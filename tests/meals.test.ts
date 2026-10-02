import { describe, expect, it } from 'vitest';
import { buildMealPlan, portionScale, type MealPlanInput } from '@/lib/domain/meals';
import { dietFilter, isAllowed, rejectionReason } from '@/lib/domain/diet';
import { buildDailyGrocery } from '@/lib/domain/grocery';
import { findBannedClaims } from '@/lib/domain/safety';
import { regionMultiplier } from '@/lib/domain/seasonal';
import type { DietPreference, Meal, Profile } from '@/lib/domain/types/index';
import { DATE, makeDiet, makeProfile } from './fixtures';

function build(over: { profile?: Partial<Profile>; diet?: Partial<DietPreference>; budget?: number } = {}): MealPlanInput {
  return {
    profile: makeProfile(over.profile ?? {}),
    diet: makeDiet(over.diet ?? {}),
    date: DATE,
    season: 'winter',
    pantry: [],
    dailyBudget: over.budget ?? 150,
    priceOverrides: {},
    targets: { calories: 1800, protein: 60 },
    isRestDay: false,
  };
}

function run(over: Parameters<typeof build>[0] = {}) {
  return buildMealPlan(build(over));
}

function keysOf(meal: Meal): string[] {
  return meal.ingredients.map((i) => i.foodKey);
}

describe('meal plan structure', () => {
  const plan = run();

  it('produces all five slots in chronological order', () => {
    expect(plan.meals.map((m) => m.slot)).toEqual(['breakfast', 'fruit', 'lunch', 'snack', 'dinner']);
    const starts = plan.meals.map((m) => m.startMinute);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('gives every meal a unique id, title, steps and a reason', () => {
    const ids = plan.meals.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const meal of plan.meals) {
      expect(meal.title.length, meal.id).toBeGreaterThan(0);
      expect(meal.subtitle.length, meal.id).toBeGreaterThan(0);
      expect(meal.prepSteps.length, meal.id).toBeGreaterThan(0);
      expect(meal.whyItMatters.length, meal.id).toBeGreaterThan(25);
      expect(meal.ingredients.length, meal.id).toBeGreaterThan(0);
      expect(meal.nutrition.calories, meal.id).toBeGreaterThan(0);
    }
  });

  it('labels every cost as an estimate with a confidence level', () => {
    for (const meal of plan.meals) {
      expect(['database', 'derived', 'regional-average', 'user-entry']).toContain(meal.cost.basis);
      expect(['low', 'medium', 'high']).toContain(meal.cost.confidence);
      expect(meal.cost.range?.low ?? meal.cost.value).toBeLessThanOrEqual(meal.cost.value);
      expect(meal.cost.range?.high ?? meal.cost.value).toBeGreaterThanOrEqual(meal.cost.value);
    }
  });

  it('keeps all user-facing copy free of banned claims', () => {
    for (const meal of plan.meals) {
      const copy = [
        meal.title,
        meal.subtitle,
        meal.whyItMatters,
        ...meal.prepSteps,
        ...meal.ingredients.map((i) => `${i.name} ${i.portion.label}`),
        ...meal.alternatives.map((a) => `${a.label} ${a.note}`),
      ];
      for (const text of copy) {
        expect(findBannedClaims(text), `offending copy: ${text}`).toHaveLength(0);
      }
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = run();
    const b = run();
    expect(a.meals).toEqual(b.meals);
    expect(a.profileHash).toBe(b.profileHash);
  });
});

describe('diet hard excludes', () => {
  it('never suggests a non-veg food to a vegetarian', () => {
    const plan = run({ diet: { dietType: 'vegetarian' } });
    const filter = dietFilter(makeDiet({ dietType: 'vegetarian' }));
    for (const meal of plan.meals) {
      for (const key of keysOf(meal)) {
        const food = FOODS_BY_KEY[key];
        if (!food) throw new Error(`unknown food key in plan: ${key}`);
        expect(isAllowed(food, filter), `${key} allowed for a vegetarian`).toBe(true);
      }
    }
  });

  it('keeps egg out of a plain vegetarian plan', () => {
    const plan = run({ diet: { dietType: 'vegetarian' } });
    const all = plan.meals.flatMap(keysOf);
    expect(all).not.toContain('egg');
    expect(all).not.toContain('chicken');
    expect(all).not.toContain('fish');
  });

  it('allows egg for an egg-vegetarian', () => {
    const vegPlan = run({ diet: { dietType: 'vegetarian' } });
    const eggPlan = run({ diet: { dietType: 'egg-vegetarian' } });
    expect(new Set(eggPlan.meals.flatMap(keysOf))).not.toEqual(new Set(vegPlan.meals.flatMap(keysOf)));
    const filter = dietFilter(makeDiet({ dietType: 'egg-vegetarian' }));
    for (const key of eggPlan.meals.flatMap(keysOf)) {
      const food = FOODS_BY_KEY[key];
      if (food) expect(isAllowed(food, filter), key).toBe(true);
    }
  });

  it('honours a declared allergy without ever substituting into it', () => {
    const diet = makeDiet({ dietType: 'non-vegetarian', allergies: ['milk'] });
    const plan = run({ diet });
    for (const key of plan.meals.flatMap(keysOf)) {
      const food = FOODS_BY_KEY[key];
      if (food) expect(food.allergens, key).not.toContain('lactose');
    }
  });

  it('respects "never suggest this again"', () => {
    const base = run();
    const first = base.meals[0];
    if (!first) throw new Error('no breakfast');
    const neverAgain = first.ingredients[0]?.foodKey;
    if (!neverAgain) throw new Error('no breakfast ingredient');
    const plan = run({ diet: { neverAgain: [neverAgain] } });
    expect(plan.meals.flatMap(keysOf)).not.toContain(neverAgain);
  });

  it('respects dislikes as a preference, not an exclusion', () => {
    const base = run();
    const disliked = base.meals[0]?.ingredients[0]?.foodKey;
    if (!disliked) throw new Error('no breakfast ingredient');
    const plan = run({ diet: { dislikes: [disliked] } });
    const filter = dietFilter(makeDiet({ dislikes: [disliked] }));
    const breakfast = plan.meals[0];
    if (breakfast) expect(keysOf(breakfast)).not.toContain(disliked);
    for (const key of plan.meals.flatMap(keysOf)) {
      const food = FOODS_BY_KEY[key];
      if (food) expect(isAllowed(food, filter), key).toBe(true);
    }
  });

  it('explains why a food was rejected', () => {
    const filter = dietFilter(makeDiet({ dietType: 'vegetarian', neverAgain: ['rice'] }));
    const rice = FOODS_BY_KEY.rice;
    if (!rice) throw new Error('no rice');
    expect(rejectionReason(rice, filter)).toMatch(/never/i);
  });
});

describe('budget behaviour', () => {
  it('fits a very low budget instead of ignoring it', () => {
    const plan = run({ budget: 80 });
    expect(plan.totalCost.value).toBeGreaterThan(0);
    expect(plan.totalCost.value).toBeLessThan(80 * 1.3);
  });

  it('scales prices by region, with Bihar cheaper than a metro', () => {
    const bihar = run({ profile: { region: 'bihar' } });
    const metro = run({ profile: { region: 'metro-south' } });
    expect(regionMultiplier('bihar')).toBeLessThan(regionMultiplier('metro-south'));
    expect(bihar.totalCost.value).toBeLessThan(metro.totalCost.value);
  });

  it('flags the day and suggests a cheaper swap when over budget', () => {
    const plan = run({ budget: 40 });
    if (plan.withinBudget) return;
    expect(plan.advisoryNotes.length).toBeGreaterThan(0);
    expect(plan.advisoryNotes.join(' ')).toMatch(/swap|budget/i);
    expect(plan.meals.some((m) => m.alternatives.length > 0)).toBe(true);
  });

  it('marks the plan over budget above the tolerance band', () => {
    const plan = run({ budget: 10 });
    expect(plan.withinBudget).toBe(false);
  });

  it('never proposes an alternative that breaks the diet', () => {
    const diet = makeDiet({ dietType: 'vegetarian', allergies: ['milk'] });
    const plan = run({ diet, budget: 60 });
    const filter = dietFilter(diet);
    for (const meal of plan.meals) {
      for (const alt of meal.alternatives) {
        for (const swap of alt.swaps) {
          const food = FOODS_BY_KEY[swap.to];
          if (food) expect(isAllowed(food, filter), `${meal.slot}:${swap.to}`).toBe(true);
        }
      }
    }
  });
});

describe('portion scaling', () => {
  it('never scales portions to zero or beyond absurdity', () => {
    const tiny = portionScale({ targetCalories: 800, baseCalories: 2200, weightKg: 58 });
    const huge = portionScale({ targetCalories: 5000, baseCalories: 2200, weightKg: 58 });
    expect(tiny).toBeGreaterThan(0.5);
    expect(tiny).toBeLessThan(1);
    expect(huge).toBeGreaterThan(1);
    expect(huge).toBeLessThan(2);
  });

  it('is 1.0 when the target already matches the baseline', () => {
    expect(portionScale({ targetCalories: 2200, baseCalories: 2200, weightKg: 58 })).toBeCloseTo(1, 3);
    // Out-of-range targets are clamped, not extrapolated.
    expect(portionScale({ targetCalories: 2200, baseCalories: 0, weightKg: 58 })).toBe(1);
    expect(portionScale({ targetCalories: 400, baseCalories: 2200, weightKg: 40 })).toBeGreaterThanOrEqual(0.78);
  });

  it('keeps total calories near the target', () => {
    const plan = run({ profile: { weightKg: 70, goal: 'maintain-weight' } });
    const pct = plan.totalNutrition.calories / 2200;
    expect(pct).toBeGreaterThan(0.5);
    expect(pct).toBeLessThan(1.6);
  });
});

describe('variety', () => {
  it('offers a reasonable spread of foods in one day', () => {
    const plan = run();
    expect(plan.distinctFoodCount).toBeGreaterThanOrEqual(8);
    expect(plan.varietyCount).toBeGreaterThanOrEqual(5);
  });

  it('includes a vegetable and a protein source on a vegetarian plan', () => {
    const plan = run({ diet: { dietType: 'vegetarian' } });
    const cats = plan.meals
      .flatMap((m) => m.ingredients.map((i) => FOODS_BY_KEY[i.foodKey]?.category))
      .filter(Boolean);
    expect(cats).toContain('vegetable');
    expect(cats.some((c) => c === 'protein' || c === 'legume' || c === 'dairy')).toBe(true);
  });
});

describe('grocery derived from the plan', () => {
  it('aggregates the same food across meals into one line', () => {
    const plan = run();
    const items = buildDailyGrocery({
      meals: plan.meals,
      region: 'bihar',
      season: 'winter',
      pantry: [],
      overrides: {},
      date: DATE,
    });
    const keys = items.map((i) => i.foodKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of items) {
      expect(item.buyQuantity.grams).toBeGreaterThan(0);
      expect(item.estimatedCost.value).toBeGreaterThan(0);
      expect(item.buyUnitLabel.length).toBeGreaterThan(0);
    }
  });

  it('marks pantry items as already owned', () => {
    const plan = run();
    const first = plan.meals[0]?.ingredients[0]?.foodKey;
    if (!first) throw new Error('no ingredient');
    const items = buildDailyGrocery({
      meals: plan.meals,
      region: 'bihar',
      season: 'winter',
      pantry: [first],
      overrides: {},
      date: DATE,
    });
    const owned = items.find((i) => i.foodKey === first);
    expect(owned?.owned).toBe(true);
    expect(owned?.purchaseRequired).toBe(false);
  });
});

// Imported lazily to keep the fixture section readable.
import { FOODS } from '@/lib/domain/data/foods';

const FOODS_BY_KEY: Record<string, (typeof FOODS)[number]> = Object.fromEntries(
  FOODS.map((f) => [f.key, f]),
);
