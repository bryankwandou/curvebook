// Check DBC configs from a terminal or a launchpad's CI before anyone launches on them. Read-only.
//
//   npx tsx scripts/check.ts <config> [<config> ...]          human-readable report
//   npx tsx scripts/check.ts --json <config>                  machine-readable
//   npx tsx scripts/check.ts --fail-on warn <config>          exit 1 on warn or red (default: red only)
//
// Exit code 1 when any config has a flag at or above --fail-on, 2 when a config cannot be read.
import { Connection } from '@solana/web3.js'
import { inspectConfig } from '../src/lib/inspect'

const args = process.argv.slice(2)
const json = args.includes('--json')
const failIdx = args.indexOf('--fail-on')
const failOn = failIdx >= 0 ? args[failIdx + 1] : 'red'
const configs = args.filter((a, i) => !a.startsWith('--') && i !== failIdx + 1)
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
    const x = await inspectConfig(connection, address)
    const fails = x.flags.some((f) => failing.includes(f.severity))
    if (fails) code = Math.max(code, 1)
    out.push({ config: x.address, pass: !fails, flags: x.flags, quote: x.quote, threshold: x.threshold, multiplier: x.multiplier, earlyBuyerMultiple: x.earlyBuyerMultiple, soldPct: x.soldPct, fee: x.fee, migration: x.migration, lpLockedPct: x.lpLockedPct })
    if (!json) {
      console.log(`\n${x.address}  ${fails ? 'FAIL' : 'PASS'}`)
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
