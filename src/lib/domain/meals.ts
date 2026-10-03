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
  AvailabilityMap,
  CalendarDay,
  DailyFocus,
  DailyFocusItem,
  DayPreference,
  DietPreference,
  Estimate,
  Food,
  FoodFocusReason,
  FoodKey,
  FoodSwap,
  Meal,
  MealAlternative,
  MealHistoryEntry,
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
import {
  eggServingsFor,
  foodSignal,
  jitter,
  meatChoiceFor,
  meatServingsFor,
  PRODUCE_ROTATION_RULES,
  repetitionPenalty,
  shiftDay,
  weeklyQuota,
} from './rotation';

export interface MealPlanInput {
  readonly profile: Profile;
  readonly diet: DietPreference;
  readonly date: CalendarDay;
  readonly season: SeasonId;
  readonly pantry: readonly FoodKey[];
  readonly dailyBudget: number;
  readonly priceOverrides: Readonly<Partial<Record<FoodKey, number>>>;
  /**
   * Personal energy and protein targets from `dailyTargets()`. These DO reach the
   * portions — they are the difference between a plan that adapts to a 45 kg
   * sedentary person and one that hands everyone the same grams.
   */
  readonly targets: { readonly calories: number; readonly protein: number; readonly fiber?: number };
  readonly isRestDay: boolean;
  /** Recent days the user actually ate, used for the anti-repetition penalty. */
  readonly history?: readonly MealHistoryEntry[];
  /** Per-food user signals from "Available near me". */
  readonly availability?: AvailabilityMap;
  /** Today's explicit user overrides (pin, exclude, lock). */
  readonly dayPreference?: DayPreference;
}

export interface NutritionStatus {
  readonly targetCalories: number;
  readonly actualCalories: number;
  readonly calorieRatio: number;
  readonly targetProtein: number;
  readonly actualProtein: number;
  readonly proteinRatio: number;
  readonly fiberGrams: number;
  readonly targetFiber: number;
  /** Short, honest, non-clinical notes. Empty when the day is well balanced. */
  readonly notes: readonly string[];
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
  /** The vegetable and fruit to buy today, with the reasoning shown to the user. */
  readonly focus: DailyFocus;
  readonly nutrition: NutritionStatus;
  /** Multiplier applied to reach the user's calorie target. Surfaced for tests. */
  readonly energyScale: number;
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

/**
 * How much to multiply every default portion by to land on the user's energy
 * target.
 *
 * Wider band than `portionScale` because this is a *day-level* correction: a
 * 90 kg active man and a 45 kg sedentary woman have a legitimate ~1.8x gap in
 * energy needs, and pretending otherwise is the bug this replaces.
 */
export function energyScale(targetCalories: number, baseCalories: number): number {
  if (baseCalories <= 0) return 1;
  const ratio = targetCalories / baseCalories;
  return Math.round(Math.max(0.7, Math.min(1.5, ratio)) * 100) / 100;
}

/** Clamped here so a mis-typed target can never produce an absurd plate. */
const MAX_ENERGY_SCALE = 1.5;
const MIN_ENERGY_SCALE = 0.7;

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
  // Merge duplicate keys before building. Without this a scorer that picks sattu
  // as both the protein and the carbohydrate produced "sattu + sattu" on one
  // plate, which reads as a bug and double-counts against the budget.
  const merged = new Map<FoodKey, IngredientSpec>();
  for (const spec of specs) {
    const existing = merged.get(spec.key);
    if (existing) {
      merged.set(spec.key, {
        ...existing,
        grams: existing.grams + spec.grams,
        optional: existing.optional && (spec.optional ?? false),
      });
    } else {
      merged.set(spec.key, spec);
    }
  }

  const out: MealIngredient[] = [];
  for (const spec of merged.values()) {
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
  const { diet } = input;
  const filter = dietFilter(diet);

  // Pass 1 — build at neutral scale purely to measure what the database's own
  // default portions produce. Everything downstream is relative to this number,
  // which is what makes age, height, sex, activity and goal reach the plate.
  const baseline = assemble({ input, filter, energyScale: 1 });

  // Pass 2 — scale to the user's own energy target.
  // History is what rotation runs on. On a user's very first day there is none,
  // and a rotation engine with no memory just returns the same answer every day —
  // which is the exact bug this replaces. So when there is no real history we
  // synthesise it by planning the preceding few days and reading back what they
  // would have been. Deterministic, so a plan regenerated mid-day is unchanged.
  let scale = energyScale(input.targets.calories, baseline.totalNutrition.calories);

  const history = input.history && input.history.length > 0 ? input.history : synthesizeHistory(input, filter, scale);
  const contextual: MealPlanInput = { ...input, history };

  let plan = assemble({ input: contextual, filter, energyScale: scale });

  // Pass 3 — calibrate. One correction is not enough: portions are rounded to whole
  // rotis and whole eggs and clamped by sensible floors, so the response to a scale
  // change is not linear. Iterate a few times and keep whatever sits closest to
  // the user's own target.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = energyScale(input.targets.calories, plan.totalNutrition.calories);
    if (Math.abs(next - scale) < 0.015) break;
    const candidate = assemble({ input: contextual, filter, energyScale: next });
    const improved =
      Math.abs(candidate.totalNutrition.calories - input.targets.calories) <
      Math.abs(plan.totalNutrition.calories - input.targets.calories);
    if (!improved) break;
    scale = next;
    plan = candidate;
  }

  // Pass 4 — protein top-up. Variety alone will not hit a protein target; if the
  // day is short, add a real protein source, so the fix is nutritional rather than
  // cosmetic.
  if (plan.totalNutrition.protein < input.targets.protein * 0.92) {
    const boosted = assemble({ input: contextual, filter, energyScale: scale, proteinTopUp: true });
    if (boosted.totalNutrition.protein > plan.totalNutrition.protein) {
      // Re-calibrate against the larger plan rather than accepting the overshoot.
      const corrected = energyScale(input.targets.calories * 0.99, boosted.totalNutrition.calories);
      const reconciled = assemble({
        input: contextual,
        filter,
        energyScale: corrected,
        proteinTopUp: true,
      });
      const boostedCloser =
        Math.abs(reconciled.totalNutrition.calories - input.targets.calories) <
        Math.abs(boosted.totalNutrition.calories - input.targets.calories);
      plan = boostedCloser && reconciled.totalNutrition.protein >= plan.totalNutrition.protein
        ? reconciled
        : boosted;
    }
  }

  plan = withFocusAndNutrition(plan, contextual);
  return plan;
}

/** How many prior days to replay when there is no stored history yet. */
const HISTORY_BOOTSTRAP_DAYS = 5;

function synthesizeHistory(
  input: MealPlanInput,
  filter: DietFilter,
  scale: number,
): readonly MealHistoryEntry[] {
  let accumulated: MealHistoryEntry[] = [];

  // Oldest first, so each day sees the ones before it — the same ordering a real
  // history arrives in.
  for (let back = HISTORY_BOOTSTRAP_DAYS; back >= 1; back -= 1) {
    const date = shiftDay(input.date, -back);
    const dayPlan = assemble({
      input: { ...input, date, history: accumulated },
      filter,
      energyScale: scale,
    });
    const meals: Record<string, readonly FoodKey[]> = {};
    for (const meal of dayPlan.meals) meals[meal.id] = meal.ingredients.map((i) => i.foodKey);
    accumulated = [{ date, meals }, ...accumulated];
  }

  return accumulated;
}

function assemble(params: {
  readonly input: MealPlanInput;
  readonly filter: DietFilter;
  readonly energyScale: number;
  readonly proteinTopUp?: boolean;
}): MealPlan {
  const { input } = params;
  const ctx: Ctx = {
    input,
    filter: params.filter,
    multiplier: regionMultiplier(input.profile.region),
    region: regionProfile(input.profile.region),
    overrides: input.priceOverrides,
    history: input.history ?? [],
    availability: input.availability ?? {},
    pantry: new Set(input.pantry),
    dayPreference: input.dayPreference,
    energyScale: params.energyScale,
    proteinTopUp: params.proteinTopUp ?? false,
    usedToday: new Set(),
  };

  // Built one at a time so each meal can see what the earlier ones already chose.
  const usedToday = ctx.usedToday;
  const meals: Meal[] = [];
  for (const build of [buildBreakfast, buildFruit, buildLunch, buildSnack, buildDinner]) {
    const meal = build(ctx);
    meals.push(meal);
    for (const ingredient of meal.ingredients) {
      // Rice is the default carbohydrate, not a variety signal. Counting it would
      // lock every other grain out of the day.
      if (ingredient.foodKey !== 'rice') usedToday.add(ingredient.foodKey);
    }
  }

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
    date: input.date,
    meals: timed,
    totalNutrition,
    totalCost: dayCost,
    withinBudget,
    varietyCount: distinctCategories.size,
    advisoryNotes,
    profileHash: profileHash(input.profile, input.diet),
    distinctFoodCount: distinctFoods.size,
    focus: { vegetable: null, fruit: null },
    nutrition: {
      targetCalories: input.targets.calories,
      actualCalories: Math.round(totalNutrition.calories),
      calorieRatio: 1,
      targetProtein: input.targets.protein,
      actualProtein: Math.round(totalNutrition.protein),
      proteinRatio: 1,
      fiberGrams: Math.round(totalNutrition.fiber),
      targetFiber: input.targets.fiber ?? 25,
      notes: [],
    },
    energyScale: params.energyScale,
  };
}

// ---------------------------------------------------------------------------
// Nutrition balance + "what should I buy today"
// ---------------------------------------------------------------------------

function withFocusAndNutrition(plan: MealPlan, input: MealPlanInput): MealPlan {
  const notes: string[] = [];

  const calorieRatio = plan.totalNutrition.calories / Math.max(1, input.targets.calories);
  const proteinRatio = plan.totalNutrition.protein / Math.max(1, input.targets.protein);

  if (calorieRatio < 0.8) {
    notes.push(
      `This plan lands at about ${Math.round(plan.totalNutrition.calories)} kcal against an estimate of ${input.targets.calories}. Add an extra roti or a glass of milk if you are hungry — that closes the gap without a new meal.`,
    );
  } else if (calorieRatio > 1.2) {
    notes.push(
      `This plan comes to about ${Math.round(plan.totalNutrition.calories)} kcal, a little over your estimate of ${input.targets.calories}. Drop the oil and you are back in range.`,
    );
  }

  if (proteinRatio < 0.85) {
    notes.push(
      `Protein is the one thing this plan cannot fully cover — about ${Math.round(plan.totalNutrition.protein)} g against an estimate of ${input.targets.protein} g. A boiled egg, a cup of curd or a handful of chana closes it.`,
    );
  }

  const targetFiber = input.targets.fiber ?? 25;
  if (plan.totalNutrition.fiber < targetFiber * 0.7) {
    notes.push(
      'Fibre is light today. A guava, papaya or a bowl of salad with lunch fixes it.',
    );
  }

  const multiplier = regionMultiplier(input.profile.region);
  const allowed = allowedKeysOf(dietFilter(input.diet));

  const focus: DailyFocus = {
    vegetable: focusItem(plan, input, multiplier, allowed, 'vegetable'),
    fruit: focusItem(plan, input, multiplier, allowed, 'fruit'),
  };

  return {
    ...plan,
    focus,
    nutrition: {
      targetCalories: input.targets.calories,
      actualCalories: Math.round(plan.totalNutrition.calories),
      calorieRatio: Math.round(calorieRatio * 100) / 100,
      targetProtein: input.targets.protein,
      actualProtein: Math.round(plan.totalNutrition.protein),
      proteinRatio: Math.round(proteinRatio * 100) / 100,
      fiberGrams: Math.round(plan.totalNutrition.fiber),
      targetFiber,
      notes,
    },
  };
}

/**
 * Builds the "today's vegetable / fruit" answer directly from the finished plan,
 * so it can never disagree with what the meals actually say.
 */
function focusItem(
  plan: MealPlan,
  input: MealPlanInput,
  multiplier: number,
  allowed: ReadonlySet<FoodKey>,
  kind: 'vegetable' | 'fruit',
): DailyFocusItem | null {
  const gramsByKey = new Map<FoodKey, number>();
  const slotsByKey = new Map<FoodKey, MealSlot[]>();

  for (const meal of plan.meals) {
    for (const ing of meal.ingredients) {
      if (getFood(ing.foodKey)?.category !== kind) continue;
      if (ing.optional) continue;
      gramsByKey.set(ing.foodKey, (gramsByKey.get(ing.foodKey) ?? 0) + ing.portion.grams);
      const slots = slotsByKey.get(ing.foodKey) ?? [];
      if (!slots.includes(meal.slot)) slots.push(meal.slot);
      slotsByKey.set(ing.foodKey, slots);
    }
  }
  // Nothing required: fall back to the optional serving so the user still has a
  // concrete "buy this" answer rather than a shrug.
  if (gramsByKey.size === 0) {
    for (const meal of plan.meals) {
      for (const ing of meal.ingredients) {
        if (getFood(ing.foodKey)?.category !== kind) continue;
        gramsByKey.set(ing.foodKey, (gramsByKey.get(ing.foodKey) ?? 0) + ing.portion.grams);
        const slots = slotsByKey.get(ing.foodKey) ?? [];
        if (!slots.includes(meal.slot)) slots.push(meal.slot);
        slotsByKey.set(ing.foodKey, slots);
      }
    }
  }

  let best: FoodKey | null = null;
  let bestGrams = 0;
  for (const [key, grams] of gramsByKey) {
    if (grams > bestGrams) {
      best = key;
      bestGrams = grams;
    }
  }
  if (!best) return null;

  const food = getFood(best);
  if (!food) return null;

  const inSeason = isInSeason(food, input.season);
  const local = regionProfile(input.profile.region).localProduce.includes(best);

  const why = focusWhy(food, kind, { inSeason, local, budget: input.dailyBudget, multiplier });

  const alternativeFoods = rankSubstitutes(best, {
    season: input.season,
    region: input.profile.region,
    priceMultiplier: multiplier,
    dietAllowed: allowed,
    category: food.category,
  }).slice(0, 3);

  return {
    kind,
    foodKey: best,
    name: food.name,
    localNames: food.localNames,
    emoji: food.emoji,
    grams: Math.round(bestGrams / 5) * 5,
    buyLabel: focusBuyLabel(best, Math.round(bestGrams / 5) * 5, input.dailyBudget),
    estimatedCost: costOfPortion(best, bestGrams, {
      multiplier,
      override: input.priceOverrides[best],
    }),
    usedIn: slotsByKey.get(best) ?? [],
    why,
    alternatives: alternativeFoods.map((c) => ({
      label: c.name,
      detail: c.reason,
    })),
    inSeason,
  };
}

/**
 * The explanation is derived from the food's own stored micronutrient data and
 * the real season/region signals — nothing here is invented per food.
 */
function focusWhy(
  food: Food,
  kind: 'vegetable' | 'fruit',
  ctx: { readonly inSeason: boolean; readonly local: boolean; readonly budget: number; readonly multiplier: number },
): FoodFocusReason {
  const nutrient = food.nutrition.keyMicronutrients[0];
  const detailParts: string[] = [];

  if (nutrient) {
    detailParts.push(`${nutrient.name} ${nutrient.benefit}.`);
  }
  detailParts.push(
    `${Math.round(food.nutrition.fiber)} g of fibre per 100 g.`,
  );

  let label: string;
  if (ctx.inSeason && ctx.local) {
    label = 'In season near you';
  } else if (ctx.inSeason) {
    label = 'In season';
  } else if (ctx.local) {
    label = 'Commonly available near you';
  } else {
    label = 'Worth buying today';
  }

  if (kind === 'vegetable' && ctx.budget < 100) {
    detailParts.push('One of the cheaper vegetables, which is why it suits a tight budget.');
  }

  return { label, detail: detailParts.join(' ') };
}

function focusBuyLabel(key: FoodKey, grams: number, budget: number): string {
  const food = getFood(key);
  if (!food) return `${grams} g`;
  if (food.price.unitGrams > 0 && grams >= food.price.unitGrams) {
    return `1 kg`;
  }
  if (grams < 200 && budget < 120) return `${grams} g (a small bunch)`;
  return `${grams} g`;
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
  readonly history: readonly MealHistoryEntry[];
  readonly availability: AvailabilityMap;
  readonly pantry: ReadonlySet<FoodKey>;
  readonly dayPreference: DayPreference | undefined;
  /** Resolved once per build rather than once per candidate. */
  readonly region: ReturnType<typeof regionProfile>;
  readonly energyScale: number;
  readonly proteinTopUp: boolean;
  /**
   * Foods already chosen for an earlier meal *today*. Two sattu in one day, or the
   * same vegetable at lunch and dinner, reads as a broken plan to a human even
   * when every individual choice was scored correctly.
   */
  readonly usedToday: Set<FoodKey>;
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
  const goal = input.profile.goal;
  const highProtein = goal === 'build-muscle' || goal === 'gain-weight';
  const canEat = (key: FoodKey): boolean => usableFood(key, ctx.filter) !== undefined;

  const earlyBreakfast = input.profile.schedule.breakfastMinute < 8 * 60;
  const specs: IngredientSpec[] = [];
  let proteinSource: FoodKey | null = null;

  // --- Protein anchor ------------------------------------------------------
  // Eggs only when the weekly pattern says so. This is the change that stops the
  // engine handing an egg-vegetarian two eggs every single morning.
  const eggs = eggsAllowedToday(ctx);
  if (eggs > 0) {
    const perEgg = 50;
    const grams = Math.max(50, Math.round((eggs * perEgg * scale) / 5) * 5);
    const count = countOf(grams, perEgg);
    proteinSource = 'egg';
    specs.push({
      key: 'egg',
      grams: count * perEgg,
      prepNote: PREP_SAFETY['egg'],
      labelOverride: `${count} ${count === 1 ? 'egg' : 'eggs'} (boiled)`,
    });
  } else {
    // No eggs today. A vegetarian used to get *nothing* here — roti, a tomato and
    // a piece of fruit is not a breakfast with protein in it.
    const vegProtein = highProtein ? pickProtein(ctx, 'breakfast', VEG_BREAKFAST_PROTEIN) : pickBreakfastProtein(ctx);
    if (vegProtein) {
      proteinSource = vegProtein;
      const food = getFood(vegProtein)!;
      const floor = vegProtein === 'milk' ? 150 : vegProtein === 'curd' ? 100 : vegProtein === 'sattu' ? 40 : 60;
      const grams = scaledGrams(food.defaultPortion, scale, floor);
      specs.push({
        key: vegProtein,
        grams,
        prepNote: PROTEIN_PREP[vegProtein] ?? 'Mix or cook it with minimal oil and salt.',
        ...(food.defaultPortion.unit === 'piece'
          ? { labelOverride: food.defaultPortion.label }
          : {}),
      });
    }
  }

  // --- Carbohydrate anchor -------------------------------------------------
  // Pick the carbohydrate after the protein so the two roles cannot land on the
  // same food — "sattu" chosen as both merged into a single confusing line.
  const carb = pickCarbAnchor(ctx, 'breakfast', proteinSource ? new Set([proteinSource]) : undefined);
  if (carb) {
    const food = getFood(carb)!;
    if (carb === 'roti') {
      const grams = countOf(scaledGrams(food.defaultPortion, scale, 60), 60) * 60;
      specs.push({
        key: 'roti',
        grams,
        prepNote: 'Whole wheat rotis cooked on a dry tawa or gas tawa with no oil.',
        labelOverride: `${Math.round(grams / 60)} ${Math.round(grams / 60) === 1 ? 'roti' : 'rotis'}`,
      });
    } else if (carb === 'rice' || carb === 'dal-rice-combo') {
      specs.push({ key: carb, grams: scaledGrams(food.defaultPortion, scale, 150) });
    } else {
      specs.push({ key: carb, grams: scaledGrams(food.defaultPortion, scale, 40) });
    }
  }

  // --- Vegetable to round it out ------------------------------------------
  if (canEat('onion') && canEat('tomato') && !earlyBreakfast) {
    specs.push({
      key: 'tomato',
      grams: Math.max(40, Math.round(70 * scale)),
      optional: true,
      prepNote: 'Chopped alongside, or stirred into the dal.',
    });
  }

  // --- Fruit ---------------------------------------------------------------
  // Only when breakfast is early enough that there is no mid-morning break, and
  // then it is the *same* fruit the fruit slot uses — so this never turns into a
  // second fruit to buy, and never puts two different fruits in one meal.
  const fruitSlotKey = pickFruit(ctx, 'fruit');
  if (fruitSlotKey && earlyBreakfast) {
    const fruit = getFood(fruitSlotKey)!;
    specs.push({
      key: fruitSlotKey,
      grams: scaledGrams(fruit.defaultPortion, scale, 60),
      optional: true,
      labelOverride: fruit.defaultPortion.label,
    });
  }

  // Sattu is the no-cook answer when there is no time or no protein budget.
  const sattuOK = canEat('sattu') && input.dailyBudget < 80 && regionProfile(input.profile.region).localProduce.includes('dal-mix');
  if (sattuOK && proteinSource === null) {
    specs.push({
      key: 'sattu',
      grams: scaledGrams(getFood('sattu')!.defaultPortion, scale, 30),
      prepNote: 'Mix 40–50 g with 300 ml water, a pinch of salt and roasted cumin. Drink fresh.',
    });
  }

  const highProteinCount = specs.filter((s) => PROTEIN_KEYS.has(s.key)).length;

  return finishMeal(ctx, {
    slot: 'breakfast',
    id: `${input.date}:breakfast`,
    title: 'Breakfast',
    subtitle: describe(specs),
    specs,
    prepSteps: breakfastSteps(specs),
    prepMinutes: highProteinCount > 1 ? 15 : 10,
    hydrationMl: 350,
    tags: highProtein ? ['high-protein', 'steady-start'] : ['steady-start'],
    startMinute: input.profile.schedule.breakfastMinute,
  });
}

const PROTEIN_KEYS: ReadonlySet<FoodKey> = new Set([
  'egg', 'dal-mix', 'chana-dal', 'moong-dal', 'toor-dal', 'chana', 'rajma', 'soy-chunks',
  'sprouts', 'besan', 'sattu', 'sattu-drink', 'milk', 'curd', 'paneer', 'peanut', 'chicken', 'fish',
]);

const PROTEIN_PREP: Partial<Record<FoodKey, string>> = {
  milk: 'Warm, not boiling. Boil once if you are unsure it has been boiled.',
  curd: PREP_SAFETY['curd'],
  paneer: 'Cut and fry lightly in a teaspoon of oil, or add straight to hot rice and dal.',
  peanut: 'Dry-roasted, or raw if you prefer. A small amount is enough.',
  sattu: 'Mix 40–50 g with 300 ml water, a pinch of salt and roasted cumin. Drink fresh.',
  'sattu-drink': 'Mix with water and a pinch of salt. No cooking.',
  chana: 'Soaked overnight if possible, or use the canned version drained and rinsed.',
  'soy-chunks': 'Soak 10 minutes, then boil 5 minutes with salt and drain.',
  sprouts: 'Wash well and eat raw, or toss with onion and salt for a minute.',
  besan: 'Mix with water and a pinch of salt into a thin drink, or use as a coating.',
  'chana-dal': 'Wash once, then cook with a little turmeric and salt.',
  'moong-dal': 'Wash and cook with turmeric and salt until soft.',
  'toor-dal': 'Wash, then cook with turmeric and salt until it thickens.',
  'dal-mix': 'Wash once, then cook with a little turmeric and salt.',
  chicken: PREP_SAFETY['chicken'],
  fish: PREP_SAFETY['fish'],
};

function breakfastSteps(specs: readonly IngredientSpec[]): readonly string[] {
  const steps: string[] = [];
  if (specs.some((s) => s.key === 'egg')) {
    steps.push('Put the eggs in a pan of water, bring to a boil, then 8–10 minutes on low heat.');
    steps.push('Cool them under tap water for a minute, then peel and halve.');
  }
  if (specs.some((s) => s.key === 'poha')) {
    steps.push('Soak the poha for 5 minutes, drain, then add onion, a little oil and salt and stir for 4 minutes.');
  }
  if (specs.some((s) => s.key === 'ragi')) {
    steps.push('Mix the ragi with water and a little salt or milk, leave for 2 minutes, and eat with fruit.');
  }
  if (specs.some((s) => s.key === 'roti')) {
    steps.push('Knead a small ball of atta with water, roll thin and cook on a dry tawa. No oil needed.');
  }
  if (specs.some((s) => s.key === 'rice' || s.key === 'dal-rice-combo')) {
    steps.push('Cook the rice as usual. Start it first so it is ready when you are.');
  }
  if (specs.some((s) => s.key === 'sattu' || s.key === 'sattu-drink')) {
    steps.push('Mix with 300 ml water, a pinch of salt and roasted cumin. Drink it fresh.');
  }
  if (specs.some((s) => s.key === 'dal-mix' || s.key === 'chana-dal' || s.key === 'moong-dal')) {
    steps.push('Start the dal first — it needs the longest. Wash, add water, a pinch of turmeric and salt.');
  }
  if (specs.some((s) => s.key === 'sprouts' || s.key === 'chana')) {
    steps.push('Rinse well, drain, and toss with a pinch of salt and chopped onion.');
  }
  if (steps.length === 0) {
    steps.push('Eat what you have, and add a glass of milk or curd alongside for protein.');
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

  // Dal: the staple protein. Rotated by the scorer, not hard-coded, so a week is
  // not seven identical bowls.
  const dalKey = pickProtein(ctx, 'lunch', ['dal-mix', 'chana-dal', 'moong-dal', 'toor-dal']) ?? 'dal-mix';
  const dal = getFood(dalKey)!;
  specs.push({
    key: dalKey,
    grams: scaledGrams(dal.defaultPortion, scale, 120),
    prepNote: PROTEIN_PREP[dalKey] ?? 'Wash once, then cook with a little turmeric and salt. Use minimal oil.',
  });

  const wantsRice = input.profile.goal !== 'lose-fat' || input.dailyBudget < 120;
  if (wantsRice && usableFood('rice', ctx.filter)) {
    specs.push({
      key: 'rice',
      grams: scaledGrams(getFood('rice')!.defaultPortion, scale, 100),
      prepNote: 'Wash twice, then cook in the usual way.',
    });
  } else if (usableFood('roti', ctx.filter)) {
    const count = countOf(scaledGrams(getFood('roti')!.defaultPortion, scale, 60), 60);
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

  const riceInSpecs = specs.some((s) => s.key === 'rice');
  const steps = [
    `Wash the ${dal.name.toLowerCase()} once and start cooking it with water, a pinch of turmeric and salt.`,
    riceInSpecs ? 'Cook the rice in a separate pot.' : 'Make the rotis while the dal cooks.',
    'For the sabzi, heat 1 tbsp oil, add chopped onion, then the vegetables and a little water. Cover and cook for 6–8 minutes.',
    'Season with salt, and a spoon of oil at the end if you like.',
    'Eat the curd with the meal or just after it, not mixed into the hot dal.',
    'Drink water through the meal according to thirst.',
  ];

  return finishMeal(ctx, {
    slot: 'lunch',
    id: `${input.date}:lunch`,
    title: 'Lunch',
    subtitle: `${dal.name} + ${riceInSpecs ? 'rice' : 'rotis'} + seasonal sabzi${specs.some((s) => s.key === 'curd') ? ' + curd' : ''}`,
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

  // Rotated rather than fixed: chana one day, nuts the next, fruit the next.
  const snackPool: FoodKey[] = ['chana-roasted', 'peanut', 'sesame-seed', 'amla', 'sprouts'];
  const snackKey = pickProtein(ctx, 'snack', snackPool);

  if (snackKey) {
    const floor = snackKey === 'sesame-seed' ? 10 : snackKey === 'amla' ? 20 : 20;
    specs.push({
      key: snackKey,
      grams: scaledGrams(getFood(snackKey)!.defaultPortion, scale, floor),
      prepNote: SNACK_PREP[snackKey],
    });
    // A second, cheap, high-protein partner where the budget allows.
    if (snackKey !== 'peanut' && usableFood('peanut', ctx.filter) && input.dailyBudget >= 70) {
      specs.push({
        key: 'peanut',
        grams: scaledGrams(getFood('peanut')!.defaultPortion, scale, 10),
        prepNote: 'Dry-roasted, or raw if you prefer. A small amount is enough.',
        optional: true,
      });
    }
  }

  if (specs.length === 0) {
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

  const steps = specs.some((s) => s.key === 'chana-roasted' || s.key === 'peanut' || s.key === 'sesame-seed')
    ? [
        'Keep it in a small tin or jar near your desk so the snack is already there.',
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

const SNACK_PREP: Partial<Record<FoodKey, string>> = {
  'chana-roasted': 'Roast chana until it smells nutty. Keep a handful in a container so it is not a shop stop.',
  peanut: 'Dry-roasted, or raw if you prefer. A small amount is enough.',
  'sesame-seed': 'A teaspoon is enough. Sprinkle over the fruit or eat it alongside.',
  amla: 'Chew slowly after a meal — it is sharp on an empty stomach.',
  sprouts: 'Rinse well and eat with a pinch of salt.',
};

function buildDinner(ctx: Ctx): Meal {
  const { input } = ctx;
  const scale = scaleForSlot(ctx, 'dinner') * 0.92;
  const specs: IngredientSpec[] = [];

  const proteinKey = pickDinnerProtein(ctx);
  const protein = getFood(proteinKey)!;
  specs.push({
    key: proteinKey,
    grams: scaledGrams(protein.defaultPortion, scale, 80),
    prepNote: PROTEIN_PREP[proteinKey] ?? 'Cook with minimal oil and salt.',
  });

  if (usableFood('roti', ctx.filter)) {
    const count = countOf(scaledGrams(getFood('roti')!.defaultPortion, scale, 60), 60);
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

  // Protein top-up pass: when the day is short on protein, add a genuine protein
  // source rather than shaving oil, which does nothing for the target.
  if (ctx.proteinTopUp) {
    const booster = pickProtein(ctx, 'dinner', ['curd', 'milk', 'soy-chunks', 'chana', 'sprouts', 'paneer', 'dal-mix']);
    if (booster && booster !== proteinKey && !specs.some((s) => s.key === booster)) {
      const food = getFood(booster)!;
      specs.push({
        key: booster,
        grams: scaledGrams(food.defaultPortion, scale, booster === 'milk' ? 200 : 80),
        prepNote: PROTEIN_PREP[booster] ?? 'Add it to the meal rather than cooking it separately.',
      });
    }
  }

  const steps: string[] = [];
  steps.push(PROTEIN_PREP[proteinKey] ?? 'Cook the protein until it is soft and well mixed.');
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
// Candidate scoring
//
// ONE scorer for every food choice in the day. The original engine had four
// near-duplicate pickers with four different weightings, which is why season kept
// beating rotation and every day came back identical. Centralising it is the fix.
//
// Scale note: `repetitionPenalty` can reach -55, while the best seasonal reward is
// +24. Rotation is therefore *able* to outrank seasonality — the property that was
// missing before — while still losing to a genuine allergen veto, which is a hard
// filter and never a score.
// ---------------------------------------------------------------------------

export interface ScoredFood {
  readonly key: FoodKey;
  readonly food: Food;
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Season reward. `all-year` is a mild positive so staples are not punished. */
function seasonScore(food: Food, season: SeasonId): number {
  if (food.seasons.includes('all-year')) return 6;
  return food.seasons.includes(season) ? 24 : -18;
}

/** Penalty proportional to price, scaled by how tight the budget is. */
function priceScore(food: Food, ctx: Ctx): number {
  const budget = ctx.input.dailyBudget;
  // ₹/kg is the number that matters to a shopper, so that is what is compared
  // against the ceiling — not a per-gram figure nobody thinks in.
  const rupeesPerKg = food.price.typicalPrice * ctx.multiplier;
  const ceiling = budget < 90 ? 45 : budget < 140 ? 70 : budget < 220 ? 110 : 999;
  const excess = Math.max(0, rupeesPerKg - ceiling) / ceiling;
  return -Math.min(30, excess * 26);
}

function scoreFood(food: Food, slot: MealSlot, ctx: Ctx): ScoredFood | null {
  const { input, filter } = ctx;
  const key = food.key;

  // Hard rules. No score can bring these back.
  if (!isAllowed(food, filter)) return null;
  if (filter.dislikes.has(key)) return null;
  if (input.dayPreference?.excluded.includes(key)) return null;
  if (NEVER_AUTOBUY.includes(key)) {
    // Grapes, pomegranate, apple, mango, mushroom and coffee are never bought on
    // the user's behalf, at any budget. A ₹400 daily budget is not consent to buy
    // an ₹800/kg fruit every day. They stay selectable only when the user has
    // explicitly marked them available, or pinned them to this meal.
    const signal = ctx.availability[key];
    const explicit = signal !== undefined && signal.availability !== 'unavailable';
    const pinnedHere = ctx.dayPreference?.pinned[slot] === key;
    if (!explicit && !pinnedHere) return null;
  }
  if (food.key !== 'rice' && EXPENSIVE_EXCLUSIONS.includes(key) && input.dailyBudget < 130) {
    // Paneer and similar sit out on a tight budget, but stay selectable if the
    // user has told us they are available and affordable.
    if (foodSignal(key, ctx.availability).score < 0) return null;
  }

  const reasons: string[] = [];
  let score = 0;

  const season = seasonScore(food, input.season);
  score += season;
  if (season >= 24) reasons.push('in season');

  // `regionProfile` is a linear search over REGIONS. Calling it per candidate meant
  // doing it a few hundred times per meal, so it is resolved once per build.
  if (ctx.region.localProduce.includes(key)) {
    score += 18;
    reasons.push('common near you');
  }

  score += priceScore(food, ctx);
  if (score < 0 && priceScore(food, ctx) < -12) reasons.push('keeps the day affordable');

  // User signals from "Available near me" and the favourite control.
  const signal = foodSignal(key, ctx.availability);
  score += signal.score;
  if (signal.reason) reasons.push(signal.reason);

  // Already in the kitchen: use it, and do not put it on the shopping list.
  if (ctx.pantry.has(key)) {
    score += 22;
    reasons.push('you already have this');
  }

  // Protein density matters for protein slots and barely for fruit. Capped
  // deliberately low: soy at 26 g/100g was winning every protein slot outright
  // and a week of soy is not a varied plan.
  score += Math.min(9, food.nutrition.protein * 0.7);

  // The anti-repetition term. Produce is judged across the whole day rather than
  // per slot: "beans again" is what a reader of the week notices, not "beans at
  // lunch again", so it gets the stricter ruleset too.
  const isProduce = food.category === 'vegetable' || food.category === 'fruit';
  const repeat = repetitionPenalty(
    key,
    isProduce ? '*' : slot,
    input.date,
    ctx.history,
    isProduce ? PRODUCE_ROTATION_RULES : undefined,
  );
  score -= repeat;
  if (repeat >= 50) reasons.push('you had this yesterday');
  else if (repeat >= 20) reasons.push('you had this a couple of days ago');

  score += jitter(input.date, slot, key);

  return { key, food, score: Math.round(score * 10) / 10, reasons };
}

/** Ranks a pool and returns the best legal candidate. */
function bestOf(
  ctx: Ctx,
  slot: MealSlot,
  pool: readonly FoodKey[],
  exclude?: ReadonlySet<FoodKey>,
): ScoredFood | null {
  const scored: ScoredFood[] = [];
  for (const key of pool) {
    if (exclude?.has(key)) continue;
    const food = getFood(key);
    if (!food) continue;
    const s = scoreFood(food, slot, ctx);
    if (s) scored.push(s);
  }
  if (scored.length === 0) {
    // Everything was excluded. Relax rather than serve nothing: the caller asks
    // again with no exclusions, and only pays for a duplicate if the pool itself
    // is a single food.
    if (exclude && exclude.size > 0) return bestOf(ctx, slot, pool);
    return null;
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored[0] ?? null;
}

/** Top N candidates, for substitution sheets and "available instead" lists. */
function rankPool(ctx: Ctx, slot: MealSlot, pool: readonly FoodKey[], limit: number): readonly ScoredFood[] {
  const scored: ScoredFood[] = [];
  for (const key of pool) {
    const food = getFood(key);
    if (!food) continue;
    const s = scoreFood(food, slot, ctx);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Portion scaling driven by the user's own targets
// ---------------------------------------------------------------------------

/**
 * The one multiplier that bends every gram in the day.
 *
 * `ctx.energyScale` comes from measuring a baseline pass against the user's
 * calorie target, so this is where age, height, sex, activity level and goal
 * finally reach the plate. `goalPortionFactor` then redistributes between meals —
 * a deficit plan pushes energy to breakfast, a muscle plan to lunch and dinner.
 */
function scaleForSlot(ctx: Ctx, slot: MealSlot): number {
  const factor = goalPortionFactor(ctx.input.profile.goal, slot);
  const scale = clampScale(ctx.energyScale * factor);
  return Math.round(scale * 100) / 100;
}

function clampScale(scale: number): number {
  return Math.max(MIN_ENERGY_SCALE * 0.85, Math.min(MAX_ENERGY_SCALE, scale));
}

function goalPortionFactor(
  goal: Profile['goal'],
  slot: MealSlot,
): number {
  switch (goal) {
    case 'lose-fat':
      return slot === 'dinner' ? 0.82 : slot === 'breakfast' ? 1.05 : 1;
    case 'gain-weight':
      return slot === 'dinner' ? 1.18 : slot === 'snack' ? 1.3 : 1.1;
    case 'build-muscle':
      return slot === 'lunch' || slot === 'dinner' ? 1.14 : 1.08;
    case 'improve-energy':
      return slot === 'breakfast' ? 1.12 : 1;
    case 'improve-fitness':
      return slot === 'breakfast' ? 1.06 : slot === 'snack' ? 1.1 : 1;
    default:
      return 1;
  }
}

/** Rounds to the nearest whole roti / egg rather than a gram-level guess. */
function countOf(grams: number, perUnit: number): number {
  return Math.max(1, Math.round(grams / perUnit));
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** Priced for everyday budgets; `localProduce` in `seasonal.ts` adds regional bias. */
const FRUIT_POOL: readonly FoodKey[] = [
  'banana', 'guava', 'papaya', 'orange', 'sapodilla', 'pomelo',
  'watermelon', 'mango', 'pineapple', 'amla', 'jujube', 'apple', 'grapes', 'pomegranate',
];

const VEG_POOL: readonly FoodKey[] = [
  'bottle-gourd', 'gourd', 'pumpkin', 'potato', 'spinach', 'cabbage', 'cauliflower',
  'carrot', 'brinjal', 'beans', 'cucumber', 'onion', 'tomato', 'radish', 'beetroot',
  'mushroom', 'peas', 'methi', 'bathua', 'bhindi',
];

/**
 * Vegetarian breakfast proteins — the fix for a veg plan with no protein anchor.
 *
 * Nuts are deliberately absent: peanut wins any protein-per-rupee ranking, but
 * "peanut and roti" is not a breakfast. Ranking alone is not enough; the pool has
 * to contain only foods that make sense at 8am.
 */
const VEG_BREAKFAST_PROTEIN: readonly FoodKey[] = [
  'dal-mix', 'chana-dal', 'moong-dal', 'sprouts', 'besan', 'sattu', 'milk', 'curd', 'paneer',
];

/**
 * Dinner proteins, cheapest complete first. Scored, not taken in order.
 *
 * `egg` is here because a boiled egg with dinner is a real meal, but it is only
 * ever added to the pool when today's egg pattern allows eggs at all — otherwise
 * dinner quietly eats the quota and the breakfast pattern means nothing.
 */
const DINNER_PROTEIN: readonly FoodKey[] = [
  'dal-mix', 'chana-dal', 'moong-dal', 'toor-dal', 'chana', 'soy-chunks', 'rajma',
  'sprouts', 'egg', 'curd', 'milk', 'paneer', 'sattu',
];

/**
 * Foods the engine must never buy on the user's behalf.
 *
 * `EXPENSIVE_EXCLUSIONS` in the budget module is a budget-pressure rule — these
 * sit out when money is tight. These are different: they are prestige items that
 * should not appear in an auto-generated plan at *any* budget, because the failure
 * mode is not "too expensive", it is "the app decided a pomegranate was important".
 * They return only when the user marks them available or pins them to a meal.
 */
const NEVER_AUTOBUY: readonly FoodKey[] = [
  'grapes',
  'pomegranate',
  'apple',
  'mango',
  'mushroom',
  'coffee',
];

/**
 * Carbohydrate anchors, per slot.
 *
 * Split by slot on purpose. A single shared pool let rice win breakfast (it is
 * the local staple, so it collects a regional bonus) and the result read as
 * "peanut and rice for breakfast" — a correct answer to the wrong question.
 */
const CARB_BREAKFAST: readonly FoodKey[] = ['roti', 'poha', 'ragi', 'sattu'];
const CARB_MAIN: readonly FoodKey[] = ['rice', 'roti', 'dal-rice-combo'];

// ---------------------------------------------------------------------------
// Slot pickers
// ---------------------------------------------------------------------------

/**
 * The vegetable for a slot.
 *
 * The previous version rewarded season with +30 and "variety" with +16 from a
 * hash of the date, so the same in-season vegetable returned every day for weeks.
 * Now the repetition penalty is the largest single term, so the vegetable genuinely
 * moves through the week.
 */
function pickVegetable(ctx: Ctx, slot: MealSlot): FoodKey | null {
  return bestOf(ctx, slot, VEG_POOL, ctx.usedToday)?.key ?? null;
}

function pickFruit(ctx: Ctx, slot: MealSlot): FoodKey | null {
  const best = bestOf(ctx, slot, FRUIT_POOL);
  if (!best) return null;
  // Respect an explicit pin.
  const pinned = ctx.dayPreference?.pinned[slot];
  if (pinned && getFood(pinned)?.category === 'fruit') return pinned;
  return best.key;
}

/**
 * The protein anchor for a slot.
 *
 * Weekly quota first, then scoring. Quota is what stops "two eggs every morning"
 * and "chicken every evening"; scoring then picks the actual food.
 */
function pickProtein(
  ctx: Ctx,
  slot: MealSlot,
  pool: readonly FoodKey[],
  exclude?: ReadonlySet<FoodKey>,
): FoodKey | null {
  const pinned = ctx.dayPreference?.pinned[slot];
  if (pinned) return pinned;
  const avoid = new Set<FoodKey>(ctx.usedToday);
  for (const key of exclude ?? []) avoid.add(key);
  return bestOf(ctx, slot, pool, avoid)?.key ?? null;
}

function pickCarbAnchor(ctx: Ctx, slot: MealSlot, exclude?: ReadonlySet<FoodKey>): FoodKey | null {
  return pickProtein(ctx, slot, slot === 'breakfast' ? CARB_BREAKFAST : CARB_MAIN, exclude);
}

/**
 * Dinner protein with the weekly non-veg quota applied.
 *
 * At ₹100–150/day this returns dal, soy or chana — which is the honest answer,
 * because chicken at ₹190/kg twice a week would blow the budget. At ₹260+ the
 * user gets three non-veg servings a week, alternating chicken and fish, never on
 * consecutive days.
 */
function pickDinnerProtein(ctx: Ctx): FoodKey {
  const { input } = ctx;
  // Eggs only join the dinner pool on a day whose egg pattern allows them, so
  // dinner cannot quietly spend the week's egg quota.
  const pool = eggsAllowedToday(ctx) > 0 ? DINNER_PROTEIN : DINNER_PROTEIN.filter((k) => k !== 'egg');
  const allowsNonVeg = weeklyQuota('chicken', (k) => {
    const f = getFood(k);
    return !!f && isAllowed(f, ctx.filter);
  }, input.dailyBudget);

  if (allowsNonVeg && allowsNonVeg.perWeek > 0 && meatServingsFor(input.date) > 0) {
    const choice = meatChoiceFor(input.date, ['chicken', 'fish']);
    const food = choice ? getFood(choice) : null;
    if (choice && food && isAllowed(food, ctx.filter) && !ctx.filter.dislikes.has(choice)) {
      return choice;
    }
  }

  return pickProtein(ctx, 'dinner', pool) ?? 'dal-mix';
}

/**
 * How many eggs the plan is allowed today.
 *
 * Reads straight off the weekly pattern (Mon 2, Tue 0, Wed 2, Thu 1, Fri 0, Sat 1,
 * Sun 0) rather than a fixed daily amount. Returns 0 for diets that forbid eggs.
 */
function eggsAllowedToday(ctx: Ctx): number {
  const food = getFood('egg');
  if (!food || !isAllowed(food, ctx.filter)) return 0;
  if (ctx.filter.dislikes.has('egg')) return 0;
  const pinned = ctx.dayPreference?.pinned.breakfast;
  if (pinned === 'egg') return Math.max(1, eggServingsFor(ctx.input.date));
  return eggServingsFor(ctx.input.date);
}

/**
 * A vegetarian's breakfast protein, for a day the egg pattern gives no eggs.
 *
 * Paneer is deliberately deprioritised rather than forbidden: it is the highest
 * scoring option in the pool on price-per-gram-of-protein alone, so without this
 * it wins every single morning and the daily cost quietly climbs.
 */
function pickBreakfastProtein(ctx: Ctx): FoodKey | null {
  const scored = rankPool(ctx, 'breakfast', VEG_BREAKFAST_PROTEIN, 6);
  const pick = scored[0];
  if (!pick) return null;
  // Paneer is a breakfast luxury; do not spend it here when curd or dal will do.
  if (pick.key === 'paneer' && ctx.input.dailyBudget < 180) {
    return scored.find((s) => s.key === 'curd' || s.key === 'dal-mix' || s.key === 'chana-dal')?.key ?? null;
  }
  return pick.key;
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

/**
 * Identity of the inputs that produced a plan.
 *
 * The diet is folded in deliberately: a vegetarian and an egg-vegetarian with the
 * same body and schedule must not share a hash, or a stored day would be treated
 * as still valid after someone switches diet — and the plan would never update.
 * Everything here changes portions or food choice; nothing purely cosmetic does,
 * so cosmetic edits do not needlessly invalidate a day.
 */
export function profileHash(profile: Profile, diet?: DietPreference): string {
  const s = profile.schedule;
  const raw = [
    profile.weightKg, profile.heightCm, profile.age, profile.sex, profile.goal,
    profile.activityLevel, profile.region, profile.schedule.workPattern,
    s.wakeMinute, s.breakfastMinute, s.lunchMinute, s.dinnerMinute, s.sleepMinute,
    s.exerciseMinute, s.snackMinute, s.fruitMinute,
    diet?.dietType ?? '',
    [...(diet?.allergies ?? [])].sort().join(','),
    [...(diet?.dislikes ?? [])].sort().join(','),
    [...(diet?.neverAgain ?? [])].sort().join(','),
  ].join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Useful for tests and the food-picker UI. */
export const FOOD_DB_SIZE = FOODS.length;
