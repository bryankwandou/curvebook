import outcomesBundled from '../../lp-outcomes.json'
import { useLive } from './live'

export type Outcomes = typeof outcomesBundled
export type OutcomeSummary = Outcomes['byClass']['open']

/** pools on configs that leave 50% or more of the graduation LP withdrawable, vesting or not */
export function exposed(o: Outcomes) {
  const a: OutcomeSummary = o.byClass.open
  const b: OutcomeSummary = o.byClass.vesting
  return { graduations: a.graduations + b.graduations, lostHalfOrMore: a.lostHalfOrMore + b.lostHalfOrMore }
}

export function useOutcomes() {
  return useLive('lp-outcomes.json', outcomesBundled)
}
