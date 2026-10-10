// Reads every official config back from Solana mainnet and checks it against the preset it was built from.
// Read-only: no keypair, nothing signed or sent.
//
//   npx tsx scripts/verify-mainnet.ts        (RPC=... optional)
import { readFileSync, writeFileSync } from 'node:fs'
import BN from 'bn.js'
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, PublicKey } from '@solana/web3.js'
import { PRESETS, buildPreset, quoteMint } from '../src/lib/presets'

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
const connection = new Connection(process.env.RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const deployed = JSON.parse(readFileSync(new URL('../src/deployed.json', import.meta.url), 'utf8'))

const genesis = await connection.getGenesisHash()
if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet')
const slot = await connection.getSlot()
console.log(`cluster mainnet-beta (genesis ${genesis.slice(0, 8)}…)  slot ${slot}`)

const str = (v: unknown) => (v instanceof BN ? v.toString() : v instanceof PublicKey ? v.toBase58() : String(v))
const rows: Record<string, unknown>[] = []
let failures = 0

for (const p of PRESETS) {
  const d = deployed[p.id]
  const want = buildPreset(p) as any
  const checks: [string, unknown, unknown][] = []
  const tx = await connection.getTransaction(d.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  const keys = tx?.transaction.message.staticAccountKeys.map((k) => k.toBase58()) ?? []
  checks.push(['createConfig tx succeeded', tx?.meta?.err === null, true])
  checks.push(['tx signed by fee claimer', keys[0], d.feeClaimer])
  checks.push(['tx calls DBC program', keys.includes(DBC), true])
  checks.push(['tx creates this config', keys.includes(d.config), true])

  const info = await connection.getAccountInfo(new PublicKey(d.config))
  checks.push(['account owner', info?.owner.toBase58(), DBC])
  const c: any = await client.state.getPoolConfig(d.config)
  checks.push(['quote mint', str(c.quoteMint), quoteMint(p).toBase58()])
  checks.push(['fee claimer', str(c.feeClaimer), d.feeClaimer])
  checks.push(['migration quote threshold', str(c.migrationQuoteThreshold), str(want.migrationQuoteThreshold)])
  checks.push(['start price (sqrt)', str(c.sqrtStartPrice), str(want.sqrtStartPrice)])
  checks.push(['base fee (cliff)', str(c.poolFees.baseFee.cliffFeeNumerator), str(want.poolFees.baseFee.cliffFeeNumerator)])
  const sched = (b: any) => [b.cliffFeeNumerator, b.firstFactor, b.secondFactor, b.thirdFactor, b.baseFeeMode].map(str).join('/')
  checks.push(['fee schedule (cliff/periods/period/reduction/mode)', sched(c.poolFees.baseFee), sched(want.poolFees.baseFee)])
  checks.push(['pool-creation fee', str(c.poolCreationFee), str(want.poolCreationFee)])
  checks.push(['collect-fee mode', str(c.collectFeeMode), str(want.collectFeeMode)])
  checks.push(['migration target (DAMM v2)', str(c.migrationOption), str(want.migrationOption)])
  checks.push(['migration fee option', str(c.migrationFeeOption), str(want.migrationFeeOption)])
  checks.push(['token type', str(c.tokenType), str(want.tokenType)])
  checks.push(['token decimals', str(c.tokenDecimal), str(want.tokenDecimal)])
  checks.push(['creator trading-fee share', str(c.creatorTradingFeePercentage), str(want.creatorTradingFeePercentage)])
  const lp = (o: any) => [o.partnerLiquidityPercentage, o.partnerPermanentLockedLiquidityPercentage, o.creatorLiquidityPercentage, o.creatorPermanentLockedLiquidityPercentage].map(str).join('/')
  checks.push(['LP split', lp(c), lp(want)])
  const curve = (pts: any[]) => pts.filter((x) => !new BN(x.sqrtPrice).isZero()).map((x) => `${str(x.sqrtPrice)}:${str(x.liquidity)}`).join(',')
  checks.push([`curve (${want.curve.length} segments)`, curve(c.curve), curve(want.curve)])

  // a field missing on either side must fail, not compare undefined === undefined
  for (const ch of checks) if (String(ch[1]).includes('undefined') || String(ch[2]).includes('undefined')) ch[1] = `missing (${ch[1]})`
  const bad = checks.filter(([, got, exp]) => got !== exp)
  failures += bad.length
  console.log(`\n${p.name}  config ${d.config}`)
  console.log(`  created slot ${tx?.slot}  ${tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : '?'}  rent ${(info!.lamports / 1e9).toFixed(5)} SOL`)
  if (process.env.SHOW) for (const [l, g] of checks) console.log('    =', l, String(g).slice(0, 70))
  for (const [label, got, exp] of checks) console.log(`  ${got === exp ? 'ok  ' : 'FAIL'} ${label}${got === exp ? '' : `: got ${got}, want ${exp}`}`)
  rows.push({ preset: p.id, config: d.config, signature: d.signature, createdSlot: tx?.slot, blockTime: tx?.blockTime, rentLamports: info?.lamports, checks: checks.length, failed: bad.map(([l]) => l) })
}

const total = rows.length * (rows[0]?.checks as number)
console.log(`\n${rows.length} configs, ${total} checks against mainnet, ${failures} failures`)
writeFileSync(
  new URL('../mainnet-verify.json', import.meta.url),
  JSON.stringify({ cluster: 'mainnet-beta', mode: 'read-only (getTransaction + getAccountInfo)', ranAt: new Date().toISOString(), slot, configs: rows, checks: total, failures }, null, 2) + '\n',
)
if (failures) process.exit(1)
