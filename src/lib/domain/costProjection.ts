/**
 * Cost projection — daily → weekly → monthly.
 *
 * Prices in the food database are regional averages, so every figure produced
 * here is an `Estimate` and carries an explicit `basis` string the UI shows
 * verbatim. The point is not to be precise; it is to let someone judge whether a
 * plan fits their budget before they walk to the shop.
 */

import type { CostProjection, Estimate } from './types/index';
import { estimate } from './nutrition';

export const DAYS_PER_WEEK = 7;

/** 30-day month. Stated in the UI so the number is not mistaken for a calendar month. */
export const DAYS_PER_MONTH = 30;

function scale(value: number, factor: number): Estimate<number> {
  const exact = value * factor;
  // Wider spread the further out we project: a single day's vegetables say
  // nothing reliable about a whole month.
  const spread = factor === 1 ? 0.1 : factor === DAYS_PER_WEEK ? 0.18 : 0.28;
  return estimate(Math.round(exact), {
    low: Math.round(exact * (1 - spread)),
    high: Math.round(exact * (1 + spread)),
  }, 'derived', factor === 1 ? 'medium' : 'low');
}

/**
 * @param dailyCost    today's estimated food cost, rupees
 * @param typicalDaily the user's own recent average when we have one, else null
 */
export function costProjection(
  dailyCost: number,
  budget: number,
  typicalDaily: number | null = null,
): CostProjection {
  // A real average beats one day. Fall back to today's figure so the projection
  // is never empty.
  const basis = typicalDaily !== null && typicalDaily > 0 ? typicalDaily : dailyCost;
  const daily = scale(basis, 1);

  return {
    daily,
    weekly: scale(basis, DAYS_PER_WEEK),
    monthly: scale(basis, DAYS_PER_MONTH),
    budget,
    withinBudget: basis <= budget,
    basis:
      typicalDaily !== null && typicalDaily > 0
        ? `Based on your recent average of about ₹${Math.round(typicalDaily)} a day. Prices vary by shop, season and city, so treat this as a guide.`
        : `Based on today's plan at about ₹${Math.round(dailyCost)} a day. Prices vary by shop, season and city, so treat this as a guide.`,
  };
}

/** Averages the last N recorded daily costs, ignoring days with no data. */
export function typicalDailyCost(
  costs: readonly { readonly date: string; readonly rupees: number }[],
  limit = 14,
): number | null {
  const seen = new Set<string>();
  const values: number[] = [];
  for (const c of costs) {
    if (seen.has(c.date)) continue;
    seen.add(c.date);
    values.push(c.rupees);
    if (values.length >= limit) break;
  }
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * How much of the day's budget is committed. `spent` counts food the user has
 * marked done; `planned` is everything the plan intends.
 */
export interface BudgetPosition {
  readonly spent: number;
  readonly planned: number;
  readonly budget: number;
  readonly remaining: number;
  readonly state: 'under' | 'on-track' | 'over';
}

export function budgetPosition(spent: number, planned: number, budget: number): BudgetPosition {
  const committed = Math.max(spent, planned);
  const remaining = budget - committed;
  const ratio = budget > 0 ? committed / budget : 0;
  return {
    spent,
    planned,
    budget,
    remaining,
    state: ratio > 1.05 ? 'over' : ratio > 0.9 ? 'on-track' : 'under',
  };
}