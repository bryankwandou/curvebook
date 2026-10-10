import { useConnection } from '@solana/wallet-adapter-react'
import { useState } from 'react'
import deployed from '../deployed.json'
import scanJson from '../../graduated-configs.json'
import { inspectConfig, type Inspection } from '../lib/inspect'
import { PRESETS } from '../lib/presets'
import { fmt, presetStats } from '../lib/stats'
import { CurveChart, type Series } from './CurveChart'

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
}
const scan = scanJson as unknown as {
  graduatedPools: number
  distinctConfigs: number
  window: { from: string; to: string }
  classification: { all: { graduations: number; listings: number; undecoded: number } }
  configs: ScanRow[]
}

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`
const sol = (kind: string, id: string) => `https://solscan.io/${kind}/${id}`

export function Inspector() {
  const { connection } = useConnection()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Inspection | null>(null)

  async function run(a: string) {
    setAddress(a)
    setBusy(true)
    setError('')
    try {
      setResult(await inspectConfig(connection, a))
    } catch (e) {
      setResult(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
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
      <p className="eyebrow">Config inspector · mainnet · read-only</p>
      <h2>Read any DBC config before you launch on it</h2>
      <p className="lede">
        Paste the config address of any launchpad on Meteora DBC. curvebook reads the account from mainnet, walks its curve with the SDK math, decodes the fee schedule,
        migration and LP lock, and finds the closest curvebook preset. Nothing is signed.
      </p>
      <form
        className="inspect-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (address.trim()) run(address)
        }}
      >
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="DBC config address" spellCheck={false} aria-label="DBC config address" />
        <button className="primary" disabled={busy || !address.trim()}>
          {busy ? 'Reading…' : 'Inspect'}
        </button>
      </form>
      <div className="chips">
        <span className="hint">Try:</span>
        {Object.entries(deployed).map(([id, d]) => (
          <button key={id} type="button" onClick={() => run(d.config)}>
            {PRESETS.find((p) => p.id === id)?.name}
          </button>
        ))}
        {scan.configs.slice(0, 3).map((c, i) => (
          <button key={c.config} type="button" onClick={() => run(c.config)}>
            #{i + 1} most graduated
          </button>
        ))}
      </div>
      {error && <pre className="status err">{error}</pre>}
      {result && (
        <div className="detail-grid">
          <div className="panel">
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
                  {fmt(result.threshold)} {result.quote}
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
                    {result.closest.gap < 0.01 ? `${result.closest.name} (identical shape)` : result.closest.gap < 0.5 ? `${result.closest.name} (shape gap ${result.closest.gap.toFixed(2)})` : `none close (nearest: ${result.closest.name}, gap ${result.closest.gap.toFixed(1)})`}
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
        configs where price moves 1.25x or less or that graduate on under 0.01 of the quote token ({scan.classification.all.undecoded} could not be decoded). Busy
        migration configs cover days and quiet ones months, so this is a sample, not a time series. Top configs below; Click a row to inspect it.
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
                  {fmt(c.threshold)} {c.quote}
                </td>
                <td>{fmt(c.multiplier, 1)}x</td>
                <td>{c.earlyBuyerMultiple.toFixed(1)}x</td>
                <td>{c.fee}</td>
                <td>{c.lpLockedPct}%</td>
                <td>{c.closest}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
