import scan from '../graduated-configs.json'
import { Inspector } from './components/Inspector'
import { useMemo, useState } from 'react'
import { PROTOCOL_POOL_CREATION_FEE_PERCENT } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PRESETS, type Preset, type Shape } from './lib/presets'
import { feeLabel, fmt, presetStats, type PresetStats } from './lib/stats'
import { deployedConfig } from './lib/registry'
import { CurveChart, type Series } from './components/CurveChart'
import { ForkButton, LaunchForm, PoolFeed } from './components/Actions'
import proof from '../devnet-proof.json'
import grad from '../devnet-graduation.json'
import fuzz from '../fuzz-report.json'
import sim from '../mainnet-sim.json'
import launch from '../mainnet-launch.json'
import verify from '../mainnet-verify.json'
import poolState from '../mainnet-pool-state.json'
import './App.css'

const COLORS: Record<string, string> = {
  'flat-fair': 'var(--c1)',
  'early-discovery': 'var(--c2)',
  'long-curve': 'var(--c3)',
  'stock-pair-usdc': 'var(--c4)',
  custom: 'var(--c5)',
}

function series(p: Preset, s: PresetStats): Series {
  return { id: p.id, label: p.name, color: COLORS[p.id] ?? 'var(--c5)', points: s.points, supply: p.supply }
}

function Stats({ p, s }: { p: Preset; s: PresetStats }) {
  return (
    <dl className="stats">
      <div>
        <dt>Open → graduation</dt>
        <dd>{s.multiplier.toFixed(1)}x</dd>
      </div>
      <div>
        <dt>Price at half-filled</dt>
        <dd>{s.halfwayMultiple.toFixed(2)}x</dd>
      </div>
      <div>
        <dt>Supply sold on curve</dt>
        <dd>{s.soldPct.toFixed(1)}%</dd>
      </div>
      <div>
        <dt>Raised at graduation</dt>
        <dd>
          {fmt(s.raised)} {p.quote}
        </dd>
      </div>
      <div>
        <dt>Trading fee</dt>
        <dd>{feeLabel(p)}</dd>
      </div>
      <div>
        <dt>Fee split author / creator</dt>
        <dd>
          {Math.round(s.authorShare * 100)}% / {Math.round(s.creatorShare * 100)}%
        </dd>
      </div>
    </dl>
  )
}

function Snippet({ config, p }: { config?: string; p: Preset }) {
  const code = config
    ? `import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'

// curvebook preset "${p.id}" — live config on mainnet
const CONFIG = new PublicKey('${config}')

const tx = await new DynamicBondingCurveClient(connection, 'confirmed')
  .creator.createPool({ config: CONFIG, baseMint: mint.publicKey,
    name, symbol, uri, payer: user, poolCreator: user })`
    : `// src/lib/presets.ts from github.com/bryankwandou/curvebook
import { buildPreset, PRESETS } from './presets'

// exact ConfigParameters for "${p.id}", validated against the DBC program
const params = buildPreset(PRESETS.find(x => x.id === '${p.id}')!)
const tx = await client.partner.createConfig({
  config, feeClaimer, leftoverReceiver, payer, quoteMint, ...params })`
  return <pre className="code">{code}</pre>
}

function Detail({ p }: { p: Preset }) {
  const r = presetStats(p)
  const dep = deployedConfig(p.id)
  if (!r.ok) return <p className="status err">{r.error}</p>
  return (
    <section className="detail" id="detail">
      <div className="detail-head">
        <div>
          <p className="eyebrow">
            {p.quote}-quoted · {p.shape} curve · 16 segments · migrates to DAMM v2
          </p>
          <h2>{p.name}</h2>
          <p className="lede">{p.tagline}</p>
          <p className="best">Best for: {p.bestFor}</p>
        </div>
      </div>
      <div className="detail-grid">
        <div className="panel">
          <CurveChart series={[series(p, r.stats)]} />
          <Stats p={p} s={r.stats} />
          <p className="hint">
            Pool-creation fee {p.poolCreationFeeSol} SOL · market cap {fmt(p.initialMarketCap)} → {fmt(p.migrationMarketCap)} {p.quote} · LP 100% permanently locked
            after migration (50/50 author / creator).
          </p>
        </div>
        <div className="panel">
          <h3>Launch a token on this curve</h3>
          {dep ? (
            <>
              <p className="hint">
                Official config <a href={`https://solscan.io/account/${dep.config}`}>{dep.config.slice(0, 8)}…</a>
              </p>
              <LaunchForm config={dep.config} />
            </>
          ) : (
            <p className="hint">The official config for this preset is not on mainnet yet. You can still deploy it as your own config below.</p>
          )}
          <h3>Use it in your launchpad</h3>
          <p className="hint">Deploy this exact curve under your wallet: you become the fee claimer and keep the pool-creation fee and the author share.</p>
          <ForkButton preset={p} />
          <Snippet config={dep?.config} p={p} />
          {dep && (
            <>
              <h3>Tokens launched on this preset</h3>
              <PoolFeed config={dep.config} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

const BLANK: Preset = {
  id: 'custom',
  name: 'Custom curve',
  tagline: 'Your own curve, checked live by the same validator the DBC SDK runs before createConfig.',
  shape: 'early',
  quote: 'SOL',
  initialMarketCap: 30,
  migrationMarketCap: 450,
  supply: 1_000_000_000,
  startFeeBps: 1000,
  endFeeBps: 100,
  feeDurationSec: 60,
  creatorFeePct: 50,
  poolCreationFeeSol: 0.01,
  bestFor: 'Whatever you are launching',
}

function Builder() {
  const [p, setP] = useState<Preset>(BLANK)
  const r = presetStats(p)
  const set = <K extends keyof Preset>(k: K) => (v: Preset[K]) => setP((x) => ({ ...x, [k]: v }))
  const num = (k: 'initialMarketCap' | 'migrationMarketCap' | 'startFeeBps' | 'endFeeBps' | 'feeDurationSec' | 'creatorFeePct' | 'poolCreationFeeSol') => ({
    value: p[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k)(Number(e.target.value)),
  })
  return (
    <section className="detail" id="builder">
      <p className="eyebrow">Builder</p>
      <h2>Tune your own curve</h2>
      <div className="detail-grid">
        <div className="panel form">
          <div className="row">
            <label>
              Shape
              <select value={p.shape} onChange={(e) => set('shape')(e.target.value as Shape)}>
                <option value="flat">Flat (equal liquidity)</option>
                <option value="early">Early discovery (thin bottom)</option>
                <option value="long">Long curve (deep bottom)</option>
              </select>
            </label>
            <label className="narrow">
              Quote
              <select value={p.quote} onChange={(e) => set('quote')(e.target.value as 'SOL' | 'USDC')}>
                <option>SOL</option>
                <option>USDC</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Start market cap ({p.quote})
              <input type="number" min={1} {...num('initialMarketCap')} />
            </label>
            <label>
              Graduation market cap ({p.quote})
              <input type="number" min={2} {...num('migrationMarketCap')} />
            </label>
          </div>
          <div className="row">
            <label>
              Start fee (bps)
              <input type="number" min={25} max={9900} {...num('startFeeBps')} />
            </label>
            <label>
              End fee (bps)
              <input type="number" min={25} max={9900} {...num('endFeeBps')} />
            </label>
            <label>
              Decay (s)
              <input type="number" min={0} {...num('feeDurationSec')} />
            </label>
          </div>
          <div className="row">
            <label>
              Creator share of fees (%)
              <input type="number" min={0} max={100} {...num('creatorFeePct')} />
            </label>
            <label>
              Pool-creation fee (SOL)
              <input type="number" step={0.001} min={0.001} {...num('poolCreationFeeSol')} />
            </label>
          </div>
          {r.ok ? <p className="status ok">Valid DBC config.</p> : <pre className="status err">{r.error}</pre>}
          {r.ok && <ForkButton preset={p} label="Deploy this curve as my config" />}
        </div>
        <div className="panel">
          {r.ok ? (
            <>
              <CurveChart series={[series(p, r.stats)]} />
              <Stats p={p} s={r.stats} />
            </>
          ) : (
            <p className="hint">Fix the parameters to see the curve.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function MainnetProof() {
  const mn = (kind: string, id: string) => `https://solscan.io/${kind}/${id}`
  return (
    <section className="detail" id="proof">
      <p className="eyebrow">Live on mainnet · DBC program dbcij3LW…</p>
      <h2>The four official configs</h2>
      <p className="lede">
        Every preset is a live DBC config account on Solana mainnet, owned by the DBC program. Launching on one pays its fee claimer. Pools appear in the feed above as
        they are created.
      </p>
      <div className="panel">
        <table className="pools">
          <thead>
            <tr>
              <th>Preset</th>
              <th>Config account</th>
              <th>createConfig tx</th>
            </tr>
          </thead>
          <tbody>
            {PRESETS.map((p) => {
              const d = deployedConfig(p.id)
              return d ? (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <a href={mn('account', d.config)}>{d.config.slice(0, 8)}…</a>
                  </td>
                  <td>
                    <a href={mn('tx', d.signature)}>{d.signature.slice(0, 8)}…</a>
                  </td>
                </tr>
              ) : null
            })}
          </tbody>
        </table>
      </div>
      <h3>Real launch on mainnet</h3>
      <p className="lede">
        {launch.ranAt.slice(0, 10)}: a CBK token launched on the live {launch.preset} config with <code>scripts/mainnet-launch.ts</code>, then a {launch.buySol} SOL buy.
        Curve progress right after our buy: {(launch.curveProgress * 100).toFixed(2)}%. Within seconds another wallet
        (not ours) bought and sold on the pool, so at the {poolState.ranAt.slice(0, 16).replace('T', ' ')} UTC read-back the curve stood at{' '}
        {(poolState.curveProgress * 100).toFixed(4)}% and the pool had paid {poolState.fees.presetAuthorClaimableSol.toFixed(4)} SOL in trading fees to the preset author
        (<code>scripts/pool-state.ts</code>, <code>mainnet-pool-state.json</code>).{' '}
        <code>scripts/verify-mainnet.ts</code> reads every config back from mainnet and checks it against its preset:{' '}
        {verify.configs.reduce((n: number, c: { checks: number }) => n + c.checks, 0)} checks,{' '}
        {verify.configs.reduce((n: number, c: { failed: unknown[] }) => n + c.failed.length, 0)} failures.
      </p>
      <div className="panel">
        <table className="pools">
          <tbody>
            <tr><td>Pool</td><td><a href={mn('account', launch.pool)}>{launch.pool.slice(0, 8)}…</a></td></tr>
            <tr><td>Mint</td><td><a href={mn('token', launch.mint)}>{launch.mint.slice(0, 8)}…</a></td></tr>
            <tr><td>createPool tx</td><td><a href={mn('tx', launch.createPool)}>{launch.createPool.slice(0, 8)}…</a></td></tr>
            <tr><td>Buy tx</td><td><a href={mn('tx', launch.buy)}>{launch.buy.slice(0, 8)}…</a></td></tr>
          </tbody>
        </table>
      </div>
      <h3>Launch + first buy on each live config, simulated on mainnet</h3>
      <p className="lede">
        <code>scripts/mainnet-sim.ts</code> builds the real launch-with-first-buy transaction for each live config and runs it through <code>simulateTransaction</code> against the
        mainnet DBC program (unsigned, never sent, no token created). The fee columns come from the simulated pool state: what the preset author earns from one launch.
        One config costs {(0.00597408).toFixed(4)} SOL of rent, so the author's share of the first launch's pool-creation fee (0.009–0.018 SOL) already covers it.
      </p>
      <div className="panel">
        <table className="pools">
          <thead>
            <tr>
              <th>Preset</th>
              <th>Result</th>
              <th>First buy</th>
              <th>Author: creation fee (after 10% protocol)</th>
              <th>Author: trading fee</th>
            </tr>
          </thead>
          <tbody>
            {sim.runs.map((r) => {
              const p = PRESETS.find((x) => x.id === r.preset)!
              return (
                <tr key={r.preset}>
                  <td>{p.name}</td>
                  <td>{r.ok ? `ok · ${(r.computeUnits / 1000).toFixed(0)}k CU` : 'failed'}</td>
                  <td>{r.buy}</td>
                  <td>{+(r.poolCreationFeeHeldSol * (1 - PROTOCOL_POOL_CREATION_FEE_PERCENT / 100)).toFixed(4)} SOL</td>
                  <td>
                    {r.authorTradingFee} {p.quote}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h3>{fuzz.cases.toLocaleString('en-US')} randomized curve tests, {fuzz.invariantFailures} failures</h3>
      <p className="lede">
        <code>scripts/fuzz-curves.ts</code> builds {fuzz.cases.toLocaleString('en-US')} random configs (seed {fuzz.seed}) through the same SDK path as the app and checks each
        one: {fuzz.passedAllInvariants.toLocaleString('en-US')} valid configs passed every invariant, all {fuzz.invalidCorrectlyRejected} deliberately broken ones were rejected,
        and the SDK validator refused {fuzz.rejectedBySdkValidator}. This is offline SDK math, not mainnet transactions.
      </p>
      <ul className="lede">
        {fuzz.checks.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  )
}

function DevnetProof() {
  const dn = (kind: string, id: string) => `https://solscan.io/${kind}/${id}?cluster=devnet`
  return (
    <section className="detail" id="devnet">
      <p className="eyebrow">On-chain run · devnet · same DBC program id</p>
      <h2>Config → launch → buy, end to end</h2>
      <p className="lede">
        Each SOL preset was deployed, a token was launched on it, and {proof.runs[0].buySol} SOL was bought. The same buy moved Early Discovery about half as far:
        its 25% opening fee keeps a quarter of the input.
      </p>
      <div className="panel">
        <table className="pools">
          <thead>
            <tr>
              <th>Preset</th>
              <th>Pool</th>
              <th>Transactions</th>
              <th>Curve progress after buy</th>
            </tr>
          </thead>
          <tbody>
            {proof.runs.map((r) => (
              <tr key={r.pool}>
                <td>{PRESETS.find((p) => p.id === r.preset)?.name}</td>
                <td>
                  <a href={dn('account', r.pool)}>{r.pool.slice(0, 8)}…</a>
                </td>
                <td>
                  <a href={dn('tx', r.createConfig)}>config</a> · <a href={dn('tx', r.createPool)}>launch</a> · <a href={dn('tx', r.buy)}>buy</a>
                </td>
                <td>{(r.curveProgress * 100).toFixed(3)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Graduation: DBC → DAMM v2, end to end</h3>
      <p className="lede">
        <code>scripts/devnet-graduate.ts</code> runs the whole lifecycle on one pool: the Flat Fair curve with both market caps divided by 150 (threshold{' '}
        {grad.migrationQuoteThresholdSol.toFixed(2)} SOL, so it fits a devnet budget; shape, fees and LP split unchanged), one buy that fills the curve to{' '}
        {(grad.curveProgress * 100).toFixed(0)}%, then <code>migrateToDammV2</code>. Read back afterwards: the DBC pool is marked migrated, the new pool is owned by the
        DAMM v2 program, and {grad.allLpPermanentlyLocked ? 'both LP positions are 100% permanently locked (0 unlocked, 0 vesting)' : 'LP lock check failed'}.
      </p>
      <div className="panel">
        <table className="pools">
          <tbody>
            <tr><td>DBC pool (migrated)</td><td><a href={dn('account', grad.pool)}>{grad.pool.slice(0, 8)}…</a></td></tr>
            <tr><td>DAMM v2 pool</td><td><a href={dn('account', grad.dammV2.pool)}>{grad.dammV2.pool.slice(0, 8)}…</a></td></tr>
            <tr>
              <td>Transactions</td>
              <td>
                <a href={dn('tx', grad.createConfig)}>config</a> · <a href={dn('tx', grad.createPool)}>launch</a> · <a href={dn('tx', grad.buy)}>buy to 100%</a> ·{' '}
                <a href={dn('tx', grad.migrateToDammV2)}>migrate to DAMM v2</a>
              </td>
            </tr>
            {grad.dammV2.positions.map((x, i) => (
              <tr key={x.position}>
                <td>LP position {i + 1}</td>
                <td><a href={dn('account', x.position)}>{x.position.slice(0, 8)}…</a> · permanently locked</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// pools from the scanned top configs that barely move price or graduate on dust: listings, not price discovery
const nearFlat = scan.configs.filter((c) => c.multiplier <= 1.25 || c.threshold < 0.01).reduce((n, c) => n + c.graduatedPools, 0)

export default function App() {
  const [selected, setSelected] = useState(PRESETS[1].id)
  const all = useMemo(() => PRESETS.map((p) => ({ p, r: presetStats(p) })), [])
  const chosen = PRESETS.find((p) => p.id === selected)!

  return (
    <>
      <header className="top">
        <a className="brand" href="#">
          <span className="mark" aria-hidden>
            ⌒
          </span>
          curvebook
        </a>
        <nav>
          <a href="#presets">Presets</a>
          <a href="#inspect">Inspector</a>
          <a href="#builder">Builder</a>
          <a href="#proof">On-chain</a>
          <a href="https://github.com/bryankwandou/curvebook">GitHub</a>
        </nav>
        <WalletMultiButton />
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Launch-curve data and presets for Meteora Dynamic Bonding Curve</p>
            <h1>Know what a launch curve does before you launch on it.</h1>
            <p className="lede">
              Of the latest {scan.graduatedPools.toLocaleString('en-US')} DBC graduations on mainnet, {nearFlat.toLocaleString('en-US')} came from configs that move price{' '}
              1.2x or less or graduate at under 0.01 SOL: direct listings, not price discovery. curvebook reads any DBC config from mainnet and shows what its curve,
              fees and LP lock actually do, then offers presets tuned for real price discovery, each live on mainnet and checked against the program.
            </p>
            <p className="lede">
              <a href="#inspect">Inspect a config</a> · <a href="#presets">Browse presets</a>
            </p>
          </div>
          <div className="panel">
            <CurveChart series={all.flatMap(({ p, r }) => (r.ok ? [series(p, r.stats)] : []))} />
            <ul className="legend">
              {PRESETS.map((p) => (
                <li key={p.id}>
                  <i style={{ background: COLORS[p.id] }} />
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="presets" className="grid">
          {all.map(({ p, r }) => (
            <button
              key={p.id}
              className={`card ${p.id === selected ? 'active' : ''}`}
              onClick={() => {
                setSelected(p.id)
                document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <span className="card-top">
                <strong>{p.name}</strong>
                <span className="pill">{deployedConfig(p.id) ? 'live' : p.quote}</span>
              </span>
              {r.ok && <CurveChart compact series={[series(p, r.stats)]} />}
              {r.ok && (
                <span className="card-stats">
                  <span>{r.stats.multiplier.toFixed(1)}x to graduate</span>
                  <span>{feeLabel(p)}</span>
                </span>
              )}
            </button>
          ))}
        </section>

        <Detail p={chosen} />
        <Inspector />
        <Builder />
        <MainnetProof />
        <DevnetProof />
      </main>

      <footer>
        Built on Meteora DBC + DAMM v2. Mainnet. Not audited by a third party: read the config before you launch.
      </footer>
    </>
  )
}
