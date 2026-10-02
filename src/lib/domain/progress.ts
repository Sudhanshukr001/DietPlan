/**
 * Progress and weekly review.
 *
 * Framing decision: this is called "Daily Routine Progress", never a health or
 * fitness score. The disclaimer is a required field on the type, so no screen
 * can render a percentage without the framing beside it.
 *
 * Streak rule: a day counts if ≥40% of required events were completed. Streaks
 * never break on a partial day, and there is no failure language anywhere.
 */

import type {
  CalendarDay,
  DailyProgress,
  DomainProgress,
  FoodKey,
  HydrationTarget,
  Meal,
  MealSlot,
  NutritionTotals,
  ReviewSuggestion,
  SkipLog,
  SleepLog,
  WeeklyReview,
  Workout,
  WorkoutLog,
} from './types/index';
import { PROGRESS_DISCLAIMER } from './types/index';
import { getFood } from './data/foods';
import { round1 } from './data/foods';

export const SUCCESS_THRESHOLD = 0.4;
export const ROUTINE_DISCLAIMER = PROGRESS_DISCLAIMER;

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export interface DayLogs {
  readonly meals: readonly Meal[];
  readonly doneEventIds: ReadonlySet<string>;
  readonly hydrationMl: number;
  readonly hydrationTarget: HydrationTarget;
  readonly workout: Workout;
  readonly workoutLog: WorkoutLog | null;
  readonly sleepLog: SleepLog | null;
  readonly sleepPlanTargetHours: number;
  readonly streak: number;
  readonly advisorySuppressCalorieTargets: boolean;
}

export function dailyProgress(date: CalendarDay, logs: DayLogs): DailyProgress {
  const mealsTotal = logs.meals.length;
  const mealsDone = logs.meals.filter((m) => logs.doneEventIds.has(mealEventId(m))).length;

  const nutrition: DomainProgress = {
    value: mealsTotal > 0 ? mealsDone / mealsTotal : 0,
    earned: mealsDone,
    possible: mealsTotal,
    label: 'Meals',
    detail: mealsTotal === 0 ? 'No meals planned' : `${mealsDone} of ${mealsTotal} meals done`,
  };

  const hydPct =
    logs.hydrationTarget.targetMl > 0
      ? Math.min(1, logs.hydrationMl / logs.hydrationTarget.targetMl)
      : 0;
  const hydration: DomainProgress = {
    value: hydPct,
    earned: logs.hydrationMl,
    possible: logs.hydrationTarget.targetMl,
    label: 'Hydration',
    detail:
      logs.hydrationMl === 0
        ? 'Nothing logged yet'
        : `${formatLitres(logs.hydrationMl)} of ${formatLitres(logs.hydrationTarget.targetMl)}`,
  };

  const workoutTotal = logs.workout.blocks.length;
  const workoutDone = logs.workoutLog?.completedBlockIds.length ?? 0;
  const exercise: DomainProgress = {
    value: workoutTotal > 0 ? Math.min(1, workoutDone / workoutTotal) : 0,
    earned: workoutDone,
    possible: workoutTotal,
    label: 'Movement',
    detail: workoutDone === 0 ? 'Not started yet' : `${workoutDone} of ${workoutTotal} exercises`,
  };

  const sleepDetail = logs.sleepLog
    ? logs.sleepLog.windDownCompleted
      ? 'Wound down on time'
      : 'Logged'
    : 'Not recorded';
  const sleep: DomainProgress = {
    value: logs.sleepLog ? (logs.sleepLog.windDownCompleted ? 1 : 0.5) : 0,
    earned: logs.sleepLog?.windDownCompleted ? 1 : logs.sleepLog ? 0.5 : 0,
    possible: 1,
    label: 'Sleep routine',
    detail: sleepDetail,
  };

  // Weighted: meals matter most, sleep least. Nothing is a "health score".
  const overall = nutrition.value * 0.4 + hydration.value * 0.25 + exercise.value * 0.2 + sleep.value * 0.15;

  return {
    date,
    nutrition,
    hydration,
    exercise,
    sleep,
    mealsDone,
    mealsTotal,
    overall: Math.round(overall * 100) / 100,
    streak: logs.streak,
    disclaimer: ROUTINE_DISCLAIMER,
  };
}

export function mealEventId(meal: Meal): string {
  return `${meal.date}:meal:${meal.id}`;
}

function formatLitres(ml: number): string {
  return ml >= 1000 ? `${round1(ml / 1000)} L` : `${ml} ml`;
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakInput {
  /** completion fraction per day, oldest first. */
  readonly dailyFractions: readonly number[];
}

/**
 * Current streak counts backwards from the most recent day. Today being empty
 * does not break a streak — it just means today is not counted yet.
 */
export function currentStreak(input: StreakInput): number {
  const { dailyFractions } = input;
  let streak = 0;
  for (let i = dailyFractions.length - 1; i >= 0; i -= 1) {
    const f = dailyFractions[i];
    if (f === undefined) break;
    // A not-yet-started today is skipped rather than counted as a failure.
    if (f === 0 && i === dailyFractions.length - 1) continue;
    if (f >= SUCCESS_THRESHOLD) streak += 1;
    else break;
  }
  return streak;
}

export function longestStreak(input: StreakInput): number {
  let best = 0;
  let run = 0;
  for (const f of input.dailyFractions) {
    if (f >= SUCCESS_THRESHOLD) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export interface WeeklyInput {
  readonly weekStart: CalendarDay;
  readonly weekEnd: CalendarDay;
  readonly days: readonly {
    readonly date: CalendarDay;
    readonly meals: readonly Meal[];
    readonly doneEventIds: ReadonlySet<string>;
    readonly hydrationMl: number;
    readonly hydrationTarget: HydrationTarget;
    readonly workout: Workout;
    readonly workoutLog: WorkoutLog | null;
    readonly foodCost: number;
    readonly grocerySpend: number;
  }[];
  readonly sleepLogs: readonly SleepLog[];
  readonly skipLogs: readonly SkipLog[];
  readonly budget: number;
}

export function weeklyReview(input: WeeklyInput): WeeklyReview {
  const days = input.days;
  const daysTracked = days.length;

  let mealsDone = 0;
  let mealsTotal = 0;
  let exerciseSessions = 0;
  let costSum = 0;
  let grocerySum = 0;
  let hydrationHits = 0;
  const foodCounts = new Map<FoodKey, number>();
  const vegVariety = new Set<FoodKey>();
  const slotTotals = new Map<MealSlot, { done: number; total: number }>();

  for (const day of days) {
    for (const meal of day.meals) {
      mealsTotal += 1;
      const done = day.doneEventIds.has(mealEventId(meal));
      if (done) mealsDone += 1;
      const slot = slotTotals.get(meal.slot) ?? { done: 0, total: 0 };
      slot.total += 1;
      if (done) slot.done += 1;
      slotTotals.set(meal.slot, slot);

      if (done) {
        for (const ing of meal.ingredients) {
          foodCounts.set(ing.foodKey, (foodCounts.get(ing.foodKey) ?? 0) + 1);
          const food = getFood(ing.foodKey);
          if (food?.category === 'vegetable') vegVariety.add(ing.foodKey);
        }
      }
    }
    if ((day.workoutLog?.completedBlockIds.length ?? 0) > 0) exerciseSessions += 1;
    if (day.hydrationTarget.targetMl > 0 && day.hydrationMl >= day.hydrationTarget.targetMl * 0.7) {
      hydrationHits += 1;
    }
    costSum += day.foodCost;
    grocerySum += day.grocerySpend;
  }

  const skipBySlot = new Map<MealSlot, number>();
  for (const s of input.skipLogs) {
    skipBySlot.set(s.slot, (skipBySlot.get(s.slot) ?? 0) + 1);
  }

  let mostSkippedSlot: MealSlot | null = null;
  let mostSkips = 0;
  for (const [slot, count] of skipBySlot) {
    const scheduled = slotTotals.get(slot)?.total ?? 0;
    if (scheduled > 0 && count > mostSkips) {
      mostSkips = count;
      mostSkippedSlot = slot;
    }
  }

  const sleepLogs = input.sleepLogs;
  const sleepConsistency =
    sleepLogs.length > 0 ? sleepLogs.filter((l) => l.windDownCompleted).length / sleepLogs.length : 0;

  const avgCost = daysTracked > 0 ? Math.round((costSum / daysTracked) * 10) / 10 : 0;

  const topConsumedFoods = [...foodCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([key, count]) => ({ key, name: getFood(key)?.name ?? key, count }));

  const review: Omit<WeeklyReview, 'suggestions'> = {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    daysTracked,
    mealsCompleted: { done: mealsDone, total: mealsTotal },
    exerciseSessions,
    hydrationConsistency: daysTracked > 0 ? hydrationHits / daysTracked : 0,
    sleepConsistency,
    averageFoodCost: {
      value: avgCost,
      range: { low: Math.round(avgCost * 0.93 * 10) / 10, high: Math.round(avgCost * 1.07 * 10) / 10 },
      basis: 'derived',
      confidence: 'medium',
    },
    grocerySpend: {
      value: Math.round(grocerySum),
      range: { low: Math.round(grocerySum * 0.93), high: Math.round(grocerySum * 1.07) },
      basis: 'derived',
      confidence: 'low',
    },
    mostSkippedSlot,
    topConsumedFoods,
    vegetableVariety: vegVariety.size,
  };

  return { ...review, suggestions: buildSuggestions(review, input) };
}

/**
 * Maximum three suggestions, each one concrete and actionable. A review that
 * lists ten observations changes nothing.
 */
function buildSuggestions(
  review: Omit<WeeklyReview, 'suggestions'>,
  input: WeeklyInput,
): readonly ReviewSuggestion[] {
  const out: ReviewSuggestion[] = [];
  const slotLabel: Record<MealSlot, string> = {
    breakfast: 'breakfast',
    fruit: 'the fruit break',
    lunch: 'lunch',
    snack: 'the afternoon snack',
    dinner: 'dinner',
  };

  // 1. The skipped-meal pattern — most actionable of all.
  if (review.mostSkippedSlot) {
    const label = slotLabel[review.mostSkippedSlot];
    const reason = mostCommonSkipReason(input.skipLogs, review.mostSkippedSlot);
    const reasonText = reason ? skipReasonLabel(reason) : null;
    out.push({
      id: 'skip-pattern',
      topic: 'skips',
      headline: `${label[0]?.toUpperCase() ?? 'T'}${label.slice(1)} was the meal you skipped most this week`,
      detail: reasonText && reason
        ? `The most common reason was "${reasonText}". ${reasonAdvice(reason)}`
        : 'There is a simple swap available on that meal whenever it happens.',
      actionLabel: 'See that meal',
      actionRoute: '/meals',
    });
  }

  // 2. Vegetable variety — the most common nutrition gap in this budget range.
  if (review.vegetableVariety <= 2) {
    out.push({
      id: 'veg-variety',
      topic: 'variety',
      headline: 'Your vegetable variety was low this week',
      detail:
        'You ate ' +
        (review.vegetableVariety === 0 ? 'no vegetables across the week' : `only ${review.vegetableVariety} different vegetable${review.vegetableVariety === 1 ? '' : 's'}`) +
        '. Cooking a different seasonal vegetable each day costs barely more, because you are replacing rather than adding.',
      actionLabel: 'See seasonal picks',
      actionRoute: '/grocery',
    });
  }

  // 3. Cost.
  if (review.averageFoodCost.value > input.budget * 1.15) {
    out.push({
      id: 'cost-over',
      topic: 'cost',
      headline: `Average food cost was about ₹${review.averageFoodCost.value}/day`,
      detail: `That is above your ₹${input.budget} target. The biggest savings usually come from cooking dal at home more often and buying seasonal fruit rather than whatever is in season at a premium.`,
      actionLabel: 'Review budget',
      actionRoute: '/settings',
    });
  } else if (review.averageFoodCost.value > 0 && review.averageFoodCost.value < input.budget * 0.7) {
    out.push({
      id: 'cost-under',
      topic: 'cost',
      headline: `Average food cost was about ₹${review.averageFoodCost.value}/day — well under budget`,
      detail: `You have about ₹${Math.round(input.budget - review.averageFoodCost.value)} a day spare. A fruit, a little more dairy, or peanuts would all fit without changing anything else.`,
      actionLabel: 'Adjust plan',
      actionRoute: '/settings',
    });
  }

  // 4. A win, always — the review should not be only criticism.
  if (review.mealsCompleted.done >= 15) {
    out.push({
      id: 'win-meals',
      topic: 'wins',
      headline: `You completed ${review.mealsCompleted.done} meals in ${review.daysTracked} days`,
      detail: 'That is the hard part of this done consistently. Keep the same times rather than changing the food around it.',
    });
  }

  return out.slice(0, 3);
}

function mostCommonSkipReason(skips: readonly SkipLog[], slot: MealSlot): SkipReasonLabel | null {
  const counts = new Map<SkipReasonLabel, number>();
  for (const s of skips) {
    if (s.slot !== slot) continue;
    counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  }
  let best: SkipReasonLabel | null = null;
  let bestCount = 0;
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return best;
}

type SkipReasonLabel = SkipLog['reason'];

const SKIP_REASON_LABELS: Record<SkipReasonLabel, string> = {
  'not-hungry': 'not hungry',
  'no-time': 'no time',
  unavailable: 'food unavailable',
  disliked: 'did not like it',
  forgot: 'forgot',
  other: 'other',
};

const SKIP_REASON_ADVICE: Record<SkipReasonLabel, string> = {
  'not-hungry': 'Try the lighter version of that meal — it is built for exactly this.',
  'no-time': 'That meal has a 5-minute version. Preparing it the night before removes the problem entirely.',
  unavailable: 'The app will suggest a same-food-group substitute within budget whenever you skip for this reason.',
  disliked: 'You can mark a food as "never suggest again" so it stops appearing.',
  forgot: 'A reminder a little earlier in the morning tends to help more than a stronger one.',
  other: 'If there is a pattern you can see, it is worth writing a note to yourself about it.',
};

function reasonAdvice(reason: SkipReasonLabel): string {
  return SKIP_REASON_ADVICE[reason] ?? SKIP_REASON_ADVICE.other;
}

export function skipReasonLabel(reason: SkipReasonLabel): string {
  return SKIP_REASON_LABELS[reason] ?? reason;
}

// ---------------------------------------------------------------------------
// Nutrition comparison
// ---------------------------------------------------------------------------

export interface NutritionComparison {
  readonly eaten: NutritionTotals;
  readonly target: NutritionTotals;
  readonly percent: number;
  readonly proteinGap: number;
  readonly detail: string;
}

export function compareNutrition(
  meals: readonly Meal[],
  doneEventIds: ReadonlySet<string>,
  target: NutritionTotals,
): NutritionComparison {
  const eaten = meals
    .filter((m) => doneEventIds.has(mealEventId(m)))
    .reduce<NutritionTotals>(
      (acc, m) => ({
        calories: acc.calories + m.nutrition.calories,
        protein: round1(acc.protein + m.nutrition.protein),
        carbs: round1(acc.carbs + m.nutrition.carbs),
        fat: round1(acc.fat + m.nutrition.fat),
        fiber: round1(acc.fiber + m.nutrition.fiber),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    );

  const percent = target.calories > 0 ? eaten.calories / target.calories : 0;

  return {
    eaten,
    target,
    percent,
    proteinGap: round1(target.protein - eaten.protein),
    detail: percent < 0.6
      ? 'Only some meals are logged so far — this updates as you tick meals off.'
      : percent > 1.1
        ? 'You are a little over the estimate. One meal less heavy, or a shorter walk, is enough.'
        : 'This is in the range the plan was aiming for.',
  };
}
