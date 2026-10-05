// Randomized property test: N random presets (seeded, reproducible) through the same
// buildPreset → validateConfigParameters → sampleCurve path the app uses.
// Pure SDK math, no RPC, no funds. Writes fuzz-report.json.
//
//   N=5000 SEED=1 npx tsx scripts/fuzz-curves.ts
import { writeFileSync } from 'node:fs'
import { PROTOCOL_FEE_PERCENT } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { presetStats } from '../src/lib/stats'
import type { Preset, Shape } from '../src/lib/presets'

const N = Number(process.env.N ?? 5000)
const SEED = Number(process.env.SEED ?? 1)

// mulberry32
let s = SEED >>> 0
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]
const logUniform = (lo: number, hi: number) => Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)))

function randomPreset(i: number): { p: Preset; expectValid: boolean } {
  const quote = rand() < 0.75 ? 'SOL' : 'USDC'
  const initialMarketCap = +(quote === 'SOL' ? logUniform(5, 5_000) : logUniform(1_000, 5_000_000)).toPrecision(4)
  // 1 in 20 cases is deliberately broken: graduation at or below the start
  const broken = rand() < 0.05
  const migrationMarketCap = broken
    ? +(initialMarketCap * (0.2 + rand() * 0.8)).toPrecision(4)
    : +(initialMarketCap * logUniform(1.2, 40)).toPrecision(4)
  const startFeeBps = Math.round(logUniform(25, 5000))
  const scheduled = rand() < 0.5
  const endFeeBps = scheduled ? Math.max(25, Math.round(startFeeBps * rand())) : startFeeBps
  return {
    expectValid: !broken,
    p: {
      id: `fuzz-${i}`,
      name: `fuzz ${i}`,
      tagline: '',
      bestFor: '',
      shape: pick<Shape>(['flat', 'early', 'long']),
      quote,
      initialMarketCap,
      migrationMarketCap,
      supply: pick([1_000_000, 10_000_000, 100_000_000, 1_000_000_000]),
      startFeeBps,
      endFeeBps,
      feeDurationSec: scheduled && endFeeBps !== startFeeBps ? Math.round(logUniform(12, 3600)) : 0,
      creatorFeePct: Math.round(rand() * 100),
      poolCreationFeeSol: pick([0, 0.01, 0.02, 0.05]),
    },
  }
}

type Fail = { case: number; check: string; detail: string; preset: Preset }
const fails: Fail[] = []
const rejectedByValidator: { case: number; error: string; preset: Preset }[] = []
let passed = 0
let invalidRejected = 0
const t0 = Date.now()

for (let i = 0; i < N; i++) {
  const { p, expectValid } = randomPreset(i)
  const r = presetStats(p)
  const fail = (check: string, detail: string) => fails.push({ case: i, check, detail, preset: p })

  if (!expectValid) {
    if (r.ok) fail('rejects graduation <= start', `accepted mig ${p.migrationMarketCap} <= init ${p.initialMarketCap}`)
    else invalidRejected++
    continue
  }
  if (!r.ok) {
    // the SDK may refuse extreme combos (e.g. fee ranges); record them, they are not invariant breaks
    rejectedByValidator.push({ case: i, error: r.error, preset: p })
    continue
  }
  const st = r.stats
  const pts = st.points
  let ok = true
  const check = (cond: boolean, name: string, detail: string) => {
    if (!cond) { ok = false; fail(name, detail) }
  }
  for (let k = 1; k < pts.length; k++) {
    check(pts[k].price >= pts[k - 1].price * (1 - 1e-12), 'price never falls', `step ${k}: ${pts[k - 1].price} → ${pts[k].price}`)
    check(pts[k].sold >= pts[k - 1].sold, 'sold never falls', `step ${k}`)
    check(pts[k].raised >= pts[k - 1].raised, 'raised never falls', `step ${k}`)
    if (!ok) break
  }
  const qd = p.quote === 'SOL' ? 1e9 : 1e6
  const threshold = Number(st.params.migrationQuoteThreshold.toString()) / qd
  check(Math.abs(st.raised - threshold) / threshold < 1e-3, 'graduates at the migration threshold', `raised ${st.raised} vs threshold ${threshold}`)
  check(st.soldPct > 0 && st.soldPct < 100, 'sells part of supply, never more', `soldPct ${st.soldPct}`)
  const startMc = st.startPrice * p.supply
  check(Math.abs(startMc - p.initialMarketCap) / p.initialMarketCap < 0.01, 'start price matches start market cap', `${startMc} vs ${p.initialMarketCap}`)
  const wantMult = p.migrationMarketCap / p.initialMarketCap
  check(Math.abs(st.multiplier - wantMult) / wantMult < 0.02, 'graduation multiple matches market-cap ratio', `${st.multiplier} vs ${wantMult}`)
  check(Math.abs(st.authorShare + st.creatorShare - (1 - PROTOCOL_FEE_PERCENT / 100)) < 1e-9, 'fee shares sum to 100% minus protocol', `${st.authorShare} + ${st.creatorShare}`)
  if (ok) passed++
}

const valid = N - (invalidRejected + fails.filter((f) => f.check === 'rejects graduation <= start').length)
const report = {
  ranAt: new Date().toISOString(),
  seed: SEED,
  cases: N,
  ms: Date.now() - t0,
  validCases: valid,
  passedAllInvariants: passed,
  rejectedBySdkValidator: rejectedByValidator.length,
  invalidCases: N - valid,
  invalidCorrectlyRejected: invalidRejected,
  invariantFailures: fails.length,
  checks: [
    'SDK validateConfigParameters accepts the config',
    'price, sold and raised never decrease along the curve',
    'curve graduates within 0.1% of migrationQuoteThreshold',
    'sold share of supply is between 0 and 100%',
    'start price × supply within 1% of start market cap',
    'graduation/start price within 2% of the market-cap ratio',
    'author + creator fee share = 100% − protocol fee',
    'graduation market cap <= start market cap is rejected',
  ],
  sdkRejections: Object.entries(
    rejectedByValidator.reduce<Record<string, number>>((m, r) => ((m[r.error] = (m[r.error] ?? 0) + 1), m), {}),
  ).map(([error, count]) => ({ error, count })),
  failures: fails.slice(0, 50),
}
writeFileSync(new URL('../fuzz-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, failures: report.failures.length, sdkRejections: report.sdkRejections.slice(0, 8) }, null, 2))
process.exit(fails.length ? 1 : 0)
