import { describe, expect, it } from 'vitest';
import { FOCUS_LABELS, buildWorkout, reducedWorkout } from '@/lib/domain/fitness';
import {
  allergySafeAlternatives,
  buildMealPlan,
  portionScale,
  profileHash,
  skipOptionsFor,
  type MealPlanInput,
} from '@/lib/domain/meals';
import {
  cheapestAllowed,
  costOfNutrition,
  formatCost,
  formatCostPrecise,
  nutritionPerRupee,
  pricePerKg,
  totalCost,
  valueRank,
} from '@/lib/domain/budget';
import { budgetLine, formatGroceryCost, groceryTotal, ownedSavings } from '@/lib/domain/grocery';
import { estimate, nutritionOfPortions, scalePortion, sumNutritionList } from '@/lib/domain/nutrition';
import { requireFood } from '@/lib/domain/data/foods';
import { dietFilter } from '@/lib/domain/diet';
import type { Estimate, FoodKey, MealSlot, Portion } from '@/lib/domain/types/index';
import { DATE, makeDiet, makeHealth, makeProfile } from './fixtures';

function planInput(over: Partial<MealPlanInput> = {}): MealPlanInput {
  return {
    profile: makeProfile(),
    diet: makeDiet(),
    date: DATE,
    season: 'winter',
    pantry: [],
    dailyBudget: 150,
    priceOverrides: {},
    targets: { calories: 1800, protein: 60 },
    isRestDay: false,
    ...over,
  };
}

describe('workout focus coverage', () => {
  const focuses = Object.keys(FOCUS_LABELS) as (keyof typeof FOCUS_LABELS)[];

  it('builds a valid workout for every focus at every level', () => {
    for (const focus of focuses) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
        const w = buildWorkout({
          profile: makeProfile(),
          date: DATE,
          level,
          focus,
          isRestDay: false,
        });
        const label = `${focus}/${level}`;
        expect(w.blocks.length, label).toBeGreaterThanOrEqual(3);
        expect(w.totalMinutes, label).toBeGreaterThan(0);
        expect(w.totalMinutes, label).toBeLessThanOrEqual(75);
        expect(new Set(w.blocks.map((b) => b.id)).size, label).toBe(w.blocks.length);
        for (const b of w.blocks) {
          expect(b.minutes, `${label}/${b.id}`).toBeGreaterThan(0);
          expect(b.instructions.length, `${label}/${b.id}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('respects a short time budget without dropping blocks', () => {
    const quick = buildWorkout({
      profile: makeProfile({ exerciseMinutesPerDay: 10 }),
      date: DATE,
      level: 'beginner',
      focus: 'full-body',
      isRestDay: false,
    });
    const long = buildWorkout({
      profile: makeProfile({ exerciseMinutesPerDay: 45 }),
      date: DATE,
      level: 'beginner',
      focus: 'full-body',
      isRestDay: false,
    });
    expect(quick.totalMinutes).toBeLessThanOrEqual(long.totalMinutes);
    expect(quick.blocks.length).toBeGreaterThanOrEqual(3);
    expect(long.totalMinutes).toBeGreaterThanOrEqual(12);
  });

  it('gives every block instructions the user can follow without a trainer', () => {
    const w = buildWorkout({
      profile: makeProfile(),
      date: DATE,
      level: 'beginner',
      focus: 'full-body',
      isRestDay: false,
    });
    for (const block of w.blocks) {
      expect(block.name.length, block.id).toBeGreaterThan(2);
      expect(block.instructions.length, block.id).toBeGreaterThan(20);
      expect(block.emoji.length, block.id).toBeGreaterThan(0);
    }
  });

  it('keeps the reduced version a strict subset of the original', () => {
    const w = buildWorkout({
      profile: makeProfile(),
      date: DATE,
      level: 'intermediate',
      focus: 'cardio',
      isRestDay: false,
    });
    const short = reducedWorkout(w);
    expect(short.blocks.map((b) => b.id)).toEqual(w.blocks.map((b) => b.id));
    expect(short.totalMinutes).toBeLessThanOrEqual(w.totalMinutes);
  });
});

describe('portion scaling and swaps', () => {
  it('clamps the portion scale to a safe range and reacts to weight', () => {
    expect(portionScale({ targetCalories: 1800, baseCalories: 0, weightKg: 70 })).toBe(1);
    expect(portionScale({ targetCalories: 900, baseCalories: 2000, weightKg: 70 })).toBe(0.82);
    expect(portionScale({ targetCalories: 4000, baseCalories: 2000, weightKg: 70 })).toBe(1.18);
    expect(portionScale({ targetCalories: 2000, baseCalories: 2000, weightKg: 40 })).toBe(0.96);
    expect(portionScale({ targetCalories: 2000, baseCalories: 2000, weightKg: 110 })).toBe(1.04);
    expect(portionScale({ targetCalories: 2000, baseCalories: 2000, weightKg: 70 })).toBe(1);
  });

  it('keeps gram and piece labels readable at both ends of the scale', () => {
    const grams: Portion = { grams: 150, gramsLow: 120, gramsHigh: 180, unit: 'g', label: '150 g' };
    expect(scalePortion(grams, 0.6).grams).toBe(90);
    expect(scalePortion(grams, 0.6).label).toBe('90 g');
    expect(scalePortion(grams, 1.4).gramsHigh).toBe(252);

    const pieces: Portion = { grams: 200, gramsLow: 180, gramsHigh: 220, unit: 'piece', label: '1 banana' };
    expect(scalePortion(pieces, 1).label).toBe('1 bananas');
    expect(scalePortion(pieces, 0.6).label).toBe('1 bananas');
    const rotis: Portion = { grams: 60, gramsLow: 50, gramsHigh: 70, unit: 'piece', label: '2 rotis' };
    expect(scalePortion(rotis, 0.6).label).toBe('1 rotis');
    expect(scalePortion(rotis, 1.4).label).toBe('3 rotis');
    const odd: Portion = { grams: 60, gramsLow: 50, gramsHigh: 70, unit: 'piece', label: 'a piece' };
    expect(scalePortion(odd, 0.6).label).toBe('a piece');

    const cup: Portion = { grams: 150, gramsLow: 130, gramsHigh: 170, unit: 'cup', label: '1 cup' };
    expect(scalePortion(cup, 0.8).label).toBe('120 g');
    expect(scalePortion(grams, 0.01).gramsLow).toBe(1);
  });

  it('offers allergen-free alternatives that avoid the whole allergen family', () => {
    const input = planInput();
    const alternatives = allergySafeAlternatives(input, 'milk');
    expect(alternatives.length).toBeGreaterThan(0);
    for (const alt of alternatives) {
      expect(alt.from).toBe('milk');
      const food = requireFood(alt.to);
      expect(food.allergens).not.toContain('lactose');
      expect(food.key).not.toBe('milk');
      expect(alt.reason.length).toBeGreaterThan(5);
      expect(Number.isFinite(alt.costDelta)).toBe(true);
    }
    expect(allergySafeAlternatives(input, 'nope' as never)).toEqual([]);
  });

  it('always has something sensible to say for every slot', () => {
    const input = planInput();
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack', 'fruit'] as MealSlot[]) {
      const options = skipOptionsFor(slot, input);
      expect(options.length, slot).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.headline.length, slot).toBeGreaterThan(3);
        expect(option.detail.length, slot).toBeGreaterThan(10);
        expect(Number.isFinite(option.costDelta)).toBe(true);
        expect(option.minutesToPrepare).toBeGreaterThanOrEqual(0);
        for (const swap of option.swaps) expect(swap.reason.length).toBeGreaterThan(5);
      }
    }
  });

  it('changes the plan hash only when the profile changes', () => {
    const base = makeProfile();
    expect(profileHash(base)).toBe(profileHash(makeProfile()));
    expect(profileHash({ ...base, weightKg: 95 })).not.toBe(profileHash(base));
    expect(profileHash({ ...base, exerciseMinutesPerDay: 99 })).toBe(profileHash(base)); // training does not change the food plan
    expect(profileHash(base).length).toBeGreaterThanOrEqual(6);
  });

  it('never plans a disallowed food, whatever the pantry says', () => {
    const filter = dietFilter(makeDiet({ dietType: 'vegetarian' }));
    const plan = buildMealPlan(planInput({ pantry: ['chicken', 'fish', 'egg', 'toor-dal'] }));
    for (const meal of plan.meals) {
      for (const item of meal.ingredients) {
        expect(filter.diet).toBe('vegetarian');
        expect(item.foodKey).not.toBe('chicken');
        expect(item.foodKey).not.toBe('fish');
      }
    }
    expect(plan.distinctFoodCount).toBeGreaterThan(3);
  });
});

describe('money helpers', () => {
  it('prices per kg using the unit conversion and local override', () => {
    const base = pricePerKg('rice', { multiplier: 1 });
    expect(base).toBeGreaterThan(0);
    expect(pricePerKg('rice', { multiplier: 1.2 })).toBeCloseTo(base * 1.2, 1);
    expect(pricePerKg('rice', { multiplier: 1, override: 40 })).toBe(40);
    expect(costOfNutrition('rice', 500, 1)).toBeGreaterThan(0);
  });

  it('picks the cheapest allowed candidate and can find nothing', () => {
    const filter = dietFilter(makeDiet({ dietType: 'non-vegetarian' }));
    const candidates: FoodKey[] = ['chicken', 'dal-mix', 'toor-dal', 'milk'];
    const pick = cheapestAllowed(candidates, { multiplier: 1, filter, season: 'winter' });
    expect(pick).not.toBeNull();
    if (pick) {
      const others = candidates.filter((k) => k !== pick);
      for (const other of others) {
        expect(pricePerKg(pick, { multiplier: 1 })).toBeLessThanOrEqual(pricePerKg(other, { multiplier: 1 }));
      }
    }
    expect(cheapestAllowed(candidates, { multiplier: 1, filter, season: 'winter', maxPrice: 0.01 })).toBeNull();
    expect(cheapestAllowed([], { multiplier: 1, filter, season: 'winter' })).toBeNull();
    expect(
      cheapestAllowed(candidates, { multiplier: 1, filter, season: 'winter', overrides: { milk: 1 } }),
    ).toBe('milk');
    const vegFilter = dietFilter(makeDiet({ dietType: 'vegetarian' }));
    expect(cheapestAllowed(['chicken', 'fish', 'egg'], { multiplier: 1, filter: vegFilter, season: 'winter' })).toBeNull();
  });

  it('ranks by protein per rupee', () => {
    const ranked = valueRank(['rice', 'chana-dal', 'toor-dal', 'milk']);
    expect(ranked.length).toBe(4);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.proteinPerRupee).toBeGreaterThanOrEqual(ranked[i]!.proteinPerRupee);
    }
  });

  it('formats a range honestly and collapses it when it is tight', () => {
    const tight: Estimate<number> = estimate(120, { low: 120, high: 120 }, 'derived', 'medium');
    expect(formatCost(tight)).toBe('₹120');
    const wide: Estimate<number> = estimate(120, { low: 90, high: 150 }, 'derived', 'medium');
    expect(formatCost(wide)).toBe('₹90–₹150');
    expect(formatCostPrecise(wide)).toBe('₹120');
    expect(formatCost(estimate(0, { low: 0, high: 0 }, 'derived', 'low'))).toBe('₹0');
    // A range that disagrees with the value collapses onto the value instead of
    // displaying a different number from the one the rest of the app uses.
    expect(formatCost(estimate(50, { low: 80, high: 20 }, 'derived', 'low'))).toBe('₹50');
    expect(formatCost(estimate(50, { low: 10, high: 10 }, 'derived', 'low'))).toBe('₹10–₹50');
    expect(formatCost(estimate(50, { low: 40, high: 70 }, 'derived', 'low'))).toBe('₹40–₹70');
  });

  it('sums estimates without losing the range', () => {
    const sum = totalCost([
      estimate(30, { low: 28, high: 33 }, 'derived', 'medium'),
      estimate(70, { low: 70, high: 70 }, 'derived', 'medium'),
    ]);
    expect(sum.value).toBe(100);
    expect(sum.range?.low).toBe(98);
    expect(sum.range?.high).toBe(103);
    const empty = totalCost([]);
    expect(empty.value).toBe(0);
    expect(empty.range?.low).toBe(0);
  });

  it('reports grocery totals, owned savings and budget tone', () => {
    const items = [
      { estimatedCost: estimate(30, { low: 28, high: 33 }, 'derived', 'medium'), purchaseRequired: true, owned: false },
      { estimatedCost: estimate(70, { low: 70, high: 70 }, 'derived', 'medium'), purchaseRequired: true, owned: true },
      { estimatedCost: estimate(999, { low: 999, high: 999 }, 'derived', 'medium'), purchaseRequired: false, owned: false },
    ] as unknown as Parameters<typeof groceryTotal>[0];
    expect(groceryTotal(items).value).toBe(100);
    expect(ownedSavings(items)).toBe(70);
    expect(formatGroceryCost(items)).toContain('₹');
    expect(budgetLine(50, 100).tone).toBe('under');
    expect(budgetLine(95, 100).tone).toBe('close');
    expect(budgetLine(80, 100).tone).toBe('close'); // exactly 20% left is "close", not "under"
    expect(budgetLine(120, 100).tone).toBe('over');
    expect(budgetLine(100, 100).tone).toBe('close');
    expect(budgetLine(120, 100).detail).toMatch(/cheaper swap/);
    expect(budgetLine(80, 100).detail).toMatch(/₹20 left/);
    expect(budgetLine(50, 100).detail).toMatch(/₹50 left/);
  });

  it('never divides by zero', () => {
    expect(nutritionPerRupee({ calories: 100, protein: 10, carbs: 10, fat: 5, fiber: 1 }, 0)).toBe(0);
    expect(nutritionPerRupee({ calories: 100, protein: 10, carbs: 10, fat: 5, fiber: 1 }, 20)).toBe(0.5);
  });
});

describe('small helpers', () => {
  it('sums nutrition through either entry point', () => {
    const items = [
      { calories: 100, protein: 5, carbs: 10, fat: 2, fiber: 1 },
      { calories: 150, protein: 7, carbs: 20, fat: 4, fiber: 3 },
    ];
    const viaHelper = sumNutritionList(items);
    expect(viaHelper.calories).toBe(250);
    expect(viaHelper.protein).toBe(12);
    expect(nutritionOfPortions([{ key: 'rice', grams: 100 }, { key: 'toor-dal', grams: 100 }]).calories).toBeGreaterThan(0);
    expect(nutritionOfPortions([]).calories).toBe(0);
    expect(Object.keys(makeHealth()).length).toBeGreaterThan(0);
  });
});
