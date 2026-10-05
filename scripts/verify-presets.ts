// Builds every preset, runs the SDK's own config validator, samples the curve,
// and simulates the createConfig transaction against mainnet (no signature, no funds moved).
import { DynamicBondingCurveClient, validateConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage } from '@solana/web3.js'
import { PRESETS, buildPreset, quoteDecimals, quoteMint } from '../src/lib/presets'
import { sampleCurve } from '../src/lib/curve'

const RPC = process.env.RPC ?? 'https://api.mainnet-beta.solana.com'
// any funded system account works as a simulated fee payer; nothing is signed or sent
const SIM_PAYER = new PublicKey(process.env.SIM_PAYER ?? '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')

const connection = new Connection(RPC, 'confirmed')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
let failed = 0

for (const p of PRESETS) {
  const params = buildPreset(p)
  try {
    validateConfigParameters({ ...params, leftoverReceiver: SIM_PAYER })
  } catch (e) {
    failed++
    console.log(`FAIL ${p.id} validate: ${(e as Error).message}`)
    continue
  }
  const pts = sampleCurve({
    sqrtStartPrice: params.sqrtStartPrice,
    curve: params.curve,
    migrationQuoteThreshold: params.migrationQuoteThreshold,
    baseDecimals: 6,
    quoteDecimals: quoteDecimals(p),
  })
  const end = pts[pts.length - 1]
  const mult = end.price / pts[0].price
  console.log(
    `ok   ${p.id.padEnd(16)} start ${pts[0].price.toExponential(3)} ${p.quote}  grad ${end.price.toExponential(3)}  x${mult.toFixed(1)}  ` +
      `sold ${((end.sold / p.supply) * 100).toFixed(1)}%  raised ${end.raised.toFixed(2)} ${p.quote}  points ${params.curve.length}`,
  )

  if (process.env.SKIP_SIM) continue
  const config = Keypair.generate()
  const tx = await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer: SIM_PAYER,
    leftoverReceiver: SIM_PAYER,
    payer: SIM_PAYER,
    quoteMint: quoteMint(p),
    ...params,
  })
  const { blockhash } = await connection.getLatestBlockhash()
  const msg = new TransactionMessage({ payerKey: SIM_PAYER, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message()
  const sim = await connection.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true })
  if (sim.value.err) {
    failed++
    console.log(`FAIL ${p.id} simulate: ${JSON.stringify(sim.value.err)}\n  ${(sim.value.logs ?? []).slice(-6).join('\n  ')}`)
  } else {
    console.log(`     simulate createConfig on mainnet: ok, ${sim.value.unitsConsumed} CU`)
  }
}
process.exit(failed ? 1 : 0)
