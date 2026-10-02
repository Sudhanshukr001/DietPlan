/**
 * Nutrition arithmetic. All outputs are rounded for display; nothing here is
 * laboratory data. Callers must label results as estimates.
 */

import type {
  Estimate,
  NutritionTotals,
  Portion,
  FitnessGoal,
  ActivityLevel,
  Sex,
} from './types/index';
import { nutritionForGrams, round1, sumNutrition } from './data/foods';
import type { FoodKey } from './types/index';

const roundCalories = (n: number): number => Math.round(n / 5) * 5;

export function estimate<T>(
  value: T,
  range: { low: T; high: T },
  basis: Estimate<T>['basis'] = 'derived',
  confidence: Estimate<T>['confidence'] = 'medium',
): Estimate<T> {
  return { value, range: { low: range.low, high: range.high }, basis, confidence };
}

export function sumNutritionList(items: readonly NutritionTotals[]): NutritionTotals {
  return sumNutrition(items);
}

export function nutritionOfPortions(
  portions: readonly { key: FoodKey; grams: number }[],
): NutritionTotals {
  return sumNutrition(portions.map((p) => nutritionForGrams(p.key, p.grams)));
}

/** Scale a whole meal by a multiplier (portion editing uses 0.6x .. 1.4x). */
export function scaleNutrition(n: NutritionTotals, factor: number): NutritionTotals {
  return {
    calories: roundCalories(n.calories * factor),
    protein: round1(n.protein * factor),
    carbs: round1(n.carbs * factor),
    fat: round1(n.fat * factor),
    fiber: round1(n.fiber * factor),
  };
}

/** Protein density in grams per 100 kcal — used to rank meals by staying power. */
export function proteinDensity(n: NutritionTotals): number {
  if (n.calories <= 0) return 0;
  return round1((n.protein / n.calories) * 100);
}

export function fibreDensity(n: NutritionTotals): number {
  if (n.calories <= 0) return 0;
  return round1((n.fiber / n.calories) * 100);
}

export function nutrientShare(n: NutritionTotals): { protein: number; carbs: number; fat: number } {
  const total = n.protein * 4 + n.carbs * 4 + n.fat * 9;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: Math.round((n.protein * 4 / total) * 100),
    carbs: Math.round((n.carbs * 4 / total) * 100),
    fat: Math.round((n.fat * 9 / total) * 100),
  };
}

// ---------------------------------------------------------------------------
// Portions
// ---------------------------------------------------------------------------

export function scalePortion(p: Portion, factor: number): Portion {
  const grams = Math.max(1, Math.round(p.grams * factor));
  const unit = p.unit;
  if (unit === 'g' || unit === 'ml') {
    return {
      grams,
      gramsLow: Math.max(1, Math.round(p.gramsLow * factor)),
      gramsHigh: Math.round(p.gramsHigh * factor),
      label: `${grams} ${unit}`,
      unit,
    };
  }
  // Pieces/cups keep their human label but scale the underlying gram weight.
  const label =
    unit === 'piece'
      ? scalePieceLabel(p.label, factor)
      : `${grams} g`;
  return {
    grams,
    gramsLow: Math.max(1, Math.round(p.gramsLow * factor)),
    gramsHigh: Math.round(p.gramsHigh * factor),
    label,
    unit,
  };
}

function scalePieceLabel(label: string, factor: number): string {
  const match = /^(\d+)\s+(.*)$/.exec(label);
  if (!match) return label;
  const count = Math.max(1, Math.round(Number(match[1]) * factor));
  const rest = match[2] ?? '';
  const plural = rest.endsWith('s') ? rest : `${rest}s`;
  return `${count} ${plural}`;
}

/** Portion stepping used by the UI Stepper. */
export const PORTION_STEPS = [0.6, 0.8, 1, 1.2, 1.4] as const;

export function nextPortionFactor(current: number): number {
  const i = PORTION_STEPS.findIndex((s) => Math.abs(s - current) < 0.05);
  if (i < 0) return 1;
  return PORTION_STEPS[Math.min(i + 1, PORTION_STEPS.length - 1)] ?? 1;
}

export function prevPortionFactor(current: number): number {
  const i = PORTION_STEPS.findIndex((s) => Math.abs(s - current) < 0.05);
  if (i < 0) return 1;
  return PORTION_STEPS[Math.max(i - 1, 0)] ?? 1;
}

// ---------------------------------------------------------------------------
// Daily targets
// ---------------------------------------------------------------------------

/**
 * Mifflin-St Jeor resting energy. Deliberately labelled an estimate: it is a
 * population formula, not a measurement.
 */
export function bmr(input: {
  readonly weightKg: number;
  readonly heightCm: number;
  readonly age: number;
  readonly sex: Sex;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  const constant = input.sex === 'male' ? 5 : input.sex === 'female' ? -161 : -78;
  return Math.round(base + constant);
}

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.25,
  light: 1.375,
  moderate: 1.5,
  active: 1.65,
  'very-active': 1.8,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sitting — desk, school or a mostly indoor day',
  light: 'Some walking or standing during the day',
  moderate: 'Regular activity — commuting, chores, daily exercise',
  active: 'Physical work or sport several times a week',
  'very-active': 'Hard physical work or daily training',
};

export function activityFactor(level: ActivityLevel): number {
  return ACTIVITY_FACTORS[level] ?? 1.375;
}

/** Estimate of total daily energy need. Approximate, never a prescription. */
export function dailyEnergyEstimate(input: {
  readonly weightKg: number;
  readonly heightCm: number;
  readonly age: number;
  readonly sex: Sex;
  readonly activityLevel: ActivityLevel;
}): Estimate<number> {
  const resting = bmr(input);
  const total = Math.round(resting * ACTIVITY_FACTORS[input.activityLevel]);
  return estimate(total, { low: Math.round(total * 0.92), high: Math.round(total * 1.08) }, 'derived', 'medium');
}

/**
 * Goal-adjusted calorie target. The adjustment is deliberately modest — the
 * spec prioritises consistency, and aggressive deficits are the main reason
 * diet plans fail.
 */
export const GOAL_CALORIE_ADJUSTMENT: Record<FitnessGoal, number> = {
  'maintain-weight': 0,
  'lose-fat': -0.12,
  'gain-weight': 0.1,
  'build-muscle': 0.08,
  'improve-fitness': -0.04,
  'improve-energy': 0,
  'build-healthy-lifestyle': 0,
};

/** Onboarding wording for each goal. No promise of outcome, only intent. */
export const GOAL_LABELS: Record<FitnessGoal, string> = {
  'maintain-weight': 'Keep my weight steady',
  'lose-fat': 'Lose fat',
  'gain-weight': 'Gain weight',
  'build-muscle': 'Build muscle',
  'improve-fitness': 'Get fitter',
  'improve-energy': 'Have more energy',
  'build-healthy-lifestyle': 'Build a healthy routine',
};

export const GOAL_DESCRIPTIONS: Record<FitnessGoal, string> = {
  'maintain-weight': 'Eat close to what you use today, so nothing drifts.',
  'lose-fat': 'A small, steady deficit with protein kept high so you keep strength.',
  'gain-weight': 'A small surplus, mostly from dal, milk, rice and oil rather than sweets.',
  'build-muscle': 'Protein first, with resistance work scheduled alongside it.',
  'improve-fitness': 'Enough food to train, and enough rest to recover.',
  'improve-energy': 'Steady meals and regular timing, without a strict target.',
  'build-healthy-lifestyle': 'No targets at all — just a repeatable day.',
};

/** Protein target in grams. Movement and body size drive it more than the calorie goal does. */
export const GOAL_PROTEIN_PER_KG: Record<FitnessGoal, number> = {
  'maintain-weight': 0.9,
  'lose-fat': 1.3,
  'gain-weight': 1.1,
  'build-muscle': 1.5,
  'improve-fitness': 1.1,
  'improve-energy': 0.9,
  'build-healthy-lifestyle': 0.9,
};

export interface DailyTargets {
  readonly calories: Estimate<number>;
  readonly protein: Estimate<number>;
  readonly carbs: Estimate<number>;
  readonly fat: Estimate<number>;
  readonly fiber: number;
  readonly bmi: number;
  readonly showBmi: boolean;
  readonly basis: string;
}

export function dailyTargets(input: {
  readonly weightKg: number;
  readonly heightCm: number;
  readonly age: number;
  readonly sex: Sex;
  readonly activityLevel: ActivityLevel;
  readonly goal: FitnessGoal;
  readonly showBmi: boolean;
}): DailyTargets {
  const energy = dailyEnergyEstimate(input);
  const adjusted = Math.round(energy.value * (1 + GOAL_CALORIE_ADJUSTMENT[input.goal]));
  const calorieTarget = Math.max(1200, adjusted);

  const proteinG = Math.round(input.weightKg * GOAL_PROTEIN_PER_KG[input.goal]);
  // Protein at 4 kcal/g, split remainder 55:45 carbs:fat — a rounded heuristic.
  const proteinKcal = proteinG * 4;
  const remaining = Math.max(calorieTarget - proteinKcal, 300);
  const carbsG = Math.round((remaining * 0.55) / 4);
  const fatG = Math.round((remaining * 0.45) / 9);

  const bmiRaw = input.weightKg / Math.pow(input.heightCm / 100, 2);
  const bmi = Math.round(bmiRaw * 10) / 10;

  return {
    calories: estimate(
      roundCalories(calorieTarget),
      { low: roundCalories(calorieTarget * 0.93), high: roundCalories(calorieTarget * 1.07) },
      'derived',
      'low',
    ),
    protein: estimate(
      proteinG,
      { low: Math.round(proteinG * 0.9), high: Math.round(proteinG * 1.1) },
      'derived',
      'medium',
    ),
    carbs: estimate(
      carbsG,
      { low: Math.round(carbsG * 0.9), high: Math.round(carbsG * 1.1) },
      'derived',
      'low',
    ),
    fat: estimate(
      fatG,
      { low: Math.round(fatG * 0.85), high: Math.round(fatG * 1.15) },
      'derived',
      'low',
    ),
    fiber: input.sex === 'male' ? 38 : 25,
    bmi,
    showBmi: input.showBmi,
    basis:
      'Estimated from your age, height, weight and activity level using a standard population formula. It is a rough guide, not a measurement.',
  };
}

/** Micronutrient highlights surfaced on the Skin & Healthy Aging surface. */
export interface LifestyleFoundation {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly emoji: string;
  readonly todayDone: boolean;
  readonly tone: 'green' | 'calm' | 'plum' | 'warm';
}

export const LIFESTYLE_FOUNDATIONS: readonly Omit<LifestyleFoundation, 'todayDone'>[] = [
  {
    id: 'produce',
    title: 'Fruit and vegetables',
    detail: 'Several servings a day bring in vitamin C, fibre and a wide spread of plant compounds that support normal skin and digestion.',
    emoji: '🥬',
    tone: 'green',
  },
  {
    id: 'protein',
    title: 'Adequate protein',
    detail: 'Protein from dal, chana, soy, eggs or milk gives your body the amino acids it uses for everyday repair.',
    emoji: '🫘',
    tone: 'warm',
  },
  {
    id: 'fats',
    title: 'A little healthy fat',
    detail: 'A small amount of groundnut or sesame fat helps your body absorb vitamins A, D, E and K from vegetables.',
    emoji: '🥜',
    tone: 'green',
  },
  {
    id: 'hydration',
    title: 'Steady hydration',
    detail: 'Regular fluids across the day help with digestion, temperature control and how alert you feel.',
    emoji: '💧',
    tone: 'calm',
  },
  {
    id: 'sleep',
    title: 'Regular sleep',
    detail: 'A consistent sleep window gives your body time to recover. Habits around it matter more than a perfect hour count.',
    emoji: '🌙',
    tone: 'plum',
  },
  {
    id: 'movement',
    title: 'Daily movement',
    detail: 'Walking and simple strength work support circulation, muscle and mood. It does not need a gym.',
    emoji: '🏃',
    tone: 'green',
  },
  {
    id: 'sun',
    title: 'Sun protection',
    detail: 'Cover up during strong midday sun and use shade, a hat or cloth. This is the most reliable everyday skin protection.',
    emoji: '🧢',
    tone: 'warm',
  },
  {
    id: 'tobacco',
    title: 'No tobacco',
    detail: 'Avoiding tobacco in any form — chewing or smoking — is one of the strongest everyday habits for skin, gums and lungs.',
    emoji: '🚭',
    tone: 'green',
  },
  {
    id: 'alcohol',
    title: 'Moderate or skip alcohol',
    detail: 'Less alcohol means steadier sleep and skin. Skipping entirely is fine and needs no explanation.',
    emoji: '🍷',
    tone: 'plum',
  },
];
