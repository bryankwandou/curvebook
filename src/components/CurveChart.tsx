import type { CurvePoint } from '../lib/curve'

export interface Series {
  id: string
  label: string
  color: string
  points: CurvePoint[]
  supply: number
}

const W = 520
const H = 260
const PAD = { l: 44, r: 14, t: 14, b: 30 }

/**
 * Price (as a multiple of the opening price) against % of supply sold.
 * Normalising both axes lets presets with different quotes and supplies share one chart.
 */
export function CurveChart({ series, compact = false }: { series: Series[]; compact?: boolean }) {
  const norm = series.map((s) => ({
    ...s,
    xy: s.points.map((p) => [(p.sold / s.supply) * 100, p.price / s.points[0].price] as const),
  }))
  const maxX = Math.max(100, ...norm.flatMap((s) => s.xy.map(([x]) => x)))
  const maxY = niceCeil(Math.max(2, ...norm.flatMap((s) => s.xy.map(([, y]) => y))))
  const x = (v: number) => PAD.l + (v / maxX) * (W - PAD.l - PAD.r)
  const y = (v: number) => H - PAD.b - ((v - 1) / (maxY - 1)) * (H - PAD.t - PAD.b)
  const yTicks = [1, ...[0.25, 0.5, 0.75, 1].map((f) => 1 + f * (maxY - 1))]

  return (
    <svg className={compact ? 'chart compact' : 'chart'} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bonding curve price chart">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="gridline" />
          {!compact && (
            <text x={PAD.l - 6} y={y(t) + 4} className="tick" textAnchor="end">
              {t.toFixed(t < 10 ? 1 : 0)}x
            </text>
          )}
        </g>
      ))}
      {!compact &&
        [0, 25, 50, 75, 100].map((t) => (
          <text key={t} x={x(t)} y={H - 10} className="tick" textAnchor="middle">
            {t}%
          </text>
        ))}
      {norm.map((s) => {
        const d = s.xy.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('')
        const last = s.xy[s.xy.length - 1]
        return (
          <g key={s.id}>
            {series.length === 1 && (
              <path d={`${d}L${x(last[0]).toFixed(1)},${y(1)}L${x(0)},${y(1)}Z`} fill={s.color} opacity={0.12} />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={compact ? 2 : 2.5} strokeLinejoin="round" />
            <circle cx={x(last[0])} cy={y(last[1])} r={compact ? 3 : 4.5} fill={s.color}>
              <title>{`${s.label}: graduates to DAMM v2 at ${last[1].toFixed(1)}x, ${last[0].toFixed(1)}% sold`}</title>
            </circle>
          </g>
        )
      })}
      {!compact && (
        <>
          <text x={W - PAD.r} y={H - 10 - 14} className="axis" textAnchor="end">
            supply sold →
          </text>
          <text x={PAD.l + 4} y={PAD.t + 10} className="axis">
            price vs. open
          </text>
        </>
      )}
    </svg>
  )
}

function niceCeil(v: number) {
  const steps = [2, 2.5, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100]
  return steps.find((s) => s >= v) ?? Math.ceil(v / 100) * 100
}
