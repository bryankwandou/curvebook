// GET /api/badge?address=<token|DBC pool|DBC config>  ->  an SVG badge: "curvebook | LP 89% gone", "no red flags", ...
// For launchpads and terminals to show next to a token; link it to the report URL. Cached for 10 minutes per address.
// Bundled into api/badge.js by `npm run build:api`.
import { Connection } from '@solana/web3.js'
import { buildReport, headline } from '../src/lib/report'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const COLOR = { red: '#e5484d', warn: '#d97706', ok: '#2b8a3e', unknown: '#8b8b93' }

// shields.io-style flat badge; widths from an average Verdana 11px glyph width
function svg(label: string, value: string, color: string) {
  const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  const w = (t: string) => Math.round(t.length * 6.8 + 12)
  const lw = w(label)
  const vw = w(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${lw + vw}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`
}

export default async function handler(req: any, res: any) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('content-type', 'image/svg+xml; charset=utf-8')
  const address = String(req.query?.address ?? '').trim()
  if (!BASE58.test(address) || !process.env.HELIUS_RPC) return res.status(400).send(svg('curvebook', 'no address', COLOR.unknown))
  try {
    const r = await buildReport(new Connection(process.env.HELIUS_RPC, 'confirmed'), new Connection(process.env.HELIUS_RPC, 'confirmed'), address)
    res.setHeader('cache-control', 'public, s-maxage=600, stale-while-revalidate=1800')
    return res.status(200).send(svg('curvebook', headline(r), COLOR[r.verdict]))
  } catch {
    res.setHeader('cache-control', 'public, s-maxage=120')
    return res.status(200).send(svg('curvebook', 'not a DBC token', COLOR.unknown))
  }
}
