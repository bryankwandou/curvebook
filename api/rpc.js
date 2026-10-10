// Narrow JSON-RPC proxy for the pool feed. The public mainnet RPC refuses getProgramAccounts, so this forwards
// exactly two read methods to a private RPC whose URL (with its API key) lives only in the HELIUS_RPC env var:
// getProgramAccounts on the DBC program, and getAccountInfo. Anything else is refused, so it is not a free RPC.
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  if (!body || Array.isArray(body) || JSON.stringify(body).length > 2000) return res.status(400).json({ error: 'one small request only' })
  const ok =
    (body.method === 'getProgramAccounts' && body.params?.[0] === DBC) ||
    (body.method === 'getAccountInfo' && typeof body.params?.[0] === 'string' && body.params[0].length <= 44)
  if (!ok) return res.status(403).json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: 403, message: 'method not allowed' } })
  if (!process.env.HELIUS_RPC) return res.status(503).json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: 503, message: 'RPC not configured' } })
  const upstream = await fetch(process.env.HELIUS_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  res.setHeader('cache-control', 's-maxage=30, stale-while-revalidate=60')
  res.status(upstream.status).send(await upstream.text())
}
