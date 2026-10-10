// Full lifecycle on devnet, same DBC program id as mainnet: createConfig -> createPool -> buy until the curve
// completes -> migrateToDammV2 -> read the DAMM v2 pool and both LP positions back.
// The curve is the Flat Fair preset with both market caps divided by SCALE, so graduation fits a devnet budget;
// shape, fees, LP split and migration settings are unchanged. Writes devnet-graduation.json.
//
//   KEYPAIR=path/to/devnet-wallet.json npx tsx scripts/devnet-graduate.ts
import { readFileSync, writeFileSync } from 'node:fs'
import BN from 'bn.js'
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DAMM_V2_PROGRAM_ID,
  DynamicBondingCurveClient,
  SwapMode,
  createDammV2Program,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  derivePositionAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'
import { PRESETS, SOL_MINT, buildPreset } from '../src/lib/presets'

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const SCALE = 150
const METADATA = 'https://curvebook-kappa.vercel.app/demo-token.json'

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR!, 'utf8'))))
const connection = new Connection(process.env.RPC ?? 'https://api.devnet.solana.com', 'confirmed')
if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error('RPC is not devnet; refusing to run')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const send = (tx: Parameters<typeof sendAndConfirmTransaction>[1], extra: Keypair[] = []) =>
  sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: 'confirmed' })
const sol = (n: unknown) => Number(String(n)) / LAMPORTS_PER_SOL

const base = PRESETS.find((p) => p.id === 'flat-fair')!
const preset = { ...base, initialMarketCap: base.initialMarketCap / SCALE, migrationMarketCap: base.migrationMarketCap / SCALE }
const params = buildPreset(preset)
const before = await connection.getBalance(payer.publicKey)
console.log(`payer ${payer.publicKey.toBase58()}  ${before / LAMPORTS_PER_SOL} SOL (devnet)`)
console.log(`flat-fair / ${SCALE}: market cap ${preset.initialMarketCap} -> ${preset.migrationMarketCap} SOL, threshold ${sol(params.migrationQuoteThreshold)} SOL`)

const config = Keypair.generate()
const createConfig = await send(
  await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    payer: payer.publicKey,
    quoteMint: SOL_MINT,
    ...params,
  }),
  [config],
)
console.log(`createConfig ${createConfig}`)

const mint = Keypair.generate()
const createPool = await send(
  await client.creator.createPool({
    baseMint: mint.publicKey,
    config: config.publicKey,
    name: 'curvebook graduation',
    symbol: 'CBKG',
    uri: METADATA,
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
  }),
  [mint],
)
const pool = deriveDbcPoolAddress(SOL_MINT, mint.publicKey, config.publicKey)
console.log(`createPool ${createPool}  pool ${pool.toBase58()}`)

// PartialFill: the program fills up to the migration threshold and leaves the rest of the input in the wallet
const buyIn = new BN(params.migrationQuoteThreshold.toString()).muln(13).divn(10)
const buy = await send(
  await client.pool.swap2({
    owner: payer.publicKey,
    pool,
    swapBaseForQuote: false,
    referralTokenAccount: null,
    swapMode: SwapMode.PartialFill,
    amountIn: buyIn,
    minimumAmountOut: new BN(0),
  }),
)
const progress = await client.state.getPoolQuoteTokenCurveProgress(pool)
console.log(`buy ${buy}  curve progress ${(progress * 100).toFixed(2)}%`)
if (progress < 1) throw new Error('curve did not complete')

const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[params.migrationFeeOption]
const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = await client.migration.migrateToDammV2({
  payer: payer.publicKey,
  pool,
  dammConfig,
})
const migrate = await send(transaction, [firstPositionNftKeypair, secondPositionNftKeypair])
console.log(`migrateToDammV2 ${migrate}`)

const raw: any = await client.state.getPool(pool)
const virtualPool = raw.poolState ?? raw
const dammPool = deriveDammV2PoolAddress(dammConfig, mint.publicKey, SOL_MINT)
const damm = createDammV2Program(connection)
const dammState: any = await (damm.account as any).pool.fetch(dammPool)
const positions = []
for (const nft of [firstPositionNftKeypair, secondPositionNftKeypair]) {
  const address = derivePositionAddress(nft.publicKey)
  const p: any = await (damm.account as any).position.fetch(address)
  positions.push({
    position: address.toBase58(),
    nftMint: nft.publicKey.toBase58(),
    unlockedLiquidity: p.unlockedLiquidity.toString(),
    vestedLiquidity: p.vestedLiquidity.toString(),
    permanentLockedLiquidity: p.permanentLockedLiquidity.toString(),
  })
}
const owner = (await connection.getAccountInfo(dammPool))!.owner
const after = await connection.getBalance(payer.publicKey)

const out = {
  cluster: 'devnet',
  ranAt: new Date().toISOString(),
  preset: `flat-fair, market caps / ${SCALE}`,
  migrationQuoteThresholdSol: sol(params.migrationQuoteThreshold),
  config: config.publicKey.toBase58(),
  pool: pool.toBase58(),
  mint: mint.publicKey.toBase58(),
  createConfig,
  createPool,
  buy,
  curveProgress: progress,
  migrateToDammV2: migrate,
  isMigrated: Number(virtualPool.isMigrated) !== 0,
  dammV2: {
    program: DAMM_V2_PROGRAM_ID.toBase58(),
    ownerMatches: owner.equals(DAMM_V2_PROGRAM_ID),
    config: dammConfig.toBase58(),
    pool: dammPool.toBase58(),
    liquidity: dammState.liquidity.toString(),
    permanentLockLiquidity: dammState.permanentLockLiquidity.toString(),
    positions,
  },
  allLpPermanentlyLocked:
    positions.every((p) => p.unlockedLiquidity === '0' && p.vestedLiquidity === '0' && p.permanentLockedLiquidity !== '0'),
  spentSol: (before - after) / LAMPORTS_PER_SOL,
}
writeFileSync(new URL('../devnet-graduation.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify({ isMigrated: out.isMigrated, dammPool: out.dammV2.pool, ownerMatches: out.dammV2.ownerMatches, allLpPermanentlyLocked: out.allLpPermanentlyLocked, spentSol: out.spentSol }))
