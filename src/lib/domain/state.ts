import type {
  AvailabilityMap,
  CalendarDay,
  DietPreference,
  FoodKey,
  HealthPreference,
  Profile,
  SkipLog,
  UserSettings,
} from './types/index';
import { SCHEMA_VERSION } from './types/index';
import { DEFAULT_SCHEDULE, defaultDiet, defaultHealth, defaultSettings } from './defaults';
import { addDays, toCalendarDay } from './time';
import { DEFAULT_SETTINGS } from './notifications';
import { CONDITION_LABELS, DECLARED_CONDITION_VALUES } from './safety';
import { hasFood } from './data/foods';
import {
  AGE_MAX,
  AGE_MIN,
  BUDGET_MAX,
  BUDGET_MIN,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from './units';

/**
 * Fill in fields that newer schema versions added.
 *
 * Snapshots written by an older build are kept as-is on purpose — they are the
 * record of what the user actually ate, and rewriting them would be exactly the
 * data loss this app is supposed to avoid. But `foodFocus` and `costProjection`
 * did not exist then, so anything reading them off an old snapshot would find
 * `undefined`. Backfilling the absent fields keeps the type honest without
 * touching the meals, which are the part that matters.
 */
function migrateSnapshots(raw: unknown): PersistedShape['snapshots'] {
  if (!isRecord(raw)) return {};
  const out: PersistedShape['snapshots'] = {};
  for (const [date, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.meals !== 'object') continue;
    const snapshot = value as unknown as PersistedShape['snapshots'][string];
    out[date] = {
      ...snapshot,
      foodFocus: snapshot.foodFocus ?? { vegetable: null, fruit: null },
      costProjection:
        snapshot.costProjection ??
        ({
          daily: { value: 0, low: 0, high: 0 },
          weekly: { value: 0, low: 0, high: 0 },
          monthly: { value: 0, low: 0, high: 0 },
          budget: 0,
          withinBudget: true,
          basis: 'Not recorded for this day.',
        } as unknown as PersistedShape['snapshots'][string]['costProjection']),
    };
  }
  return out;
}

/** A single safe place that produces a valid, complete app state. */
export function blankState(today: CalendarDay): PersistedShape {
  return {
    profile: null,
    diet: defaultDiet(),
    health: defaultHealth(),
    settings: defaultSettings(),
    snapshots: {},
    hydration: [],
    workouts: [],
    sleep: [],
    skips: [],
    swaps: [],
    firedReminders: [],
    weeklyReviews: [],
    pantry: {},
    availability: {},
    planRevisions: {},
    dayPreferences: {},
    localPriceOverrides: {},
    completedEvents: {},
    snoozedUntil: {},
    _today: today,
  };
}

export interface PersistedShape {
  profile: Profile | null;
  diet: DietPreference;
  health: HealthPreference;
  settings: UserSettings;
  snapshots: Record<CalendarDay, import('./types/index').DaySnapshot>;
  hydration: import('./types/index').HydrationEntry[];
  workouts: import('./types/index').WorkoutLog[];
  sleep: import('./types/index').SleepLog[];
  skips: SkipLog[];
  swaps: import('./types/index').SwapLog[];
  firedReminders: import('./types/index').FiredReminder[];
  weeklyReviews: import('./types/index').WeeklyReview[];
  pantry: Record<string, { quantity: import('./types/index').Portion; updatedAt: string }>;
  /**
   * What the user says they can actually get hold of. Absent means "no opinion",
   * which is not the same as unavailable — the engine only drops a food on an
   * explicit signal.
   */
  availability: AvailabilityMap;
  /**
   * Intentional plan edits, keyed by date. A revision records *why* a day was
   * regenerated so the reason survives a reload instead of being a one-off toast.
   */
  planRevisions: Record<string, import('./types/index').PlanRevision>;
  /** Per-day pins and exclusions the user set for one specific date. */
  dayPreferences: Record<string, import('./types/index').DayPreference>;
  localPriceOverrides: Record<string, number>;
  /** eventId -> day the completion belongs to. */
  completedEvents: Record<string, string>;
  /** eventId -> snooze target minute. */
  snoozedUntil: Record<string, number>;
  _today: string;
}

/**
 * Migration: total function. Accepts any historical shape (or garbage) and
 * returns something valid. Never throws, never silently drops a profile.
 */
export function migrate(raw: unknown): PersistedShape {
  const fallback = blankState(todayString());
  if (!isRecord(raw)) return fallback;

  const settings = isRecord(raw.settings)
    ? {
        ...fallback.settings,
        theme: pickEnum(raw.settings.theme, ['light', 'dark', 'system'], fallback.settings.theme),
        reduceMotion: toBool(raw.settings.reduceMotion, fallback.settings.reduceMotion),
        textScale: pickNumber(raw.settings.textScale, [1, 1.15, 1.3], fallback.settings.textScale),
        notifications: isRecord(raw.settings.notifications)
          ? {
              ...DEFAULT_SETTINGS,
              meals: toBool(raw.settings.notifications.meals, DEFAULT_SETTINGS.meals),
              water: toBool(raw.settings.notifications.water, DEFAULT_SETTINGS.water),
              exercise: toBool(raw.settings.notifications.exercise, DEFAULT_SETTINGS.exercise),
              sleep: toBool(raw.settings.notifications.sleep, DEFAULT_SETTINGS.sleep),
              motivation: toBool(raw.settings.notifications.motivation, DEFAULT_SETTINGS.motivation),
              quietHoursStart: toMinute(raw.settings.notifications.quietHoursStart, DEFAULT_SETTINGS.quietHoursStart),
              quietHoursEnd: toMinute(raw.settings.notifications.quietHoursEnd, DEFAULT_SETTINGS.quietHoursEnd),
              snoozeMinutes: clampNum(raw.settings.notifications.snoozeMinutes, 10, 120, DEFAULT_SETTINGS.snoozeMinutes),
              dailyCap: clampNum(raw.settings.notifications.dailyCap, 1, 30, DEFAULT_SETTINGS.dailyCap),
              browserPermission: pickEnum(
                raw.settings.notifications.browserPermission,
                ['unsupported', 'default', 'granted', 'denied', 'insecure-context'],
                'default',
              ),
              delivery: pickEnum(raw.settings.notifications.delivery, ['auto', 'system', 'in-app', 'off'], 'auto'),
            }
          : DEFAULT_SETTINGS,
        dailyBudget: clampNum(raw.settings.dailyBudget, BUDGET_MIN, BUDGET_MAX, fallback.settings.dailyBudget),
      }
    : fallback.settings;

  return {
    profile: migrateProfile(raw.profile),
    diet: isRecord(raw.diet)
      ? {
          userId: str(raw.diet.userId, 'default'),
          dietType: pickEnum(raw.diet.dietType, ['vegetarian', 'egg-vegetarian', 'non-vegetarian'], 'vegetarian'),
          allergies: foodKeys(raw.diet.allergies),
          intolerances: foodKeys(raw.diet.intolerances),
          dislikes: foodKeys(raw.diet.dislikes),
          neverAgain: foodKeys(raw.diet.neverAgain),
          staples: foodKeys(raw.diet.staples),
        }
      : defaultDiet(),
    health: isRecord(raw.health)
      ? {
          userId: str(raw.health.userId, 'default'),
          declaredConditions: strArray(raw.health.declaredConditions).filter((c): c is import('./types/index').DeclaredCondition =>
            (DECLARED_CONDITION_VALUES as readonly string[]).includes(c),
          ),
          usesTobacco: toBool(raw.health.usesTobacco, false),
          alcoholFrequency: pickEnum(raw.health.alcoholFrequency, ['never', 'occasional', 'weekly', 'daily'], 'never'),
          sunExposure: pickEnum(raw.health.sunExposure, ['low', 'moderate', 'high'], 'moderate'),
          sleepDifficulty: pickEnum(raw.health.sleepDifficulty, ['none', 'occasional', 'frequent'], 'none'),
          digestionNotes: str(raw.health.digestionNotes, ''),
        }
      : defaultHealth(),
    settings,
    snapshots: migrateSnapshots(raw.snapshots),
    hydration: array(raw.hydration),
    workouts: array(raw.workouts),
    sleep: array(raw.sleep),
    skips: array(raw.skips) as SkipLog[],
    swaps: array(raw.swaps),
    firedReminders: array(raw.firedReminders),
    weeklyReviews: array(raw.weeklyReviews),
    pantry: isRecord(raw.pantry) ? (raw.pantry as PersistedShape['pantry']) : {},
    availability: isRecord(raw.availability)
      ? (raw.availability as PersistedShape['availability'])
      : {},
    planRevisions: isRecord(raw.planRevisions)
      ? (raw.planRevisions as PersistedShape['planRevisions'])
      : {},
    dayPreferences: isRecord(raw.dayPreferences)
      ? (raw.dayPreferences as PersistedShape['dayPreferences'])
      : {},
    localPriceOverrides: isRecord(raw.localPriceOverrides) ? (raw.localPriceOverrides as Record<string, number>) : {},
    completedEvents: isRecord(raw.completedEvents) ? (raw.completedEvents as Record<string, string>) : {},
    snoozedUntil: isRecord(raw.snoozedUntil) ? (raw.snoozedUntil as Record<string, number>) : {},
    _today: str(raw._today, todayString()),
  };
}

function migrateProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  return {
    userId: str(raw.userId, 'default'),
    name: str(raw.name, '').slice(0, 40),
    age: clampNum(raw.age, AGE_MIN, AGE_MAX, 25),
    sex: pickEnum(raw.sex, ['female', 'male', 'other', 'prefer-not-to-say'], 'prefer-not-to-say'),
    heightCm: clampNum(raw.heightCm, HEIGHT_CM_MIN, HEIGHT_CM_MAX, 165),
    weightKg: clampNum(raw.weightKg, WEIGHT_KG_MIN, WEIGHT_KG_MAX, 60),
    ...(typeof raw.targetWeightKg === 'number'
      ? { targetWeightKg: clampNum(raw.targetWeightKg, WEIGHT_KG_MIN, WEIGHT_KG_MAX, 60) }
      : {}),
    activityLevel: pickEnum(raw.activityLevel, ['sedentary', 'light', 'moderate', 'active', 'very-active'], 'light'),
    fitnessLevel: pickEnum(raw.fitnessLevel, ['beginner', 'intermediate', 'advanced'], 'beginner'),
    goal: pickEnum(
      raw.goal,
      ['maintain-weight', 'lose-fat', 'gain-weight', 'build-muscle', 'improve-fitness', 'improve-energy', 'build-healthy-lifestyle'],
      'build-healthy-lifestyle',
    ),
    units: pickEnum(raw.units, ['metric', 'imperial'], 'metric'),
    city: str(raw.city, ''),
    state: str(raw.state, ''),
    region: str(raw.region, 'other') as Profile['region'],
    schedule: isRecord(raw.schedule)
      ? {
          wakeMinute: toMinute(raw.schedule.wakeMinute, DEFAULT_SCHEDULE.wakeMinute),
          breakfastMinute: toMinute(raw.schedule.breakfastMinute, DEFAULT_SCHEDULE.breakfastMinute),
          lunchMinute: toMinute(raw.schedule.lunchMinute, DEFAULT_SCHEDULE.lunchMinute),
          dinnerMinute: toMinute(raw.schedule.dinnerMinute, DEFAULT_SCHEDULE.dinnerMinute),
          sleepMinute: toMinute(raw.schedule.sleepMinute, DEFAULT_SCHEDULE.sleepMinute),
          exerciseMinute: toMinute(raw.schedule.exerciseMinute, DEFAULT_SCHEDULE.exerciseMinute),
          snackMinute: toMinute(raw.schedule.snackMinute, DEFAULT_SCHEDULE.snackMinute),
          fruitMinute: toMinute(raw.schedule.fruitMinute, DEFAULT_SCHEDULE.fruitMinute),
          workPattern: pickEnum(
            raw.schedule.workPattern,
            ['school', 'office-desk', 'office-field', 'shift', 'student', 'home', 'other'],
            'other',
          ),
          chronotype: pickEnum(raw.schedule.chronotype, ['early', 'intermediate', 'late'], 'intermediate'),
        }
      : DEFAULT_SCHEDULE,
    exerciseMinutesPerDay: clampNum(raw.exerciseMinutesPerDay, 0, 180, 30),
    hasGymAccess: toBool(raw.hasGymAccess, false),
    acceptedSafetyVersion: str(raw.acceptedSafetyVersion, ''),
    onboardingComplete: toBool(raw.onboardingComplete, false),
    showBmi: toBool(raw.showBmi, false),
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers — every one of these tolerates garbage
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function array(v: unknown): never[] {
  return Array.isArray(v) ? (v as never[]) : [];
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Keeps only keys the current food database actually knows about. */
function foodKeys(v: unknown): FoodKey[] {
  return strArray(v).filter((k): k is FoodKey => hasFood(k as FoodKey));
}

function toBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function toMinute(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampNum(v, 0, 1439, fallback) : fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function pickNumber<T extends number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === v) ?? fallback;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function todayString(): string {
  return toCalendarDay(new Date(), 'Asia/Kolkata');
}

export { CONDITION_LABELS, addDays, SCHEMA_VERSION };
