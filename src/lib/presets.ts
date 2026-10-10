import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithLiquidityWeights,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { PublicKey } from '@solana/web3.js'

export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

export type Shape = 'flat' | 'early' | 'long'

export interface Preset {
  id: string
  name: string
  tagline: string
  shape: Shape
  quote: 'SOL' | 'USDC'
  initialMarketCap: number
  migrationMarketCap: number
  supply: number
  /** bonding-curve trading fee schedule, bps */
  startFeeBps: number
  endFeeBps: number
  feeDurationSec: number
  /** share of trading fees that goes to the token creator; the rest goes to the preset author */
  creatorFeePct: number
  /** paid by every launcher to the preset author, in SOL */
  poolCreationFeeSol: number
  bestFor: string
}

export const PRESETS: Preset[] = [
  {
    id: 'flat-fair',
    name: 'Flat Fair Launch',
    tagline: 'Every segment holds the same liquidity, so the first buyer and the hundredth pay close to the same price.',
    shape: 'flat',
    quote: 'SOL',
    initialMarketCap: 60,
    migrationMarketCap: 300,
    supply: 1_000_000_000,
    startFeeBps: 100,
    endFeeBps: 100,
    feeDurationSec: 0,
    creatorFeePct: 50,
    poolCreationFeeSol: 0.01,
    bestFor: 'Community tokens where early snipers should not get a 10x edge',
  },
  {
    id: 'early-discovery',
    name: 'Early Discovery',
    tagline: 'Thin liquidity at the bottom: price moves fast early, then calms as the pool fills. An anti-snipe fee decays over two minutes.',
    shape: 'early',
    quote: 'SOL',
    initialMarketCap: 25,
    migrationMarketCap: 400,
    supply: 1_000_000_000,
    startFeeBps: 2500,
    endFeeBps: 100,
    feeDurationSec: 120,
    creatorFeePct: 40,
    poolCreationFeeSol: 0.02,
    bestFor: 'Meme launches that want fast price discovery without bots eating the open',
  },
  {
    id: 'long-curve',
    name: 'Long Curve',
    tagline: 'Deep liquidity at the bottom, thin at the top: a long, patient accumulation zone that steepens only near graduation.',
    shape: 'long',
    quote: 'SOL',
    initialMarketCap: 40,
    migrationMarketCap: 800,
    supply: 1_000_000_000,
    startFeeBps: 150,
    endFeeBps: 150,
    feeDurationSec: 0,
    creatorFeePct: 60,
    poolCreationFeeSol: 0.01,
    bestFor: 'Projects that want holders to accumulate for weeks, not minutes',
  },
  {
    id: 'stock-pair-usdc',
    name: 'Stock Pair (USDC)',
    tagline: 'USDC-quoted, narrow 1.8x band, low fee: a calm first market for a token whose value is roughly known. No oracle, so nothing ties it to a reference price.',
    shape: 'flat',
    quote: 'USDC',
    initialMarketCap: 50_000,
    migrationMarketCap: 90_000,
    supply: 1_000_000,
    startFeeBps: 30,
    endFeeBps: 30,
    feeDurationSec: 0,
    creatorFeePct: 50,
    poolCreationFeeSol: 0.01,
    bestFor: 'USDC-paired tokens with a roughly known value (e.g. companions to tokenized equities); not for discovering an unknown price',
  },
]

export function weights(shape: Shape): number[] {
  return Array.from({ length: 16 }, (_, i) =>
    shape === 'flat' ? 1 : shape === 'early' ? 1.25 ** i : 1.25 ** (15 - i),
  )
}

export function quoteMint(p: Preset) {
  return p.quote === 'SOL' ? SOL_MINT : USDC_MINT
}

export function quoteDecimals(p: Preset) {
  return p.quote === 'SOL' ? 9 : 6
}

/** Turn a preset into the exact ConfigParameters the DBC program will store. */
export function buildPreset(p: Preset): ConfigParameters {
  const scheduled = p.startFeeBps !== p.endFeeBps
  return buildCurveWithLiquidityWeights({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quoteDecimals(p),
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: p.supply,
      leftover: p.supply / 100_000,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: scheduled ? BaseFeeMode.FeeSchedulerExponential : BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: p.startFeeBps,
          endingFeeBps: p.endFeeBps,
          numberOfPeriod: scheduled ? 12 : 0,
          totalDuration: scheduled ? p.feeDurationSec : 0,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: p.creatorFeePct,
      poolCreationFee: p.poolCreationFeeSol,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: p.initialMarketCap,
    migrationMarketCap: p.migrationMarketCap,
    liquidityWeights: weights(p.shape),
  })
}
