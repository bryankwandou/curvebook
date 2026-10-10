import { useEffect, useState } from 'react'

// How a trading terminal or launchpad plugs the check in: a JSON endpoint, an SVG badge, and the CLI for CI.
// The sample response is fetched live, so the page shows what the endpoint returns today.
const SITE = 'https://curvebook-kappa.vercel.app'
const EXAMPLE = 'USTdxXk3BZTAX43TjAbrS4Hnb1iVVyvGeqtkvLzLPGJ'
const BADGES: [string, string][] = [
  ['LP pulled after graduating', EXAMPLE],
  ['our token, on the curve', '9yVLMokYuoC2KWMESmD1XUY3jmFJmasEw4FKPxZZ6gfS'],
]

export function ApiDocs() {
  const [sample, setSample] = useState('')
  useEffect(() => {
    fetch(`/api/check?address=${EXAMPLE}`)
      .then((r) => r.json())
      .then((j) => {
        // the fields a terminal needs first; the full response also has the curve and fee details
        const { input, kind, token, pool, config, verdict, flags, status, reportUrl } = j
        setSample(JSON.stringify({ input, kind, token, pool, config, verdict, flags, status, reportUrl, '…': 'curve, fees, checkedAt' }, null, 2))
      })
      .catch(() => setSample(''))
  }, [])

  return (
    <section className="detail" id="api">
      <p className="eyebrow">For trading terminals and launchpads · read-only · free</p>
      <h2>Plug the check into your product</h2>
      <p className="lede">
        The same report as the Inspector, for any token, DBC pool or config. CORS is open and responses are cached for five minutes per address, so a terminal can call it
        for every token it lists. The verdict is <code>red</code> when the graduation liquidity is half gone or a red flag is set, <code>warn</code> for warnings,{' '}
        <code>ok</code> otherwise.
      </p>
      <div className="detail-grid">
        <div className="panel">
          <h3>JSON</h3>
          <pre className="code">{`GET ${SITE}/api/check?address=<token | DBC pool | config>`}</pre>
          <pre className="code api-sample">{sample || 'loading a live response…'}</pre>
        </div>
        <div className="panel">
          <h3>Badge</h3>
          <p className="hint">An SVG badge to show next to a token, linked to its full report. Cached for ten minutes.</p>
          {BADGES.map(([label, a]) => (
            <p key={a} className="badge-row">
              <a href={`${SITE}/?config=${a}#inspect`}>
                <img src={`/api/badge?address=${a}`} alt={`curvebook check for ${label}`} height={20} />
              </a>{' '}
              <span className="hint">{label}</span>
            </p>
          ))}
          <pre className="code">{`<a href="${SITE}/?config=<address>#inspect">
  <img src="${SITE}/api/badge?address=<address>" alt="curvebook check">
</a>`}</pre>
          <h3>CI</h3>
          <p className="hint">Gate your own configs before you deploy them: exit code 1 on a red flag (or on a warning with --fail-on warn).</p>
          <pre className="code">{`git clone https://github.com/bryankwandou/curvebook && cd curvebook && npm ci
RPC=<your mainnet RPC> npx tsx scripts/check.ts --fail-on warn <config>`}</pre>
        </div>
      </div>
    </section>
  )
}
