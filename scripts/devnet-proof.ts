// End-to-end run on devnet, against the same DBC program id as mainnet:
// createConfig for every SOL preset -> createPool on it -> one buy -> read the curve progress.
// Writes every address and signature to devnet-proof.json.
//
//   KEYPAIR=path/to/devnet-wallet.json RPC=https://devnet-rpc npx tsx scripts/devnet-proof.ts
import { readFileSync, writeFileSync } from 'node:fs'
import BN from 'bn.js'
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'
import { PRESETS, buildPreset, quoteMint } from '../src/lib/presets'

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const BUY_SOL = 0.2
const METADATA = 'https://curvebook-kappa.vercel.app/demo-token.json'

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR!, 'utf8'))))
const connection = new Connection(process.env.RPC ?? 'https://api.devnet.solana.com', 'confirmed')
if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error('RPC is not devnet; refusing to run')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const send = (tx: Parameters<typeof sendAndConfirmTransaction>[1], extra: Keypair[] = []) =>
  sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: 'confirmed' })

const proof: Record<string, unknown>[] = []
console.log(`payer ${payer.publicKey.toBase58()}  ${(await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL (devnet)`)

// the USDC preset quotes mainnet USDC, which has no mint on devnet
for (const p of PRESETS.filter((x) => x.quote === 'SOL')) {
  const config = Keypair.generate()
  const createConfig = await send(
    await client.partner.createConfig({
      config: config.publicKey,
      feeClaimer: payer.publicKey,
      leftoverReceiver: payer.publicKey,
      payer: payer.publicKey,
      quoteMint: quoteMint(p),
      ...buildPreset(p),
    }),
    [config],
  )

  const mint = Keypair.generate()
  const createPool = await send(
    await client.creator.createPool({
      baseMint: mint.publicKey,
      config: config.publicKey,
      name: `curvebook ${p.name}`.slice(0, 32),
      symbol: 'CBK',
      uri: METADATA,
      payer: payer.publicKey,
      poolCreator: payer.publicKey,
    }),
    [mint],
  )
  const pool = deriveDbcPoolAddress(quoteMint(p), mint.publicKey, config.publicKey)

  const buy = await send(
    await client.pool.swap({
      owner: payer.publicKey,
      pool,
      amountIn: new BN(BUY_SOL * LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      swapBaseForQuote: false,
      referralTokenAccount: null,
    }),
  )
  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool)

  const row = {
    preset: p.id,
    config: config.publicKey.toBase58(),
    pool: pool.toBase58(),
    mint: mint.publicKey.toBase58(),
    createConfig,
    createPool,
    buy,
    buySol: BUY_SOL,
    curveProgress: progress,
  }
  proof.push(row)
  console.log(`ok   ${p.id}: config ${row.config}  pool ${row.pool}  progress ${(progress * 100).toFixed(3)}%`)
}

writeFileSync(new URL('../devnet-proof.json', import.meta.url), JSON.stringify({ cluster: 'devnet', ranAt: new Date().toISOString(), runs: proof }, null, 2) + '\n')
