// GET /api/check?address=<token|DBC pool|DBC config>
// The same report as scripts/check.ts (src/lib/report.ts), as JSON, for trading terminals and launchpads. Read-only.
// Responses are CDN-cached for 5 minutes per address. Bundled into api/check.js by `npm run build:api`.
import { Connection } from '@solana/web3.js'
import { buildReport } from '../src/lib/report'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
// errors that mean "not something we can check", as opposed to an RPC failure
const NOT_FOUND = /No account at this address|Not a DBC config, a DBC pool or a token mint|not launched on Meteora DBC|neither a config nor a pool|not a DBC config/
const SITE = 'https://curvebook-kappa.vercel.app'

export default async function handler(req: any, res: any) {
  res.setHeader('access-control-allow-origin', '*')
  const address = String(req.query?.address ?? '').trim()
  if (!BASE58.test(address)) return res.status(400).json({ error: 'pass ?address= a token mint, DBC pool or DBC config address' })
  if (!process.env.HELIUS_RPC) return res.status(503).json({ error: 'RPC not configured' })
  const connection = new Connection(process.env.HELIUS_RPC, 'confirmed')
  try {
    const report = await buildReport(connection, connection, address)
    res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=900')
    return res.status(200).json({ ...report, checkedAt: new Date().toISOString(), reportUrl: `${SITE}/?config=${address}#inspect` })
  } catch (e) {
    const message = (e as Error).message
    const notFound = NOT_FOUND.test(message)
    res.setHeader('cache-control', notFound ? 'public, s-maxage=300' : 'no-store')
    return res.status(notFound ? 404 : 502).json({ input: address, error: message })
  }
}
