// Did the withdrawable graduation LP actually get withdrawn? Read-only. For every graduation in graduated-pools.json
// (written by scan-graduations.ts) it compares the liquidity the migration put into the DAMM pool with the pool's
// liquidity today, at pool level, so liquidity moved between positions (splits, transfers) is not mistaken for a
// withdrawal:
//   DAMM v2: liquidity at migration = the liquidity the DAMM events in the migration transaction added; today = the
//            pool account's liquidity.
//   DAMM v1: LP minted at migration vs the LP mint's supply today (withdrawing burns LP).
// "withdrawn" is the drop, capped at the share the config left withdrawable (partner + creator liquidity percentage).
// Liquidity added later by anyone hides withdrawals, so it is a lower bound. Control: in pools whose config locks
// 100% of the LP, the raw (uncapped) drop has to come out at about zero, or the measurement is wrong.
//
//   RPC=... npx tsx scripts/lp-outcomes.ts      writes lp-outcomes.json
import { readFileSync, writeFileSync } from 'node:fs'
import { createDammV2Program } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, PublicKey } from '@solana/web3.js'

const connection = new Connection(process.env.RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed')
const coder = (createDammV2Program(connection) as any).coder
const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
const { pools, ranAt: scannedAt } = read('graduated-pools.json')
const configs = new Map<string, { lpUnlockedPct: number | null; lpVesting: boolean | null }>(
  read('graduated-configs.json').allConfigs.map((c: any) => [c.config, c]),
)

async function accounts(keys: string[]) {
  const out = new Map<string, Buffer | null>()
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100)
    const infos = await connection.getMultipleAccountsInfo(batch.map((k) => new PublicKey(k)))
    infos.forEach((info, k) => out.set(batch[k], info ? Buffer.from(info.data) : null))
  }
  return out
}

const v2 = pools.filter((p: any) => p.kind === 'damm_v2' && p.dammPool && p.positions?.some((x: any) => x.liquidity !== '0'))
const v1 = pools.filter((p: any) => p.kind === 'damm_v1' && p.lpMinted)
const poolData = await accounts([...new Set<string>(v2.map((p: any) => p.dammPool))])
const mintData = await accounts([...new Set<string>(v1.map((p: any) => p.lpMint))])

type Class = 'open' | 'vesting' | 'partial' | 'locked'
const classOf = (config: string): Class | null => {
  const c = configs.get(config)
  if (!c || c.lpUnlockedPct === null) return null
  if (c.lpUnlockedPct === 0) return 'locked'
  if (c.lpUnlockedPct < 50) return 'partial'
  return c.lpVesting ? 'vesting' : 'open'
}

interface Row {
  config: string
  pool: string
  kind: 'damm_v2' | 'damm_v1'
  cls: Class
  hours: number
  /** liquidity (v2) or LP supply (v1) at migration */
  total: bigint
  /** total minus today, uncapped; negative when liquidity was added since */
  drop: bigint
  withdrawable: bigint
  withdrawn: bigint
}
const rows: Row[] = []
const now = Date.now() / 1000
function push(p: any, kind: Row['kind'], total: bigint, today: bigint) {
  const cls = classOf(p.config)
  if (!cls || total === 0n) return
  const withdrawable = (total * BigInt(configs.get(p.config)!.lpUnlockedPct!)) / 100n
  const drop = total - today
  const gone = drop > 0n ? drop : 0n
  rows.push({ config: p.config, pool: p.pool, kind, cls, hours: (now - p.time) / 3600, total, drop, withdrawable, withdrawn: gone < withdrawable ? gone : withdrawable })
}
for (const p of v2) {
  const data = poolData.get(p.dammPool)
  if (!data) continue
  const total = p.positions.reduce((n: bigint, x: any) => n + BigInt(x.liquidity), 0n)
  push(p, 'damm_v2', total, BigInt(coder.accounts.decode('pool', data).liquidity.toString()))
}
for (const p of v1) {
  const data = mintData.get(p.lpMint)
  if (data) push(p, 'damm_v1', BigInt(p.lpMinted), data.readBigUInt64LE(36))
}

const share = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 1_000_000n) / b) / 10_000)
const median = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
// share of the liquidity a pool graduated with that is gone today, from the raw drop (not capped by the config, so
// it does not depend on reading the config right), clipped at 0..100%
const gonePct = (r: Row) => Math.min(100, Math.max(0, share(r.drop, r.total)))
function summary(rs: Row[]) {
  const pulled = rs.filter((r) => r.withdrawable > 0n && r.withdrawn * 10n >= r.withdrawable * 9n)
  const some = rs.filter((r) => r.withdrawable > 0n && r.withdrawn * 10n >= r.withdrawable)
  // per pool, then averaged: liquidity units differ between pools (and between DAMM v1 and v2), so they are never summed
  const mean = (f: (r: Row) => number) => (rs.length ? Math.round((rs.reduce((n, r) => n + f(r), 0) / rs.length) * 10) / 10 : 0)
  return {
    graduations: rs.length,
    // 90% or more of what the config left withdrawable is gone
    pulled: pulled.length,
    // 10% or more of it is gone
    someWithdrawn: some.length,
    meanWithdrawablePct: mean((r) => share(r.withdrawable, r.total)),
    meanWithdrawnPct: mean((r) => share(r.withdrawn, r.total)),
    // raw drop, no cap: pools that lost half or more of their graduation liquidity, and the average loss
    lostHalfOrMore: rs.filter((r) => gonePct(r) >= 50).length,
    lostAny10Pct: rs.filter((r) => gonePct(r) >= 10).length,
    meanGonePct: mean(gonePct),
    medianHoursSinceGraduation: Math.round(median(rs.map((r) => r.hours))),
  }
}
const classes: Class[] = ['open', 'vesting', 'partial', 'locked']
const out = {
  cluster: 'mainnet-beta',
  mode: 'read-only (DAMM v2 pool accounts, DAMM v1 LP mint supply)',
  ranAt: new Date().toISOString(),
  scannedAt,
  method:
    'Per graduation, at pool level: liquidity the migration put in (DAMM v2 migration events, or DAMM v1 LP minted) vs the pool liquidity or LP supply today. Withdrawn = the drop, capped at the share the config left withdrawable. Later additions hide withdrawals, so it is a lower bound. Control: pools on configs that lock 100% must show no drop.',
  classes: {
    open: 'config leaves 50% or more of the graduation LP not permanently locked, no vesting schedule',
    vesting: 'config leaves 50% or more not permanently locked, with a vesting schedule',
    partial: 'config leaves 1-49% not permanently locked',
    locked: 'config permanently locks 100% (control: should show no loss)',
  },
  all: summary(rows),
  byClass: Object.fromEntries(classes.map((c) => [c, summary(rows.filter((r) => r.cls === c))])),
  byKind: { damm_v2: summary(rows.filter((r) => r.kind === 'damm_v2')), damm_v1: summary(rows.filter((r) => r.kind === 'damm_v1')) },
  measured: rows.length,
  skipped: pools.length - rows.length,
}
writeFileSync(new URL('../lp-outcomes.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out.byClass, null, 2))
console.log(`measured ${rows.length} of ${pools.length} graduations; byKind ${JSON.stringify(out.byKind)}`)
