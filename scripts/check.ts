// Check DBC configs, pools or tokens from a terminal or a launchpad's CI. Read-only.
// A token or pool is resolved to its config; for one that already graduated, it also reports how much of the
// liquidity it graduated with is gone (a red flag at 50% or more).
//
//   npx tsx scripts/check.ts <config|pool|token> [...]          human-readable report
//   npx tsx scripts/check.ts --json <config>                  machine-readable
//   npx tsx scripts/check.ts --fail-on warn <config>          exit 1 on warn or red (default: red only)
//
// Exit code 1 when any config has a flag at or above --fail-on, 2 when a config cannot be read.
import { Connection } from '@solana/web3.js'
import { inspectConfig } from '../src/lib/inspect'
import { poolStatus, resolveTarget } from '../src/lib/target'

const args = process.argv.slice(2)
const json = args.includes('--json')
const failIdx = args.indexOf('--fail-on')
const failOn = failIdx >= 0 ? args[failIdx + 1] : 'red'
const configs = args.filter((a, i) => !a.startsWith('--') && (failIdx < 0 || i !== failIdx + 1))
if (!configs.length || !['red', 'warn', 'info'].includes(failOn)) {
  console.error('usage: check.ts [--json] [--fail-on red|warn|info] <config> [<config> ...]')
  process.exit(2)
}
const failing = { red: ['red'], warn: ['red', 'warn'], info: ['red', 'warn', 'info'] }[failOn as 'red']

const connection = new Connection(process.env.RPC ?? 'https://solana-rpc.publicnode.com', 'confirmed')
let code = 0
const out = []
for (const address of configs) {
  try {
    const t = await resolveTarget(connection, connection, address)
    const x = await inspectConfig(connection, t.config)
    const st = t.pool ? await poolStatus(connection, t) : null
    const gone = st?.graduation?.gonePct ?? null
    if (gone !== null && gone >= 50)
      x.flags.unshift({ severity: 'red', title: `${Math.round(gone)}% of the graduation liquidity is gone`, detail: `DAMM pool ${st!.graduation!.dammPool}, migration ${st!.graduation!.signature}.` })
    const fails = x.flags.some((f) => failing.includes(f.severity))
    if (fails) code = Math.max(code, 1)
    out.push({ input: address, kind: t.kind, pool: t.pool, token: t.baseMint, status: st, config: x.address, pass: !fails, flags: x.flags, quote: x.quote, threshold: x.threshold, multiplier: x.multiplier, earlyBuyerMultiple: x.earlyBuyerMultiple, soldPct: x.soldPct, fee: x.fee, migration: x.migration, lpLockedPct: x.lpLockedPct })
    if (!json) {
      console.log(`\n${address}  ${fails ? 'FAIL' : 'PASS'}${t.kind === 'config' ? '' : `  (${t.kind}; config ${x.address})`}`)
      if (st && !st.migrated) console.log(`  on the curve: ${(st.progress * 100).toFixed(2)}% to graduation`)
      if (st?.graduation)
        console.log(`  graduated ${new Date(st.graduation.time * 1000).toISOString().slice(0, 16)} to DAMM ${st.graduation.kind === 'damm_v2' ? 'v2' : 'v1'} ${st.graduation.dammPool}; liquidity gone since: ${gone === null ? 'unknown' : gone + '%'}`)
      console.log(`  ${x.quote}, graduates at ${+x.threshold.toPrecision(3)} ${x.quote}, ${x.multiplier.toFixed(2)}x open → graduation, ${x.soldPct.toFixed(1)}% sold on curve`)
      console.log(`  fee ${x.fee}; ${x.migration}; LP ${x.lpLockedPct}% permanently locked`)
      for (const f of x.flags) console.log(`  [${f.severity}] ${f.title}: ${f.detail}`)
      if (!x.flags.length) console.log('  no flags')
    }
  } catch (e) {
    code = 2
    out.push({ config: address, error: (e as Error).message })
    if (!json) console.log(`\n${address}  ERROR ${(e as Error).message}`)
  }
}
if (json) console.log(JSON.stringify(out, null, 2))
process.exit(code)
