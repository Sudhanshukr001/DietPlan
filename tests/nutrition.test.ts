import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LABELS,
  GOAL_CALORIE_ADJUSTMENT,
  GOAL_PROTEIN_PER_KG,
  LIFESTYLE_FOUNDATIONS,
  PORTION_STEPS,
  activityFactor,
  bmr,
  dailyEnergyEstimate,
  dailyTargets,
  estimate,
  fibreDensity,
  nextPortionFactor,
  nutrientShare,
  prevPortionFactor,
  proteinDensity,
  scaleNutrition,
  scalePortion,
  sumNutritionList,
} from '@/lib/domain/nutrition';
import type { ActivityLevel, FitnessGoal, NutritionTotals, Portion } from '@/lib/domain/types/index';
import { findBannedClaims } from '@/lib/domain/safety';

const BASE: NutritionTotals = { calories: 500, protein: 25, carbs: 60, fat: 20, fiber: 8 };

function targets(over: Partial<Parameters<typeof dailyTargets>[0]> = {}) {
  return dailyTargets({
    weightKg: 58,
    heightCm: 160,
    age: 25,
    sex: 'female',
    activityLevel: 'light',
    goal: 'build-healthy-lifestyle',
    showBmi: false,
    ...over,
  });
}

describe('estimates', () => {
  it('always carries a basis and a confidence level', () => {
    const e = estimate(10, { low: 9, high: 11 }, 'derived', 'medium');
    expect(e.value).toBe(10);
    expect(e.basis).toBe('derived');
    expect(e.confidence).toBe('medium');
  });

  it('brackets the value when given a range', () => {
    const e = estimate(100, { low: 92, high: 108 }, 'derived', 'low');
    expect(e.range?.low).toBeLessThan(e.value);
    expect(e.range?.high).toBeGreaterThan(e.value);
  });
});

describe('nutrition arithmetic', () => {
  it('sums and scales without losing precision to rounding', () => {
    const sum = sumNutritionList([BASE, BASE]);
    expect(sum.calories).toBe(1000);
    expect(sum.protein).toBe(50);
    const scaled = scaleNutrition(BASE, 0.5);
    expect(scaled.calories).toBe(250);
    expect(scaled.protein).toBe(12.5);
  });

  it('returns zeroes for an empty list rather than NaN', () => {
    const sum = sumNutritionList([]);
    expect(sum.calories).toBe(0);
    expect(Number.isFinite(sum.protein)).toBe(true);
  });

  it('reports density as grams per 100 calories', () => {
    expect(proteinDensity(BASE)).toBeCloseTo(5, 1);
    expect(fibreDensity(BASE)).toBeCloseTo(1.6, 1);
    expect(proteinDensity({ ...BASE, calories: 0 })).toBe(0);
  });

  it('computes macro shares as whole percentages that roughly add to 100', () => {
    const share = nutrientShare(BASE);
    const total = share.protein + share.carbs + share.fat;
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(101);
    expect(share.protein).toBe(Math.round((25 * 4) / (25 * 4 + 60 * 4 + 20 * 9) * 100));
  });

  it('does not divide by zero on an empty meal', () => {
    const share = nutrientShare({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    expect(share.protein + share.carbs + share.fat).toBe(0);
    expect(share.protein).toBe(0);
  });
});

describe('portion controls', () => {
  const portion: Portion = { grams: 100, gramsLow: 80, gramsHigh: 120, unit: 'g', label: '100 g' };

  it('scales grams, unit and label together', () => {
    const bigger = scalePortion(portion, 1.5);
    expect(bigger.grams).toBe(150);
    expect(bigger.unit).toBe('g');
    expect(bigger.label.length).toBeGreaterThan(0);
  });

  it('never scales a portion to zero or negative', () => {
    expect(scalePortion(portion, 0).grams).toBeGreaterThan(0);
    expect(scalePortion(portion, -1).grams).toBeGreaterThan(0);
  });

  it('steps up and down through the allowed steps and stops at the ends', () => {
    expect(PORTION_STEPS).toContain(1);
    let factor = 1;
    for (let i = 0; i < 10; i += 1) factor = nextPortionFactor(factor);
    expect(factor).toBe(Math.max(...PORTION_STEPS));
    for (let i = 0; i < 10; i += 1) factor = prevPortionFactor(factor);
    expect(factor).toBe(Math.min(...PORTION_STEPS));
  });

  it('moves in recognisable steps', () => {
    expect(nextPortionFactor(1)).toBeGreaterThan(1);
    expect(prevPortionFactor(1)).toBeLessThan(1);
  });
});

describe('energy targets', () => {
  it('uses different constants per sex, and a neutral one for "prefer not to say"', () => {
    const male = bmr({ weightKg: 70, heightCm: 175, age: 30, sex: 'male' });
    const female = bmr({ weightKg: 70, heightCm: 175, age: 30, sex: 'female' });
    const unspecified = bmr({ weightKg: 70, heightCm: 175, age: 30, sex: 'prefer-not-to-say' });
    expect(male).toBeGreaterThan(female);
    expect(unspecified).toBeGreaterThan(female);
    expect(unspecified).toBeLessThan(male);
  });

  it('scales energy with activity level', () => {
    const input = { weightKg: 65, heightCm: 170, age: 30, sex: 'male' as const };
    const levels: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very-active'];
    const values = levels.map((level) => dailyEnergyEstimate({ ...input, activityLevel: level }).value);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
    for (const level of levels) {
      expect(activityFactor(level)).toBeGreaterThan(1);
      expect(ACTIVITY_LABELS[level].length).toBeGreaterThan(10);
    }
  });

  it('gives a ±8% range and never presents the number as a measurement', () => {
    const e = dailyEnergyEstimate({ weightKg: 65, heightCm: 170, age: 30, sex: 'male', activityLevel: 'moderate' });
    expect(e.confidence).not.toBe('high');
    expect(e.range?.low).toBeLessThan(e.value);
    expect(targets().basis.toLowerCase()).toContain('not a measurement');
  });

  it('keeps every goal adjustment modest', () => {
    for (const goal of Object.keys(GOAL_CALORIE_ADJUSTMENT) as FitnessGoal[]) {
      const adjustment = GOAL_CALORIE_ADJUSTMENT[goal];
      expect(Math.abs(adjustment), goal).toBeLessThanOrEqual(0.15);
      expect(GOAL_PROTEIN_PER_KG[goal], goal).toBeGreaterThan(0.5);
    }
  });

  it('never recommends a dangerously low target', () => {
    const tiny = targets({ weightKg: 38, heightCm: 140, age: 70, sex: 'female', goal: 'lose-fat', activityLevel: 'sedentary' });
    expect(tiny.calories.value).toBeGreaterThanOrEqual(1200);
  });

  it('gives more protein to a heavier person and to a muscle goal', () => {
    const light = targets({ weightKg: 45 }).protein.value;
    const heavy = targets({ weightKg: 95 }).protein.value;
    const muscle = targets({ weightKg: 58, goal: 'build-muscle' }).protein.value;
    expect(heavy).toBeGreaterThan(light);
    expect(muscle).toBeGreaterThan(targets({ weightKg: 58 }).protein.value);
  });

  it('only shows BMI when the user opted in', () => {
    expect(targets({ showBmi: false }).showBmi).toBe(false);
    expect(targets({ showBmi: true }).bmi).toBeGreaterThan(0);
  });

  it('keeps macros consistent with the calorie target', () => {
    const t = targets();
    const fromMacros = t.protein.value * 4 + t.carbs.value * 4 + t.fat.value * 9;
    expect(Math.abs(fromMacros - t.calories.value) / t.calories.value).toBeLessThan(0.12);
  });
});

describe('lifestyle foundations copy', () => {
  it('is honest about what food can and cannot do', () => {
    for (const item of LIFESTYLE_FOUNDATIONS) {
      expect(item.title.length).toBeGreaterThan(3);
      expect(item.detail.length).toBeGreaterThan(40);
      expect(findBannedClaims(`${item.title} ${item.detail}`), item.id).toHaveLength(0);
    }
  });

  it('never promises a specific physical outcome', () => {
    const text = LIFESTYLE_FOUNDATIONS.map((i) => `${i.title} ${i.detail}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/guarantee|will (look|be)|cure|anti-aging|detox/);
  });

  it('has a distinct tone per item so the UI can colour them', () => {
    for (const item of LIFESTYLE_FOUNDATIONS) {
      expect(['green', 'calm', 'plum', 'warm']).toContain(item.tone);
    }
  });
});
