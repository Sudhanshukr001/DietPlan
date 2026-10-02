/**
 * Defaults for a brand-new account.
 *
 * Every default here is a *non-answer*: the onboarding flow replaces them with
 * real values, and `blankState()` is deliberately unopinionated so an app that
 * never finishes onboarding still renders something safe.
 */

import type {
  DailySchedulePreference,
  DietPreference,
  HealthPreference,
  Profile,
  UserSettings,
} from './types/index';
import { SAFETY_VERSION } from './safety';
import { DEFAULT_SETTINGS } from './notifications';

export function defaultDiet(userId = 'default'): DietPreference {
  return {
    userId,
    dietType: 'vegetarian',
    allergies: [],
    intolerances: [],
    dislikes: [],
    neverAgain: [],
    staples: [],
  };
}

export function defaultHealth(userId = 'default'): HealthPreference {
  return {
    userId,
    declaredConditions: ['none'],
    usesTobacco: false,
    alcoholFrequency: 'never',
    sunExposure: 'moderate',
    sleepDifficulty: 'none',
    digestionNotes: '',
  };
}

export function defaultSettings(): UserSettings {
  return {
    theme: 'system',
    reduceMotion: false,
    textScale: 1,
    notifications: DEFAULT_SETTINGS,
    dailyBudget: 150,
  };
}

export const DEFAULT_SCHEDULE: DailySchedulePreference = {
  wakeMinute: 7 * 60,
  breakfastMinute: 8 * 60 + 30,
  lunchMinute: 13 * 60 + 30,
  dinnerMinute: 20 * 60,
  sleepMinute: 23 * 60,
  exerciseMinute: 18 * 60,
  snackMinute: 16 * 60 + 30,
  fruitMinute: 11 * 60 + 30,
  workPattern: 'other',
  chronotype: 'intermediate',
};

/**
 * A skeleton profile. Every field is a placeholder the user is guided to
 * replace, and `onboardingComplete` stays false until they finish.
 */
export function defaultProfile(userId = 'default'): Profile {
  return {
    userId,
    name: '',
    age: 25,
    sex: 'prefer-not-to-say',
    heightCm: 165,
    weightKg: 60,
    activityLevel: 'light',
    fitnessLevel: 'beginner',
    goal: 'build-healthy-lifestyle',
    units: 'metric',
    city: '',
    state: '',
    region: 'other',
    schedule: DEFAULT_SCHEDULE,
    exerciseMinutesPerDay: 30,
    hasGymAccess: false,
    acceptedSafetyVersion: SAFETY_VERSION,
    onboardingComplete: false,
    showBmi: false,
  };
}