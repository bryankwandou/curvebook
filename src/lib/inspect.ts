import {
  BaseFeeMode,
  DynamicBondingCurveClient,
  getFeeSchedulerMinBaseFeeNumerator,
  type PoolConfig,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import { PublicKey, type Connection } from '@solana/web3.js'
import { sampleCurve, type CurvePoint } from './curve'
import { PRESETS, USDC_MINT, SOL_MINT } from './presets'
import { presetStats } from './stats'

const FEE_DENOMINATOR = 1e9
const MIGRATION_FEE_BPS = [25, 30, 100, 200, 400, 600]

export interface Inspection {
  address: string
  feeClaimer: string
  quote: string
  quoteDecimals: number
  baseDecimals: number
  supply: number
  points: CurvePoint[]
  /** graduation price / opening price */
  multiplier: number
  /** graduation price / price once 10% of the threshold is raised: what an early buyer is up at graduation */
  earlyBuyerMultiple: number
  /** % of supply sold on the curve at graduation */
  soldPct: number
  threshold: number
  fee: string
  dynamicFee: boolean
  creatorFeePct: number
  poolCreationFee: number
  migration: string
  lp: string
  lpLockedPct: number
  tokenVesting: boolean
  closest: { id: string; name: string; gap: number }
}

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`

function feeLabel(c: PoolConfig) {
  const b = c.poolFees.baseFee
  const startBps = Number(b.cliffFeeNumerator.toString()) / FEE_DENOMINATOR * 10_000
  const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`
  if (b.baseFeeMode === BaseFeeMode.RateLimiter) return `${pct(startBps)} base, rate limiter (fee grows with trade size)`
  if (b.baseFeeMode > BaseFeeMode.RateLimiter) return `${pct(startBps)} base, fee mode ${b.baseFeeMode}`
  const periods = b.firstFactor
  if (!periods) return `${pct(startBps)} flat`
  const end = getFeeSchedulerMinBaseFeeNumerator(b.cliffFeeNumerator, periods, new BN(b.thirdFactor.toString()), b.baseFeeMode)
  const endBps = Number(end.toString()) / FEE_DENOMINATOR * 10_000
  const duration = periods * Number(b.secondFactor.toString())
  const unit = c.activationType === 1 ? 's' : ' slots'
  if (Math.abs(endBps - startBps) < 0.01) return `${pct(startBps)} flat`
  return `${pct(startBps)} → ${pct(endBps)} over ${duration}${unit} (${b.baseFeeMode === BaseFeeMode.FeeSchedulerExponential ? 'exponential' : 'linear'})`
}

/** price multiple (vs opening) at each tenth of the raise: a scale-free fingerprint of the curve shape */
function fingerprint(points: CurvePoint[]) {
  const end = points[points.length - 1].raised
  return Array.from({ length: 10 }, (_, i) => {
    const pt = points.find((p) => p.raised >= (end * (i + 1)) / 10) ?? points[points.length - 1]
    return pt.price / points[0].price
  })
}

export async function inspectConfig(connection: Connection, address: string): Promise<Inspection> {
  const key = new PublicKey(address.trim())
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const c = await client.state.getPoolConfig(key).catch((e: Error) => {
    if (/discriminator|could not find|does not exist/i.test(e.message)) return null
    throw e
  })
  if (!c) throw new Error('This address is not a DBC config on mainnet.')
  const quoteMint = c.quoteMint.toBase58()
  const quoteDecimals =
    quoteMint === SOL_MINT.toBase58() ? 9 : quoteMint === USDC_MINT.toBase58() ? 6 : await mintDecimals(connection, c.quoteMint)
  const baseDecimals = c.tokenDecimal
  const points = sampleCurve({
    sqrtStartPrice: c.sqrtStartPrice,
    curve: c.curve.filter((p) => !p.liquidity.isZero()),
    migrationQuoteThreshold: c.migrationQuoteThreshold,
    baseDecimals,
    quoteDecimals,
  })
  const end = points[points.length - 1]
  const early = points.find((p) => p.raised >= end.raised / 10) ?? end
  const supply = Number(c.preMigrationTokenSupply.toString()) / 10 ** baseDecimals
  const lpLockedPct = c.partnerPermanentLockedLiquidityPercentage + c.creatorPermanentLockedLiquidityPercentage

  const fp = fingerprint(points)
  let closest = { id: '', name: '', gap: Infinity }
  for (const p of PRESETS) {
    const r = presetStats(p)
    if (!r.ok) continue
    const pf = fingerprint(r.stats.points)
    const gap = fp.reduce((s, v, i) => s + Math.abs(Math.log(v / pf[i])), 0) / fp.length
    if (gap < closest.gap) closest = { id: p.id, name: p.name, gap }
  }

  return {
    address: key.toBase58(),
    feeClaimer: c.feeClaimer.toBase58(),
    quote: quoteMint === SOL_MINT.toBase58() ? 'SOL' : quoteMint === USDC_MINT.toBase58() ? 'USDC' : short(quoteMint),
    quoteDecimals,
    baseDecimals,
    supply,
    points,
    multiplier: end.price / points[0].price,
    earlyBuyerMultiple: end.price / early.price,
    soldPct: (end.sold / supply) * 100,
    threshold: Number(c.migrationQuoteThreshold.toString()) / 10 ** quoteDecimals,
    fee: feeLabel(c),
    dynamicFee: c.poolFees.dynamicFee.initialized !== 0,
    creatorFeePct: c.creatorTradingFeePercentage,
    poolCreationFee: Number(c.poolCreationFee.toString()) / 1e9,
    migration:
      c.migrationOption === 1
        ? `DAMM v2, ${MIGRATION_FEE_BPS[c.migrationFeeOption] !== undefined ? `${MIGRATION_FEE_BPS[c.migrationFeeOption] / 100}% pool fee` : 'custom pool fee'}`
        : 'DAMM v1',
    lp: `partner ${c.partnerLiquidityPercentage}% + ${c.partnerPermanentLockedLiquidityPercentage}% locked, creator ${c.creatorLiquidityPercentage}% + ${c.creatorPermanentLockedLiquidityPercentage}% locked`,
    lpLockedPct,
    tokenVesting: !c.lockedVestingConfig.amountPerPeriod.isZero() || !c.lockedVestingConfig.cliffUnlockAmount.isZero(),
    closest,
  }
}

async function mintDecimals(connection: Connection, mint: PublicKey) {
  const info = await connection.getParsedAccountInfo(mint)
  const data = info.value?.data
  if (data && 'parsed' in data) return data.parsed.info.decimals as number
  throw new Error('Could not read the quote mint decimals.')
}
