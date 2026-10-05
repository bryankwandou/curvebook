import { PROTOCOL_FEE_PERCENT, validateConfigParameters, type ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { PublicKey } from '@solana/web3.js'
import { buildPreset, quoteDecimals, type Preset } from './presets'
import { sampleCurve, type CurvePoint } from './curve'

export interface PresetStats {
  params: ConfigParameters
  points: CurvePoint[]
  startPrice: number
  gradPrice: number
  multiplier: number
  /** % of total supply sold on the curve when it graduates */
  soldPct: number
  raised: number
  /** spot price when half the migration threshold is raised, relative to the start */
  halfwayMultiple: number
  /** share of every trading-fee unit that lands with the preset author / the token creator */
  authorShare: number
  creatorShare: number
}

export type StatsResult = { ok: true; stats: PresetStats } | { ok: false; error: string }

// validateConfigParameters needs a receiver; any non-default key works for a pure check
const PLACEHOLDER = new PublicKey('So11111111111111111111111111111111111111112')
const cache = new Map<string, StatsResult>()

export function presetStats(p: Preset): StatsResult {
  const key = JSON.stringify(p)
  const hit = cache.get(key)
  if (hit) return hit
  let res: StatsResult
  try {
    const params = buildPreset(p)
    validateConfigParameters({ ...params, leftoverReceiver: PLACEHOLDER })
    const points = sampleCurve({
      sqrtStartPrice: params.sqrtStartPrice,
      curve: params.curve,
      migrationQuoteThreshold: params.migrationQuoteThreshold,
      baseDecimals: 6,
      quoteDecimals: quoteDecimals(p),
    })
    const start = points[0]
    const end = points[points.length - 1]
    const half = points.find((pt) => pt.raised >= end.raised / 2) ?? end
    const afterProtocol = 1 - PROTOCOL_FEE_PERCENT / 100
    res = {
      ok: true,
      stats: {
        params,
        points,
        startPrice: start.price,
        gradPrice: end.price,
        multiplier: end.price / start.price,
        soldPct: (end.sold / p.supply) * 100,
        raised: end.raised,
        halfwayMultiple: half.price / start.price,
        authorShare: afterProtocol * (1 - p.creatorFeePct / 100),
        creatorShare: afterProtocol * (p.creatorFeePct / 100),
      },
    }
  } catch (e) {
    res = { ok: false, error: (e as Error).message }
  }
  cache.set(key, res)
  return res
}

export function feeLabel(p: Preset) {
  const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`
  if (p.startFeeBps === p.endFeeBps) return `${pct(p.startFeeBps)} flat`
  return `${pct(p.startFeeBps)} → ${pct(p.endFeeBps)} over ${p.feeDurationSec}s`
}

export function fmt(n: number, digits = 2) {
  if (n === 0) return '0'
  if (Math.abs(n) < 0.001) return n.toExponential(2)
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}
