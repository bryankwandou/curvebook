import { useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { deployConfig, feedConnection, launchToken, poolsOnConfig, type PoolRow } from '../lib/actions'
import type { Preset } from '../lib/presets'

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`
const solscan = (kind: 'tx' | 'account' | 'token', id: string) => `https://solscan.io/${kind}/${id}`

type Status = { kind: 'idle' } | { kind: 'busy'; msg: string } | { kind: 'ok'; node: React.ReactNode } | { kind: 'err'; msg: string }

function StatusLine({ s }: { s: Status }) {
  if (s.kind === 'idle') return null
  if (s.kind === 'busy') return <p className="status busy">{s.msg}</p>
  if (s.kind === 'ok') return <p className="status ok">{s.node}</p>
  return <pre className="status err">{s.msg}</pre>
}

function useRequireWallet() {
  const { publicKey, sendTransaction } = useWallet()
  const { setVisible } = useWalletModal()
  return { publicKey, sendTransaction, ask: () => setVisible(true) }
}

export function LaunchForm({ config }: { config: string }) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, ask } = useRequireWallet()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [uri, setUri] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const valid = name.trim().length > 0 && name.length <= 32 && /^[A-Za-z0-9]{1,10}$/.test(symbol) && /^https?:\/\/.{4,190}$/.test(uri)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!publicKey) return ask()
    setStatus({ kind: 'busy', msg: 'Simulating, then waiting for your wallet…' })
    try {
      const r = await launchToken(connection, publicKey, sendTransaction, { config, name: name.trim(), symbol, uri })
      setStatus({
        kind: 'ok',
        node: (
          <>
            Launched. Token <a href={solscan('token', r.mint)}>{short(r.mint)}</a>, tx <a href={solscan('tx', r.signature)}>{short(r.signature)}</a>.
            Trade it on <a href={`https://jup.ag/swap/SOL-${r.mint}`}>Jupiter</a>.
          </>
        ),
      })
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as Error).message })
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="My Token" />
        </label>
        <label className="narrow">
          Symbol
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} placeholder="MYT" />
        </label>
      </div>
      <label>
        Metadata URI
        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://…/metadata.json (Metaplex JSON: name, symbol, image)" />
      </label>
      <button className="primary" disabled={status.kind === 'busy' || (!!publicKey && !valid)}>
        {publicKey ? 'Launch token on mainnet' : 'Connect wallet to launch'}
      </button>
      <p className="hint">You sign one transaction: it creates the mint and the DBC pool. The preset's pool-creation fee is charged by the program.</p>
      <StatusLine s={status} />
    </form>
  )
}

export function ForkButton({ preset, label = 'Deploy as my own config' }: { preset: Preset; label?: string }) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, ask } = useRequireWallet()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function run() {
    if (!publicKey) return ask()
    setStatus({ kind: 'busy', msg: 'Simulating createConfig, then waiting for your wallet…' })
    try {
      const r = await deployConfig(connection, publicKey, sendTransaction, preset)
      setStatus({
        kind: 'ok',
        node: (
          <>
            Config <a href={solscan('account', r.config)}>{r.config}</a> is live (tx <a href={solscan('tx', r.signature)}>{short(r.signature)}</a>). You are its fee
            claimer: pass it as <code>config</code> to <code>createPool</code> in your launchpad.
          </>
        ),
      })
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as Error).message })
    }
  }

  return (
    <div>
      <button className="secondary" onClick={run} disabled={status.kind === 'busy'}>
        {publicKey ? label : 'Connect wallet to deploy'}
      </button>
      <StatusLine s={status} />
    </div>
  )
}

export function PoolFeed({ config }: { config: string }) {
  const { connection } = useConnection()
  const [rows, setRows] = useState<PoolRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    poolsOnConfig(feedConnection(connection), config)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [connection, config])

  if (error) return <p className="hint">Pool feed is unavailable right now ({error.slice(0, 80)}). The pools are on Solscan from the config link above.</p>
  if (!rows) return <p className="hint">Loading pools on this config…</p>
  if (!rows.length) return <p className="hint">No tokens launched on this config yet. Be the first.</p>
  return (
    <table className="pools">
      <thead>
        <tr>
          <th>Token</th>
          <th>Creator</th>
          <th>Curve progress</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.pool}>
            <td>
              <a href={solscan('token', r.baseMint)}>{short(r.baseMint)}</a>
            </td>
            <td>{short(r.creator)}</td>
            <td>
              {r.migrated ? (
                'graduated to DAMM v2'
              ) : (
                <span className="bar">
                  <span style={{ width: `${(r.progress * 100).toFixed(1)}%` }} />
                  <em>{(r.progress * 100).toFixed(1)}%</em>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
