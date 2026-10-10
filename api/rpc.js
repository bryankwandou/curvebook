// Narrow JSON-RPC proxy for the inspector and the pool feed. The public mainnet RPCs refuse getProgramAccounts and keep
// little transaction history, so this forwards a few read methods to a private RPC whose URL (with its API key) lives
// only in the HELIUS_RPC env var. Everything is scoped to the DBC program, so it is not a free general-purpose RPC:
//   getProgramAccounts  on the DBC program only
//   getAccountInfo      any single account
//   getSignaturesForAddress  only for accounts the DBC program owns (its configs and pools), newest 25 at most
//   getTransaction      returned only if the transaction calls the DBC program
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
const isKey = (k) => typeof k === 'string' && k.length >= 32 && k.length <= 44

async function call(method, params) {
  const r = await fetch(process.env.HELIUS_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  return r.json()
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  if (!body || Array.isArray(body) || JSON.stringify(body).length > 2000) return res.status(400).json({ error: 'one small request only' })
  const id = body.id ?? null
  const deny = () => res.status(403).json({ jsonrpc: '2.0', id, error: { code: 403, message: 'method not allowed' } })
  if (!process.env.HELIUS_RPC) return res.status(503).json({ jsonrpc: '2.0', id, error: { code: 503, message: 'RPC not configured' } })
  const { method, params: p } = body
  const forward = async (b) => {
    const upstream = await fetch(process.env.HELIUS_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    res.status(upstream.status).send(await upstream.text())
  }

  if (method === 'getProgramAccounts' && p?.[0] === DBC) return forward(body)
  if (method === 'getAccountInfo' && isKey(p?.[0])) return forward(body)
  if (method === 'getSignaturesForAddress' && isKey(p?.[0])) {
    const acct = await call('getAccountInfo', [p[0], { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])
    if (acct.result?.value?.owner !== DBC) return deny()
    return forward({ ...body, params: [p[0], { ...(p[1] ?? {}), limit: Math.min(25, Number(p[1]?.limit) || 25) }] })
  }
  if (method === 'getTransaction' && typeof p?.[0] === 'string' && p[0].length <= 90) {
    const r = await call('getTransaction', [p[0], { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])
    const tx = r.result
    if (!tx) return res.status(200).json({ jsonrpc: '2.0', id, result: null })
    const keys = tx ? [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])] : []
    if (!keys.includes(DBC)) return deny()
    return res.status(200).json({ jsonrpc: '2.0', id, result: tx })
  }
  return deny()
}
