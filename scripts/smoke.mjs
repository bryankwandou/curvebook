// Daily check that the deployed API still gives the known answers (run by .github/workflows/data.yml). No deps.
//   node scripts/smoke.mjs        (SITE=... to test another deployment)
const SITE = process.env.SITE ?? 'https://curvebook-kappa.vercel.app'
const cases = [
  // DAMM v2 pool whose withdrawable LP was removed 3 min after graduating (2026-10-10): gone cannot come back down
  ['USTdxXk3BZTAX43TjAbrS4Hnb1iVVyvGeqtkvLzLPGJ', 200, (j) => j.verdict === 'red' && j.status?.graduation?.gonePct >= 50],
  // pool on a config that permanently locks all LP: nothing can be withdrawn
  ['75qK2pbYCbA85pnHh14q1r24UBpN3xFGNPVwNB5DQrus', 200, (j) => j.status?.graduation?.gonePct < 10],
  // our own token, resolved from its mint to the Flat Fair config
  ['9yVLMokYuoC2KWMESmD1XUY3jmFJmasEw4FKPxZZ6gfS', 200, (j) => j.kind === 'mint' && j.config === '7Cybv7xUZn3JhvZfGQF9h9s7bLWQhNNcqs1yQVGPprPK'],
  // a wallet is not a DBC token
  ['GNuQ8FoXKAsq1i5QaT3o3Cjtevo7MAyRsAKiWB4Z2as8', 404, (j) => typeof j.error === 'string'],
]
let failed = 0
for (const [address, status, ok] of cases) {
  // a fresh query string each run, so the check hits the function and not yesterday's cached answer
  const r = await fetch(`${SITE}/api/check?address=${address}&smoke=${Date.now()}`)
  const j = await r.json().catch(() => ({}))
  const pass = r.status === status && ok(j)
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${address} ${r.status} ${j.verdict ?? j.error ?? ''}`)
}
const badge = await (await fetch(`${SITE}/api/badge?address=${cases[0][0]}&smoke=${Date.now()}`)).text()
const badgeOk = /aria-label="curvebook: LP \d+% gone"/.test(badge)
if (!badgeOk) failed++
console.log(`${badgeOk ? 'ok  ' : 'FAIL'} badge ${(badge.match(/aria-label="([^"]+)"/) ?? [])[1] ?? badge.slice(0, 80)}`)
if (failed) {
  console.error(`${failed} smoke check(s) failed against ${SITE}`)
  process.exit(1)
}
