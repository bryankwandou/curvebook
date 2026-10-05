// Creates the official mainnet config for every preset that is not in src/deployed.json yet.
// The signing wallet pays rent (~0.01 SOL per config) and becomes the fee claimer for that preset.
//
//   KEYPAIR=path/to/wallet.json RPC=https://... npx tsx scripts/deploy-configs.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'
import { PRESETS, buildPreset, quoteMint } from '../src/lib/presets'

const KEYPAIR = process.env.KEYPAIR
if (!KEYPAIR) throw new Error('set KEYPAIR to the wallet that will own the official configs')
const RPC = process.env.RPC ?? 'https://api.mainnet-beta.solana.com'
const OUT = new URL('../src/deployed.json', import.meta.url)

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))))
const connection = new Connection(RPC, 'confirmed')
const client = new DynamicBondingCurveClient(connection, 'confirmed')
const deployed: Record<string, { config: string; feeClaimer: string; signature: string }> = JSON.parse(readFileSync(OUT, 'utf8'))

console.log(`payer ${payer.publicKey.toBase58()}  balance ${(await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`)

for (const p of PRESETS) {
  if (deployed[p.id]) {
    console.log(`skip ${p.id}: ${deployed[p.id].config}`)
    continue
  }
  const config = Keypair.generate()
  const tx = await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    payer: payer.publicKey,
    quoteMint: quoteMint(p),
    ...buildPreset(p),
  })
  const signature = await sendAndConfirmTransaction(connection, tx, [payer, config], { commitment: 'confirmed' })
  deployed[p.id] = { config: config.publicKey.toBase58(), feeClaimer: payer.publicKey.toBase58(), signature }
  // write after each one so a failure halfway keeps what already landed
  writeFileSync(OUT, JSON.stringify(deployed, null, 2) + '\n')
  console.log(`ok   ${p.id}: ${deployed[p.id].config}  tx ${signature}`)
}
