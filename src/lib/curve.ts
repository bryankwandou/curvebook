import {
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getPriceFromSqrtPrice,
  Rounding,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'

export interface CurveInput {
  sqrtStartPrice: BN
  curve: { sqrtPrice: BN; liquidity: BN }[]
  migrationQuoteThreshold: BN
  baseDecimals: number
  quoteDecimals: number
}

export interface CurvePoint {
  /** base tokens sold so far, human units */
  sold: number
  /** quote tokens raised so far, human units */
  raised: number
  /** spot price, quote per base */
  price: number
}

const STEPS_PER_SEGMENT = 12

/**
 * Walk the DBC curve the same way the program does: segment i spans
 * [prev sqrtPrice, curve[i].sqrtPrice] with liquidity curve[i].liquidity.
 * Stops at the migration quote threshold, where the pool graduates to DAMM v2.
 */
export function sampleCurve(c: CurveInput): CurvePoint[] {
  const bd = 10 ** c.baseDecimals
  const qd = 10 ** c.quoteDecimals
  const price = (sp: BN) => getPriceFromSqrtPrice(sp, c.baseDecimals, c.quoteDecimals).toNumber()
  const pts: CurvePoint[] = [{ sold: 0, raised: 0, price: price(c.sqrtStartPrice) }]
  let lower = c.sqrtStartPrice
  let sold = new BN(0)
  let raised = new BN(0)

  for (const seg of c.curve) {
    if (seg.liquidity.isZero() || seg.sqrtPrice.lte(lower)) continue
    const span = seg.sqrtPrice.sub(lower)
    for (let s = 1; s <= STEPS_PER_SEGMENT; s++) {
      const a = lower.add(span.muln(s - 1).divn(STEPS_PER_SEGMENT))
      let b = lower.add(span.muln(s).divn(STEPS_PER_SEGMENT))
      let dq = getDeltaAmountQuoteUnsigned(a, b, seg.liquidity, Rounding.Up)
      if (raised.add(dq).gt(c.migrationQuoteThreshold)) {
        // bisect for the exact graduation price inside this step
        let lo = a
        let hi = b
        for (let k = 0; k < 40; k++) {
          const mid = lo.add(hi).shrn(1)
          const q = getDeltaAmountQuoteUnsigned(a, mid, seg.liquidity, Rounding.Up)
          if (raised.add(q).gt(c.migrationQuoteThreshold)) hi = mid
          else lo = mid
        }
        b = lo
        dq = getDeltaAmountQuoteUnsigned(a, b, seg.liquidity, Rounding.Up)
        sold = sold.add(getDeltaAmountBaseUnsigned(a, b, seg.liquidity, Rounding.Down))
        raised = raised.add(dq)
        pts.push({ sold: num(sold) / bd, raised: num(raised) / qd, price: price(b) })
        return pts
      }
      sold = sold.add(getDeltaAmountBaseUnsigned(a, b, seg.liquidity, Rounding.Down))
      raised = raised.add(dq)
      pts.push({ sold: num(sold) / bd, raised: num(raised) / qd, price: price(b) })
    }
    lower = seg.sqrtPrice
  }
  return pts
}

function num(b: BN) {
  return Number(b.toString())
}
