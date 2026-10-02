/**
 * Budget engine.
 *
 * Money is a first-class input, not an afterthought. At ₹100/day the plan must
 * still be a good plan. Two hard structural rules:
 *   1. Expensive prestige items are excluded by construction (§EXPENSIVE_EXCLUSIONS).
 *   2. Protein is bought by value (grams of protein per rupee), never by trend.
 */

import type {
  BudgetPlan,
  Estimate,
  FoodKey,
  NutritionTotals,
  RegionId,
  SeasonId,
} from './types/index';
import { FOODS, getFood, proteinPerRupee, requireFood, round1 } from './data/foods';
import { regionMultiplier } from './seasonal';
import { estimate } from './nutrition';
import { isAllowed } from './diet';
import type { DietFilter } from './diet';

/**
 * The spec is explicit that these must never be auto-recommended. They are not
 * banned (a user may own some), they are simply never bought automatically.
 */
export const EXPENSIVE_EXCLUSIONS: readonly FoodKey[] = [
  'apple',
  'grapes',
  'pomegranate',
  'mushroom',
  'paneer',
  'fish',
  'chicken',
  'coffee',
  'mango',
];

export const EXCLUSION_REASONS: Readonly<Partial<Record<FoodKey, string>>> = {
  apple: 'Apples are expensive for what they give you — a local seasonal fruit gives more vitamin C per rupee.',
  grapes: 'Grapes cost several times what guava or banana do.',
  pomegranate: 'Pomegranate is a festive fruit, not an everyday one on a tight budget.',
  mushroom: 'Mushrooms cost several times what seasonal vegetables do.',
  paneer: 'Paneer is the most expensive everyday protein — dal, chana and soy give more protein per rupee.',
  fish: 'Fish is fine food, but it does not fit a tight daily budget.',
  chicken: 'Chicken is a good protein, but dal, chana and soy are cheaper per gram of protein.',
  coffee: 'Coffee is a discretionary cost, not nutrition.',
  mango: 'Mango is seasonal and pricey outside its window.',
};

export const BUDGET_TIERS: readonly { readonly value: number; readonly label: string; readonly detail: string }[] = [
  { value: 50, label: '₹50', detail: 'Very tight — dal, sattu, seasonal vegetables and one fruit' },
  { value: 75, label: '₹75', detail: 'Tight — dal, chana or soy, vegetables and seasonal fruit' },
  { value: 100, label: '₹100', detail: 'Comfortable — most everyday foods, eggs if you eat them' },
  { value: 150, label: '₹150', detail: 'Comfortable — more variety, fruit and dairy more often' },
  { value: 200, label: '₹200', detail: 'Flexible — widest seasonal variety and more dairy' },
];

/**
 * ₹ spent on a portion, given a regional multiplier and any user override.
 * Uses a band so the UI can honestly show a range.
 */
export function costOfPortion(
  key: FoodKey,
  grams: number,
  opts: { readonly multiplier: number; readonly override?: number },
): Estimate<number> {
  const food = requireFood(key);
  const unitPrice = opts.override ?? food.price.typicalPrice;
  const lowUnit = opts.override ?? food.price.low;
  const highUnit = opts.override ?? food.price.high;

  const scale = grams / food.price.unitGrams;
  const value = scale * unitPrice * opts.multiplier;
  const low = scale * lowUnit * opts.multiplier;
  const high = scale * highUnit * opts.multiplier;

  const basis: Estimate<number>['basis'] =
    food.price.sourceNote === 'user-entry' ? 'user-entry' : food.price.sourceNote === 'derived' ? 'derived' : 'regional-average';
  return estimate(round1(value), { low: round1(low), high: round1(high) }, basis, 'medium');
}

/** ₹ per kg after regional adjustment — the comparison number the optimizer uses. */
export function pricePerKg(
  key: FoodKey,
  opts: { readonly multiplier: number; readonly override?: number },
): number {
  const food = requireFood(key);
  const unitPrice = opts.override ?? food.price.typicalPrice;
  const price = unitPrice * opts.multiplier;
  return food.price.unit === 'kg' ? price : (price / food.price.unitGrams) * 1000;
}

export function costOfNutrition(key: FoodKey, grams: number, multiplier: number): number {
  return (grams / requireFood(key).price.unitGrams) * requireFood(key).price.typicalPrice * multiplier;
}

/**
 * Budget plan for a day. Derives a priority order from actual price-per-protein
 * values rather than a hard-coded list, so it stays correct as prices shift.
 */
export function buildBudgetPlan(input: {
  readonly dailyBudget: number;
  readonly region: RegionId;
  readonly season: SeasonId;
  readonly filter: DietFilter;
  readonly overrides?: Readonly<Partial<Record<FoodKey, number>>>;
}): BudgetPlan {
  const multiplier = regionMultiplier(input.region);
  const notes: string[] = [];

  const proteinCandidates = FOODS.filter(
    (f) =>
      isAllowed(f, input.filter) &&
      (f.category === 'protein' || f.category === 'legume' || f.category === 'egg-meat') &&
      !EXPENSIVE_EXCLUSIONS.includes(f.key) &&
      (f.seasons.includes('all-year') || f.seasons.includes(input.season)),
  );

  // Rank by protein grams per rupee at a realistic 100 g portion.
  const ranked = proteinCandidates
    .map((food) => {
      const override: number | undefined = input.overrides?.[food.key];
      const price = pricePerKg(food.key, { multiplier, override });
      const proteinPer100g = food.nutrition.protein;
      const cost100 = (100 / food.price.unitGrams) * (override ?? food.price.typicalPrice) * multiplier;
      const ppr = cost100 > 0 ? proteinPer100g / cost100 : 0;
      return { food, ppr: Math.round(ppr * 10) / 10, price: Math.round(price) };
    })
    .sort((a, b) => b.ppr - a.ppr || a.price - b.price || a.food.key.localeCompare(b.food.key));

  const priorityOrder = ranked.map((r) => r.food.key);

  // Below ₹60/day we cannot fit dairy every day; say so honestly.
  const proteinBudget = input.dailyBudget < 60 ? 0.28 : input.dailyBudget < 100 ? 0.32 : 0.38;
  notes.push(
    `About ${Math.round(input.dailyBudget * proteinBudget)} rupees of your ₹${input.dailyBudget} goes to protein — dal, chana, soy or eggs depending on what you eat.`,
  );

  if (input.dailyBudget < 60) {
    notes.push('At this budget we skip daily dairy and fruit is seasonal and small. It is doable, just simple.');
  }
  if (input.dailyBudget >= 150) {
    notes.push('At this budget you can rotate two or three different vegetables and fruit each day.');
  }

  const localProduceRank = priorityOrder.slice(0, 8);

  return {
    dailyBudget: input.dailyBudget,
    allocated: input.dailyBudget,
    proteinBudget: Math.round(input.dailyBudget * proteinBudget),
    priorityOrder: localProduceRank,
    excludedExpensive: EXPENSIVE_EXCLUSIONS.filter((k) => getFood(k)),
    notes,
  };
}

export interface BudgetCheck {
  readonly total: number;
  readonly budget: number;
  readonly over: boolean;
  readonly remaining: number;
  readonly utilisation: number;
  /** 0..1 — how close to the limit, used to drive substitution urgency. */
  readonly pressure: number;
}

export function checkBudget(total: number, budget: number): BudgetCheck {
  const over = total > budget;
  const utilisation = budget > 0 ? total / budget : 1;
  return {
    total: round1(total),
    budget,
    over,
    remaining: round1(budget - total),
    utilisation: round1(utilisation),
    pressure: Math.max(0, Math.min(1, utilisation)),
  };
}

/**
 * Choose the cheapest food in a category that satisfies the filter and budget.
 * This is what makes the plan survive a ₹50/day budget.
 */
export function cheapestAllowed(
  candidates: readonly FoodKey[],
  opts: {
    readonly multiplier: number;
    readonly filter: DietFilter;
    readonly season: SeasonId;
    readonly overrides?: Readonly<Partial<Record<FoodKey, number>>>;
    readonly maxPrice?: number;
  },
): FoodKey | null {
  const scored = candidates
    .filter((key) => {
      const food = getFood(key);
      if (!food) return false;
      if (!isAllowed(food, opts.filter)) return false;
      if (opts.season && !food.seasons.includes('all-year') && !food.seasons.includes(opts.season)) {
        return false;
      }
      const override: number | undefined = opts.overrides?.[key];
      const price = pricePerKg(key, { multiplier: opts.multiplier, override });
      return opts.maxPrice ? price <= opts.maxPrice : true;
    })
    .map((key) => ({ key, price: pricePerKg(key, { multiplier: opts.multiplier, override: opts.overrides?.[key] }) }))
    .sort((a, b) => a.price - b.price || a.key.localeCompare(b.key));

  return scored[0]?.key ?? null;
}

/** Value-per-rupee ranking, used to explain a swap in plain language. */
export function valueRank(keys: readonly FoodKey[]): readonly { key: FoodKey; proteinPerRupee: number }[] {
  return keys
    .map((key) => ({ key, proteinPerRupee: proteinPerRupee(key) }))
    .sort((a, b) => b.proteinPerRupee - a.proteinPerRupee || a.key.localeCompare(b.key));
}

export function formatCost(cost: Estimate<number>): string {
  // The displayed range must always contain the estimate's own value, otherwise
  // a narrow or wrong range silently shows a different number from the one the
  // rest of the app is using.
  const low = Math.max(0, Math.round(Math.min(cost.range?.low ?? cost.value, cost.value)));
  const high = Math.max(low, Math.round(Math.max(cost.range?.high ?? cost.value, cost.value)));
  if (low === high) return `₹${low}`;
  return `₹${low}–₹${high}`;
}

export function formatCostPrecise(cost: Estimate<number>): string {
  return `₹${Math.round(cost.value)}`;
}

/** Aggregate cost across ingredients, keeping the range honest. */
export function totalCost(estimates: readonly Estimate<number>[]): Estimate<number> {
  if (estimates.length === 0) return estimate(0, { low: 0, high: 0 }, 'derived', 'high');
  const value = round1(estimates.reduce((s, e) => s + e.value, 0));
  const low = round1(estimates.reduce((s, e) => s + (e.range?.low ?? e.value), 0));
  const high = round1(estimates.reduce((s, e) => s + (e.range?.high ?? e.value), 0));
  return estimate(value, { low, high: Math.max(high, value) }, 'derived', 'medium');
}

export function nutritionPerRupee(n: NutritionTotals, cost: number): number {
  if (cost <= 0) return 0;
  return round1(n.protein / cost);
}
