import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk'

// What a buyer should know about a DBC config before the first buy. Every flag is read straight from the config
// account (plus the curve walk), so it holds for every pool launched on that config.
export type Severity = 'red' | 'warn' | 'info'
export interface Flag {
  severity: Severity
  title: string
  detail: string
}

export interface RiskInput {
  config: PoolConfig
  baseDecimals: number
  supply: number
  multiplier: number
  earlyBuyerMultiple: number
  threshold: number
  quote: string
  /** trading fee at launch and once any fee schedule has finished, in % */
  feeStartPct: number
  feeEndPct: number
}

const AUTHORITY = ['creator can change metadata', 'immutable', 'partner can change metadata', 'creator keeps mint authority', 'partner keeps mint authority']

export function riskFlags(r: RiskInput): Flag[] {
  const c = r.config
  const flags: Flag[] = []
  const add = (severity: Severity, title: string, detail: string) => flags.push({ severity, title, detail })

  // 3 and 4 hand the token's mint authority to a wallet: the supply on the curve is not the real supply
  if (c.tokenUpdateAuthority === 3 || c.tokenUpdateAuthority === 4)
    add('red', 'Mint authority kept', `Token authority option ${c.tokenUpdateAuthority} (${AUTHORITY[c.tokenUpdateAuthority]}): that wallet can mint more tokens after launch.`)
  else if (c.tokenUpdateAuthority === 0 || c.tokenUpdateAuthority === 2)
    add('info', 'Metadata can change', `Token authority option ${c.tokenUpdateAuthority} (${AUTHORITY[c.tokenUpdateAuthority]}): name and image can be edited after launch. Supply is fixed.`)

  const unlocked = c.partnerLiquidityPercentage + c.creatorLiquidityPercentage
  if (unlocked > 0) {
    const vesting = c.partnerLiquidityVestingInfo.isInitialized || c.creatorLiquidityVestingInfo.isInitialized
    add(
      unlocked >= 50 && !vesting ? 'red' : 'warn',
      `${unlocked}% of graduation LP not permanently locked`,
      `Partner ${c.partnerLiquidityPercentage}%, creator ${c.creatorLiquidityPercentage}% of the DAMM liquidity ${vesting ? 'is subject to a vesting schedule, then withdrawable' : 'can be withdrawn after graduation'}.`,
    )
  }

  const vested = (Number(c.lockedVestingConfig.cliffUnlockAmount.toString()) + Number(c.lockedVestingConfig.amountPerPeriod.toString()) * Number(c.lockedVestingConfig.numberOfPeriod.toString())) / 10 ** r.baseDecimals
  const vestedPct = (vested / r.supply) * 100
  if (vestedPct >= 1)
    add(vestedPct >= 20 ? 'warn' : 'info', `${vestedPct.toFixed(1)}% of supply vests to the creator`, 'Locked vesting outside the curve, released after graduation.')

  if (r.feeStartPct >= 50 && r.feeEndPct < 50)
    add('info', `${+r.feeStartPct.toFixed(1)}% fee at launch, decaying`, `Anti-sniper schedule: the first blocks pay up to ${+r.feeStartPct.toFixed(1)}%, falling to ${+r.feeEndPct.toFixed(2)}%.`)
  if (r.feeEndPct >= 10)
    add('red', `${+r.feeEndPct.toFixed(1)}% trading fee that never decays`, 'Every buy and sell on the curve pays this, for the whole life of the pool.')
  else if (r.feeEndPct >= 3) add('warn', `${+r.feeEndPct.toFixed(1)}% trading fee`, 'High for a bonding curve; most launchpads sit at 1–2%.')

  if (c.migrationFeePercentage >= 10)
    add('warn', `${c.migrationFeePercentage}% of the raise taken at graduation`, `Migration fee (creator share ${c.creatorMigrationFeePercentage}%): it is not added to the DAMM pool.`)

  if (r.earlyBuyerMultiple >= 30)
    add('warn', `Early buyers up ${r.earlyBuyerMultiple.toFixed(0)}x at graduation`, 'A buyer at 10% of the raise holds a large multiple by graduation: strong sniper advantage.')

  if (r.multiplier <= 1.25 || r.threshold < 0.01)
    add('info', 'Listing, not price discovery', `Price moves ${r.multiplier.toFixed(2)}x and graduation needs ${+r.threshold.toPrecision(2)} ${r.quote}: the curve is a listing step, not a sale.`)

  if (r.quote !== 'SOL' && r.quote !== 'USDC') add('warn', 'Unfamiliar quote token', `Buyers pay in ${r.quote}, not SOL or USDC.`)

  const order: Severity[] = ['red', 'warn', 'info']
  return flags.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
}
