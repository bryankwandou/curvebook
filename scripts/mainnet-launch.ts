// One real launch on a live mainnet config: createPool on flat-fair -> one small buy.
// Default is a dry run (simulateTransaction, nothing sent). SEND=1 signs and sends.
// Writes addresses and signatures to mainnet-launch.json.
//
//   KEYPAIR=~/.config/solana/curvebook-deployer.json npx tsx scripts/mainnet-launch.ts          (dry run)
//   KEYPAIR=... SEND=1 npx tsx scripts/mainnet-launch.ts                                         (real)
import { readFileSync, writeFileSync } from 'node:fs'
import BN from 'bn.js'
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js'

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const WSOL = new PublicKey('So11111111111111111111111111111111111111112')
const PRESET = 'flat-fair'
const BUY_SOL = Number(process.env.BUY_SOL ?? 0.01)
const METADATA = 'https://curvebook-kappa.vercel.app/demo-token.json'
const SEND = process.env.SEND === '1'

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR!, 'utf8'))))
const connection = new Connection(process.env.RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed')
if ((await connection.getGenesisHash()) !== MAINNET_GENESIS) throw new Error('RPC is not mainnet')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const deployed = JSON.parse(readFileSync(new URL('../src/deployed.json', import.meta.url), 'utf8'))
const config = new PublicKey(deployed[PRESET].config)

const before = await connection.getBalance(payer.publicKey)
console.log(`payer ${payer.publicKey.toBase58()}  ${before / LAMPORTS_PER_SOL} SOL (mainnet)  ${SEND ? 'SENDING' : 'dry run'}`)

const mint = Keypair.generate()
const createPoolTx = await client.creator.createPool({
  baseMint: mint.publicKey,
  config,
  name: 'curvebook flat-fair',
  symbol: 'CBK',
  uri: METADATA,
  payer: payer.publicKey,
  poolCreator: payer.publicKey,
})
const pool = deriveDbcPoolAddress(WSOL, mint.publicKey, config)

if (!SEND) {
  const { blockhash } = await connection.getLatestBlockhash()
  createPoolTx.recentBlockhash = blockhash
  createPoolTx.feePayer = payer.publicKey
  createPoolTx.sign(payer, mint)
  const sim = await connection.simulateTransaction(createPoolTx, undefined, [payer.publicKey])
  if (sim.value.err) throw new Error(`createPool simulation failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join('\n')}`)
  const after = Number(sim.value.accounts![0]!.lamports)
  const poolCost = (before - after) / LAMPORTS_PER_SOL
  // buy: the swap amount plus a token account for the bought CBK, plus fees
  const buyCost = BUY_SOL + 0.00204 + 0.0001
  console.log(`createPool ok in simulation, ${sim.value.unitsConsumed} CU, costs ${poolCost.toFixed(6)} SOL`)
  console.log(`buy ${BUY_SOL} SOL, about ${buyCost.toFixed(6)} SOL with token-account rent`)
  console.log(`total about ${(poolCost + buyCost).toFixed(6)} SOL, leaves about ${(before / LAMPORTS_PER_SOL - poolCost - buyCost).toFixed(6)} SOL`)
  process.exit(0)
}

const send = (tx: Parameters<typeof sendAndConfirmTransaction>[1], extra: Keypair[] = []) =>
  sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: 'confirmed' })

const createPool = await send(createPoolTx, [mint])
console.log(`createPool ${createPool}`)
const buy = await send(
  await client.pool.swap({
    owner: payer.publicKey,
    pool,
    amountIn: new BN(Math.round(BUY_SOL * LAMPORTS_PER_SOL)),
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false,
    referralTokenAccount: null,
  }),
)
console.log(`buy ${buy}`)
const progress = await client.state.getPoolQuoteTokenCurveProgress(pool)
const after = await connection.getBalance(payer.publicKey)
const row = {
  cluster: 'mainnet-beta',
  ranAt: new Date().toISOString(),
  preset: PRESET,
  config: config.toBase58(),
  pool: pool.toBase58(),
  mint: mint.publicKey.toBase58(),
  createPool,
  buy,
  buySol: BUY_SOL,
  curveProgress: progress,
  spentSol: (before - after) / LAMPORTS_PER_SOL,
}
writeFileSync(new URL('../mainnet-launch.json', import.meta.url), JSON.stringify(row, null, 2) + '\n')
console.log(`pool ${row.pool}  mint ${row.mint}  progress ${(progress * 100).toFixed(4)}%  spent ${row.spentSol} SOL`)
