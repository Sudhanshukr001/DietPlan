/**
 * Meal plan engine.
 *
 * Assembles a day of meals from: profile (age, size, goal, activity), diet rules,
 * budget, season, region, schedule and pantry. Everything is deterministic —
 * `buildMealPlan(profile, day, ctx)` returns the same plan every time, which is
 * what lets a DaySnapshot be stored once and replayed months later.
 *
 * Design stance: the engine proposes *concrete everyday Indian food*, never
 * branded products, supplements, or imported ingredients. When it cannot fit
 * something in budget it degrades the portion or swaps within the same food
 * group rather than dropping a meal.
 */

import type {
  CalendarDay,
  DietPreference,
  Estimate,
  Food,
  FoodKey,
  FoodSwap,
  Meal,
  MealAlternative,
  MealIngredient,
  MealSlot,
  MinuteOfDay,
  NutritionTotals,
  Portion,
  Profile,
  SeasonId,
} from './types/index';
import { FOODS, getFood, nutritionForGrams, sumNutrition } from './data/foods';
import { costOfPortion, formatCost, totalCost, cheapestAllowed, EXPENSIVE_EXCLUSIONS } from './budget';
import { dietFilter, isAllowed, type DietFilter } from './diet';
import { isInSeason, rankSubstitutes, regionMultiplier, regionProfile, seasonSafetyNote } from './seasonal';
import { proteinDensity } from './nutrition';
import { clampMinute } from './time';
import { foodSafetyTopicsFor } from './safety';
import { MEAL_WINDOW_MINUTES } from './mealWindows';

export interface MealPlanInput {
  readonly profile: Profile;
  readonly diet: DietPreference;
  readonly date: CalendarDay;
  readonly season: SeasonId;
  readonly pantry: readonly FoodKey[];
  readonly dailyBudget: number;
  readonly priceOverrides: Readonly<Partial<Record<FoodKey, number>>>;
  readonly targets: { readonly calories: number; readonly protein: number };
  readonly isRestDay: boolean;
}

export interface MealPlan {
  readonly date: CalendarDay;
  readonly meals: readonly Meal[];
  readonly totalNutrition: NutritionTotals;
  readonly totalCost: Estimate<number>;
  readonly withinBudget: boolean;
  readonly varietyCount: number;
  readonly advisoryNotes: readonly string[];
  readonly profileHash: string;
  readonly distinctFoodCount: number;
}

// ---------------------------------------------------------------------------
// Portion scaling
// ---------------------------------------------------------------------------

/**
 * A single scalar that bends every portion in the day. Derived from how far the
 * calorie target is from the baseline plan, clamped so it never produces
 * absurd quantities.
 */
export function portionScale(input: {
  readonly targetCalories: number;
  readonly baseCalories: number;
  readonly weightKg: number;
}): number {
  if (input.baseCalories <= 0) return 1;
  const ratio = input.targetCalories / input.baseCalories;
  // ±18% is the honest range for food-based adjustment without medical guidance.
  const clamped = Math.max(0.82, Math.min(1.18, ratio));
  // Very light or very heavy users get a small extra adjustment.
  const weightAdjust = input.weightKg < 45 ? -0.04 : input.weightKg > 95 ? 0.04 : 0;
  return Math.round((clamped + weightAdjust) * 100) / 100;
}

function scaledGrams(base: Portion, scale: number, floor = 10): number {
  return Math.max(floor, Math.round((base.grams * scale) / 5) * 5);
}

function relabel(portion: Portion, grams: number): Portion {
  if (portion.unit === 'g' || portion.unit === 'ml') {
    return {
      grams,
      gramsLow: Math.max(5, Math.round(grams * 0.85)),
      gramsHigh: Math.round(grams * 1.15),
      label: `${grams} ${portion.unit}`,
      unit: portion.unit,
    };
  }
  const count = Math.max(1, Math.round(grams / portion.grams));
  const base = portion.label.replace(/^\d+\s+/, '');
  return {
    grams,
    gramsLow: Math.max(5, Math.round(grams * 0.85)),
    gramsHigh: Math.round(grams * 1.15),
    label: `${count} ${base}`,
    unit: portion.unit,
  };
}

// ---------------------------------------------------------------------------
// Ingredient construction
// ---------------------------------------------------------------------------

interface IngredientSpec {
  readonly key: FoodKey;
  readonly grams: number;
  /** Overrides the food name in the meal subtitle when phrasing matters. */
  readonly displayName?: string;
  readonly optional?: boolean;
  readonly prepNote?: string;
  readonly labelOverride?: string;
}

function buildIngredient(
  spec: IngredientSpec,
  overrides: Readonly<Partial<Record<FoodKey, number>>>,
  region: Profile['region'],
): MealIngredient | null {
  const food = getFood(spec.key);
  if (!food) return null;

  const cost = costOfPortion(spec.key, spec.grams, {
    multiplier: regionMultiplier(region),
    override: overrides[spec.key],
  });
  const base = food.defaultPortion;
  const portion =
    spec.labelOverride !== undefined
      ? { ...relabel(base, spec.grams), label: spec.labelOverride }
      : relabel(base, spec.grams);

  return {
    foodKey: spec.key,
    name: food.name,
    emoji: food.emoji,
    portion,
    nutrition: nutritionForGrams(spec.key, spec.grams),
    cost,
    prepNote: spec.prepNote,
    optional: spec.optional ?? false,
    allergenNote: food.allergens.length > 0 ? `contains ${food.allergens.join(', ')}` : undefined,
  };
}

/** Filter out anything the user cannot eat; returns null if the meal collapses. */
function safeIngredients(
  specs: readonly IngredientSpec[],
  filter: DietFilter,
  overrides: Readonly<Partial<Record<FoodKey, number>>>,
  region: Profile['region'],
): readonly MealIngredient[] {
  const out: MealIngredient[] = [];
  for (const spec of specs) {
    const food = getFood(spec.key);
    if (!food) continue;
    if (!isAllowed(food, filter)) continue;
    const ing = buildIngredient(spec, overrides, region);
    if (ing) out.push(ing);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Why-it-matters copy (mechanism, never a claim)
// ---------------------------------------------------------------------------

const WHY: Record<MealSlot, (highProtein: boolean) => string> = {
  breakfast: (hp) =>
    hp
      ? 'Protein at breakfast steadies your appetite for the rest of the morning, and the carbohydrate gives you energy to start. Boiled rather than fried keeps the fat low.'
      : 'Carbohydrate and some fibre at breakfast give you steady energy through the morning. Adding dal, chana or eggs raises the protein without much cost.',
  fruit: () =>
    'Fruit brings vitamin C, which helps your body absorb the iron in dal and leafy greens, plus fibre and water. One serving is plenty.',
  lunch: (hp) =>
    hp
      ? 'Dal or chana gives real protein and fibre, and it is among the cheapest ways to do that. Rice or roti supplies the carbohydrate, and vegetables add micronutrients most meals miss.'
      : 'Dal, rice or roti and a cooked vegetable make a complete, balanced and inexpensive meal. Adding curd adds calcium and probiotics.',
  snack: () =>
    'A small snack between meals keeps you from getting hungrier than is comfortable by dinner. Roasted chana or a spoon of peanuts give protein and healthy fat.',
  dinner: () =>
    'A lighter dinner than lunch suits most people, especially if you exercised earlier. Keep protein in it so you are not hungry before bed.',
};

function whyFor(slot: MealSlot, nutrition: NutritionTotals): string {
  const hp = proteinDensity(nutrition) >= 6;
  return WHY[slot](hp);
}

const PREP_SAFETY: Partial<Record<FoodKey, string>> = {
  egg: 'Boil until the white is fully set — about 8–10 minutes — or scramble it through.',
  chicken: 'Cook until there is no pink or translucent part left. Keep raw chicken separate.',
  fish: 'Cook through until it flakes easily and turns opaque.',
  curd: 'Add off the heat or serve separately so it stays sour and thick.',
  milk: 'Bring to a boil once if you are not sure it has been boiled.',
  potato: 'Boil or fry in a little oil. Do not eat it raw.',
  'mustard-oil': 'Measure a teaspoon or two rather than pouring free — a little is plenty.',
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function buildMealPlan(input: MealPlanInput): MealPlan {
  const { profile, diet, date } = input;
  const ctx: Ctx = {
    input,
    filter: dietFilter(diet),
    multiplier: regionMultiplier(profile.region),
    overrides: input.priceOverrides,
  };


  const meals: Meal[] = [];

  meals.push(buildBreakfast(ctx));
  meals.push(buildFruit(ctx));
  meals.push(buildLunch(ctx));
  meals.push(buildSnack(ctx));
  meals.push(buildDinner(ctx));

  const timed = separateWindows(sortBySlot(meals));

  const totalNutrition = sumNutrition(timed.map((m) => m.nutrition));
  const dayCost = totalCost(timed.map((m) => m.cost));
  const withinBudget = dayCost.value <= input.dailyBudget * 1.15;

  const advisoryNotes: string[] = [];
  if (!withinBudget) {
    advisoryNotes.push(
      `This plan came to about ${formatCost(dayCost)}, slightly over your ₹${input.dailyBudget} budget. The cheapest swap available is shown on each meal.`,
    );
  }

  const distinctFoods = new Set(timed.flatMap((m) => m.ingredients.map((i) => i.foodKey)));
  const distinctCategories = new Set(
    timed.flatMap((m) => m.ingredients.map((i) => getFood(i.foodKey)?.category)).filter(Boolean),
  );

  return {
    date,
    meals: timed,
    totalNutrition,
    totalCost: dayCost,
    withinBudget,
    varietyCount: distinctCategories.size,
    advisoryNotes,
    profileHash: profileHash(profile),
    distinctFoodCount: distinctFoods.size,
  };
}

/**
 * Two meals can be scheduled close together (lunch at 16:00, snack at 16:30),
 * which would put the user in two places at once and make the timeline lie.
 * Each window is clipped to the moment the next one starts, keeping a minimum
 * window so a meal never disappears entirely.
 */
const MIN_MEAL_WINDOW_MINUTES = 20;

function separateWindows(meals: readonly Meal[]): readonly Meal[] {
  const ordered = [...meals].sort((a, b) => a.startMinute - b.startMinute);
  const out: Meal[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const meal = ordered[i];
    if (!meal) continue;
    const next = ordered[i + 1];
    if (!next || meal.endMinute <= next.startMinute) {
      out.push(meal);
      continue;
    }
    const end = Math.max(meal.startMinute + MIN_MEAL_WINDOW_MINUTES, next.startMinute);
    out.push({ ...meal, endMinute: Math.min(end, 1439) });
  }

  return out;
}

function sortBySlot(meals: readonly Meal[]): readonly Meal[] {
  const order: Record<MealSlot, number> = { breakfast: 0, fruit: 1, lunch: 2, snack: 3, dinner: 4 };
  return [...meals].sort((a, b) => order[a.slot] - order[b.slot]);
}

// ---------------------------------------------------------------------------
// Individual meals
// ---------------------------------------------------------------------------

interface Ctx {
  readonly input: MealPlanInput;
  readonly filter: DietFilter;
  readonly multiplier: number;
  readonly overrides: Readonly<Partial<Record<FoodKey, number>>>;
}

function finishMeal(
  ctx: Ctx,
  params: {
    slot: MealSlot;
    id: string;
    title: string;
    subtitle: string;
    specs: readonly IngredientSpec[];
    prepSteps: readonly string[];
    prepMinutes: number;
    hydrationMl: number;
    tags: readonly string[];
    startMinute: MinuteOfDay;
    windowMinutes?: number;
    alternatives?: readonly MealAlternative[];
  },
): Meal {
  const { input } = ctx;
  const ingredients = safeIngredients(
    params.specs,
    ctx.filter,
    ctx.overrides,
    input.profile.region,
  );

  const nutrition = sumNutrition(ingredients.map((i) => i.nutrition));
  const cost = totalCost(ingredients.map((i) => i.cost));

  const start = clampMinute(params.startMinute);
  const end = clampMinute(start + (params.windowMinutes ?? MEAL_WINDOW_MINUTES[params.slot]));

  const foodKeys = ingredients.map((i) => i.foodKey);
  const safety = foodSafetyTopicsFor(foodKeys);
  const monsoon = seasonSafetyNote(input.season);

  const prepSteps = [
    ...params.prepSteps,
    ...safety.map((s) => `${s.title}: ${s.detail}`),
  ].slice(0, 7);

  return {
    id: params.id,
    slot: params.slot,
    date: input.date,
    startMinute: start,
    endMinute: end,
    title: params.title,
    subtitle: params.subtitle,
    ingredients,
    prepSteps: monsoon ? [monsoon, ...prepSteps].slice(0, 7) : prepSteps,
    prepMinutes: params.prepMinutes,
    nutrition,
    cost,
    whyItMatters: whyFor(params.slot, nutrition),
    alternatives: params.alternatives ?? buildAlternatives(ctx, foodKeys),
    hydrationMl: params.hydrationMl,
    tags: params.tags,
    foodSafetyNote: safety.length > 0 ? `${safety.length} food-safety note${safety.length > 1 ? 's' : ''} for this meal` : undefined,
  };
}

/**
 * A food the engine may put in a meal: passes the hard diet rules *and* is not
 * something the user said they would rather avoid. Dislikes are soft in the
 * sense that the plan still works without them, but if we have an alternative
 * we use it — being shown something you dislike every day is a bug, not a
 * preference.
 */
function usableFood(key: FoodKey, filter: DietFilter): Food | undefined {
  const food = getFood(key);
  if (!food) return undefined;
  if (!isAllowed(food, filter)) return undefined;
  if (filter.dislikes.has(key)) return undefined;
  return food;
}

function buildBreakfast(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'breakfast');
  const highProtein = input.profile.goal === 'build-muscle' || input.profile.goal === 'gain-weight';

  const canEat = (key: FoodKey): boolean => usableFood(key, ctx.filter) !== undefined;

  const local = new Set(regionProfile(input.profile.region).localProduce);
  const budgetTight = input.dailyBudget < 90;

  const specs: IngredientSpec[] = [];

  // Protein anchor — cheapest complete protein the diet permits.
  if (canEat('egg') && highProtein) {
    specs.push({
      key: 'egg',
      grams: Math.max(50, scaledGrams(getFood('egg')!.defaultPortion, scale, 50)),
      prepNote: PREP_SAFETY['egg'],
      labelOverride: `${Math.max(1, Math.round(scaledGrams(getFood('egg')!.defaultPortion, scale, 50) / 50))} ${Math.max(1, Math.round(scaledGrams(getFood('egg')!.defaultPortion, scale, 50) / 50)) === 1 ? 'egg' : 'eggs'} (boiled)`,
    });
  } else if (canEat('egg') && !budgetTight) {
    const eggs = Math.max(1, Math.round(scaledGrams(getFood('egg')!.defaultPortion, scale, 50) / 100));
    specs.push({
      key: 'egg',
      grams: eggs * 50,
      prepNote: PREP_SAFETY['egg'],
      labelOverride: `${eggs} ${eggs === 1 ? 'egg' : 'eggs'} (boiled)`,
    });
  }

  // Carbohydrate anchor — roti for most, upma/poha when breakfast is very early.
  const earlyBreakfast = input.profile.schedule.breakfastMinute < 8 * 60;
  if (earlyBreakfast && canEat('poha')) {
    specs.push({ key: 'poha', grams: scaledGrams(getFood('poha')!.defaultPortion, scale) });
  } else if (canEat('roti') && (canEat('atta') || canEat('maida'))) {
    const rotis = Math.max(1, Math.round((scaledGrams(getFood('roti')!.defaultPortion, scale) / 60) * 10) / 10);
    const count = Math.max(1, Math.round(rotis));
    specs.push({
      key: 'roti',
      grams: count * 60,
      prepNote: 'Whole wheat rotis cooked on a dry tawa or gas tawa with no oil.',
      labelOverride: `${count} ${count === 1 ? 'roti' : 'rotis'}`,
    });
  } else if (canEat('rice')) {
    specs.push({ key: 'rice', grams: scaledGrams(getFood('rice')!.defaultPortion, scale) });
  }

  // Vegetable or fruit to round it out.
  if (canEat('onion') && canEat('tomato') && !earlyBreakfast) {
    specs.push({
      key: 'tomato',
      grams: Math.max(40, Math.round(70 * scale)),
      optional: true,
      prepNote: 'Chopped alongside the eggs, or stirred into the dal.',
    });
  }

  const fruitKey = pickFruit(ctx, 'breakfast');
  if (fruitKey) {
    const fruit = getFood(fruitKey)!;
    specs.push({
      key: fruitKey,
      grams: scaledGrams(fruit.defaultPortion, scale, 60),
      optional: true,
      labelOverride: fruit.defaultPortion.label,
    });
  }

  const sattuOK = canEat('sattu') && input.dailyBudget < 80 && local.has('dal-mix');
  if (sattuOK) {
    specs.push({
      key: 'sattu',
      grams: scaledGrams(getFood('sattu')!.defaultPortion, scale, 30),
      optional: true,
      prepNote: 'Mix 40–50 g with 300 ml water, a pinch of salt and roasted cumin. Drink fresh.',
    });
  }

  const proteinCount = specs.filter((s) => ['egg', 'dal-mix', 'chana', 'soy-chunks', 'sattu', 'milk', 'curd'].includes(s.key)).length;

  return finishMeal(ctx, {
    slot: 'breakfast',
    id: `${input.date}:breakfast`,
    title: 'Breakfast',
    subtitle: describe(specs),
    specs,
    prepSteps: breakfastSteps(specs),
    prepMinutes: proteinCount > 1 ? 15 : 10,
    hydrationMl: 350,
    tags: highProtein ? ['high-protein', 'steady-start'] : ['steady-start'],
    startMinute: input.profile.schedule.breakfastMinute,
  });
}

function breakfastSteps(specs: readonly IngredientSpec[]): readonly string[] {
  const steps: string[] = [];
  if (specs.some((s) => s.key === 'egg')) {
    steps.push('Put the eggs in a pan of water, bring to a boil, then 8–10 minutes on low heat.');
    steps.push('Cool them under tap water for a minute, then peel and halve.');
  }
  if (specs.some((s) => s.key === 'roti')) {
    steps.push('Knead a small ball of atta with water, roll thin and cook on a dry tawa. No oil needed.');
  }
  if (specs.some((s) => s.key === 'poha')) {
    steps.push('Soak the poha for 5 minutes, drain, then add onion, a little oil and salt and stir for 4 minutes.');
  }
  if (specs.some((s) => s.key === 'rice')) {
    steps.push('Cook the rice as usual. Start it first so it is ready when you are.');
  }
  if (specs.some((s) => s.key === 'sattu')) {
    steps.push('Mix the sattu with 300 ml water, a pinch of salt and roasted cumin. Drink it fresh.');
  }
  if (specs.some((s) => s.key === 'sattu') === false && steps.length < 3) {
    steps.push('Eat the fruit with breakfast or keep it for your mid-morning break.');
  }
  steps.push('Start with the water glass before anything else.');
  return steps;
}

function buildFruit(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'fruit');
  const fruitKey = pickFruit(ctx, 'fruit') ?? 'banana';
  const fruit = getFood(fruitKey)!;

  const specs: IngredientSpec[] = [
    {
      key: fruitKey,
      grams: scaledGrams(fruit.defaultPortion, scale, 60),
      labelOverride: fruit.defaultPortion.label,
    },
  ];

  const inSeason = isInSeason(fruit, input.season);

  return finishMeal(ctx, {
    slot: 'fruit',
    id: `${input.date}:fruit`,
    title: 'Fruit break',
    subtitle: `${fruit.name} + water`,
    specs,
    prepSteps: [
      `Wash the ${fruit.name.toLowerCase()} well and cut it if you like.`,
      'Drink a glass of water alongside it.',
    ],
    prepMinutes: 3,
    hydrationMl: 400,
    tags: inSeason ? ['in-season', 'quick'] : ['quick'],
    startMinute: input.profile.schedule.fruitMinute,
    windowMinutes: 40,
    alternatives: buildSeasonalAlternatives(ctx, [fruitKey]),
  });
}

function buildLunch(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'lunch');
  const specs: IngredientSpec[] = [];

  const dalKey =
    cheapestAllowed(
      ['dal-mix', 'chana-dal', 'moong-dal', 'toor-dal'],
      { multiplier: regionMultiplier(input.profile.region), filter: ctx.filter, season: input.season, overrides: ctx.overrides },
    ) ?? 'dal-mix';
  const dal = getFood(dalKey)!;
  specs.push({
    key: dalKey,
    grams: scaledGrams(dal.defaultPortion, scale, 120),
    prepNote: 'Wash once, then cook with a little turmeric and salt. Use minimal oil.',
  });

  const wantsRice = input.profile.goal !== 'lose-fat' || input.dailyBudget < 120;
  if (wantsRice && usableFood('rice', ctx.filter)) {
    specs.push({
      key: 'rice',
      grams: scaledGrams(getFood('rice')!.defaultPortion, scale, 100),
      prepNote: 'Wash twice, then cook in the usual way.',
    });
  } else if (usableFood('roti', ctx.filter)) {
    const count = Math.max(1, Math.round((scaledGrams(getFood('roti')!.defaultPortion, scale) / 60)));
    specs.push({
      key: 'roti',
      grams: count * 60,
      labelOverride: `${count} ${count === 1 ? 'roti' : 'rotis'}`,
      prepNote: 'Cook on a dry tawa.',
    });
  }

  const vegKey = pickVegetable(ctx, 'lunch');
  if (vegKey) {
    const veg = getFood(vegKey)!;
    specs.push({
      key: vegKey,
      grams: scaledGrams(veg.defaultPortion, scale, 80),
      prepNote: 'Wash well, cut, and cook with a little oil, garlic or onion and salt. Add water and cover.',
    });
    if (usableFood('onion', ctx.filter)) {
      specs.push({ key: 'onion', grams: 50, optional: true, prepNote: 'Finely chopped for the tadka.' });
    }
    if (usableFood('tomato', ctx.filter)) {
      specs.push({ key: 'tomato', grams: 60, optional: true, prepNote: 'Chopped into the curry.' });
    }
    if (usableFood('mustard-oil', ctx.filter)) {
      specs.push({
        key: 'mustard-oil',
        grams: 10,
        optional: true,
        prepNote: PREP_SAFETY['mustard-oil'],
        labelOverride: '1 tbsp oil (total for the meal)',
      });
    }
  }

  if (usableFood('curd', ctx.filter) && input.dailyBudget >= 75) {
    specs.push({
      key: 'curd',
      grams: scaledGrams(getFood('curd')!.defaultPortion, scale, 80),
      prepNote: PREP_SAFETY['curd'],
    });
  }

  const steps = [
    `Wash the ${dal.name.toLowerCase()} once and start cooking it with water, a pinch of turmeric and salt.`,
    'Cook the rice in a separate pot.',
    'For the sabzi, heat 1 tbsp oil, add chopped onion, then the vegetables and a little water. Cover and cook for 6–8 minutes.',
    'Season with salt, and a spoon of oil at the end if you like.',
    'Eat the curd with the meal or just after it, not mixed into the hot dal.',
    'Drink water through the meal according to thirst.',
  ];

  return finishMeal(ctx, {
    slot: 'lunch',
    id: `${input.date}:lunch`,
    title: 'Lunch',
    subtitle: `${dal.name} + ${specs.some((s) => s.key === 'rice') ? 'rice' : 'rotis'} + seasonal sabzi${specs.some((s) => s.key === 'curd') ? ' + curd' : ''}`,
    specs,
    prepSteps: steps,
    prepMinutes: 30,
    hydrationMl: 500,
    tags: ['complete-meal', 'balanced'],
    startMinute: input.profile.schedule.lunchMinute,
    windowMinutes: 75,
  });
}

function buildSnack(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'snack');
  const specs: IngredientSpec[] = [];

  const wantsPeanut =
    usableFood('peanut', ctx.filter) && input.dailyBudget >= 70;
  const wantsChana =
    usableFood('chana-roasted', ctx.filter);

  if (wantsChana && input.dailyBudget < 140) {
    specs.push({
      key: 'chana-roasted',
      grams: scaledGrams(getFood('chana-roasted')!.defaultPortion, scale, 20),
      prepNote: 'Roast chana until it smells nutty. Keep a handful in a container so it is not a shop stop.',
    });
  } else if (wantsChana) {
    specs.push({ key: 'chana-roasted', grams: scaledGrams(getFood('chana-roasted')!.defaultPortion, scale, 20) });
  }

  if (wantsPeanut) {
    specs.push({
      key: 'peanut',
      grams: scaledGrams(getFood('peanut')!.defaultPortion, scale, 10),
      prepNote: 'Dry-roasted, or raw if you prefer. A small amount is enough.',
      optional: true,
    });
  }

  if (specs.length === 0) {
    // Absolute floor: fruit, or a piece of fruit plus curd.
    const fruitKey = pickFruit(ctx, 'snack') ?? 'banana';
    const fruit = getFood(fruitKey)!;
    specs.push({
      key: fruitKey,
      grams: scaledGrams(fruit.defaultPortion, scale, 60),
      labelOverride: fruit.defaultPortion.label,
    });
  }

  if (input.season === 'summer' && usableFood('buttermilk', ctx.filter)) {
    specs.push({
      key: 'buttermilk',
      grams: scaledGrams(getFood('buttermilk')!.defaultPortion, scale, 150),
      optional: true,
      prepNote: 'Add a pinch of salt, cumin and lemon.',
    });
  }

  const steps = specs.some((s) => s.key === 'chana-roasted')
    ? [
        'Keep roasted chana and peanuts in a small tin or jar near your desk so the snack is already there.',
        'Have a small handful — about a quarter cup — with water.',
      ]
    : [
        'Keep the fruit in a place you will actually see it.',
        'Eat it with a glass of water, sitting down, away from the screen.',
      ];

  return finishMeal(ctx, {
    slot: 'snack',
    id: `${input.date}:snack`,
    title: 'Snack',
    subtitle: describe(specs),
    specs,
    prepSteps: steps,
    prepMinutes: 2,
    hydrationMl: 300,
    tags: ['budget', 'no-cook'],
    startMinute: input.profile.schedule.snackMinute,
    windowMinutes: 45,
  });
}

function buildDinner(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'dinner') * 0.9;
  const specs: IngredientSpec[] = [];

  const proteinKey = pickDinnerProtein(ctx);
  const protein = getFood(proteinKey)!;
  specs.push({
    key: proteinKey,
    grams: scaledGrams(protein.defaultPortion, scale, 80),
    prepNote: proteinKey === 'egg' ? PREP_SAFETY['egg'] : 'Cook with minimal oil and salt.',
  });

  if (usableFood('roti', ctx.filter)) {
    const count = Math.max(1, Math.round(scaledGrams(getFood('roti')!.defaultPortion, scale) / 60));
    specs.push({
      key: 'roti',
      grams: count * 60,
      labelOverride: `${count} ${count === 1 ? 'roti' : 'rotis'}`,
      prepNote: 'Cook on a dry tawa. Two or three is usually enough at night.',
    });
  }

  const vegKey = pickVegetable(ctx, 'dinner');
  if (vegKey) {
    specs.push({
      key: vegKey,
      grams: scaledGrams(getFood(vegKey)!.defaultPortion, scale, 80),
      prepNote: 'Wash, cut and stir-fry or cook into a light sabzi. Anything left is fine for tomorrow.',
    });
  }

  if (usableFood('mustard-oil', ctx.filter)) {
    specs.push({
      key: 'mustard-oil',
      grams: 8,
      optional: true,
      labelOverride: '1 tsp oil',
      prepNote: PREP_SAFETY['mustard-oil'],
    });
  }

  if (usableFood('milk', ctx.filter) && input.dailyBudget >= 100) {
    specs.push({
      key: 'milk',
      grams: scaledGrams(getFood('milk')!.defaultPortion, scale, 150),
      optional: true,
      prepNote: 'Warm, not boiling. Drink before you finish eating, not straight after.',
    });
  }

  const steps: string[] = [];
  if (proteinKey === 'egg') {
    steps.push('Boil the eggs while you are making the rotis — it is the same 10 minutes either way.');
  } else if (proteinKey === 'soy-chunks') {
    steps.push('Soak the soy chunks for 10 minutes, then boil them for 5 minutes with salt. Drain well.');
  } else if (proteinKey === 'chana') {
    steps.push('Soak the chana overnight if you can, or use canned chana drained and rinsed.');
  } else if (proteinKey === 'chana-dal' || proteinKey === 'dal-mix' || proteinKey === 'moong-dal') {
    steps.push('Cook the dal with a little turmeric and salt. It should thicken in about 15 minutes.');
  } else if (proteinKey === 'paneer') {
    steps.push('Cut the paneer, fry lightly in 1 tsp oil until the edges firm, then add the vegetables.');
  } else if (proteinKey === 'chicken' || proteinKey === 'fish') {
    steps.push(PREP_SAFETY[proteinKey] ?? 'Cook all the way through.');
  } else {
    steps.push('Cook the dal or protein until it is soft and well mixed.');
  }
  steps.push('Make the rotis and dry-fry or lightly oil the vegetables in a separate pan.');
  steps.push('Eat slowly, sitting down. Stop when you are comfortable, not when the plate is empty.');
  steps.push('Finish at least an hour before bed if you can.');

  return finishMeal(ctx, {
    slot: 'dinner',
    id: `${input.date}:dinner`,
    title: 'Dinner',
    subtitle: describe(specs),
    specs,
    prepSteps: steps,
    prepMinutes: 25,
    hydrationMl: 400,
    tags: ['lighter-evening', 'balanced'],
    startMinute: input.profile.schedule.dinnerMinute,
    windowMinutes: 70,
  });
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

function scaleForSlot(ctx: Ctx, slot: MealSlot): number {
  const { input } = ctx;
  // Slot share of the day's energy, then a person-scale factor.
  const share: Record<MealSlot, number> = {
    breakfast: 0.24,
    fruit: 0.08,
    lunch: 0.34,
    snack: 0.12,
    dinner: 0.22,
  };
  const sizeFactor = Math.min(1.25, Math.max(0.75, input.profile.weightKg / 65));
  const goalFactor = goalPortionFactor(input.profile.goal, slot);
  return Math.round(share[slot] * sizeFactor * goalFactor * 100) / 100;
}

function goalPortionFactor(
  goal: Profile['goal'],
  slot: MealSlot,
): number {
  switch (goal) {
    case 'lose-fat':
      return slot === 'dinner' ? 0.8 : slot === 'breakfast' ? 0.95 : 1;
    case 'gain-weight':
      return slot === 'dinner' ? 1.2 : slot === 'snack' ? 1.35 : 1.1;
    case 'build-muscle':
      return slot === 'lunch' || slot === 'dinner' ? 1.15 : 1.1;
    case 'improve-energy':
      return slot === 'breakfast' ? 1.1 : 1;
    default:
      return 1;
  }
}

const FRUIT_POOL: readonly FoodKey[] = [
  'banana', 'guava', 'papaya', 'orange', 'sapodilla', 'pomelo',
  'watermelon', 'mango', 'pineapple', 'amla', 'jujube', 'apple', 'grapes', 'pomegranate',
];

const VEG_POOL: readonly FoodKey[] = [
  'bottle-gourd', 'gourd', 'pumpkin', 'potato', 'spinach', 'cabbage', 'cauliflower',
  'carrot', 'brinjal', 'beans', 'cucumber', 'onion', 'tomato', 'radish', 'beetroot', 'mushroom',
];

/**
 * Deterministic fruit pick: rotate by day so the user gets variety without the
 * engine "hard-coding" one fruit. Cheaper and more local candidates win.
 */
function pickFruit(ctx: Ctx, slot: MealSlot): FoodKey | null {
  const { input } = ctx;
  const dayIndex = dayIndexOf(input.date);
  const multiplier = regionMultiplier(input.profile.region);
  const local = new Set(regionProfile(input.profile.region).localProduce);
  const budgetTight = input.dailyBudget < 90;

  const scored = FRUIT_POOL.map((key, idx) => {
    const food = getFood(key);
    if (!food) return null;
    if (!isAllowed(food, ctx.filter)) return null;
    if (ctx.filter.dislikes.has(key)) return null;
    const seasonalBonus = isInSeason(food, input.season) ? 30 : -25;
    const localBonus = local.has(key) ? 20 : 0;
    const price = (food.price.typicalPrice * multiplier) / 1000; // per g, roughly
    const costPenalty = budgetTight ? price * 260 : price * 40;
    const excluded = EXPENSIVE_EXCLUSIONS.includes(key) ? -55 : 0;
    // Rotation bonus so the same fruit does not appear every single day.
    const rotation = (dayIndex * 7 + slotSeed(slot) + idx) % 5 === 0 ? 18 : 0;
    return { key, score: seasonalBonus + localBonus + rotation - costPenalty + excluded };
  }).filter((x): x is { key: FoodKey; score: number } => x !== null);

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored[0]?.key ?? null;
}

function pickVegetable(ctx: Ctx, slot: MealSlot): FoodKey | null {
  const { input } = ctx;
  const dayIndex = dayIndexOf(input.date);
  const multiplier = regionMultiplier(input.profile.region);
  const local = new Set(regionProfile(input.profile.region).localProduce);
  const budgetTight = input.dailyBudget < 100;

  const scored = VEG_POOL.map((key, idx) => {
    const food = getFood(key);
    if (!food) return null;
    if (!isAllowed(food, ctx.filter)) return null;
    if (ctx.filter.dislikes.has(key)) return null;
    const seasonalBonus = isInSeason(food, input.season) ? 30 : -22;
    const localBonus = local.has(key) ? 20 : 0;
    const price = food.price.typicalPrice * multiplier;
    const costPenalty = budgetTight ? price / 4 : price / 12;
    const excluded = EXPENSIVE_EXCLUSIONS.includes(key) ? -60 : 0;
    const rotation = (dayIndex * 5 + slotSeed(slot) * 3 + idx) % 4 === 0 ? 16 : 0;
    return { key, score: seasonalBonus + localBonus + rotation - costPenalty + excluded };
  }).filter((x): x is { key: FoodKey; score: number } => x !== null);

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored[0]?.key ?? null;
}

function pickDinnerProtein(ctx: Ctx): FoodKey {
  const { input } = ctx;
  const multiplier = regionMultiplier(input.profile.region);
  const can = (key: FoodKey): boolean => {
    const f = getFood(key);
    return !!f && isAllowed(f, ctx.filter) && isInSeason(f, input.season);
  };

  const options: FoodKey[] = [];
  if (can('dal-mix')) options.push('dal-mix');
  if (can('soy-chunks')) options.push('soy-chunks');
  if (can('chana')) options.push('chana');
  if (can('egg')) options.push('egg');
  if (can('paneer') && input.dailyBudget >= 150) options.push('paneer');
  if (can('chicken') && input.dailyBudget >= 200) options.push('chicken');
  if (can('fish') && input.dailyBudget >= 200) options.push('fish');

  const chosen = cheapestAllowed(options, {
    multiplier,
    filter: ctx.filter,
    season: input.season,
    overrides: ctx.overrides,
  });

  return chosen ?? 'dal-mix';
}

function slotSeed(slot: MealSlot): number {
  return { breakfast: 0, fruit: 1, lunch: 2, snack: 3, dinner: 4 }[slot];
}

/** Day-of-month hash for deterministic daily rotation. */
function dayIndexOf(date: CalendarDay): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.abs((y ?? 2026) * 372 + (m ?? 1) * 31 + (d ?? 1)) % 31;
}

// ---------------------------------------------------------------------------
// Alternatives & substitutions
// ---------------------------------------------------------------------------

function describe(specs: readonly IngredientSpec[]): string {
  return specs
    .filter((s) => !s.optional)
    .map((s) => s.displayName ?? getFood(s.key)?.name ?? s.key)
    .join(' + ');
}

function buildAlternatives(ctx: Ctx, foodKeys: readonly FoodKey[]): readonly MealAlternative[] {
  const out: MealAlternative[] = [];

  // Vegetarian: only meaningful when the meal actually contains non-veg.
  const nonVeg = foodKeys.filter((k) => {
    const f = getFood(k);
    return f && f.dietTag !== 'veg';
  });
  if (nonVeg.length > 0) {
    const swaps: FoodSwap[] = nonVeg
      .map((from) => {
        const to = bestVegetarianSwapFor(ctx, from);
        return to ? swapOf(ctx, from, to, 'no meat or egg needed') : null;
      })
      .filter((s): s is FoodSwap => s !== null);
    if (swaps.length > 0) {
      out.push({
        kind: 'vegetarian',
        label: 'Vegetarian version',
        swaps,
        note: 'Same meal, no meat or egg.',
      });
    }
  }

  // Budget: cheapest equivalent in each protein group.
  const budgetSwaps = buildBudgetSwaps(ctx, foodKeys);
  if (budgetSwaps.length > 0) {
    out.push({
      kind: 'budget',
      label: 'Cheaper version',
      swaps: budgetSwaps,
      note: 'Cuts the cost of this meal without losing the protein.',
    });
  }

  const seasonal = buildSeasonalAlternatives(ctx, foodKeys.filter((k) => {
    const f = getFood(k);
    return f?.category === 'fruit' || f?.category === 'vegetable';
  }));
  if (seasonal.length > 0) out.push(...seasonal);

  return out;
}

function bestVegetarianSwapFor(ctx: Ctx, from: FoodKey): FoodKey | null {
  const candidates: readonly FoodKey[] =
    from === 'egg'
      ? ['chana', 'dal-mix', 'soy-chunks', 'paneer', 'chana-dal']
      : from === 'chicken' || from === 'fish'
        ? ['dal-mix', 'soy-chunks', 'chana', 'egg']
        : [];
  return cheapestAllowed(candidates, {
    multiplier: regionMultiplier(ctx.input.profile.region),
    filter: ctx.filter,
    season: ctx.input.season,
    overrides: ctx.overrides,
  });
}

function buildBudgetSwaps(ctx: Ctx, foodKeys: readonly FoodKey[]): readonly FoodSwap[] {
  const multiplier = regionMultiplier(ctx.input.profile.region);
  const swaps: FoodSwap[] = [];

  for (const key of foodKeys) {
    const food = getFood(key);
    if (!food) continue;
    if (food.category !== 'protein' && food.category !== 'legume' && food.category !== 'egg-meat') continue;

    const cheaper = rankSubstitutes(key, {
      season: ctx.input.season,
      region: ctx.input.profile.region,
      priceMultiplier: multiplier,
      dietAllowed: allowedKeysOf(ctx.filter),
      category: food.category,
      maxPricePerKg: food.price.typicalPrice * multiplier,
    }).filter((c) => c.pricePerKg < food.price.typicalPrice * multiplier)[0];

    if (!cheaper) continue;
    swaps.push(
      swapOf(
        ctx,
        key,
        cheaper.key,
        cheaper.local ? 'cheaper and common in your area' : 'cheaper',
      ),
    );
  }

  return swaps.slice(0, 3);
}

function buildSeasonalAlternatives(ctx: Ctx, foodKeys: readonly FoodKey[]): readonly MealAlternative[] {
  if (foodKeys.length === 0) return [];
  const multiplier = regionMultiplier(ctx.input.profile.region);
  const allowed = allowedKeysOf(ctx.filter);

  const out: MealAlternative[] = [];
  for (const key of foodKeys.slice(0, 2)) {
    const food = getFood(key);
    if (!food) continue;
    const candidates = rankSubstitutes(key, {
      season: ctx.input.season,
      region: ctx.input.profile.region,
      priceMultiplier: multiplier,
      dietAllowed: allowed,
      category: food.category,
    }).slice(0, 3);

    if (candidates.length < 2) continue;
    out.push({
      kind: 'seasonal',
      label: 'What is available instead',
      swaps: candidates.map((c) => swapOf(ctx, key, c.key, c.reason)),
      note: 'If the shop does not have it today, these are close and usually cheaper.',
    });
    break;
  }
  return out;
}

function allowedKeysOf(filter: DietFilter): ReadonlySet<FoodKey> {
  return new Set(FOODS.filter((f) => isAllowed(f, filter)).map((f) => f.key));
}

function swapOf(ctx: Ctx, from: FoodKey, to: FoodKey, reason: string): FoodSwap {
  const fromFood = getFood(from);
  const toFood = getFood(to);
  const grams = fromFood?.defaultPortion.grams ?? 100;
  const multiplier = regionMultiplier(ctx.input.profile.region);

  const delta = fromFood && toFood
    ? costOfPortion(to, grams, { multiplier, override: ctx.overrides[to] }).value -
      costOfPortion(from, grams, { multiplier, override: ctx.overrides[from] }).value
    : 0;

  return {
    from,
    to,
    toName: toFood?.name ?? to,
    reason,
    costDelta: Math.round(delta),
  };
}

/** Allergen-safe alternative for a specific food. Used by the swap sheet. */
export function allergySafeAlternatives(
  input: MealPlanInput,
  from: FoodKey,
): readonly FoodSwap[] {
  const food = getFood(from);
  if (!food) return [];
  const declared = new Set<string>([from, ...food.allergens]);

  const allowed = FOODS.filter(
    (f) =>
      f.key !== from &&
      (f.seasons.includes('all-year') || f.seasons.includes(input.season)) &&
      !f.allergens.some((a) => declared.has(a)),
  );

  // Deliberately not restricted to the same category: the allergen-free option
  // for milk or wheat usually lives in a different family entirely, and an
  // empty swap sheet is worse than an unusual one.
  const ranked = rankSubstitutes(from, {
    season: input.season,
    region: input.profile.region,
    priceMultiplier: regionMultiplier(input.profile.region),
    dietAllowed: new Set(allowed.map((f) => f.key)),
  });

  return ranked.slice(0, 3).map((c) => {
    const grams = food.defaultPortion.grams;
    const delta =
      costOfPortion(c.key, grams, { multiplier: regionMultiplier(input.profile.region) }).value -
      costOfPortion(from, grams, { multiplier: regionMultiplier(input.profile.region) }).value;
    return {
      from,
      to: c.key,
      toName: c.name,
      reason: `does not contain ${[from, ...food.allergens].join(' or ')} — ${c.reason}`,
      costDelta: Math.round(delta),
    };
  });
}

// ---------------------------------------------------------------------------
// Skip resolution — never a dead end, always a food decision
// ---------------------------------------------------------------------------

export interface SkipInput {
  readonly plan: MealPlanInput;
  readonly slot: MealSlot;
  readonly filter?: DietFilter;
}

export interface SkipOption {
  readonly headline: string;
  readonly detail: string;
  readonly swaps: readonly FoodSwap[];
  readonly minutesToPrepare: number;
  readonly costDelta: number;
}

export function skipOptionsFor(slot: MealSlot, plan: MealPlanInput): readonly SkipOption[] {
  const multiplier = regionMultiplier(plan.profile.region);
  const filter = dietFilter(plan.diet);

  const proteinFor = (pool: readonly FoodKey[]): FoodKey | null =>
    cheapestAllowed(pool, {
      multiplier,
      filter,
      season: plan.season,
      overrides: plan.priceOverrides,
    });

  switch (slot) {
    case 'breakfast': {
      const out: SkipOption[] = [];
      const alt = proteinFor(['egg', 'chana', 'dal-mix', 'soy-chunks']);
      if (alt) {
        out.push({
          headline: alt === 'sattu' ? 'Sattu drink instead' : `Swap in ${getFood(alt)?.name}`,
          detail: `Replace the usual protein with ${getFood(alt)?.name?.toLowerCase()} — same meal, different protein.`,
          swaps: [{ from: 'egg', to: alt, toName: getFood(alt)?.name ?? alt, reason: 'closest available protein', costDelta: 0 }],
          minutesToPrepare: 8,
          costDelta: 0,
        });
      }
      if (isAllowed(getFood('sattu')!, filter)) {
        out.push({
          headline: 'Sattu drink',
          detail: '40–50 g sattu mixed with 300–400 ml water, a pinch of salt and roasted cumin. No cooking.',
          swaps: [],
          minutesToPrepare: 5,
          costDelta: 0,
        });
      }
      out.push({
        headline: 'Just fruit and a glass of milk',
        detail: 'Two bananas or a guava with a glass of milk. Perfectly fine as a lighter breakfast.',
        swaps: [],
        minutesToPrepare: 2,
        costDelta: -10,
      });
      return out;
    }
    case 'lunch':
    case 'dinner': {
      const out: SkipOption[] = [];
      const main = proteinFor(['dal-mix', 'chana-dal', 'moong-dal', 'chana', 'soy-chunks']);
      if (main) {
        out.push({
          headline: `${getFood(main)?.name} and rotis`,
          detail: 'Skip rice instead — two or three rotis with dal and whatever vegetables you have. You lose almost nothing.',
          swaps: [{ from: 'rice', to: 'roti' as FoodKey, toName: 'Rotis', reason: 'uses what is already in the kitchen', costDelta: -6 }],
          minutesToPrepare: 20,
          costDelta: -6,
        });
      }
      const vegOnly = proteinFor(['dal-mix', 'chana-dal', 'toor-dal']);
      if (vegOnly) {
        out.push({
          headline: `Only ${getFood(vegOnly)?.name} and vegetables`,
          detail: 'One bowl of dal with a cooked vegetable is a complete, filling meal on its own.',
          swaps: [],
          minutesToPrepare: 20,
          costDelta: -12,
        });
      }
      out.push({
        headline: 'Leftovers from an earlier meal',
        detail: 'Reheat yesterday\'s dal or sabzi with a roti. Cooking once and eating twice is the cheapest way to do this.',
        swaps: [],
        minutesToPrepare: 10,
        costDelta: -18,
      });
      return out;
    }
    case 'snack':
      return [
        {
          headline: 'Just water and a fruit',
          detail: 'A piece of fruit with water is a fine snack. Not every gap between meals needs food.',
          swaps: [],
          minutesToPrepare: 1,
          costDelta: -8,
        },
        {
          headline: 'A handful of roasted chana',
          detail: 'About 30 g. Keep a small tin at your desk so it is there when you do not feel like cooking.',
          swaps: [],
          minutesToPrepare: 0,
          costDelta: 0,
        },
      ];
    case 'fruit':
      return [
        {
          headline: 'Save it for later in the day',
          detail: 'Move this fruit to your evening snack instead of dropping it entirely.',
          swaps: [],
          minutesToPrepare: 0,
          costDelta: 0,
        },
        {
          headline: 'Skip it, no problem',
          detail: 'You will still get fruit at another point today. Hydration matters more here.',
          swaps: [],
          minutesToPrepare: 0,
          costDelta: 0,
        },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Profile hashing (snapshot invalidation)
// ---------------------------------------------------------------------------

export function profileHash(profile: Profile): string {
  const s = profile.schedule;
  const raw = [
    profile.weightKg, profile.heightCm, profile.age, profile.sex, profile.goal,
    profile.activityLevel, profile.region, profile.schedule.workPattern,
    s.wakeMinute, s.breakfastMinute, s.lunchMinute, s.dinnerMinute, s.sleepMinute,
    s.exerciseMinute, s.snackMinute, s.fruitMinute,
  ].join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Useful for tests and the food-picker UI. */
export const FOOD_DB_SIZE = FOODS.length;
