// Which DBC configs actually graduate? Read-only scan of recent mainnet migrations.
// Every DBC graduation passes one of Meteora's DAMM migration-fee configs, so their recent signatures are a
// stream of graduations. Each migrate instruction names the DBC config (account #2). Groups by config, then
// decodes the most-graduated ones with the same inspector the site uses. Writes graduated-configs.json.
//
//   npx tsx scripts/scan-graduations.ts        (PER_ADDRESS=100 signatures per migration config, RPC=... optional)
//   RPC=https://mainnet.helius-rpc.com/?api-key=... CONCURRENCY=8 DELAY=100 PER_ADDRESS=200 npx tsx scripts/scan-graduations.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  DAMM_V1_MIGRATION_FEE_ADDRESS,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
  createDammV2Program,
  createDbcProgram,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, PublicKey, type ConfirmedSignatureInfo } from '@solana/web3.js'
import bs58 from 'bs58'
import { inspectConfig } from '../src/lib/inspect'

const RPC = process.env.RPC ?? 'https://api.mainnet-beta.solana.com'
const connection = new Connection(RPC, 'confirmed')
const PER_ADDRESS = Number(process.env.PER_ADDRESS ?? 100)
const TOP = 8
// the public RPC rate-limits getTransaction hard (1 at a time, 700 ms apart); a private RPC can take CONCURRENCY=8 DELAY=100
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1)
const DELAY = Number(process.env.DELAY ?? 700)
// 8-byte instruction discriminators of the two migrate instructions, from the program IDL
const MIGRATE = DynamicBondingCurveIdl.instructions
  .filter((i) => i.name === 'migration_damm_v2' || i.name === 'migrate_meteora_damm')
  .map((i) => Buffer.from(i.discriminator).toString('hex'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f()
    } catch (e) {
      if (i >= 8) throw e
      await sleep(Math.min(60_000, 2000 * 2 ** i))
    }
  }
}

async function rawTransaction(signature: string) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }] }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

const sigs = new Map<string, ConfirmedSignatureInfo>()
// the sample is complete from coveredSince on: every migration config that hit the PER_ADDRESS limit reaches back at least that far
let coveredSince = 0
for (const a of [...DAMM_V2_MIGRATION_FEE_ADDRESS, ...DAMM_V1_MIGRATION_FEE_ADDRESS]) {
  const page = await retry(() => connection.getSignaturesForAddress(a, { limit: PER_ADDRESS }))
  for (const s of page) if (!s.err) sigs.set(s.signature, s)
  if (page.length >= PER_ADDRESS) coveredSince = Math.max(coveredSince, Math.min(...page.map((s) => s.blockTime ?? Infinity)))
}
console.log(`${sigs.size} successful transactions on the migration configs`)

// what each migration put where, for scripts/lp-outcomes.ts: per-position DAMM v2 liquidity from the DAMM events in the
// migration transaction, or the DAMM v1 LP mint and the LP amount minted at migration
interface Migration {
  kind: 'damm_v2' | 'damm_v1'
  dammPool?: string
  positions?: { position: string; liquidity: string; permanentLocked: string }[]
  lpMint?: string
  lpMinted?: string
}
const MIGRATE_V2 = Buffer.from(DynamicBondingCurveIdl.instructions.find((i) => i.name === 'migration_damm_v2')!.discriminator).toString('hex')
const DAMM_V2 = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'
const dammCoder = (createDammV2Program(connection) as any).coder
function migrationDetails(tx: any, keys: string[], ix: { accounts: number[] }, v2: boolean): Migration {
  if (!v2) {
    const lpAccount = keys[ix.accounts[19]]
    const bal = tx.meta.postTokenBalances?.find((b: any) => keys[b.accountIndex] === lpAccount)
    return { kind: 'damm_v1', dammPool: keys[ix.accounts[4]], lpMint: keys[ix.accounts[6]], lpMinted: bal?.uiTokenAmount.amount }
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
        e = dammCoder.events.decode(data.subarray(8).toString('base64'))
      } catch {
        continue
      }
      if (!e) continue
      const add = (m: Map<string, bigint>, k: string, v: { toString(): string }) => m.set(k, (m.get(k) ?? 0n) + BigInt(v.toString()))
      if (e.name === 'evtCreatePosition') current = e.data.position.toBase58()
      else if (e.name === 'evtInitializePool') add(liquidity, current, e.data.liquidity)
      else if (e.name === 'evtLiquidityChange' && e.data.changeType === 0) add(liquidity, e.data.position.toBase58(), e.data.liquidityDelta)
      else if (e.name === 'evtPermanentLockPosition') add(locked, e.data.position.toBase58(), e.data.lockLiquidityAmount)
    }
  return {
    kind: 'damm_v2',
    dammPool: keys[ix.accounts[4]],
    positions: [keys[ix.accounts[7]], keys[ix.accounts[10]]].map((p) => ({
      position: p,
      liquidity: (liquidity.get(p) ?? 0n).toString(),
      permanentLocked: (locked.get(p) ?? 0n).toString(),
    })),
  }
}

const graduations: ({ config: string; pool: string; time: number; signature: string } & Migration)[] = []
const list = [...sigs.values()]
for (let i = 0; i < list.length; i += CONCURRENCY) {
  await Promise.all(
    list.slice(i, i + CONCURRENCY).map(async (s) => {
      // raw JSON-RPC: version-agnostic, so transactions in formats web3.js 1.x cannot parse are still read
      const tx = await retry(() => rawTransaction(s.signature))
      if (!tx?.meta) return
      const m = tx.transaction.message
      const keys: string[] = [...m.accountKeys, ...tx.meta.loadedAddresses.writable, ...tx.meta.loadedAddresses.readonly]
      for (const ix of m.instructions as { programIdIndex: number; accounts: number[]; data: string }[]) {
        if (keys[ix.programIdIndex] !== DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()) continue
        const disc = Buffer.from(bs58.decode(ix.data).subarray(0, 8)).toString('hex')
        if (!MIGRATE.includes(disc)) continue
        graduations.push({
          config: keys[ix.accounts[2]],
          pool: keys[ix.accounts[0]],
          time: s.blockTime ?? 0,
          signature: s.signature,
          ...migrationDetails(tx, keys, ix, disc === MIGRATE_V2),
        })
      }
    }),
  )
  await sleep(DELAY)
  if (i % (CONCURRENCY * 50) === 0) console.log(`  ${i}/${list.length} read, ${graduations.length} graduations so far`)
}

// one migration can take several transactions; count each pool once
const byConfig = new Map<string, Map<string, number>>()
for (const g of graduations) {
  const pools = byConfig.get(g.config) ?? new Map<string, number>()
  pools.set(g.pool, Math.max(pools.get(g.pool) ?? 0, g.time))
  byConfig.set(g.config, pools)
}
const ranked = [...byConfig.entries()].map(([config, pools]) => ({ config, pools })).sort((a, b) => b.pools.size - a.pools.size)
const totalPools = ranked.reduce((n, r) => n + r.pools.size, 0)
const times = graduations.map((g) => g.time).filter(Boolean)

// classify EVERY config, not just the top ones: price range from the stored sqrt prices (exact, no curve walk)
// and graduation threshold in quote units. "Listing" = price moves 1.25x or less, or graduates on under 0.01 quote.
const coder = createDbcProgram(connection).program.coder
const decoded = new Map<string, { multiplier: number; threshold: number; quoteMint: string; lpUnlockedPct: number; lpVesting: boolean; mintAuthority: boolean }>()
for (let i = 0; i < ranked.length; i += 100) {
  const keys = ranked.slice(i, i + 100).map((r) => new PublicKey(r.config))
  const infos = await retry(() => connection.getMultipleAccountsInfo(keys))
  infos.forEach((info, k) => {
    if (!info) return
    let c: any
    try {
      c = coder.accounts.decode('poolConfig', info.data)
    } catch {
      return // not a current-layout pool config: counted as undecoded below
    }
    const r = Number(c.migrationSqrtPrice.toString()) / Number(c.sqrtStartPrice.toString())
    decoded.set(keys[k].toBase58(), {
      multiplier: r * r,
      threshold: Number(c.migrationQuoteThreshold.toString()),
      quoteMint: c.quoteMint.toBase58(),
      // LP that is not permanently locked goes to the partner / creator as a position they can withdraw
      lpUnlockedPct: c.partnerLiquidityPercentage + c.creatorLiquidityPercentage,
      lpVesting: !!(c.partnerLiquidityVestingInfo?.isInitialized || c.creatorLiquidityVestingInfo?.isInitialized),
      // token authority options 3 and 4 keep the mint authority with the creator / partner
      mintAuthority: c.tokenUpdateAuthority === 3 || c.tokenUpdateAuthority === 4,
    })
  })
}
const mints = [...new Set([...decoded.values()].map((d) => d.quoteMint))]
const decimals = new Map<string, number>()
for (let i = 0; i < mints.length; i += 100) {
  const res = await retry(() => connection.getMultipleParsedAccounts(mints.slice(i, i + 100).map((m) => new PublicKey(m))))
  res.value.forEach((v, k) => decimals.set(mints[i + k], (v?.data as any)?.parsed?.info?.decimals ?? 9))
}
const isListing = (cfg: string) => {
  const d = decoded.get(cfg)
  if (!d) return null
  return d.multiplier <= 1.25 || d.threshold / 10 ** (decimals.get(d.quoteMint) ?? 9) < 0.01
}
const share = (since: number) => {
  let total = 0
  let listing = 0
  let unknown = 0
  for (const r of ranked)
    for (const t of r.pools.values()) {
      if (t < since) continue
      total++
      const l = isListing(r.config)
      if (l === null) unknown++
      else if (l) listing++
    }
  return { graduations: total, listings: listing, undecoded: unknown }
}
// buyer-safety view of the same sample: graduations whose DAMM liquidity is mostly withdrawable, or whose mint stays open
const safety = (() => {
  let lpMostlyWithdrawable = 0
  let lpAllLocked = 0
  let mintAuthorityKept = 0
  for (const r of ranked) {
    const d = decoded.get(r.config)
    if (!d) continue
    // vesting is not counted as protection: in lp-outcomes.json, pools on vesting configs lost liquidity as often
    if (d.lpUnlockedPct >= 50) lpMostlyWithdrawable += r.pools.size
    if (d.lpUnlockedPct === 0) lpAllLocked += r.pools.size
    if (d.mintAuthority) mintAuthorityKept += r.pools.size
  }
  return {
    rule: 'lpMostlyWithdrawable = 50% or more of the graduation LP is not permanently locked (vesting or not); lpAllLocked = 100% permanently locked; mintAuthorityKept = token authority option 3 or 4',
    lpMostlyWithdrawable,
    lpAllLocked,
    mintAuthorityKept,
  }
})()
const perConfig = ranked.map((r) => {
  const d = decoded.get(r.config)
  return {
    config: r.config,
    graduatedPools: r.pools.size,
    multiplier: d?.multiplier ?? null,
    threshold: d ? d.threshold / 10 ** (decimals.get(d.quoteMint) ?? 9) : null,
    listing: isListing(r.config),
    lpUnlockedPct: d?.lpUnlockedPct ?? null,
    lpVesting: d?.lpVesting ?? null,
    mintAuthority: d?.mintAuthority ?? null,
  }
})
const classification = {
  rule: 'listing = price moves 1.25x or less from open to graduation, or the graduation threshold is under 0.01 of the quote token',
  configsDecoded: decoded.size,
  all: share(0),
  // the sample is the latest signatures per migration config, so busy configs cover days and quiet ones months:
  // only the whole-sample share is meaningful, not per-period shares
  sample: 'latest PER_ADDRESS successful transactions on each DAMM v1/v2 migration-fee config',
  safety,
}
console.log(JSON.stringify(classification))

const configs = []
for (const r of ranked.slice(0, TOP)) {
  try {
    const x = await retry(() => inspectConfig(connection, r.config))
    configs.push({
      config: r.config,
      graduatedPools: r.pools.size,
      samplePools: [...r.pools.keys()].slice(0, 3),
      lastGraduation: new Date(Math.max(...r.pools.values()) * 1000).toISOString(),
      feeClaimer: x.feeClaimer,
      quote: x.quote,
      threshold: x.threshold,
      multiplier: x.multiplier,
      earlyBuyerMultiple: x.earlyBuyerMultiple,
      soldPct: x.soldPct,
      fee: x.fee,
      creatorFeePct: x.creatorFeePct,
      migration: x.migration,
      lpLockedPct: x.lpLockedPct,
      // a preset only counts as close when the curve shapes are near; otherwise say there is none
      closest: x.closest.gap < 0.25 ? x.closest.name : 'none',
      closestGap: x.closest.gap,
    })
  } catch (e) {
    console.log(`  could not decode ${r.config}: ${(e as Error).message}`)
  }
}

const out = {
  cluster: 'mainnet-beta',
  mode: 'read-only (getSignaturesForAddress on the DAMM migration configs + getTransaction + config accounts)',
  ranAt: new Date().toISOString(),
  window: { from: new Date(Math.min(...times) * 1000).toISOString(), to: new Date(Math.max(...times) * 1000).toISOString() },
  graduatedPools: totalPools,
  distinctConfigs: ranked.length,
  classification,
  configs,
  allConfigs: perConfig,
}
writeFileSync(new URL('../graduated-configs.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
// one row per graduated pool with what its migration created; input of scripts/lp-outcomes.ts (not bundled into the site)
const perPool = new Map<string, (typeof graduations)[number]>()
for (const g of graduations.sort((a, b) => a.time - b.time)) if (!perPool.has(g.pool)) perPool.set(g.pool, g)
writeFileSync(new URL('../graduated-pools.json', import.meta.url), JSON.stringify({ ranAt: out.ranAt, pools: [...perPool.values()] }) + '\n')

// daily snapshot of the same sample. Not a daily graduation count: the busiest migration config fills
// PER_ADDRESS signatures in about an hour, so coveredSince records how far back the sample is complete.
const day = {
  date: out.ranAt.slice(0, 10),
  ranAt: out.ranAt,
  window: out.window,
  coveredSince: new Date(coveredSince * 1000).toISOString(),
  configs: ranked.length,
  ...classification.all,
  lpMostlyWithdrawable: safety.lpMostlyWithdrawable,
  lpAllLocked: safety.lpAllLocked,
  mintAuthorityKept: safety.mintAuthorityKept,
}
const historyFile = new URL('../graduation-history.json', import.meta.url)
const history: { rule: string; days: (typeof day)[] } = existsSync(historyFile)
  ? JSON.parse(readFileSync(historyFile, 'utf8'))
  : { rule: classification.rule, days: [] }
const days = [...history.days.filter((d) => d.date !== day.date), day].sort((a, b) => a.date.localeCompare(b.date))
writeFileSync(historyFile, JSON.stringify({ rule: history.rule, ranAt: out.ranAt, days }, null, 2) + '\n')
console.log(`last 24h: ${JSON.stringify(day)}`)
console.log(`${totalPools} graduated pools across ${ranked.length} configs, ${out.window.from} → ${out.window.to}`)
for (const c of configs)
  console.log(`${String(c.graduatedPools).padStart(4)}  ${c.config}  ${c.quote}  ${c.multiplier.toFixed(1)}x  early ${c.earlyBuyerMultiple.toFixed(1)}x  ${c.fee}  LP locked ${c.lpLockedPct}%  ~${c.closest}`)
