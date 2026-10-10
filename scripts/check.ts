// Check DBC configs, pools or tokens from a terminal or a launchpad's CI. Read-only.
// A token or pool is resolved to its config; for one that already graduated, it also reports how much of the
// liquidity it graduated with is gone (a red flag at 50% or more). Same report as GET /api/check (src/lib/report.ts).
//
//   npx tsx scripts/check.ts <config|pool|token> [...]          human-readable report
//   npx tsx scripts/check.ts --json <address>                  machine-readable
//   npx tsx scripts/check.ts --fail-on warn <address>          exit 1 on warn or red (default: red only)
//
// Exit code 1 when any address has a flag at or above --fail-on, 2 when an address cannot be read.
// RPC=... a private RPC is best: public ones keep little transaction history, so graduated-pool checks may be skipped.
import { Connection } from '@solana/web3.js'
import { buildReport, type Report } from '../src/lib/report'

const args = process.argv.slice(2)
const json = args.includes('--json')
const failIdx = args.indexOf('--fail-on')
const failOn = failIdx >= 0 ? args[failIdx + 1] : 'red'
const addresses = args.filter((a, i) => !a.startsWith('--') && (failIdx < 0 || i !== failIdx + 1))
if (!addresses.length || !['red', 'warn', 'info'].includes(failOn)) {
  console.error('usage: check.ts [--json] [--fail-on red|warn|info] <config|pool|token> [...]')
  process.exit(2)
}
const failing = { red: ['red'], warn: ['red', 'warn'], info: ['red', 'warn', 'info'] }[failOn as 'red']

const connection = new Connection(process.env.RPC ?? 'https://solana-rpc.publicnode.com', 'confirmed')
let code = 0
const out: ((Report & { pass: boolean }) | { input: string; error: string })[] = []
for (const address of addresses) {
  try {
    const r = await buildReport(connection, connection, address)
    const pass = !r.flags.some((f) => failing.includes(f.severity))
    if (!pass) code = Math.max(code, 1)
    out.push({ ...r, pass })
    if (json) continue
    const c = r.curve
    const st = r.status
    console.log(`\n${address}  ${pass ? 'PASS' : 'FAIL'}${r.kind === 'config' ? '' : `  (${r.kind}; config ${r.config})`}`)
    if (st && !st.migrated) console.log(`  on the curve: ${(st.progress * 100).toFixed(2)}% to graduation`)
    if (st?.graduation) {
      const g = st.graduation
      console.log(`  graduated ${new Date(g.time * 1000).toISOString().slice(0, 16)} to DAMM ${g.kind === 'damm_v2' ? 'v2' : 'v1'} ${g.dammPool}; liquidity gone since: ${g.gonePct === null ? 'unknown' : g.gonePct + '%'}`)
    } else if (st?.migrated) console.log('  graduated; migration transaction not found in the recent history this RPC keeps')
    console.log(`  ${c.quote}, graduates at ${+c.graduatesAt.toPrecision(3)} ${c.quote}, ${c.openToGraduation.toFixed(2)}x open → graduation, ${c.soldOnCurvePct.toFixed(1)}% sold on curve`)
    console.log(`  fee ${c.fee}; ${c.migration}; LP ${c.lpPermanentlyLockedPct}% permanently locked`)
    for (const f of r.flags) console.log(`  [${f.severity}] ${f.title}: ${f.detail}`)
    if (!r.flags.length) console.log('  no flags')
  } catch (e) {
    code = 2
    out.push({ input: address, error: (e as Error).message })
    if (!json) console.log(`\n${address}  ERROR ${(e as Error).message}`)
  }
}
if (json) console.log(JSON.stringify(out, null, 2))
process.exit(code)
