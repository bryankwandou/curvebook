import { useOutcomes, type OutcomeSummary as Summary, type Outcomes } from '../lib/outcomes'

const pct = (x: number, t: number) => (t ? `${Math.round((x / t) * 100)}%` : '–')
const LABELS: [keyof Outcomes['byClass'], string][] = [
  ['open', '50%+ of LP withdrawable, no vesting'],
  ['vesting', '50%+ of LP withdrawable, with a vesting schedule'],
  ['partial', '1–49% of LP withdrawable'],
  ['locked', '100% of LP permanently locked (control)'],
]

export function OutcomesTable() {
  const o = useOutcomes()
  return (
    <>
      <h3>What happened to the liquidity</h3>
      <p className="lede">
        <code>scripts/lp-outcomes.ts</code> compares, for each graduation, the liquidity the migration put into the DAMM pool with the pool's liquidity today (DAMM v2 pool
        account, or DAMM v1 LP supply). It reads the pool, not the positions, so liquidity moved between positions is not counted as withdrawn, and anything added since
        hides withdrawals: the losses below are a lower bound. {o.measured.toLocaleString('en-US')} of {(o.measured + o.skipped).toLocaleString('en-US')} graduations
        measured, {o.ranAt.slice(0, 10)}.
      </p>
      <div className="panel scroll-x">
        <table className="pools">
          <thead>
            <tr>
              <th>Config leaves</th>
              <th>Graduations</th>
              <th>Lost half or more of their liquidity</th>
              <th>Average lost</th>
              <th>Median pool age</th>
            </tr>
          </thead>
          <tbody>
            {LABELS.map(([k, label]) => {
              const s: Summary = o.byClass[k]
              return (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{s.graduations.toLocaleString('en-US')}</td>
                  <td className={k !== 'locked' && s.lostHalfOrMore * 2 > s.graduations ? 'bad' : undefined}>
                    {s.lostHalfOrMore.toLocaleString('en-US')} ({pct(s.lostHalfOrMore, s.graduations)})
                  </td>
                  <td>{s.meanGonePct}%</td>
                  <td>{s.medianHoursSinceGraduation < 48 ? `${s.medianHoursSinceGraduation} h` : `${Math.round(s.medianHoursSinceGraduation / 24)} d`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        The control is not perfect: {o.byClass.locked.lostHalfOrMore} pools on configs that lock everything still lost half their liquidity, almost all on a few older
        DAMM v1 configs. We report them rather than drop them. One verified case: DAMM v2 pool{' '}
        <a href="https://solscan.io/account/BtERBHLyp2iDFP7fjUZthzKofPiPPHLArsnL7LcKjvhU">BtERBH…</a> graduated at 13:50:08 UTC on 2026-10-10 and{' '}
        <code>removeAllLiquidity</code> ran at 13:53:31, on a config with a vesting schedule.
      </p>
    </>
  )
}
