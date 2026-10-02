import type {
  ActivityLevel,
  CalendarDay,
  Chronotype,
  DeclaredCondition,
  DietPreference,
  DietType,
  EngineContext,
  FitnessGoal,
  FitnessLevel,
  FoodKey,
  HealthPreference,
  Profile,
  Sex,
  UserSettings,
  WeatherKind,
  WorkPattern,
} from '@/lib/domain/types/index';
import { defaultDiet, defaultHealth, defaultSettings } from '@/lib/domain/defaults';

export const TZ = 'Asia/Kolkata';
export const DATE: CalendarDay = '2026-01-14';
export const WEEKDAY = 3; // Wednesday

/**
 * A fixed instant: Wednesday 2026-01-14, 13:42 IST.
 * Chosen so tests cross meal boundaries without landing on an exact edge.
 */
export const NOW_ISO = '2026-01-14T08:12:00.000Z';
export const NOW = new Date(NOW_ISO);

export function ctxAt(isoUtc: string, weather: WeatherKind = 'mild'): EngineContext {
  return {
    now: new Date(isoUtc),
    tz: TZ,
    weather: weather === 'hot' ? { kind: 'hot', temperatureC: 38 } : { kind: 'mild', temperatureC: 24 },
    dayOfWeek: WEEKDAY,
    month: 0,
  };
}

export const CTX: EngineContext = ctxAt(NOW_ISO);

export interface ProfileOverrides {
  readonly age?: number;
  readonly sex?: Sex;
  readonly heightCm?: number;
  readonly weightKg?: number;
  readonly activityLevel?: ActivityLevel;
  readonly fitnessLevel?: FitnessLevel;
  readonly goal?: FitnessGoal;
  readonly region?: Profile['region'];
  readonly dietType?: DietType;
  readonly wakeMinute?: number;
  readonly sleepMinute?: number;
  readonly breakfastMinute?: number;
  readonly lunchMinute?: number;
  readonly dinnerMinute?: number;
  readonly snackMinute?: number;
  readonly fruitMinute?: number;
  readonly exerciseMinute?: number;
  readonly exerciseMinutesPerDay?: number;
  readonly workPattern?: WorkPattern;
  readonly chronotype?: Chronotype;
  readonly hasGymAccess?: boolean;
  readonly showBmi?: boolean;
  readonly onboardingComplete?: boolean;
}

export function makeProfile(overrides: ProfileOverrides = {}): Profile {
  const base = defaultProfileForTest();
  return {
    ...base,
    ...overrides,
    schedule: {
      wakeMinute: overrides.wakeMinute ?? base.schedule.wakeMinute,
      breakfastMinute: overrides.breakfastMinute ?? base.schedule.breakfastMinute,
      lunchMinute: overrides.lunchMinute ?? base.schedule.lunchMinute,
      dinnerMinute: overrides.dinnerMinute ?? base.schedule.dinnerMinute,
      sleepMinute: overrides.sleepMinute ?? base.schedule.sleepMinute,
      exerciseMinute: overrides.exerciseMinute ?? base.schedule.exerciseMinute,
      snackMinute: overrides.snackMinute ?? base.schedule.snackMinute,
      fruitMinute: overrides.fruitMinute ?? base.schedule.fruitMinute,
      workPattern: overrides.workPattern ?? base.schedule.workPattern,
      chronotype: overrides.chronotype ?? base.schedule.chronotype,
    },
  };
}

function defaultProfileForTest(): Profile {
  return {
    userId: 'test',
    name: 'Test',
    age: 25,
    sex: 'female',
    heightCm: 160,
    weightKg: 58,
    activityLevel: 'light',
    fitnessLevel: 'beginner',
    goal: 'build-healthy-lifestyle',
    units: 'metric',
    city: 'Patna',
    state: 'Bihar',
    region: 'bihar',
    schedule: {
      wakeMinute: 7 * 60,
      breakfastMinute: 8 * 60 + 30,
      lunchMinute: 13 * 60 + 30,
      dinnerMinute: 20 * 60,
      sleepMinute: 23 * 60,
      exerciseMinute: 18 * 60,
      snackMinute: 16 * 60 + 30,
      fruitMinute: 11 * 60 + 30,
      workPattern: 'office-desk',
      chronotype: 'intermediate',
    },
    exerciseMinutesPerDay: 30,
    hasGymAccess: false,
    acceptedSafetyVersion: '2026-01-general-wellness',
    onboardingComplete: true,
    showBmi: false,
  };
}

export function makeDiet(overrides: Partial<DietPreference> = {}): DietPreference {
  return { ...defaultDiet('test'), ...overrides };
}

export function makeHealth(overrides: Partial<HealthPreference> = {}): HealthPreference {
  return { ...defaultHealth('test'), ...overrides };
}

export function conditions(...list: DeclaredCondition[]): HealthPreference {
  return makeHealth({ declaredConditions: list });
}

export function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...defaultSettings(), ...overrides };
}

/** Deterministic ids so assertions can reference specific foods. */
export function mealKeys(meals: readonly { ingredients: readonly { foodKey: FoodKey }[] }[]): FoodKey[][] {
  return meals.map((m) => m.ingredients.map((i) => i.foodKey));
}
