import { useEffect, useRef } from 'react'

// How the graduation numbers are made, and how much they move when the thresholds move. Computed in the browser
// from the per-config rows of graduated-configs.json, so it always matches the numbers above it.
export interface ConfigRow {
  graduatedPools: number
  multiplier: number | null
  threshold: number | null
  lpUnlockedPct?: number | null
  lpVesting?: boolean | null
}

const MULTIPLIERS = [1.05, 1.1, 1.25, 1.5, 2, 3]
const THRESHOLDS = [0, 0.001, 0.01, 0.1, 1]
const LP_CUTS = [1, 25, 50, 75, 90]

export function Methodology({ rows, sample, window }: { rows: ConfigRow[]; sample: string; window: { from: string; to: string } }) {
  const decoded = rows.filter((r) => r.multiplier !== null && r.threshold !== null)
  const total = decoded.reduce((n, r) => n + r.graduatedPools, 0)
  const pct = (f: (r: ConfigRow) => boolean) => `${Math.round((decoded.filter(f).reduce((n, r) => n + r.graduatedPools, 0) / total) * 100)}%`
  const withLp = decoded.filter((r) => r.lpUnlockedPct !== undefined && r.lpUnlockedPct !== null)
  // a link to #method opens the panel
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const open = () => {
      if (location.hash === '#method' && ref.current) ref.current.open = true
    }
    open()
    addEventListener('hashchange', open)
    return () => removeEventListener('hashchange', open)
  }, [])

  return (
    <details className="panel method" id="method" ref={ref}>
      <summary>Method, sample and sensitivity</summary>
      <p>
        <b>Population.</b> Every DBC graduation calls one of Meteora's DAMM v1/v2 migration-fee configs, so their transactions are the stream of graduations. The sample is the{' '}
        {sample.replace('PER_ADDRESS', '200')}, {window.from.slice(0, 10)} to {window.to.slice(0, 10)}. Busy migration configs fill 200 transactions in about an hour and
        quiet ones reach back months, so the sample over-weights whatever is graduating right now. It is not a time series and not every graduation ever.
      </p>
      <p>
        <b>Attribution.</b> The DBC config is read from the migrate instruction itself (account #2), never guessed from the token. Configs are decoded with the program's IDL;
        configs whose layout does not decode are reported as undecoded, not dropped.
      </p>
      <p>
        <b>Listing share is sensitive to the thresholds.</b> Share of decoded graduations counted as listings (price moves at most <i>x</i> from open to graduation, or
        graduation needs under <i>t</i> of the quote token). The published rule is 1.25x / 0.01.
      </p>
      <div className="scroll-x">
        <table className="pools">
          <thead>
            <tr>
              <th>max move \ t</th>
              {THRESHOLDS.map((t) => (
                <th key={t}>{t === 0 ? 'none' : t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MULTIPLIERS.map((m) => (
              <tr key={m}>
                <td>{m}x</td>
                {THRESHOLDS.map((t) => (
                  <td key={t} className={m === 1.25 && t === 0.01 ? 'hl' : undefined}>
                    {pct((r) => r.multiplier! <= m || r.threshold! < t)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withLp.length > 0 && (
        <>
          <p>
            <b>The LP finding is not.</b> Share of decoded graduations whose config leaves at least <i>k</i>% of the graduation LP not permanently locked. Configs
            tend to lock everything or almost nothing, so the share barely moves until 90%.
          </p>
          <div className="scroll-x">
            <table className="pools">
              <thead>
                <tr>
                  {LP_CUTS.map((k) => (
                    <th key={k}>k = {k}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {LP_CUTS.map((k) => (
                    <td key={k} className={k === 50 ? 'hl' : undefined}>
                      {pct((r) => (r.lpUnlockedPct ?? 0) >= k)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <p>
        <b>Reproduce.</b> <code>npx tsx scripts/scan-graduations.ts</code> (any mainnet RPC), then <code>npm test</code> recomputes every published share from the per-config
        rows. The workflow <code>.github/workflows/data.yml</code> does both daily.
      </p>
    </details>
  )
}
