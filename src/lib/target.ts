import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveClient,
  DynamicBondingCurveIdl,
  createDammV2Program,
  createDbcProgram,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { PublicKey, type Connection } from '@solana/web3.js'
import { findMigrations, migratedAmount, rawTransaction } from './migration'

// What a pasted address is: a DBC config, a DBC pool, or a token mint launched on DBC. Buyers have the token, not the
// config, so the inspector resolves any of the three to the config that governs the pool.
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']
const DISC = Object.fromEntries(DynamicBondingCurveIdl.accounts.map((a) => [a.name, a.discriminator as number[]]))
const startsWith = (data: Uint8Array, d: number[]) => d.every((b, i) => data[i] === b)

export interface Target {
  kind: 'config' | 'pool' | 'mint'
  config: string
  pool?: string
  baseMint?: string
}

/** `feed` must allow getProgramAccounts on the DBC program (the site's /api/rpc proxy does); it is only used for mints */
export async function resolveTarget(connection: Connection, feed: Connection, address: string): Promise<Target> {
  const key = new PublicKey(address.trim())
  const info = await connection.getAccountInfo(key)
  if (!info) throw new Error('No account at this address on mainnet.')
  const owner = info.owner.toBase58()
  if (owner === DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()) {
    if (startsWith(info.data, DISC.PoolConfig)) return { kind: 'config', config: key.toBase58() }
    if (startsWith(info.data, DISC.VirtualPool)) {
      // the account wraps its fields in poolState
      const raw = createDbcProgram(connection).program.coder.accounts.decode('virtualPool', info.data)
      const pool = raw.poolState ?? raw
      return { kind: 'pool', config: pool.config.toBase58(), pool: key.toBase58(), baseMint: pool.baseMint.toBase58() }
    }
    throw new Error('This DBC account is neither a config nor a pool.')
  }
  if (TOKEN_PROGRAMS.includes(owner)) {
    const found = await new DynamicBondingCurveClient(feed, 'confirmed').state.getPoolByBaseMint(key)
    if (!found) throw new Error('This token was not launched on Meteora DBC.')
    const account: any = found.account
    const state = account.poolState ?? account
    return { kind: 'mint', config: state.config.toBase58(), pool: found.publicKey.toBase58(), baseMint: key.toBase58() }
  }
  throw new Error('Not a DBC config, a DBC pool or a token mint.')
}

export interface PoolStatus {
  migrated: boolean
  /** share of the migration threshold raised on the curve, 0–1 */
  progress: number
  graduation?: {
    time: number
    signature: string
    kind: 'damm_v2' | 'damm_v1'
    dammPool: string
    /** share of the liquidity (v2) or LP (v1) the migration put in that is no longer in the pool; null if unreadable */
    gonePct: number | null
    /** DAMM v2 only: share of the pool's liquidity today that is permanently locked */
    lockedNowPct?: number
  }
}

/** `history` must serve getSignaturesForAddress and getTransaction with full history (the site's /api/rpc proxy does;
 *  public RPCs keep only recent history) */
export async function poolStatus(connection: Connection, target: Target, history: Connection = connection): Promise<PoolStatus | null> {
  if (!target.pool) return null
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const raw: any = await client.state.getPool(target.pool)
  const cfg = await client.state.getPoolConfig(target.config)
  if (!raw || !cfg) return null
  const state = raw.poolState ?? raw
  const migrated = Number(state.isMigrated) !== 0
  if (!migrated) return { migrated, progress: Number(state.quoteReserve.toString()) / Number(cfg.migrationQuoteThreshold.toString()) }
  return { migrated, progress: 1, graduation: (await graduationOf(connection, history, target.pool)) ?? undefined }
}

// a public or shared RPC answers 429 under load; a few short retries keep one busy second from failing the lookup
async function retry<T>(f: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f()
    } catch (e) {
      if (i + 1 >= tries || !/429|Too Many/i.test((e as Error).message)) throw e
      await new Promise((r) => setTimeout(r, 600 * 2 ** i))
    }
  }
}

// The migration is among the last transactions on a DBC pool (trading moves to DAMM after it), so the newest
// signatures are enough. Same parser as the daily scan (src/lib/migration.ts).
async function graduationOf(connection: Connection, history: Connection, pool: string): Promise<PoolStatus['graduation'] | null> {
  const sigs = await retry(() => history.getSignaturesForAddress(new PublicKey(pool), { limit: 25 }))
  for (const s of sigs) {
    if (s.err) continue
    const m = findMigrations(await retry(() => rawTransaction(history.rpcEndpoint, s.signature)), connection).find((x) => x.pool === pool)
    if (!m) continue
    const migratedIn = migratedAmount(m)
    let today: bigint | null = null
    let lockedNowPct: number | undefined
    if (m.kind === 'damm_v2') {
      const info = await connection.getAccountInfo(new PublicKey(m.dammPool))
      if (info) {
        const p = (createDammV2Program(connection) as any).coder.accounts.decode('pool', info.data)
        today = BigInt(p.liquidity.toString())
        const locked = BigInt(p.permanentLockLiquidity.toString())
        lockedNowPct = today === 0n ? 100 : Number((locked * 10_000n) / today) / 100
      }
    } else if (m.lpMint) {
      const info = await connection.getAccountInfo(new PublicKey(m.lpMint))
      if (info) today = Buffer.from(info.data).readBigUInt64LE(36) // SPL mint supply
    }
    const gonePct = today === null || migratedIn === 0n ? null : Math.max(0, Number(((migratedIn - today) * 10_000n) / migratedIn) / 100)
    return { time: s.blockTime ?? 0, signature: s.signature, kind: m.kind, dammPool: m.dammPool, gonePct, lockedNowPct }
  }
  return null
}
