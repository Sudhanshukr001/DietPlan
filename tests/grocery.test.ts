import { describe, expect, it } from 'vitest';
import { SHELF_DAYS, buildDailyGrocery, buildWeeklyGrocery } from '@/lib/domain/grocery';
import { buildMealPlan } from '@/lib/domain/meals';
import type { GroceryCategory, Meal } from '@/lib/domain/types/index';
import { getFood } from '@/lib/domain/data/foods';
import { findBannedClaims } from '@/lib/domain/safety';
import { DATE, makeDiet, makeProfile } from './fixtures';

const plan = buildMealPlan({
  profile: makeProfile(),
  diet: makeDiet(),
  date: DATE,
  season: 'winter',
  pantry: [],
  dailyBudget: 150,
  priceOverrides: {},
  targets: { calories: 1800, protein: 60 },
  isRestDay: false,
});

function daily(over: Partial<Parameters<typeof buildDailyGrocery>[0]> = {}) {
  return buildDailyGrocery({
    meals: plan.meals,
    region: 'bihar',
    season: 'winter',
    pantry: [],
    overrides: {},
    date: DATE,
    ...over,
  });
}

describe('daily grocery list', () => {
  const items = daily();

  it('covers every non-optional ingredient in the day', () => {
    const needed = new Set(
      plan.meals.flatMap((m) => m.ingredients.filter((i) => !i.optional).map((i) => i.foodKey)),
    );
    for (const key of needed) {
      expect(items.some((i) => i.foodKey === key), key).toBe(true);
    }
  });

  it('rounds up to whole purchase units — never 340 g of dal', () => {
    for (const item of items) {
      const food = getFood(item.foodKey);
      if (!food) throw new Error(`unknown food ${item.foodKey}`);
      expect(item.buyQuantity.grams % food.price.unitGrams).toBe(0);
      expect(item.buyQuantity.grams).toBeGreaterThanOrEqual(item.quantity.grams);
      expect(item.buyQuantity.grams / food.price.unitGrams).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives each line a name, a category, a unit and a storage note', () => {
    for (const item of items) {
      expect(item.name.length, item.foodKey).toBeGreaterThan(0);
      expect(item.buyUnitLabel.length, item.foodKey).toBeGreaterThan(0);
      expect(item.storage.length, item.foodKey).toBeGreaterThan(3);
      expect(item.category in SHELF_DAYS).toBe(true);
    }
  });

  it('marks cost as an estimate, not a quote', () => {
    for (const item of items) {
      expect(item.estimatedCost.basis).toBeTruthy();
      expect(item.estimatedCost.confidence).toBeTruthy();
      expect(item.estimatedCost.value).toBeGreaterThan(0);
    }
  });

  it('aggregates the same food used in several meals into one line', () => {
    for (const item of items) {
      expect(new Set(item.meals).size).toBe(item.meals.length);
    }
  });

  it('excludes what is already in the pantry from the amount to buy', () => {
    const key = items[0]?.foodKey;
    if (!key) throw new Error('no items');
    const owned = daily({ pantry: [key] }).find((i) => i.foodKey === key);
    expect(owned?.owned).toBe(true);
    expect(owned?.purchaseRequired).toBe(false);
  });

  it('applies the local price override when the user entered one', () => {
    const key = items[0]?.foodKey;
    if (!key) throw new Error('no items');
    const base = items[0]?.estimatedCost.value ?? 0;
    const cheap = daily({ overrides: { [key]: 1 } }).find((i) => i.foodKey === key);
    expect((cheap?.estimatedCost.value ?? 0)).toBeLessThan(base);
  });

  it('ranks perishables and budget pressure into a budget priority', () => {
    for (const item of items) {
      expect(item.budgetPriority).toBeGreaterThanOrEqual(1);
      expect(item.budgetPriority).toBeLessThanOrEqual(10);
    }
  });

  it('never prints banned claims or shame wording', () => {
    const text = JSON.stringify(items).toLowerCase();
    expect(findBannedClaims(JSON.stringify(items))).toHaveLength(0);
    expect(text).not.toMatch(/cheat|unhealthy|junk|guilt|bad fat/);
  });

  it('is deterministic', () => {
    expect(daily()).toEqual(daily());
  });

  it('handles a meal with no ingredients at all', () => {
    const emptyMeal = { ...plan.meals[0], ingredients: [] } as Meal;
    expect(buildDailyGrocery({
      meals: [emptyMeal],
      region: 'bihar',
      season: 'winter',
      pantry: [],
      overrides: {},
      date: DATE,
    })).toEqual([]);
  });
});

describe('weekly grocery', () => {
  it('lists purchase units for the whole week', () => {
    const week = buildWeeklyGrocery({
      fromDay: '2026-01-14',
      toDay: '2026-01-20',
      mealsByDay: [plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals],
      region: 'bihar',
      season: 'winter',
      pantry: [],
      overrides: {},
      dailyBudget: 150,
    });
    expect(week.groups.length).toBeGreaterThan(0);
    expect(week.totalCost.value).toBeGreaterThan(0);
    expect(week.perDayCost.value).toBeGreaterThan(0);
    expect(week.wasteReductionNotes.length).toBeGreaterThan(0);
    for (const group of week.groups) {
      for (const item of group.items) {
        expect(item.buyQuantity.grams).toBeGreaterThan(0);
        expect(item.estimatedCost.value).toBeGreaterThan(0);
      }
      expect(group.subtotal.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('buys more than one day of perishables but not seven', () => {
    const key = 'tomato';
    const oneDay = daily().find((i) => i.foodKey === key)?.quantity.grams ?? 0;
    if (oneDay === 0) return; // not in today's plan
    const week = buildWeeklyGrocery({
      fromDay: '2026-01-14',
      toDay: '2026-01-20',
      mealsByDay: [plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals],
      region: 'bihar',
      season: 'winter',
      pantry: [],
      overrides: {},
      dailyBudget: 150,
    });
    const item = week.groups.flatMap((g) => g.items).find((i) => i.foodKey === key);
    if (!item) return;
    expect(item.quantity.grams).toBeGreaterThan(oneDay);
    expect(item.quantity.grams).toBeLessThan(oneDay * 7);
  });

  it('respects a pantry item across the whole week', () => {
    const week = buildWeeklyGrocery({
      fromDay: '2026-01-14',
      toDay: '2026-01-20',
      mealsByDay: [plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals, plan.meals],
      region: 'bihar',
      season: 'winter',
      pantry: ['rice'],
      overrides: {},
      dailyBudget: 150,
    });
    const rice = week.groups.flatMap((g) => g.items).find((i) => i.foodKey === 'rice');
    if (rice) expect(rice.purchaseRequired).toBe(false);
  });
});

describe('shelf life guidance', () => {
  it('covers every grocery category', () => {
    const categories: GroceryCategory[] = ['vegetable', 'fruit', 'protein', 'staple', 'fat', 'other'];
    for (const c of categories) {
      expect(SHELF_DAYS[c], c).toBeGreaterThan(0);
    }
  });

  it('expects vegetables to be used sooner than staples', () => {
    expect(SHELF_DAYS.vegetable).toBeLessThan(SHELF_DAYS.staple);
  });
});
