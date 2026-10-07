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
  AvailabilityMap,
  CalendarDay,
  CostProjection,
  DayPreference,
  DaySnapshot,
  DietPreference,
  EngineContext,
  FoodKey,
  HealthPreference,
  HydrationEntry,
  HydrationTarget,
  MealHistoryEntry,
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
import { costProjection } from './costProjection';
import {
  buildSchedule,
  deriveScheduleForProfile,
  resolveNow,
  sleepTargetHoursFor,
  type CompletedEvents,
} from './schedule';
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
  /**
   * Recorded days of eating, used to avoid repeating yesterday's meals. Keeping
   * this in `DayInputs` rather than reading a store inside the pipeline is what
   * keeps `buildDay` pure and replayable.
   */
  readonly history: readonly MealHistoryEntry[];
  /** What the user actually said they can buy or find nearby. */
  readonly availability: AvailabilityMap;
  /** Pins and exclusions set for one specific date. */
  readonly dayPreference?: DayPreference;
  /** Mean daily spend across recent recorded days, once there are any. */
  readonly recentDailyCost?: number | null;
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
  readonly costProjection: CostProjection;
}

export function buildDay(inputs: DayInputs, ctx: EngineContext): DayResult {
  const date = toCalendarDay(ctx.now, ctx.tz);
  const nowMinute = localMinuteOfDay(ctx.now, ctx.tz);
  const season = seasonForMonth(ctx.month);

  const filter = dietFilter(inputs.diet);
  const dailyBudget = inputs.settings.dailyBudget;

  // The times the plan is built from are always re-derived from the wake and
  // sleep times the user entered, so a profile saved by an older build (which
  // kept fixed 8:30/13:30/20:00 meal times) still gets a plan that fits its day.
  const profile = deriveScheduleForProfile(inputs.profile);

  // --- Nutrition targets -------------------------------------------------
  const targets = dailyTargets({
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    showBmi: profile.showBmi,
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
    profile,
    diet: inputs.diet,
    date,
    season,
    pantry: inputs.pantry,
    dailyBudget,
    priceOverrides: inputs.priceOverrides,
    targets: {
      calories: targetNutrition.calories,
      protein: targetNutrition.protein,
      fiber: targetNutrition.fiber,
    },
    isRestDay: inputs.isRestDay,
    history: inputs.history,
    availability: inputs.availability,
    ...(inputs.dayPreference ? { dayPreference: inputs.dayPreference } : {}),
  });

  // --- Schedule ----------------------------------------------------------
  const sleepHours = sleepTargetHoursFor(profile.age);
  const schedule = buildSchedule({
    profile,
    date,
    meals: plan.meals,
    context: ctx,
    exerciseMinutes: inputs.isRestDay ? 0 : profile.exerciseMinutesPerDay,
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
  const focus = focusForDate(date, profile.fitnessLevel);
  const workout = buildWorkout({
    profile,
    date,
    level: profile.fitnessLevel,
    focus,
    isRestDay: inputs.isRestDay,
  });

  // --- Sleep -------------------------------------------------------------
  const sleepPlan = buildSleepPlan({
    wakeMinute: profile.schedule.wakeMinute,
    sleepMinute: profile.schedule.sleepMinute,
    age: profile.age,
    difficulty: inputs.health.sleepDifficulty,
  });

  // --- Hydration ---------------------------------------------------------
  const hydTarget = hydrationTarget({
    weightKg: profile.weightKg,
    activityLevel: profile.activityLevel,
    exerciseMinutes: profile.exerciseMinutesPerDay,
    weather: ctx.weather.kind,
    ...(ctx.weather.temperatureC !== undefined ? { temperatureC: ctx.weather.temperatureC } : {}),
    fluidRestrictionCaution: advisory.fluidCaution,
    isRestDay: inputs.isRestDay,
  });

  const nudges = hydrationNudges({
    target: hydTarget,
    wakeMinute: profile.schedule.wakeMinute,
    sleepMinute: profile.schedule.sleepMinute,
    date,
    exerciseMinute: inputs.isRestDay ? undefined : profile.schedule.exerciseMinute,
  });

  const consumedMl = inputs.hydration
    .filter((h) => h.date === date)
    .reduce((s, h) => s + Math.min(h.ml, 1500), 0);

  // --- Grocery -----------------------------------------------------------
  const grocery = buildDailyGrocery({
    meals: plan.meals,
    region: profile.region,
    season,
    pantry: inputs.pantry,
    overrides: inputs.priceOverrides,
    date,
  });

  // --- Budget ------------------------------------------------------------
  const budgetCheck = checkBudget(plan.totalCost.value, dailyBudget);
  // Falls back to today's own figure until enough days of history exist to
  // average, and says so in the `basis` string rather than inventing a trend.
  const projection = costProjection(plan.totalCost.value, dailyBudget, inputs.recentDailyCost ?? null);

  const budgetPlan = buildBudgetPlan({
    dailyBudget,
    region: profile.region,
    season,
    filter,
    ...(Object.keys(inputs.priceOverrides).length > 0 ? { overrides: inputs.priceOverrides } : {}),
  });

  // --- Progress ----------------------------------------------------------
  const todayWorkoutLog = inputs.workouts.find((w) => w.date === date) ?? null;
  // Sleep is logged against the night that BEGAN yesterday. A log written for
  // tonight's own night counts as well, so ticking "wind-down done" in the
  // evening is reflected immediately instead of only tomorrow morning.
  const sleepLog =
    inputs.sleep.find((s) => s.date === date) ?? inputs.sleep.find((s) => s.date === previousDay(date)) ?? null;

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
    foodFocus: plan.focus,
    costProjection: projection,
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
    costProjection: projection,
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
