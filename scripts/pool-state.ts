// Reads the mainnet launch pool back (read-only): every transaction that touched it, current reserves,
// curve progress and accrued trading fees. Writes mainnet-pool-state.json.
//
//   npx tsx scripts/pool-state.ts        (RPC=... optional)
import { readFileSync, writeFileSync } from 'node:fs'
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, PublicKey } from '@solana/web3.js'

const connection = new Connection(process.env.RPC ?? 'https://api.mainnet-beta.solana.com', 'confirmed')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const launch = JSON.parse(readFileSync(new URL('../mainnet-launch.json', import.meta.url), 'utf8'))
const deployer = JSON.parse(readFileSync(new URL('../src/deployed.json', import.meta.url), 'utf8'))[launch.preset].feeClaimer
const sol = (lamports: unknown) => Number(String(lamports)) / 1e9

const trades = []
const sigs = await connection.getSignaturesForAddress(new PublicKey(launch.pool), { limit: 100 })
for (const s of sigs.reverse()) {
  const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  if (!tx?.meta) continue
  const signer = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).get(0)!.toBase58()
  const cbk = (b: typeof tx.meta.postTokenBalances) =>
    (b ?? []).filter((x) => x.mint === launch.mint && x.owner === signer).reduce((n, x) => n + Number(x.uiTokenAmount.uiAmount ?? 0), 0)
  const instruction = (tx.meta.logMessages ?? []).find((l) => l.startsWith('Program log: Instruction: '))?.slice(26) ?? '?'
  trades.push({
    time: new Date(s.blockTime! * 1000).toISOString(),
    slot: s.slot,
    ok: s.err === null,
    signer,
    ours: signer === deployer,
    instruction,
    solChange: (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / 1e9,
    cbkChange: cbk(tx.meta.postTokenBalances) - cbk(tx.meta.preTokenBalances),
    signature: s.signature,
  })
}

const raw: any = await client.state.getPool(launch.pool)
const pool = raw.poolState ?? raw
const out = {
  cluster: 'mainnet-beta',
  mode: 'read-only (getSignaturesForAddress + getTransaction + pool account)',
  ranAt: new Date().toISOString(),
  slot: await connection.getSlot(),
  pool: launch.pool,
  mint: launch.mint,
  deployer,
  quoteReserveSol: sol(pool.quoteReserve),
  curveProgress: await client.state.getPoolQuoteTokenCurveProgress(launch.pool),
  fees: {
    totalTradingSol: sol(pool.metrics.totalTradingQuoteFee) + sol(pool.metrics.totalProtocolQuoteFee),
    presetAuthorClaimableSol: sol(pool.partnerQuoteFee),
    poolCreatorClaimableSol: sol(pool.creatorQuoteFee),
    protocolSol: sol(pool.protocolQuoteFee),
  },
  trades,
}
writeFileSync(new URL('../mainnet-pool-state.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')

for (const t of trades)
  console.log(`${t.time}  ${t.ok ? 'ok  ' : 'FAIL'} ${t.ours ? 'ours ' : 'other'} ${t.signer.slice(0, 8)}…  ${t.instruction.padEnd(34)} SOL ${t.solChange.toFixed(6).padStart(10)}  CBK ${t.cbkChange.toFixed(0)}`)
console.log(`\nquote reserve ${out.quoteReserveSol} SOL, curve progress ${(out.curveProgress * 100).toFixed(4)}%`)
console.log(`fees: preset author ${out.fees.presetAuthorClaimableSol} SOL, pool creator ${out.fees.poolCreatorClaimableSol} SOL, protocol ${out.fees.protocolSol} SOL`)
