/**
 * Sleep engine.
 *
 * The one thing it is allowed to be opinionated about is *timing*: the wind-down
 * ladder is derived backwards from the user's own wake time. Everything else is
 * framed as a habit, never as a promise ("this will fix your sleep").
 */

import type { MinuteOfDay, SleepLog, SleepPlan, SleepStep } from './types/index';
import { clampMinute, hoursBetweenSleep, minutesBetween } from './time';

export const SLEEP_TARGETS_BY_AGE: ReadonlyArray<{ readonly maxAge: number; readonly hours: number }> = [
  { maxAge: 17, hours: 9 },
  { maxAge: 60, hours: 8 },
  { maxAge: 120, hours: 7.5 },
];

export function sleepTargetHoursForAge(age: number): number {
  const row = SLEEP_TARGETS_BY_AGE.find((r) => age <= r.maxAge);
  return row?.hours ?? 8;
}

/**
 * The ladder runs backwards from bedtime: dim screens, finish tasks, wash up,
 * lights out. Each step has a concrete action rather than advice.
 */
export function buildSleepPlan(input: {
  readonly wakeMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly age: number;
  readonly difficulty: 'none' | 'occasional' | 'frequent';
}): SleepPlan {
  const targetHours = sleepTargetHoursForAge(input.age);
  const actual = hoursBetweenSleep(input.sleepMinute, input.wakeMinute);

  // If the user's own schedule leaves too little sleep, move bedtime earlier
  // rather than telling them to wake earlier.
  //
  // If even midnight is not early enough — a 5 AM wake with an 8-hour target —
  // there is no bedtime that works, so we keep the user's bedtime and say so
  // instead of wrapping the ladder around to 00:00.
  const desiredBed = input.wakeMinute - targetHours * 60;
  const bedtimeFitsBeforeMidnight = desiredBed >= 0;
  const bed = actual < targetHours - 0.5 && bedtimeFitsBeforeMidnight ? desiredBed : input.sleepMinute;

  const steps: SleepStep[] = [
    {
      id: 'wind-down',
      minute: clampMinute(bed - 75),
      title: 'Start winding down',
      action: 'Dim the lights and stop anything that needs real thinking — work, study, arguments.',
      emoji: '🌆',
    },
    {
      id: 'screens',
      minute: clampMinute(bed - 45),
      title: 'Put the screen away',
      action: 'Charge the phone across the room. Screens at full brightness keep you alert.',
      emoji: '📵',
    },
    {
      id: 'wash-up',
      minute: clampMinute(bed - 25),
      title: 'Wash up and get ready',
      action: 'Brush teeth, wash your face, set your alarm, keep the room cool.',
      emoji: '🛁',
    },
    {
      id: 'lights-out',
      minute: bed,
      title: 'Lights out',
      action: 'If your mind is busy, write tomorrow\'s three tasks down and leave the paper there.',
      emoji: '😴',
    },
  ];

  const notes: string[] = [
    'A steady bedtime and wake time matters more than any single perfect night.',
    'Caffeine after mid-afternoon affects some people a lot. Try moving tea and coffee earlier for a week.',
    'If you cannot sleep, get up and do something dull in dim light. Lying awake worrying helps nobody.',
  ];

  if (input.difficulty === 'frequent') {
    notes.push(
      'You mentioned sleep is often difficult. A regular wake time helps most — even if bedtime varies. If it stays difficult for weeks, talking to a doctor is worth it.',
    );
  }

  if (actual < targetHours - 0.5 && bedtimeFitsBeforeMidnight) {
    notes.push(
      `Your schedule leaves about ${Math.round(actual * 10) / 10} hours. That is less than the ${targetHours} hours most adults need, so bedtime has been moved ${Math.round((input.sleepMinute - bed) / 5) * 5} minutes earlier.`,
    );
  } else if (actual < targetHours - 0.5) {
    const achievable = Math.round((input.wakeMinute / 60) * 10) / 10;
    const shortfall = Math.round((targetHours - achievable) * 60 / 5) * 5;
    notes.push(
      `With a ${Math.floor(input.wakeMinute / 60)}:${String(input.wakeMinute % 60).padStart(2, '0')} wake-up there is not enough night left for ${targetHours} hours, so the plan has not moved anything. The honest option is to move your wake-up about ${shortfall} minutes later rather than cutting sleep — that is a scheduling conversation, not a willpower one.`,
    );
  }

  return {
    wakeMinute: input.wakeMinute,
    targetBedMinute: bed,
    targetHours,
    ladder: steps,
    notes,
  };
}

export interface SleepProgress {
  readonly value: number;
  readonly windDownDone: boolean;
  readonly bedtimeOnTarget: boolean;
  readonly detail: string;
}

export function sleepProgress(
  plan: SleepPlan,
  log: SleepLog | null,
): SleepProgress {
  if (!log) {
    return {
      value: 0,
      windDownDone: false,
      bedtimeOnTarget: false,
      detail: 'Nothing recorded for last night yet.',
    };
  }

  const parts: number[] = [];
  const details: string[] = [];

  parts.push(log.windDownCompleted ? 1 : 0);
  details.push(log.windDownCompleted ? 'wound down' : 'wind-down not marked');

  parts.push(log.screensOff ? 1 : 0);
  details.push(log.screensOff ? 'screens off' : 'screens still on late');

  const onTarget =
    log.bedtimeActual !== null &&
    Math.abs(minutesBetween(plan.targetBedMinute, log.bedtimeActual)) <= 45;
  parts.push(onTarget ? 1 : 0);
  if (log.bedtimeActual !== null) {
    details.push(onTarget ? 'bedtime close to target' : 'bedtime drifted');
  } else {
    details.push('bedtime not recorded');
  }

  const value = parts.reduce((a, b) => a + b, 0) / parts.length;

  return {
    value,
    windDownDone: log.windDownCompleted,
    bedtimeOnTarget: onTarget,
    detail: details.join(' · '),
  };
}

/** Never claims a specific sleep time guarantees health. */
export const SLEEP_DISCLAIMER =
  'These are routine suggestions based on your own wake time. Individual sleep needs vary, and no fixed bedtime guarantees health.';

export function sleepWindowLabel(plan: SleepPlan): string {
  return `${Math.round(plan.targetBedMinute / 60) % 24 || 24}:00 → ${Math.round(plan.wakeMinute / 60) % 24 || 24}:00`;
}

export function wakeUpGreeting(wakeMinute: MinuteOfDay, nowMinute: MinuteOfDay): string {
  const since = minutesBetween(wakeMinute, nowMinute);
  if (since < 60) return 'Good morning';
  if (since < 12 * 60) return 'Good morning';
  if (nowMinute < 12 * 60) return 'Good morning';
  if (nowMinute < 17 * 60) return 'Good afternoon';
  return 'Good evening';
}
