/**
 * Diet filtering — the single place that decides what a user may eat.
 *
 * Hard excludes (allergies, declared intolerances, never-again) are absolute.
 * Dislikes are preferences: avoided when an equivalent exists, but never a
 * dead end.
 */

import type {
  DietPreference,
  DietTag,
  DietType,
  Food,
  FoodKey,
  SeasonId,
} from './types/index';
import { FOODS } from './data/foods';

export const DIET_LABELS: Record<DietType, string> = {
  vegetarian: 'Vegetarian',
  'egg-vegetarian': 'Egg vegetarian',
  'non-vegetarian': 'Non-vegetarian',
};

export const DIET_DESCRIPTIONS: Record<DietType, string> = {
  vegetarian: 'No meat, fish or egg. Dairy, dal, chana and soy carry the protein.',
  'egg-vegetarian': 'Vegetarian food plus eggs. Eggs are the cheapest complete protein here.',
  'non-vegetarian': 'Vegetarian food plus eggs, chicken or fish, whichever fits your budget.',
};

export const DIET_TAG_LABELS: Record<DietTag, string> = {
  veg: 'Vegetarian',
  egg: 'Has egg',
  nonveg: 'Non-vegetarian',
};

/** Highest animal-protein level a diet permits. */
export function maxDietTag(diet: DietType): DietTag {
  if (diet === 'vegetarian') return 'veg';
  if (diet === 'egg-vegetarian') return 'egg';
  return 'nonveg';
}

const TAG_RANK: Record<DietTag, number> = { veg: 0, egg: 1, nonveg: 2 };

export function dietAllowsTag(diet: DietType, tag: DietTag): boolean {
  return TAG_RANK[tag] <= TAG_RANK[maxDietTag(diet)];
}

/** Allergens the user declared, as a set of allergen strings (not food keys). */
export function allergenSet(diet: DietPreference): ReadonlySet<string> {
  return new Set(diet.allergies.flatMap((k) => {
    const food = FOODS.find((f) => f.key === k);
    return food ? [k, ...food.allergens] : [k];
  }));
}

export function intoleranceSet(diet: DietPreference): ReadonlySet<string> {
  return new Set(diet.intolerances.flatMap((k) => {
    const food = FOODS.find((f) => f.key === k);
    return food ? [k, ...food.allergens] : [k];
  }));
}

export interface DietFilter {
  readonly diet: DietType;
  readonly allergies: ReadonlySet<string>;
  readonly intolerances: ReadonlySet<string>;
  readonly neverAgain: ReadonlySet<string>;
  readonly dislikes: ReadonlySet<string>;
}

/** Build the reusable filter once per plan generation. */
export function dietFilter(diet: DietPreference): DietFilter {
  return {
    diet: diet.dietType,
    allergies: allergenSet(diet),
    intolerances: intoleranceSet(diet),
    neverAgain: new Set(diet.neverAgain),
    dislikes: new Set(diet.dislikes),
  };
}

/**
 * Absolute legality test. This is the only function that may veto a food, and
 * every engine must call it before emitting an ingredient.
 */
export function isAllowed(food: Food, f: DietFilter): boolean {
  if (!dietAllowsTag(f.diet, food.dietTag)) return false;
  if (f.neverAgain.has(food.key)) return false;
  if (f.allergies.has(food.key)) return false;
  for (const allergen of food.allergens) {
    if (f.allergies.has(allergen)) return false;
    if (f.intolerances.has(allergen)) return false;
  }
  return true;
}

/** Strict (must-have) minus dislikes and off-season items, for hard exclusions. */
export function isIdeal(food: Food, f: DietFilter, season: SeasonId): boolean {
  if (!isAllowed(food, f)) return false;
  if (f.dislikes.has(food.key)) return false;
  if (!food.seasons.includes('all-year') && !food.seasons.includes(season)) return false;
  return true;
}

/** Reason a food was rejected — used to explain substitutions to the user. */
export function rejectionReason(food: Food, f: DietFilter): string | null {
  if (f.neverAgain.has(food.key)) return 'you asked us never to suggest this';
  if (f.allergies.has(food.key)) return 'listed as an allergy';
  if (!dietAllowsTag(f.diet, food.dietTag)) return 'not part of your diet type';
  for (const allergen of food.allergens) {
    if (f.allergies.has(allergen)) return `contains ${allergen}, which you listed as an allergy`;
    if (f.intolerances.has(allergen)) return `contains ${allergen}, which you listed as difficult to digest`;
  }
  if (f.dislikes.has(food.key)) return 'you said you would rather avoid it';
  return null;
}

export function allowedFoods(f: DietFilter): readonly Food[] {
  return FOODS.filter((food) => isAllowed(food, f));
}

export function allowedKeys(f: DietFilter): ReadonlySet<FoodKey> {
  return new Set(allowedFoods(f).map((x) => x.key));
}

/** Common allergen vocabulary offered in onboarding, mapped to foods. */
export const ALLERGY_OPTIONS: readonly { readonly label: string; readonly keys: readonly FoodKey[] }[] = [
  { label: 'Peanuts / groundnuts', keys: ['peanut'] },
  { label: 'Tree nuts & sesame', keys: ['sesame-seed'] },
  { label: 'Eggs', keys: ['egg'] },
  { label: 'Milk / dairy (lactose)', keys: ['milk', 'curd', 'paneer', 'buttermilk'] },
  { label: 'Soy', keys: ['soy-chunks'] },
  { label: 'Gluten / wheat', keys: ['atta', 'maida', 'sattu', 'besan', 'bread'] },
  { label: 'Fish', keys: ['fish'] },
  { label: 'Beans & pulses', keys: ['chana', 'rajma', 'beans'] },
];

export const INTOLERANCE_OPTIONS: readonly { readonly label: string; readonly keys: readonly FoodKey[] }[] = [
  { label: 'Milk gives me trouble', keys: ['milk', 'paneer'] },
  { label: 'Spicy food upsets my stomach', keys: [] },
  { label: 'Beans cause gas', keys: ['chana', 'rajma', 'beans', 'soy-chunks'] },
  { label: 'Wheat gives me trouble', keys: ['atta', 'maida', 'bread', 'sattu'] },
  { label: 'Tomato or citrus upsets me', keys: ['tomato', 'lemon', 'orange'] },
  { label: 'Raw vegetables are hard to digest', keys: ['onion', 'cabbage', 'cauliflower'] },
];
