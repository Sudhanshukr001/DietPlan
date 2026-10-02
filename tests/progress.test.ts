import { describe, expect, it } from 'vitest';
import {
  ROUTINE_DISCLAIMER,
  SUCCESS_THRESHOLD,
  compareNutrition,
  currentStreak,
  dailyProgress,
  longestStreak,
  mealEventId,
  skipReasonLabel,
  weeklyReview,
  type DayLogs,
  type WeeklyInput,
} from '@/lib/domain/progress';
import { findBannedClaims } from '@/lib/domain/safety';
import { buildMealPlan } from '@/lib/domain/meals';
import { hydrationTarget } from '@/lib/domain/hydration';
import { buildWorkout, focusForDate } from '@/lib/domain/fitness';
import type { Meal } from '@/lib/domain/types/index';
import { DATE, makeDiet, makeProfile } from './fixtures';

const profile = makeProfile();

const plan = buildMealPlan({
  profile,
  diet: makeDiet(),
  date: DATE,
  season: 'winter',
  pantry: [],
  dailyBudget: 150,
  priceOverrides: {},
  targets: { calories: 1800, protein: 60 },
  isRestDay: false,
});

const workout = buildWorkout({
  profile,
  date: DATE,
  level: 'beginner',
  focus: focusForDate(DATE, 'beginner'),
  isRestDay: false,
});

const hydTarget = hydrationTarget({
  weightKg: 58,
  activityLevel: 'light',
  exerciseMinutes: 30,
  weather: 'mild',
  fluidRestrictionCaution: false,
  isRestDay: false,
});

function logs(over: Partial<DayLogs> = {}): DayLogs {
  return {
    meals: plan.meals,
    doneEventIds: new Set(),
    hydrationMl: 0,
    hydrationTarget: hydTarget,
    workout,
    workoutLog: null,
    sleepLog: null,
    sleepPlanTargetHours: 8,
    streak: 0,
    advisorySuppressCalorieTargets: false,
    ...over,
  };
}

function mealIds(): string[] {
  return plan.meals.map((m) => mealEventId(m));
}

describe('daily progress', () => {
  it('starts at zero and requires the disclaimer by type', () => {
    const p = dailyProgress(DATE, logs());
    expect(p.overall).toBe(0);
    expect(p.disclaimer).toBe(ROUTINE_DISCLAIMER);
    expect(ROUTINE_DISCLAIMER.toLowerCase()).toMatch(/not|general/i);
  });

  it('scores meals as the largest component', () => {
    const [b, f, l] = mealIds();
    const all = new Set(mealIds());
    const mealsOnly = dailyProgress(DATE, logs({ doneEventIds: all }));
    const mealsHalf = dailyProgress(
      DATE,
      logs({ doneEventIds: new Set([b, f, l].filter(Boolean) as string[]) }),
    );
    expect(mealsOnly.overall).toBeGreaterThan(mealsHalf.overall);
    expect(mealsOnly.nutrition.value).toBeCloseTo(1, 5);
    expect(mealsHalf.nutrition.earned).toBe(3);
    expect(mealsHalf.mealsTotal).toBe(5);
  });

  it('caps hydration at 100% however much is logged', () => {
    const p = dailyProgress(DATE, logs({ hydrationMl: 99_999 }));
    expect(p.hydration.value).toBe(1);
  });

  it('counts exercise from completed blocks', () => {
    const p = dailyProgress(
      DATE,
      logs({
        workoutLog: {
          id: 'w1',
          date: DATE,
          workoutId: workout.id,
          completedBlockIds: workout.blocks.slice(0, 1).map((b) => b.id),
          completedAt: '2026-01-14T13:10:00.000Z',
          minutes: 10,
        },
      }),
    );
    expect(p.exercise.earned).toBe(1);
    expect(p.exercise.possible).toBe(workout.blocks.length);
    expect(p.exercise.value).toBeGreaterThan(0);
    expect(p.exercise.value).toBeLessThan(1);
  });

  it('gives partial credit for logging sleep at all', () => {
    const p = dailyProgress(
      DATE,
      logs({
        sleepLog: {
          id: 's1',
          date: DATE,
          bedtimeActual: 1400,
          wakeMinute: 420,
          windDownCompleted: false,
          screensOff: false,
        },
      }),
    );
    expect(p.sleep.earned).toBeGreaterThan(0);
    expect(p.sleep.detail.toLowerCase()).not.toMatch(/fail|bad|poor/);
  });

  it('stays within 0..1 and is deterministic', () => {
    const p = dailyProgress(DATE, logs({ doneEventIds: new Set(mealIds()) }));
    expect(p.overall).toBeGreaterThan(0);
    expect(p.overall).toBeLessThanOrEqual(1);
    expect(dailyProgress(DATE, logs({ doneEventIds: new Set(mealIds()) }))).toEqual(p);
  });

  it('produces only safe, non-judgemental labels', () => {
    const p = dailyProgress(DATE, logs({ doneEventIds: new Set(mealIds()) }));
    for (const label of [p.nutrition.detail, p.hydration.detail, p.exercise.detail, p.sleep.detail, p.disclaimer]) {
      expect(findBannedClaims(label), label).toHaveLength(0);
      expect(label.toLowerCase()).not.toMatch(/lazy|bad|poor|fail|cheat|sin/);
    }
  });
});

describe('streaks', () => {
  it('counts consecutive days at or above the success threshold', () => {
    expect(currentStreak({ dailyFractions: [1, 1, 1] })).toBe(3);
    expect(currentStreak({ dailyFractions: [1, 1, 0, 1] })).toBe(1);
    expect(currentStreak({ dailyFractions: [0.5, 0.5] })).toBe(2);
  });

  it('does not break the streak for a day that has not started yet', () => {
    expect(currentStreak({ dailyFractions: [1, 1, 0] })).toBe(2);
  });

  it('does break the streak once a real day is missed', () => {
    expect(currentStreak({ dailyFractions: [1, 1, 0.1, 0.9] })).toBe(1);
    expect(currentStreak({ dailyFractions: [1, 1, 0, 0] })).toBe(0);
    expect(SUCCESS_THRESHOLD).toBeGreaterThan(0);
  });

  it('returns zero for an empty history', () => {
    expect(currentStreak({ dailyFractions: [] })).toBe(0);
    expect(longestStreak({ dailyFractions: [] })).toBe(0);
  });

  it('remembers the best run, not just the current one', () => {
    const history = [1, 1, 1, 1, 0, 1];
    expect(longestStreak({ dailyFractions: history })).toBe(4);
    expect(currentStreak({ dailyFractions: history })).toBe(1);
  });
});

describe('weekly review', () => {
  function weekly(over: Partial<WeeklyInput> = {}): WeeklyInput {
    const days = [0, 1, 2].map((i) => {
      const date = `2026-01-${String(13 + i).padStart(2, '0')}`;
      return {
        date,
        meals: plan.meals,
        doneEventIds: new Set<string>(),
        hydrationMl: 0,
        hydrationTarget: hydTarget,
        workout,
        workoutLog: null,
        foodCost: 120,
        grocerySpend: 900,
      };
    });
    return {
      weekStart: '2026-01-12',
      weekEnd: '2026-01-18',
      days,
      sleepLogs: [],
      skipLogs: [],
      budget: 150,
      ...over,
    };
  }

  it('summarises the week without inventing data', () => {
    const review = weeklyReview(weekly());
    expect(review.daysTracked).toBe(3);
    expect(review.mealsCompleted.total).toBe(15);
    expect(review.mealsCompleted.done).toBe(0);
    expect(review.averageFoodCost.value).toBe(120);
    expect(review.grocerySpend.value).toBe(2700);
    expect(review.suggestions.length).toBeLessThanOrEqual(3);
  });

  it('labels averages as estimates with a range', () => {
    const review = weeklyReview(weekly());
    expect(['derived', 'database', 'regional-average', 'user-entry']).toContain(review.averageFoodCost.basis);
    expect(review.averageFoodCost.range?.low ?? 0).toBeLessThanOrEqual(review.averageFoodCost.value);
    expect(review.averageFoodCost.range?.high ?? 0).toBeGreaterThanOrEqual(review.averageFoodCost.value);
    expect(review.grocerySpend.confidence).toBe('low');
  });

  it('surfaces the most skipped meal slot', () => {
    const review = weeklyReview(
      weekly({
        skipLogs: [
          { id: 'k1', date: '2026-01-13', slot: 'breakfast', reason: 'no-time', eventId: 'e1', minute: 510 },
          { id: 'k2', date: '2026-01-14', slot: 'breakfast', reason: 'no-time', eventId: 'e2', minute: 510 },
        ],
      }),
    );
    expect(review.mostSkippedSlot).toBe('breakfast');
    const suggestion = review.suggestions.find((s) => s.topic === 'skips');
    expect(suggestion?.detail.toLowerCase()).toContain('no time');
  });

  it('offers at most three suggestions and each one is actionable', () => {
    const review = weeklyReview(
      weekly({
        budget: 60,
        skipLogs: [
          { id: 'k1', date: '2026-01-13', slot: 'dinner', reason: 'unavailable', eventId: 'e1', minute: 1200 },
        ],
      }),
    );
    expect(review.suggestions.length).toBeLessThanOrEqual(3);
    for (const s of review.suggestions) {
      expect(s.headline.length).toBeGreaterThan(5);
      expect(s.detail.length).toBeGreaterThan(15);
      if (s.actionRoute) expect(s.actionRoute.startsWith('/')).toBe(true);
    }
  });

  it('never uses shame language anywhere in the review', () => {
    const review = weeklyReview(weekly({ budget: 50 }));
    const all = [JSON.stringify(review)];
    for (const text of all) expect(findBannedClaims(text), text).toHaveLength(0);
    const words = JSON.stringify(review).toLowerCase();
    expect(words).not.toMatch(/cheat|lazy|bad habits|failed|give up/);
  });

  it('recognises a good week and says so', () => {
    const doneAll = new Set(plan.meals.map((m) => mealEventId(m)));
    const days = [0, 1, 2, 3, 4].map((i) => ({
      date: `2026-01-${String(12 + i).padStart(2, '0')}`,
      meals: plan.meals,
      doneEventIds: doneAll,
      hydrationMl: 2000,
      hydrationTarget: hydTarget,
      workout,
      workoutLog: null,
      foodCost: 100,
      grocerySpend: 700,
    }));
    const review = weeklyReview(weekly({ days }));
    expect(review.mealsCompleted.done).toBeGreaterThanOrEqual(15);
    expect(review.suggestions.some((s) => s.topic === 'wins')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(weeklyReview(weekly())).toEqual(weeklyReview(weekly()));
  });

  it('handles an empty week without dividing by zero', () => {
    const review = weeklyReview(weekly({ days: [] }));
    expect(review.daysTracked).toBe(0);
    expect(review.averageFoodCost.value).toBe(0);
    expect(Number.isFinite(review.hydrationConsistency)).toBe(true);
  });
});

describe('skip reasons', () => {
  it('labels every skip reason in plain words', () => {
    for (const reason of ['not-hungry', 'no-time', 'unavailable', 'disliked', 'forgot', 'other'] as const) {
      expect(skipReasonLabel(reason).length).toBeGreaterThan(2);
    }
  });
});

describe('nutrition comparison', () => {
  const target = { calories: 2000, protein: 70, carbs: 250, fat: 60, fiber: 30 };

  it('counts only meals that were actually eaten', () => {
    const first = plan.meals[0] as Meal;
    const cmp = compareNutrition(plan.meals, new Set([mealEventId(first)]), target);
    expect(cmp.eaten.calories).toBeCloseTo(first.nutrition.calories, 1);
    expect(cmp.proteinGap).toBeGreaterThan(0);
  });

  it('says the number is partial while meals are still unticked', () => {
    const cmp = compareNutrition(plan.meals, new Set(), target);
    expect(cmp.detail.toLowerCase()).toMatch(/logged|updates/);
  });

  it('is reassuring rather than alarming when over the estimate', () => {
    const all = new Set(plan.meals.map((m) => mealEventId(m)));
    const cmp = compareNutrition(plan.meals, all, { ...target, calories: 500 });
    expect(cmp.percent).toBeGreaterThan(1);
    expect(cmp.detail.toLowerCase()).not.toMatch(/fail|overweight|bad/);
  });

  it('does not divide by zero with no target', () => {
    const cmp = compareNutrition(plan.meals, new Set(), { ...target, calories: 0 });
    expect(cmp.percent).toBe(0);
  });
});
