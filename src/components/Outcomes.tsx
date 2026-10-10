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
      <h3 id="outcomes">What happened to the liquidity</h3>
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
      {o.pulls && (
        <>
          <h3 id="timing">How soon it left</h3>
          <p className="lede">
            Of the {o.pulls.pools} DAMM v2 pools that lost half or more, at least <strong>{o.pulls.within10Minutes}</strong> ({pct(o.pulls.within10Minutes, o.pulls.pools)})
            had liquidity removed within <strong>10 minutes</strong> of graduating, and {o.pulls.withinHour} within the hour. For the {o.pulls.found} where the first{' '}
            <code>removeLiquidity</code> or <code>removeAllLiquidity</code> was among the pool's first {PULL_SCAN(o.pulls.method)} transactions after the migration, the
            median was {o.pulls.medianMinutes} minutes; the other {o.pulls.later} were removed later than that, so the 10-minute count is a lower bound. DAMM v1 pools are
            not timed.
          </p>
        </>
      )}
      {o.byConfig && (
        <>
          <h3>The configs with the most graduations</h3>
          <p className="lede">
            A withdrawable LP is a permission, not a verdict: some configs leave it open and the liquidity stays. Click a config to check it.
          </p>
          <div className="panel scroll-x">
            <table className="pools">
              <thead>
                <tr>
                  <th>Config</th>
                  <th>Migrates to</th>
                  <th>Leaves</th>
                  <th>Graduations</th>
                  <th>Lost half or more</th>
                </tr>
              </thead>
              <tbody>
                {o.byConfig.slice(0, 10).map((c) => (
                  <tr key={c.config}>
                    <td>
                      <a href={`/?config=${c.config}#inspect`}>
                        <code>{c.config.slice(0, 4)}…{c.config.slice(-4)}</code>
                      </a>
                    </td>
                    <td>{c.kind === 'damm_v2' ? 'DAMM v2' : 'DAMM v1'}</td>
                    <td>{CLASS[c.cls] ?? c.cls}</td>
                    <td>{c.graduations}</td>
                    <td className={c.cls !== 'locked' && c.lostHalfOrMore * 2 > c.graduations ? 'bad' : undefined}>
                      {c.lostHalfOrMore} ({pct(c.lostHalfOrMore, c.graduations)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

const CLASS: Record<string, string> = { open: '50%+ withdrawable', vesting: '50%+ withdrawable, vesting', partial: '1–49% withdrawable', locked: 'all LP locked' }
// the scan depth is part of the method string ("among its first 40 transactions")
const PULL_SCAN = (method: string) => method.match(/first (\d+) transactions/)?.[1] ?? '40'
