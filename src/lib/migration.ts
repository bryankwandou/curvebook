import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, DynamicBondingCurveIdl, createDammV2Program } from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { Connection } from '@solana/web3.js'
import bs58 from 'bs58'

// Reads a DBC graduation out of a raw getTransaction result (encoding 'json', any version): which config and pool it
// was, and what the migration put into the DAMM pool. Used by scripts/scan-graduations.ts and by the site's inspector,
// so both read migrations the same way.
//   DAMM v2: liquidity per migration position, from the DAMM events (emit_cpi inner instructions) in the transaction.
//   DAMM v1: the LP mint and the LP amount minted to the DBC pool's LP account.
const disc = (name: string) => Buffer.from(DynamicBondingCurveIdl.instructions.find((i) => i.name === name)!.discriminator).toString('hex')
const MIGRATE_V2 = disc('migration_damm_v2')
const MIGRATE_V1 = disc('migrate_meteora_damm')
const DBC = DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()
const DAMM_V2 = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'

export interface Migration {
  config: string
  pool: string
  kind: 'damm_v2' | 'damm_v1'
  dammPool: string
  positions?: { position: string; liquidity: string; permanentLocked: string }[]
  lpMint?: string
  lpMinted?: string
}

let coder: any
export function findMigrations(tx: any, connection: Connection): Migration[] {
  if (!tx?.meta) return []
  coder ??= (createDammV2Program(connection) as any).coder
  const m = tx.transaction.message
  const keys: string[] = [...m.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])]
  const out: Migration[] = []
  for (const ix of m.instructions as { programIdIndex: number; accounts: number[]; data: string }[]) {
    if (keys[ix.programIdIndex] !== DBC) continue
    const d = Buffer.from(bs58.decode(ix.data).subarray(0, 8)).toString('hex')
    if (d !== MIGRATE_V2 && d !== MIGRATE_V1) continue
    const base = { config: keys[ix.accounts[2]], pool: keys[ix.accounts[0]], dammPool: keys[ix.accounts[4]] }
    if (d === MIGRATE_V1) {
      const lpAccount = keys[ix.accounts[19]]
      const bal = tx.meta.postTokenBalances?.find((b: any) => keys[b.accountIndex] === lpAccount)
      out.push({ ...base, kind: 'damm_v1', lpMint: keys[ix.accounts[6]], lpMinted: bal?.uiTokenAmount.amount })
      continue
    }
    const liquidity = new Map<string, bigint>()
    const locked = new Map<string, bigint>()
    let current = ''
    for (const inner of tx.meta.innerInstructions ?? [])
      for (const ii of inner.instructions) {
        if (keys[ii.programIdIndex] !== DAMM_V2) continue
        const data = Buffer.from(bs58.decode(ii.data))
        if (data.length < 16) continue
        let e: { name: string; data: any } | null = null
        try {
          e = coder.events.decode(data.subarray(8).toString('base64'))
        } catch {
          continue
        }
        if (!e) continue
        const add = (map: Map<string, bigint>, k: string, v: { toString(): string }) => map.set(k, (map.get(k) ?? 0n) + BigInt(v.toString()))
        if (e.name === 'evtCreatePosition') current = e.data.position.toBase58()
        else if (e.name === 'evtInitializePool') add(liquidity, current, e.data.liquidity)
        else if (e.name === 'evtLiquidityChange' && e.data.changeType === 0) add(liquidity, e.data.position.toBase58(), e.data.liquidityDelta)
        else if (e.name === 'evtPermanentLockPosition') add(locked, e.data.position.toBase58(), e.data.lockLiquidityAmount)
      }
    out.push({
      ...base,
      kind: 'damm_v2',
      positions: [keys[ix.accounts[7]], keys[ix.accounts[10]]].map((p) => ({
        position: p,
        liquidity: (liquidity.get(p) ?? 0n).toString(),
        permanentLocked: (locked.get(p) ?? 0n).toString(),
      })),
    })
  }
  return out
}

/** total liquidity (DAMM v2) or LP (DAMM v1) the migration put into the pool */
export const migratedAmount = (m: Migration) =>
  m.kind === 'damm_v2' ? (m.positions ?? []).reduce((n, p) => n + BigInt(p.liquidity), 0n) : BigInt(m.lpMinted ?? '0')

/** raw getTransaction over JSON-RPC: version-agnostic, so transactions web3.js 1.x cannot parse are still read */
export async function rawTransaction(rpc: string, signature: string) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }] }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}
