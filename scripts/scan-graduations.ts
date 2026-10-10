// Which DBC configs actually graduate? Read-only scan of recent mainnet migrations.
// Every DBC graduation passes one of Meteora's DAMM migration-fee configs, so their recent signatures are a
// stream of graduations. Each migrate instruction names the DBC config (account #2). Groups by config, then
// decodes the most-graduated ones with the same inspector the site uses. Writes graduated-configs.json.
//
//   npx tsx scripts/scan-graduations.ts        (PER_ADDRESS=100 signatures per migration config, RPC=... optional)
//   RPC=https://mainnet.helius-rpc.com/?api-key=... CONCURRENCY=8 DELAY=100 PER_ADDRESS=200 npx tsx scripts/scan-graduations.ts
import { writeFileSync } from 'node:fs'
import {
  DAMM_V1_MIGRATION_FEE_ADDRESS,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js'
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
for (const a of [...DAMM_V2_MIGRATION_FEE_ADDRESS, ...DAMM_V1_MIGRATION_FEE_ADDRESS]) {
  for (const s of await retry(() => connection.getSignaturesForAddress(a, { limit: PER_ADDRESS }))) if (!s.err) sigs.set(s.signature, s)
}
console.log(`${sigs.size} successful transactions on the migration configs`)

const graduations: { config: string; pool: string; time: number; signature: string }[] = []
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
        if (!MIGRATE.includes(Buffer.from(bs58.decode(ix.data).subarray(0, 8)).toString('hex'))) continue
        graduations.push({
          config: keys[ix.accounts[2]],
          pool: keys[ix.accounts[0]],
          time: s.blockTime ?? 0,
          signature: s.signature,
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
      closest: x.closest.gap < 0.5 ? x.closest.name : 'none',
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
  configs,
}
writeFileSync(new URL('../graduated-configs.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`${totalPools} graduated pools across ${ranked.length} configs, ${out.window.from} → ${out.window.to}`)
for (const c of configs)
  console.log(`${String(c.graduatedPools).padStart(4)}  ${c.config}  ${c.quote}  ${c.multiplier.toFixed(1)}x  early ${c.earlyBuyerMultiple.toFixed(1)}x  ${c.fee}  LP locked ${c.lpLockedPct}%  ~${c.closest}`)
