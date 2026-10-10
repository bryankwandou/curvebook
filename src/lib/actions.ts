import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Connection, Keypair, PublicKey, type Transaction } from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { buildPreset, quoteMint, type Preset } from './presets'

type Send = WalletContextState['sendTransaction']

async function send(connection: Connection, sendTransaction: Send, tx: Transaction, payer: PublicKey, signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.feePayer = payer
  tx.recentBlockhash = blockhash
  // fail before the wallet popup if the program would reject it
  // simulate the unsigned message so the blockhash we confirm against stays the same
  const sim = await connection.simulateTransaction(tx.compileMessage())
  if (sim.value.err) {
    const tail = (sim.value.logs ?? []).slice(-4).join('\n')
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}\n${tail}`)
  }
  const signature = await sendTransaction(tx, connection, { signers })
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

/** Launch a token on an existing preset config. The connected wallet becomes the pool creator. */
export async function launchToken(
  connection: Connection,
  wallet: PublicKey,
  sendTransaction: Send,
  args: { config: string; name: string; symbol: string; uri: string },
) {
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const mint = Keypair.generate()
  const tx = await client.creator.createPool({
    baseMint: mint.publicKey,
    config: new PublicKey(args.config),
    name: args.name,
    symbol: args.symbol,
    uri: args.uri,
    payer: wallet,
    poolCreator: wallet,
  })
  const signature = await send(connection, sendTransaction, tx, wallet, [mint])
  return { signature, mint: mint.publicKey.toBase58() }
}

/**
 * Deploy a preset as the connected wallet's own config: the wallet becomes fee claimer,
 * so a launchpad can adopt a curve without paying anyone.
 */
export async function deployConfig(connection: Connection, wallet: PublicKey, sendTransaction: Send, preset: Preset) {
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const config = Keypair.generate()
  const tx = await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer: wallet,
    leftoverReceiver: wallet,
    payer: wallet,
    quoteMint: quoteMint(preset),
    ...buildPreset(preset),
  })
  const signature = await send(connection, sendTransaction, tx, wallet, [config])
  return { signature, config: config.publicKey.toBase58() }
}

export interface PoolRow {
  pool: string
  baseMint: string
  creator: string
  progress: number
  migrated: boolean
}

/** the public RPC refuses getProgramAccounts, so the feed goes through the site's narrow /api/rpc proxy */
export function feedConnection(fallback: Connection) {
  return typeof location === 'undefined' ? fallback : new Connection(new URL('/api/rpc', location.origin).toString(), 'confirmed')
}

export async function poolsOnConfig(connection: Connection, config: string): Promise<PoolRow[]> {
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const cfg = await client.state.getPoolConfig(config)
  if (!cfg) throw new Error('config account not found')
  const threshold = Number(cfg.migrationQuoteThreshold.toString())
  const pools = await client.state.getPoolsByConfig(config)
  return pools.map(({ publicKey, account: { poolState: s } }) => ({
    pool: publicKey.toBase58(),
    baseMint: s.baseMint.toBase58(),
    creator: s.creator.toBase58(),
    progress: threshold ? Math.min(1, Number(s.quoteReserve.toString()) / threshold) : 0,
    migrated: s.isMigrated !== 0,
  }))
}
