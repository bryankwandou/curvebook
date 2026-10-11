// Runs inside the curvebook GitHub Action (action.yml): checks each address against the public API and fails the job
// on a red flag (or on a warning with fail-on: warn). No install step: Node's fetch only.
import { appendFileSync } from 'node:fs'

const API = (process.env.API || 'https://curvebook-kappa.vercel.app').replace(/\/$/, '')
const failOn = process.env.FAIL_ON === 'warn' ? 'warn' : 'red'
const addresses = (process.env.ADDRESSES || '').split(/[\s,]+/).filter(Boolean)
if (!addresses.length) {
  console.log('::error::no addresses given')
  process.exit(1)
}

const RANK = { ok: 0, warn: 1, red: 2 }
let worst = 'ok'
const summary = ['| Address | Verdict | Flags |', '| --- | --- | --- |']
for (const a of addresses) {
  let r
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API}/api/check?address=${encodeURIComponent(a)}`)
    r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (res.status < 500) break
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)))
  }
  if (r.error) {
    console.log(`::error::${a}: ${r.error}`)
    summary.push(`| \`${a}\` | error | ${r.error} |`)
    worst = 'red'
    continue
  }
  const flags = r.flags.filter((f) => f.severity !== 'info')
  console.log(`${r.verdict.toUpperCase()}  ${a}  ${r.reportUrl}`)
  for (const f of flags) console.log(`${f.severity === 'red' ? '::error' : '::warning'}::${a}: ${f.title}. ${f.detail}`)
  summary.push(`| [\`${a.slice(0, 4)}…${a.slice(-4)}\`](${r.reportUrl}) | ${r.verdict} | ${flags.map((f) => f.title).join('; ') || 'none'} |`)
  if (RANK[r.verdict] > RANK[worst]) worst = r.verdict
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### curvebook DBC check\n\n${summary.join('\n')}\n`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${worst}\n`)
if (RANK[worst] >= RANK[failOn]) {
  console.log(`::error::curvebook: worst verdict is ${worst} (fail-on: ${failOn})`)
  process.exitCode = 1
}
