// Offline checks, run in CI on every push: `npm test`. No RPC, no keys.
// Covers the preset math, the published graduation data, and the submission page (both broke once).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PRESETS } from '../src/lib/presets'
import { presetStats } from '../src/lib/stats'
import { riskFlags } from '../src/lib/risk'
import BN from 'bn.js'

let passed = 0
function test(name: string, f: () => void) {
  f()
  passed++
  console.log(`ok  ${name}`)
}
const json = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))

// 1. presets: valid for the SDK, the advertised open → graduation multiple, a monotonic curve that ends at the threshold
const advertised: Record<string, number> = { 'flat-fair': 5, 'early-discovery': 16, 'long-curve': 20, 'stock-pair-usdc': 1.8 }
for (const p of PRESETS) {
  test(`preset ${p.id}: valid, ${advertised[p.id]}x, curve monotonic and ends at the threshold`, () => {
    const r = presetStats(p)
    assert.ok(r.ok, r.ok ? '' : r.error)
    const s = r.stats
    assert.ok(Math.abs(s.multiplier / advertised[p.id] - 1) < 0.01, `multiplier ${s.multiplier}`)
    for (let i = 1; i < s.points.length; i++) {
      assert.ok(s.points[i].price >= s.points[i - 1].price, 'price decreased')
      assert.ok(s.points[i].raised >= s.points[i - 1].raised, 'raised decreased')
    }
    const threshold = Number(s.params.migrationQuoteThreshold.toString()) / 10 ** (p.quote === 'SOL' ? 9 : 6)
    assert.ok(Math.abs(s.raised / threshold - 1) < 0.001, `raised ${s.raised} vs threshold ${threshold}`)
  })
}

// 2. graduation scan: the published share is recomputable from the per-config rows with the stated rule
test('graduated-configs.json: classification adds up and follows its rule', () => {
  const scan = json('graduated-configs.json')
  let total = 0
  let listings = 0
  let undecoded = 0
  for (const c of scan.allConfigs) {
    total += c.graduatedPools
    if (c.listing === null) undecoded += c.graduatedPools
    else {
      assert.equal(c.listing, c.multiplier <= 1.25 || c.threshold < 0.01, `rule mismatch on ${c.config}`)
      if (c.listing) listings += c.graduatedPools
    }
  }
  assert.deepEqual({ graduations: total, listings, undecoded }, scan.classification.all)
  const sum = (f: (c: { lpUnlockedPct: number; lpVesting: boolean; mintAuthority: boolean }) => boolean) =>
    scan.allConfigs.filter((c: { lpUnlockedPct: number | null }) => c.lpUnlockedPct !== null).filter(f).reduce((n: number, c: { graduatedPools: number }) => n + c.graduatedPools, 0)
  const { lpMostlyWithdrawable, lpAllLocked, mintAuthorityKept } = scan.classification.safety
  assert.equal(sum((c) => c.lpUnlockedPct >= 50), lpMostlyWithdrawable)
  assert.equal(sum((c) => c.lpUnlockedPct === 0), lpAllLocked)
  assert.equal(sum((c) => c.mintAuthority), mintAuthorityKept)
  assert.equal(total, scan.graduatedPools)
  assert.equal(scan.allConfigs.length, scan.distinctConfigs)
})

test('lp-outcomes.json: classes add up, and the control (all LP locked) mostly shows no loss', () => {
  const o = json('lp-outcomes.json')
  const classes = Object.values(o.byClass) as { graduations: number; lostHalfOrMore: number }[]
  assert.equal(classes.reduce((n, c) => n + c.graduations, 0), o.measured)
  assert.equal(o.byKind.damm_v1.graduations + o.byKind.damm_v2.graduations, o.measured)
  for (const c of classes) assert.ok(c.lostHalfOrMore <= c.graduations)
  // if pools on fully locked configs lose liquidity often, the measurement is broken, not the pools
  assert.ok(o.byClass.locked.lostHalfOrMore <= o.byClass.locked.graduations * 0.1, `control: ${o.byClass.locked.lostHalfOrMore} of ${o.byClass.locked.graduations}`)
})

// 3. on-chain proof files agree with each other
test('mainnet launch is on the flat-fair config that deployed.json lists', () => {
  assert.equal(json('mainnet-launch.json').config, json('src/deployed.json')['flat-fair'].config)
})
test('devnet graduation: migrated and all LP permanently locked', () => {
  const g = json('devnet-graduation.json')
  assert.ok(g.isMigrated && g.allLpPermanentlyLocked && g.dammV2.ownerMatches)
  const locked = g.dammV2.positions.reduce((n: bigint, p: { permanentLockedLiquidity: string }) => n + BigInt(p.permanentLockedLiquidity), 0n)
  assert.equal(locked, BigInt(g.dammV2.liquidity))
})

// 4. submission page: its script parses, and the form fields fit their limits
test('public/submit.html: script parses, description ≤ 3000, tweet ≤ 280', () => {
  const html = readFileSync(new URL('../public/submit.html', import.meta.url), 'utf8')
  const js = html.split('<script>')[1].split('</script>')[0]
  const F: [string, string][] = new Function('document', 'navigator', 'getSelection', js.replace('const root', 'return F;const root'))()
  const field = (name: string) => F.find((f) => f[0].startsWith(name))![1]
  assert.ok(field('Project Description').length <= 3000, `description ${field('Project Description').length}`)
  assert.ok(field('Tweet text').replace(/https:\S+/g, 'x'.repeat(23)).length <= 280, 'tweet too long')
})

// 5. risk flags: each rule fires on a config built to trip it, and a clean config gets none
test('risk flags: mint authority, withdrawable LP, never-decaying fee, vesting; clean config has none', () => {
  const cfg = (o: Record<string, unknown> = {}) =>
    ({
      tokenUpdateAuthority: 1,
      partnerLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      partnerLiquidityVestingInfo: { isInitialized: 0 },
      creatorLiquidityVestingInfo: { isInitialized: 0 },
      lockedVestingConfig: { cliffUnlockAmount: new BN(0), amountPerPeriod: new BN(0), numberOfPeriod: new BN(0) },
      migrationFeePercentage: 0,
      creatorMigrationFeePercentage: 0,
      ...o,
    }) as never
  const base = { baseDecimals: 6, supply: 1e9, multiplier: 5, earlyBuyerMultiple: 3, threshold: 85, quote: 'SOL', feeStartPct: 1, feeEndPct: 1 }
  const titles = (o: Record<string, unknown>, b = {}) => riskFlags({ ...base, ...b, config: cfg(o) }).map((f) => `${f.severity}:${f.title}`)
  assert.deepEqual(titles({}), [])
  assert.ok(titles({ tokenUpdateAuthority: 3 })[0].startsWith('red:Mint authority'))
  assert.ok(titles({ partnerLiquidityPercentage: 89 })[0].startsWith('red:89% of graduation LP'))
  // vesting does not downgrade it: pools on vesting configs lost their LP as often (lp-outcomes.json)
  assert.ok(titles({ partnerLiquidityPercentage: 89, partnerLiquidityVestingInfo: { isInitialized: 1 } })[0].startsWith('red:'))
  assert.ok(titles({ partnerLiquidityPercentage: 20 })[0].startsWith('warn:20% of graduation LP'))
  assert.ok(titles({}, { feeStartPct: 15, feeEndPct: 15 })[0].startsWith('red:15% trading fee'))
  assert.deepEqual(titles({}, { feeStartPct: 60, feeEndPct: 1 }).map((t) => t.split(':')[0]), ['info'])
  const vest = { cliffUnlockAmount: new BN(0), amountPerPeriod: new BN(25e6).mul(new BN(1e6)), numberOfPeriod: new BN(10) }
  assert.ok(titles({ lockedVestingConfig: vest })[0].startsWith('warn:25.0% of supply vests'))
})

console.log(`\n${passed} passed`)
