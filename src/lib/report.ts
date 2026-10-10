import type { Connection } from '@solana/web3.js'
import { inspectConfig } from './inspect'
import type { Flag } from './risk'
import { poolStatus, resolveTarget, type PoolStatus } from './target'

// One report for a token, DBC pool or config: what scripts/check.ts prints and what /api/check returns.
// Plain JSON (no bigints, no curve points), so it can be cached and served as is.
export interface Report {
  input: string
  kind: 'config' | 'pool' | 'mint'
  token: string | null
  pool: string | null
  config: string
  /** red if any red flag, warn if any warning, else ok */
  verdict: 'red' | 'warn' | 'ok'
  flags: Flag[]
  /** null for a config; for a token or pool: on the curve, or graduated and how much liquidity is gone */
  status: PoolStatus | null
  curve: {
    quote: string
    graduatesAt: number
    openToGraduation: number
    earlyBuyerMultiple: number
    soldOnCurvePct: number
    fee: string
    migration: string
    lpPermanentlyLockedPct: number
  }
}

/** `history` must serve getSignaturesForAddress/getTransaction with full history (a private RPC, or the site's proxy) */
export async function buildReport(connection: Connection, history: Connection, address: string): Promise<Report> {
  const input = address.trim()
  const t = await resolveTarget(connection, history, input)
  const x = await inspectConfig(connection, t.config)
  const status = t.pool ? await poolStatus(connection, t, history) : null
  const flags = [...x.flags]
  const g = status?.graduation
  if (g && g.gonePct !== null && g.gonePct >= 50)
    flags.unshift({
      severity: 'red',
      title: `${Math.round(g.gonePct)}% of the graduation liquidity is gone`,
      detail: `Graduated ${new Date(g.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC to DAMM ${g.kind === 'damm_v2' ? 'v2' : 'v1'} pool ${g.dammPool}; the pool holds less than half of what the migration put in.`,
    })
  return {
    input,
    kind: t.kind,
    token: t.baseMint ?? null,
    pool: t.pool ?? null,
    config: x.address,
    verdict: flags.some((f) => f.severity === 'red') ? 'red' : flags.some((f) => f.severity === 'warn') ? 'warn' : 'ok',
    flags,
    status,
    curve: {
      quote: x.quote,
      graduatesAt: x.threshold,
      openToGraduation: x.multiplier,
      earlyBuyerMultiple: x.earlyBuyerMultiple,
      soldOnCurvePct: x.soldPct,
      fee: x.fee,
      migration: x.migration,
      lpPermanentlyLockedPct: x.lpLockedPct,
    },
  }
}

/** short text for a badge or a one-line summary */
export function headline(r: Report) {
  const gone = r.status?.graduation?.gonePct
  if (gone !== undefined && gone !== null && gone >= 50) return `LP ${Math.round(gone)}% gone`
  const reds = r.flags.filter((f) => f.severity === 'red').length
  const warns = r.flags.filter((f) => f.severity === 'warn').length
  if (reds) return `${reds} red flag${reds > 1 ? 's' : ''}`
  if (warns) return `${warns} warning${warns > 1 ? 's' : ''}`
  return 'no red flags'
}
