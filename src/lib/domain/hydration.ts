/**
 * Hydration engine.
 *
 * Two rules this module enforces that a naive implementation would break:
 *   1. Never chase past a ceiling. Targets are bounded by [floor, ceiling].
 *   2. Never nag. Nudges are spread across waking hours and stop at the cap.
 *
 * Fluid-restriction conditions (kidney/cardiac/hypertension) add a caution note
 * but deliberately do NOT auto-adjust the number — that would be prescribing.
 */

import type {
  CalendarDay,
  FitnessGoal,
  HydrationAdjustment,
  HydrationEntry,
  HydrationNudge,
  HydrationTarget,
  MinuteOfDay,
  Profile,
  WeatherKind,
} from './types/index';
import { clampMinute, minutesBetween } from './time';

export const ML_PER_LITRE = 1000;

/** Never exceed this under any circumstances, whatever the weather. */
export const HARD_CEILING_ML = 4500;
/** Never recommend less than this for a healthy adult on a normal day. */
export const ABSOLUTE_FLOOR_ML = 1200;

export const WEATHER_ADJUSTMENT: Record<WeatherKind, number> = {
  mild: 0,
  hot: 400,
  humid: 250,
  cold: 0,
  unknown: 0,
};

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  mild: 'Mild weather',
  hot: 'Hot weather',
  humid: 'Humid weather',
  cold: 'Cold weather',
  unknown: 'Weather not available',
};

const ACTIVITY_ADJUSTMENT: Record<Profile['activityLevel'], number> = {
  sedentary: 0,
  light: 150,
  moderate: 300,
  active: 450,
  'very-active': 600,
};

export interface HydrationInput {
  readonly weightKg: number;
  readonly activityLevel: Profile['activityLevel'];
  readonly exerciseMinutes: number;
  readonly weather: WeatherKind;
  readonly temperatureC?: number;
  readonly fluidRestrictionCaution: boolean;
  readonly isRestDay: boolean;
  readonly goal?: FitnessGoal;
}

export function hydrationTarget(input: HydrationInput): HydrationTarget {
  const adjustments: HydrationAdjustment[] = [];

  // Baseline scales gently with body size: ~30 ml per kg, floored sensibly.
  const base = Math.round(input.weightKg * 30);
  adjustments.push({
    factor: 'base',
    label: `about 30 ml per kg of body weight (${input.weightKg} kg)`,
    deltaMl: base,
  });

  const activity = ACTIVITY_ADJUSTMENT[input.activityLevel];
  if (activity > 0) {
    adjustments.push({
      factor: 'activity',
      label: 'your day-to-day activity level',
      deltaMl: activity,
    });
  }

  // Exercise adds roughly 400–700 ml per hour of movement.
  const exercise = input.isRestDay || input.exerciseMinutes <= 0
    ? 0
    : Math.round(Math.min(input.exerciseMinutes / 60, 1) * 600);
  if (exercise > 0) {
    adjustments.push({
      factor: 'exercise',
      label: `${input.exerciseMinutes} minutes of movement`,
      deltaMl: exercise,
    });
  }

  let weather = WEATHER_ADJUSTMENT[input.weather];
  if (input.temperatureC !== undefined && input.temperatureC >= 35) {
    weather = Math.max(weather, 500);
  } else if (input.temperatureC !== undefined && input.temperatureC >= 30) {
    weather = Math.max(weather, 250);
  }
  if (weather > 0) {
    adjustments.push({
      factor: input.weather === 'humid' ? 'humidity' : 'weather',
      label: WEATHER_LABELS[input.weather].toLowerCase(),
      deltaMl: weather,
    });
  }

  const raw = base + activity + exercise + weather;
  const target = clamp(Math.round(raw / 50) * 50, ABSOLUTE_FLOOR_ML, HARD_CEILING_ML);
  const floor = Math.max(ABSOLUTE_FLOOR_ML, Math.round((target * 0.75) / 50) * 50);
  const ceiling = Math.min(HARD_CEILING_ML, Math.round((target * 1.35) / 50) * 50);

  const basis =
    'A rough daily total based on your body size, activity and today’s weather. Drink to thirst — this number is a guide, not a quota to chase.';

  const consultNote = input.fluidRestrictionCaution
    ? 'You have told us about a condition where fluid intake may need to be limited. Do not use this number. Ask your doctor how much you should drink and follow their guidance.'
    : undefined;

  return {
    targetMl: target,
    floorMl: floor,
    ceilingMl: ceiling,
    adjustments: adjustments.filter((a) => a.deltaMl > 0),
    basis,
    consultNote,
  };
}

/** Total consumed today, clamped to a sane range so a typo cannot corrupt progress. */
export function consumedMl(entries: readonly HydrationEntry[], date: CalendarDay): number {
  return entries
    .filter((e) => e.date === date && e.ml > 0)
    .reduce((sum, e) => sum + Math.min(e.ml, 1500), 0);
}

export function remainingMl(target: HydrationTarget, consumed: number): number {
  return Math.max(0, target.targetMl - consumed);
}

/**
 * Spread nudges across waking hours so water is spread through the day rather
 * than consumed in one go.
 */
export function hydrationNudges(input: {
  readonly target: HydrationTarget;
  readonly wakeMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly date: CalendarDay;
  readonly exerciseMinute?: MinuteOfDay;
}): readonly HydrationNudge[] {
  const { target, wakeMinute, sleepMinute } = input;
  const wakingMinutes = minutesBetween(wakeMinute, sleepMinute);
  const dayLength = Math.max(240, Math.min(wakingMinutes || 960, 1140));

  const parts = [0, 0.2, 0.4, 0.6, 0.8];
  const labels = [
    'With waking up',
    'Late morning',
    'With lunch',
    'Afternoon',
    'Early evening',
  ];
  const reasons = [
    'You lost fluid overnight',
    'Top up before lunch',
    'Drinking with a meal is an easy habit to keep',
    'The afternoon is when most people quietly go without',
    'Top up before your evening meal',
  ];

  const nudges: HydrationNudge[] = parts.map((p, i) => ({
    id: `${input.date}:water-${i}`,
    minute: clampMinute(wakeMinute + dayLength * p),
    label: labels[i] ?? 'Hydration',
    suggestedMl: Math.round((target.targetMl / 5) / 50) * 50,
    reason: reasons[i] ?? 'Steady hydration across the day',
  }));

  // A post-workout nudge only if there is actually a workout.
  if (input.exerciseMinute !== undefined) {
    nudges.push({
      id: `${input.date}:water-post-workout`,
      minute: clampMinute(input.exerciseMinute + 40),
      label: 'After movement',
      suggestedMl: 400,
      reason: 'You lose fluid while moving, especially in warm weather',
    });
  }

  return nudges.sort((a, b) => a.minute - b.minute);
}

export const QUICK_ADD_ML: readonly number[] = [250, 500, 750, 1000];

export interface HydrationSummary {
  readonly consumed: number;
  readonly target: number;
  readonly remaining: number;
  readonly percent: number;
  readonly overTarget: boolean;
  readonly entriesToday: number;
  readonly lastEntryMinute: MinuteOfDay | null;
}

/** Never display above 100% — rewarding a capped ring beats shaming a big one. */
export function hydrationSummary(
  entries: readonly HydrationEntry[],
  date: CalendarDay,
  target: HydrationTarget,
): HydrationSummary {
  const consumed = consumedMl(entries, date);
  const todays = entries.filter((e) => e.date === date);
  const last = todays.reduce<HydrationEntry | null>((a, b) => (a && a.minute >= b.minute ? a : b), null);

  return {
    consumed,
    target: target.targetMl,
    remaining: remainingMl(target, consumed),
    percent: target.targetMl > 0 ? Math.min(1, consumed / target.targetMl) : 0,
    overTarget: consumed > target.ceilingMl,
    entriesToday: todays.length,
    lastEntryMinute: last?.minute ?? null,
  };
}

/** Advice shown at the bottom of the tracker. Never "you are behind". */
export function hydrationAdvice(summary: HydrationSummary, target: HydrationTarget): string {
  if (summary.overTarget) {
    return 'You are well past today\'s target. That is fine — drinking to thirst is the right guide, and you do not need to keep counting.';
  }
  if (summary.percent >= 1) {
    return 'You have hit today\'s guide. Keep drinking with meals and when you feel thirsty.';
  }
  if (summary.percent >= 0.75) {
    return 'Nearly there. One more glass across the rest of the day is enough.';
  }
  if (summary.percent >= 0.4) {
    return 'Halfway. Small glasses through the afternoon work better than one large one.';
  }
  if (summary.entriesToday === 0) {
    return 'Nothing logged yet. A glass now, with your next meal, is the easiest way to start.';
  }
  return `${target.basis}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
