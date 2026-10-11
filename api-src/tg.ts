// POST /api/tg: Telegram webhook. Send the bot a token, DBC pool or config address (in a DM), or `/check <address>`
// (in a group), and it replies with the same report as /api/check. Read-only.
// Env: TELEGRAM_BOT_TOKEN, and TELEGRAM_WEBHOOK_SECRET, which Telegram echoes in a header so nobody else can post here.
// Bundled into api/tg.js by `npm run build:api`.
import { Connection } from '@solana/web3.js'
import { buildReport, headline, type Report } from '../src/lib/report'

const ADDRESS = /[1-9A-HJ-NP-Za-km-z]{32,44}/
const SITE = 'https://curvebook-kappa.vercel.app'
const ICON = { red: '🔴', warn: '🟠', ok: '🟢' }
const HELP = `Send a Meteora DBC token, pool or config address and I'll check it: LP lock at graduation, mint authority, fee traps, creator vesting, and for a graduated token how much of its liquidity is gone. In a group: /check &lt;address&gt;. Read-only, nothing is signed. ${SITE}`

const esc = (t: string) => t.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)

export function format(r: Report, url: string) {
  const lines = [`${ICON[r.verdict]} <b>${esc(headline(r))}</b>`]
  for (const f of r.flags.filter((f) => f.severity !== 'info')) lines.push(`${ICON[f.severity as 'red' | 'warn']} ${esc(f.title)}: ${esc(f.detail)}`)
  if (!r.flags.some((f) => f.severity !== 'info')) lines.push('No red flags or warnings on its config.')
  lines.push(`LP permanently locked at graduation: ${r.curve.lpPermanentlyLockedPct}% · fee ${esc(r.curve.fee)} · migrates to ${esc(r.curve.migration)}`)
  lines.push(`<a href="${url}">Full report</a>`)
  return lines.join('\n\n')
}

async function send(chatId: number, text: string, replyTo?: number) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_parameters: replyTo ? { message_id: replyTo } : undefined }),
  })
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' || !process.env.TELEGRAM_BOT_TOKEN || req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET)
    return res.status(403).end()
  const msg = req.body?.message
  const text: string = msg?.text ?? ''
  if (!msg || !text) return res.status(200).end()
  const isPrivate = msg.chat.type === 'private'
  const command = /^\/(check|start|help)(@\w+)?\b/.exec(text)?.[1]
  // in groups the bot only answers /check, so it never talks over a conversation
  if (!isPrivate && command !== 'check') return res.status(200).end()
  const address = ADDRESS.exec(text)?.[0]
  if (!address) {
    if (isPrivate || command) await send(msg.chat.id, HELP)
    return res.status(200).end()
  }
  try {
    const rpc = new Connection(process.env.HELIUS_RPC!, 'confirmed')
    const r = await buildReport(rpc, rpc, address)
    await send(msg.chat.id, format(r, `${SITE}/?config=${address}#inspect`), msg.message_id)
  } catch (e) {
    await send(msg.chat.id, `Could not check ${esc(address)}: ${esc((e as Error).message)}`, msg.message_id)
  }
  return res.status(200).end()
}
