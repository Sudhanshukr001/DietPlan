/**
 * THE DAY PIPELINE.
 *
 * One pure function turns (profile + date + logs) into everything the UI shows.
 * This is the architectural seam described in docs/01 §2.4: all derived state is
 * recomputed from inputs, never incrementally mutated. It is what makes a
 * DaySnapshot replayable months later and makes mid-day profile edits reflow
 * correctly.
 *
 * `Date` is injected via `EngineContext` — this module never calls `Date.now()`.
 */

import type {
  CalendarDay,
  DaySnapshot,
  DietPreference,
  EngineContext,
  FoodKey,
  HealthPreference,
  HydrationEntry,
  HydrationTarget,
  MinuteOfDay,
  NutritionTotals,
  Profile,
  ScheduleResolution,
  SeasonId,
  SkipLog,
  SleepLog,
  UserSettings,
  Workout,
  WorkoutLog,
} from './types/index';
import { localMinuteOfDay, toCalendarDay } from './time';
import { seasonForMonth } from './seasonal';
import { advisoryFor } from './safety';
import { dailyTargets } from './nutrition';
import { dietFilter } from './diet';
import { regionMultiplier } from './seasonal';
import { buildMealPlan, type MealPlan } from './meals';
import { buildSchedule, resolveNow, sleepTargetHoursFor, type CompletedEvents } from './schedule';
import { buildDailyGrocery } from './grocery';
import { hydrationNudges, hydrationTarget } from './hydration';
import { buildWorkout, focusForDate } from './fitness';
import { buildSleepPlan } from './sleep';
import { dailyProgress, type DayLogs } from './progress';
import { checkBudget } from './budget';
import { buildBudgetPlan } from './budget';

export interface DayInputs {
  readonly profile: Profile;
  readonly diet: DietPreference;
  readonly health: HealthPreference;
  readonly settings: UserSettings;
  readonly pantry: readonly FoodKey[];
  readonly priceOverrides: Readonly<Partial<Record<FoodKey, number>>>;
  readonly hydration: readonly HydrationEntry[];
  readonly workouts: readonly WorkoutLog[];
  readonly sleep: readonly SleepLog[];
  readonly skips: readonly SkipLog[];
  readonly doneEventIds: ReadonlySet<string>;
  readonly snoozed: ReadonlyMap<string, MinuteOfDay>;
  readonly streak: number;
  readonly isRestDay: boolean;
  readonly writtenAt: string;
}

export interface DayResult {
  readonly date: CalendarDay;
  readonly snapshot: DaySnapshot;
  readonly plan: MealPlan;
  readonly workout: Workout;
  readonly sleepPlan: ReturnType<typeof buildSleepPlan>;
  readonly hydrationTarget: HydrationTarget;
  readonly hydrationNudges: ReturnType<typeof hydrationNudges>;
  readonly resolution: ScheduleResolution;
  readonly nowMinute: MinuteOfDay;
  readonly targets: ReturnType<typeof dailyTargets>;
  readonly targetNutrition: NutritionTotals;
  readonly budgetCheck: ReturnType<typeof checkBudget>;
  readonly budgetPlan: ReturnType<typeof buildBudgetPlan>;
  readonly completed: CompletedEvents;
  readonly consumedMl: number;
  readonly season: SeasonId;
  readonly tz: string;
}

export function buildDay(inputs: DayInputs, ctx: EngineContext): DayResult {
  const date = toCalendarDay(ctx.now, ctx.tz);
  const nowMinute = localMinuteOfDay(ctx.now, ctx.tz);
  const season = seasonForMonth(ctx.month);

  const filter = dietFilter(inputs.diet);
  const dailyBudget = inputs.settings.dailyBudget;

  // --- Nutrition targets -------------------------------------------------
  const targets = dailyTargets({
    weightKg: inputs.profile.weightKg,
    heightCm: inputs.profile.heightCm,
    age: inputs.profile.age,
    sex: inputs.profile.sex,
    activityLevel: inputs.profile.activityLevel,
    goal: inputs.profile.goal,
    showBmi: inputs.profile.showBmi,
  });

  const advisory = advisoryFor(inputs.health);

  const targetNutrition: NutritionTotals = {
    calories: targets.calories.value,
    protein: targets.protein.value,
    carbs: targets.carbs.value,
    fat: targets.fat.value,
    fiber: targets.fiber,
  };

  // --- Meals -------------------------------------------------------------
  const plan = buildMealPlan({
    profile: inputs.profile,
    diet: inputs.diet,
    date,
    season,
    pantry: inputs.pantry,
    dailyBudget,
    priceOverrides: inputs.priceOverrides,
    targets: { calories: targetNutrition.calories, protein: targetNutrition.protein },
    isRestDay: inputs.isRestDay,
  });

  // --- Schedule ----------------------------------------------------------
  const sleepHours = sleepTargetHoursFor(inputs.profile.age);
  const schedule = buildSchedule({
    profile: inputs.profile,
    date,
    meals: plan.meals,
    context: ctx,
    exerciseMinutes: inputs.isRestDay ? 0 : inputs.profile.exerciseMinutesPerDay,
    isRestDay: inputs.isRestDay,
    sleepTargetHours: sleepHours,
  });

  const skippedIds = new Set(inputs.skips.filter((s) => s.date === date).map((s) => s.eventId));
  const completed: CompletedEvents = {
    done: inputs.doneEventIds,
    skipped: skippedIds,
    snoozed: inputs.snoozed,
  };

  const resolution = resolveNow({ schedule, nowMinute, completed });

  // --- Fitness -----------------------------------------------------------
  const focus = focusForDate(date, inputs.profile.fitnessLevel);
  const workout = buildWorkout({
    profile: inputs.profile,
    date,
    level: inputs.profile.fitnessLevel,
    focus,
    isRestDay: inputs.isRestDay,
  });

  // --- Sleep -------------------------------------------------------------
  const sleepPlan = buildSleepPlan({
    wakeMinute: inputs.profile.schedule.wakeMinute,
    sleepMinute: inputs.profile.schedule.sleepMinute,
    age: inputs.profile.age,
    difficulty: inputs.health.sleepDifficulty,
  });

  // --- Hydration ---------------------------------------------------------
  const hydTarget = hydrationTarget({
    weightKg: inputs.profile.weightKg,
    activityLevel: inputs.profile.activityLevel,
    exerciseMinutes: inputs.profile.exerciseMinutesPerDay,
    weather: ctx.weather.kind,
    ...(ctx.weather.temperatureC !== undefined ? { temperatureC: ctx.weather.temperatureC } : {}),
    fluidRestrictionCaution: advisory.fluidCaution,
    isRestDay: inputs.isRestDay,
  });

  const nudges = hydrationNudges({
    target: hydTarget,
    wakeMinute: inputs.profile.schedule.wakeMinute,
    sleepMinute: inputs.profile.schedule.sleepMinute,
    date,
    exerciseMinute: inputs.isRestDay ? undefined : inputs.profile.schedule.exerciseMinute,
  });

  const consumedMl = inputs.hydration
    .filter((h) => h.date === date)
    .reduce((s, h) => s + Math.min(h.ml, 1500), 0);

  // --- Grocery -----------------------------------------------------------
  const grocery = buildDailyGrocery({
    meals: plan.meals,
    region: inputs.profile.region,
    season,
    pantry: inputs.pantry,
    overrides: inputs.priceOverrides,
    date,
  });

  // --- Budget ------------------------------------------------------------
  const budgetCheck = checkBudget(plan.totalCost.value, dailyBudget);
  const budgetPlan = buildBudgetPlan({
    dailyBudget,
    region: inputs.profile.region,
    season,
    filter,
    ...(Object.keys(inputs.priceOverrides).length > 0 ? { overrides: inputs.priceOverrides } : {}),
  });

  // --- Progress ----------------------------------------------------------
  const todayWorkoutLog = inputs.workouts.find((w) => w.date === date) ?? null;
  // Sleep is logged against the night that BEGAN yesterday.
  const sleepLog = inputs.sleep.find((s) => s.date === previousDay(date)) ?? null;

  const dayLogs: DayLogs = {
    meals: plan.meals,
    doneEventIds: inputs.doneEventIds,
    hydrationMl: consumedMl,
    hydrationTarget: hydTarget,
    workout,
    workoutLog: todayWorkoutLog,
    sleepLog,
    sleepPlanTargetHours: sleepHours,
    streak: inputs.streak,
    advisorySuppressCalorieTargets: advisory.suppressCalorieTargets,
  };

  const progress = dailyProgress(date, dayLogs);

  const snapshot: DaySnapshot = {
    date,
    tz: ctx.tz,
    profileHash: plan.profileHash,
    meals: plan.meals,
    schedule,
    grocery,
    progress,
    workout,
    sleepPlan,
    hydrationTarget: hydTarget,
    advisory,
    writtenAt: inputs.writtenAt,
  };

  return {
    date,
    snapshot,
    plan,
    workout,
    sleepPlan,
    hydrationTarget: hydTarget,
    hydrationNudges: nudges,
    resolution,
    nowMinute,
    targets,
    targetNutrition,
    budgetCheck,
    budgetPlan,
    completed,
    consumedMl,
    season,
    tz: ctx.tz,
  };
}

function previousDay(date: CalendarDay): CalendarDay {
  const [y, m, d] = date.split('-').map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - 86_400_000;
  const dt = new Date(base);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Regional price multiplier re-exported so app code has one import surface. */
export { regionMultiplier };
