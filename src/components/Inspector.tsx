import { useConnection } from '@solana/wallet-adapter-react'
import { useEffect, useRef, useState } from 'react'
import deployed from '../deployed.json'
import scanJson from '../../graduated-configs.json'
import { feedConnection } from '../lib/actions'
import { inspectConfig, type Inspection } from '../lib/inspect'
import { poolStatus, resolveTarget, type PoolStatus, type Target } from '../lib/target'
import { PRESETS } from '../lib/presets'
import { fmt, presetStats } from '../lib/stats'
import { CurveChart, type Series } from './CurveChart'
import { useLive } from '../lib/live'
import { Methodology, type ConfigRow } from './Methodology'
import { OutcomesTable } from './Outcomes'

interface ScanRow {
  config: string
  graduatedPools: number
  quote: string
  threshold: number
  multiplier: number
  earlyBuyerMultiple: number
  fee: string
  lpLockedPct: number
  closest: string
  closestGap: number
}
type Scan = {
  ranAt: string
  graduatedPools: number
  distinctConfigs: number
  window: { from: string; to: string }
  classification: {
    all: { graduations: number; listings: number; undecoded: number }
    safety?: { lpMostlyWithdrawable: number; lpAllLocked: number; mintAuthorityKept: number }
    sample: string
  }
  configs: ScanRow[]
  allConfigs: ConfigRow[]
}
const scanBundled = scanJson as unknown as Scan

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`
// examples that show each case: our own token (still on the curve), a pool whose LP was pulled 3 minutes after
// graduating, and a pool on a config that locks all LP
const EXAMPLES: [string, string][] = [
  ['CBK, our token (on the curve)', '9yVLMokYuoC2KWMESmD1XUY3jmFJmasEw4FKPxZZ6gfS'],
  ['Graduated, LP pulled', 'USTdxXk3BZTAX43TjAbrS4Hnb1iVVyvGeqtkvLzLPGJ'],
  ['Graduated, LP locked', '75qK2pbYCbA85pnHh14q1r24UBpN3xFGNPVwNB5DQrus'],
]
const sol = (kind: string, id: string) => `https://solscan.io/${kind}/${id}`

export function Inspector() {
  const { connection } = useConnection()
  const scan = useLive('graduated-configs.json', scanBundled)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Inspection | null>(null)
  const [copied, setCopied] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const [status, setStatus] = useState<PoolStatus | null | 'loading' | 'error'>(null)
  // a slower lookup from an earlier click must not overwrite the current one
  const runId = useRef(0)

  // ?config=<address> opens the site on that config's report, so a report can be shared as a link
  useEffect(() => {
    const a = new URLSearchParams(location.search).get('config')
    if (a) {
      run(a)
      document.getElementById('inspect')?.scrollIntoView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(a: string) {
    a = a.trim()
    setAddress(a)
    setCopied(false)
    history.replaceState(null, '', `?config=${encodeURIComponent(a)}#inspect`)
    setBusy(true)
    setError('')
    // clear the previous report at once, so it is never shown under the new address
    setStatus(null)
    setTarget(null)
    setResult(null)
    const id = ++runId.current
    try {
      const feed = feedConnection(connection)
      const t = await resolveTarget(connection, feed, a)
      const r = await inspectConfig(connection, t.config)
      if (id !== runId.current) return
      setTarget(t)
      setResult(r)
      if (t.pool) {
        setStatus('loading')
        poolStatus(connection, t, feed).then(
          (st) => id === runId.current && setStatus(st),
          () => id === runId.current && setStatus('error'),
        )
      }
    } catch (e) {
      if (id !== runId.current) return
      setResult(null)
      setTarget(null)
      setError((e as Error).message)
    } finally {
      if (id === runId.current) setBusy(false)
    }
  }

  const closest = result && PRESETS.find((p) => p.id === result.closest.id)
  const closestStats = closest && presetStats(closest)
  // closest preset first so the inspected curve is drawn on top of it
  const chart: Series[] = result
    ? [
        ...(closest && closestStats?.ok
          ? [{ id: closest.id, label: closest.name, color: 'var(--muted)', points: closestStats.stats.points, supply: closest.supply }]
          : []),
        { id: 'inspected', label: short(result.address), color: 'var(--accent)', points: result.points, supply: result.supply },
      ]
    : []

  return (
    <section className="detail" id="inspect">
      <p className="eyebrow">Inspector · mainnet · read-only</p>
      <h2>Check a DBC token or config before you buy or launch</h2>
      <p className="lede">
        Paste a token address, its DBC pool, or a launchpad's config. curvebook finds the config that governs the pool, reads it from mainnet, walks its curve with the SDK
        math and decodes the fee schedule, migration and LP lock. For a token that already graduated it also reads the migration transaction and the DAMM pool today, to
        show how much of the liquidity it graduated with is still there. Nothing is signed.
      </p>
      <form
        className="inspect-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (address.trim()) run(address)
        }}
      >
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Token, DBC pool or config address" spellCheck={false} aria-label="Token, DBC pool or config address" />
        <button className="primary" disabled={busy || !address.trim()}>
          {busy ? 'Reading…' : 'Check'}
        </button>
      </form>
      <div className="chips">
        <span className="hint">Try a token:</span>
        {EXAMPLES.map(([label, a]) => (
          <button key={a} type="button" onClick={() => run(a)}>
            {label}
          </button>
        ))}
      </div>
      <div className="chips">
        <span className="hint">or a config:</span>
        {Object.entries(deployed).map(([id, d]) => (
          <button key={id} type="button" onClick={() => run(d.config)}>
            {PRESETS.find((p) => p.id === id)?.name}
          </button>
        ))}
        {scan.configs.slice(0, 1).map((c, i) => (
          <button key={c.config} type="button" onClick={() => run(c.config)}>
            #{i + 1} most graduated
          </button>
        ))}
      </div>
      {error && <pre className="status err">{error}</pre>}
      {result && target && target.kind !== 'config' && <TokenPanel target={target} status={status} />}
      {result && (
        <div className="panel flags" aria-label="Risk flags">
          <p className="eyebrow">
            {target && target.kind !== 'config' ? 'Its config' : 'Before you buy'} ·{' '}
            {result.flags.some((f) => f.severity === 'red')
              ? 'red flags on this config'
              : result.flags.some((f) => f.severity === 'warn')
                ? 'warnings, no red flags'
                : 'no red flags'}
          </p>
          {result.flags.length ? (
            <ul>
              {result.flags.map((f) => (
                <li key={f.title} className={`flag ${f.severity}`}>
                  <b>{f.title}</b> {f.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Mint authority revoked, LP 100% permanently locked, no high fee, no creator vesting, no strong sniper advantage.</p>
          )}
          <p className="hint">
            Same checks from a terminal or CI: <code>npx tsx scripts/check.ts {result.address}</code>
          </p>
        </div>
      )}
      {result && (
        <div className="detail-grid">
          <div className="panel">
            <p className="hint">
              Report for <a href={sol('account', result.address)}>{short(result.address)}</a> ·{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  navigator.clipboard.writeText(`${location.origin}/?config=${result.address}#inspect`).then(() => setCopied(true), () => {})
                }}
              >
                {copied ? 'link copied' : 'copy link to this report'}
              </button>
            </p>
            <CurveChart series={chart} />
            <ul className="legend">
              {chart.map((s) => (
                <li key={s.id}>
                  <i style={{ background: s.color }} />
                  {s.id === 'inspected' ? `This config (${s.label})` : `Closest preset: ${s.label}`}
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <dl className="stats">
              <div>
                <dt>Open → graduation</dt>
                <dd>{fmt(result.multiplier, 1)}x</dd>
              </div>
              <div>
                <dt>Buyer at 10% raised, at graduation</dt>
                <dd>{result.earlyBuyerMultiple.toFixed(1)}x</dd>
              </div>
              <div>
                <dt>Supply sold on curve</dt>
                <dd>{result.soldPct.toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Graduates at</dt>
                <dd>
                  {result.threshold < 1 ? +result.threshold.toPrecision(2) : fmt(result.threshold)} {result.quote}
                </dd>
              </div>
              <div>
                <dt>Creator share of fees</dt>
                <dd>{result.creatorFeePct}%</dd>
              </div>
              <div>
                <dt>LP permanently locked</dt>
                <dd>{result.lpLockedPct}%</dd>
              </div>
            </dl>
            <table className="pools">
              <tbody>
                <tr><td>Trading fee</td><td>{result.fee}{result.dynamicFee ? ' + dynamic fee' : ''}</td></tr>
                <tr><td>Migration</td><td>{result.migration}</td></tr>
                <tr><td>LP split</td><td>{result.lp}</td></tr>
                <tr><td>Pool-creation fee</td><td>{result.poolCreationFee} SOL</td></tr>
                <tr><td>Token vesting after graduation</td><td>{result.tokenVesting ? 'yes' : 'none'}</td></tr>
                <tr><td>Fee claimer</td><td><a href={sol('account', result.feeClaimer)}>{short(result.feeClaimer)}</a></td></tr>
                <tr>
                  <td>Closest preset</td>
                  <td>
                    {result.closest.gap < 0.01 ? `${result.closest.name} (identical shape)` : result.closest.gap < 0.25 ? `${result.closest.name} (shape gap ${result.closest.gap.toFixed(2)})` : `none close (nearest: ${result.closest.name}, gap ${result.closest.gap.toFixed(1)})`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3>Which configs actually graduate</h3>
      <p className="lede">
        <code>scripts/scan-graduations.ts</code> takes the latest 200 transactions on each of Meteora's DAMM migration configs (every DBC graduation passes one),
        finds the DBC config named by each migrate instruction, and decodes every config: {scan.graduatedPools.toLocaleString('en-US')} graduated pools across{' '}
        {scan.distinctConfigs} configs, {scan.window.from.slice(0, 10)} to {scan.window.to.slice(0, 10)}. {scan.classification.all.listings.toLocaleString('en-US')} of them came from
        configs where price moves 1.25x or less or that graduate on under 0.01 of the quote token ({scan.classification.all.undecoded} could not be decoded).
        {scan.classification.safety &&
          ` ${scan.classification.safety.lpMostlyWithdrawable.toLocaleString('en-US')} came from configs that leave half or more of the graduation LP withdrawable; ${scan.classification.safety.lpAllLocked.toLocaleString('en-US')} from configs that lock all of it.`} Busy
        migration configs cover days and quiet ones months, so this is a sample, not a time series. The scan reruns daily in GitHub Actions; this copy is from {scan.ranAt.slice(0, 10)}. Top configs below; click a row to inspect it.
      </p>
      <div className="panel scroll-x">
        <table className="pools">
          <thead>
            <tr>
              <th>Graduated</th>
              <th>Config</th>
              <th>Graduates at</th>
              <th>Open → grad</th>
              <th>Buyer at 10%</th>
              <th>Trading fee</th>
              <th>LP locked</th>
              <th>Closest preset</th>
            </tr>
          </thead>
          <tbody>
            {scan.configs.map((c) => (
              <tr key={c.config}>
                <td>{c.graduatedPools}</td>
                <td>
                  <a
                    href="#inspect"
                    onClick={(e) => {
                      e.preventDefault()
                      run(c.config)
                      document.getElementById('inspect')?.scrollIntoView({ behavior: 'smooth' })
                    }}
                  >
                    {short(c.config)}
                  </a>
                </td>
                <td>
                  {c.threshold < 1 ? +c.threshold.toPrecision(2) : fmt(c.threshold)} {c.quote}
                </td>
                <td>{fmt(c.multiplier, 1)}x</td>
                <td>{c.earlyBuyerMultiple.toFixed(1)}x</td>
                <td>{c.fee}</td>
                <td className={c.lpLockedPct <= 50 ? 'bad' : undefined}>{c.lpLockedPct}%</td>
                <td>{c.closestGap < 0.25 ? c.closest : 'none close'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OutcomesTable />
      <Methodology rows={scan.allConfigs} sample={scan.classification.sample} window={scan.window} />
    </section>
  )
}

function TokenPanel({ target, status }: { target: Target; status: PoolStatus | null | 'loading' | 'error' }) {
  const g = status && typeof status === 'object' ? status.graduation : undefined
  const gone = g?.gonePct ?? null
  return (
    <div className="panel flags" aria-label="This token">
      <p className="eyebrow">This token</p>
      <p className="hint">
        {target.baseMint && (
          <>
            Token <a href={sol('token', target.baseMint)}>{short(target.baseMint)}</a> ·{' '}
          </>
        )}
        DBC pool <a href={sol('account', target.pool!)}>{short(target.pool!)}</a> · config <a href={sol('account', target.config)}>{short(target.config)}</a>
      </p>
      {status === 'loading' && <p className="hint">Reading the pool and its graduation…</p>}
      {status === 'error' && <p className="hint">Could not read this pool's graduation right now. The config checks below still apply.</p>}
      {status && typeof status === 'object' && !status.migrated && (
        <p>
          Still on the bonding curve: {(status.progress * 100).toFixed(2)}% of the way to graduation. The checks below say what happens to its liquidity when it
          graduates.
        </p>
      )}
      {status && typeof status === 'object' && status.migrated && !g && (
        <p className="hint">Graduated, but its migration transaction is not among the pool's 25 most recent, so the liquidity check is skipped.</p>
      )}
      {g && (
        <ul>
          <li className={`flag ${gone === null ? 'info' : gone >= 50 ? 'red' : gone >= 10 ? 'warn' : 'info'}`}>
            <b>{gone === null ? 'Liquidity today could not be read' : `${gone >= 10 ? Math.round(gone) : +gone.toFixed(1)}% of the liquidity it graduated with is gone`}</b>{' '}
            Graduated {new Date(g.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC to DAMM {g.kind === 'damm_v2' ? 'v2' : 'v1'} pool{' '}
            <a href={sol('account', g.dammPool)}>{short(g.dammPool)}</a> (<a href={sol('tx', g.signature)}>migration</a>).{' '}
            {g.lockedNowPct !== undefined && `Today ${+g.lockedNowPct.toFixed(1)}% of the pool's liquidity is permanently locked. `}
            Liquidity added since by anyone offsets the loss, so the real loss is at least this much.
          </li>
        </ul>
      )}
    </div>
  )
}
