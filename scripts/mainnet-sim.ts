// Launch + first buy on every LIVE mainnet preset config, run through simulateTransaction
// against the real mainnet DBC program. Nothing is signed or sent: sigVerify is off and the
// fee payer is a large public wallet, so no one's funds move and no token is created.
// Reads the simulated pool state back to show what the preset author (fee claimer) earns.
//
//   npx tsx scripts/mainnet-sim.ts        (RPC=... optional)
import { readFileSync, writeFileSync } from 'node:fs'
import BN from 'bn.js'
import { DynamicBondingCurveClient, createDbcProgram, deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, PublicKey, type Transaction } from '@solana/web3.js'
import { PRESETS, quoteMint } from '../src/lib/presets'

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const SOL_PAYER = new PublicKey(process.env.SIM_PAYER ?? '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
const BUY = { SOL: 1_000_000_000, USDC: 1_000_000_000 } // 1 SOL, or 1,000 USDC

const connection = new Connection(process.env.RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed')
if ((await connection.getGenesisHash()) !== MAINNET_GENESIS) throw new Error('RPC is not mainnet')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const { program } = createDbcProgram(connection, 'confirmed')
const deployed = JSON.parse(readFileSync(new URL('../src/deployed.json', import.meta.url), 'utf8'))

// a USDC holder to act as the buyer on the USDC preset
async function usdcBuyer() {
  const largest = await connection.getTokenLargestAccounts(quoteMint(PRESETS.find((p) => p.quote === 'USDC')!))
  for (const a of largest.value) {
    const info = await connection.getParsedAccountInfo(a.address)
    const owner = (info.value?.data as any)?.parsed?.info?.owner
    if (owner && PublicKey.isOnCurve(new PublicKey(owner).toBytes())) return new PublicKey(owner)
  }
  throw new Error('no on-curve USDC holder found')
}

async function simulate(tx: Transaction, watch: PublicKey[]) {
  tx.feePayer = SOL_PAYER
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  const res = await connection.simulateTransaction(tx.compileMessage(), undefined, watch.map(() => 0).length ? watch : undefined)
  return res.value
}

const rows: Record<string, unknown>[] = []
// getTokenLargestAccounts is rate-limited on the public RPC; without a holder the USDC preset is simulated as launch only
const usdcHolder = process.env.USDC_BUYER ? new PublicKey(process.env.USDC_BUYER) : await usdcBuyer().catch(() => null)

for (const p of PRESETS) {
  const d = deployed[p.id]
  if (!d) continue
  const config = new PublicKey(d.config)
  const mint = Keypair.generate()
  const buyer = p.quote === 'SOL' ? SOL_PAYER : usdcHolder
  const tx = await client.creator.createPoolWithFirstBuy({
    createPoolParam: {
      baseMint: mint.publicKey,
      config,
      name: `curvebook ${p.name}`.slice(0, 32),
      symbol: 'CBK',
      uri: 'https://curvebook-kappa.vercel.app/demo-token.json',
      payer: SOL_PAYER,
      poolCreator: SOL_PAYER,
    },
    firstBuyParam: buyer
      ? { buyer, buyAmount: new BN(BUY[p.quote]), minimumAmountOut: new BN(1), referralTokenAccount: null }
      : undefined,
  })
  const pool = deriveDbcPoolAddress(quoteMint(p), mint.publicKey, config)
  const sim = await simulate(tx, [pool])
  const row: Record<string, unknown> = {
    preset: p.id,
    config: d.config,
    ok: sim.err === null,
    err: sim.err,
    computeUnits: sim.unitsConsumed,
    buy: buyer ? `${BUY[p.quote] / (p.quote === 'SOL' ? 1e9 : 1e6)} ${p.quote}` : 'none (launch only)',
  }
  const acct = (sim as any).accounts?.[0]
  if (sim.err === null && acct) {
    const data = Buffer.from(acct.data[0], 'base64')
    const s: any = (program.coder.accounts.decode('virtualPool', data) as any).poolState
    const qd = p.quote === 'SOL' ? 1e9 : 1e6
    const rent = await connection.getMinimumBalanceForRentExemption(data.length)
    const num = (b: BN) => Number(b.toString())
    Object.assign(row, {
      quoteReserve: num(s.quoteReserve) / qd,
      authorTradingFee: num(s.partnerQuoteFee) / qd,
      creatorTradingFee: num(s.creatorQuoteFee) / qd,
      protocolTradingFee: num(s.protocolQuoteFee) / qd,
      // pool-creation fee is held as lamports on the pool account until the fee claimer claims it
      poolCreationFeeHeldSol: (acct.lamports - rent) / 1e9,
    })
  } else {
    row.logs = sim.logs?.slice(-6)
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}

writeFileSync(
  new URL('../mainnet-sim.json', import.meta.url),
  JSON.stringify({ cluster: 'mainnet-beta', mode: 'simulateTransaction (unsigned, not sent)', ranAt: new Date().toISOString(), payer: SOL_PAYER.toBase58(), runs: rows }, null, 2) + '\n',
)
