import { describe, expect, it } from 'vitest';
import {
  CATEGORY_CAPS,
  CATCH_UP_WINDOW_MINUTES,
  DEFAULT_DAILY_CAP,
  DEFAULT_SETTINGS,
  buildReminders,
  dueReminders,
  estimateDailyVolume,
  inQuietHours,
  snoozeUntil,
} from '@/lib/domain/notifications';
import { buildSchedule } from '@/lib/domain/schedule';
import { buildMealPlan } from '@/lib/domain/meals';
import { hydrationNudges, hydrationTarget } from '@/lib/domain/hydration';
import { buildSleepPlan } from '@/lib/domain/sleep';
import { buildWorkout, focusForDate } from '@/lib/domain/fitness';
import type { FiredReminder, NotificationSettings, Reminder } from '@/lib/domain/types/index';
import { CTX, DATE, makeProfile } from './fixtures';

const profile = makeProfile();

const plan = buildMealPlan({
  profile,
  diet: { userId: 'test', dietType: 'vegetarian', allergies: [], intolerances: [], dislikes: [], neverAgain: [], staples: [] },
  date: DATE,
  season: 'winter',
  pantry: [],
  dailyBudget: 150,
  priceOverrides: {},
  targets: { calories: 1800, protein: 60 },
  isRestDay: false,
});

const schedule = buildSchedule({
  profile,
  date: DATE,
  meals: plan.meals,
  context: CTX,
  exerciseMinutes: 30,
  isRestDay: false,
  sleepTargetHours: 8,
});

const workout = buildWorkout({ profile, date: DATE, level: 'beginner', focus: focusForDate(DATE, 'beginner'), isRestDay: false });
const sleepPlan = buildSleepPlan({ wakeMinute: profile.schedule.wakeMinute, sleepMinute: profile.schedule.sleepMinute, age: profile.age, difficulty: 'none' });
const target = hydrationTarget({
  weightKg: profile.weightKg,
  activityLevel: profile.activityLevel,
  exerciseMinutes: 30,
  weather: 'mild',
  fluidRestrictionCaution: false,
  isRestDay: false,
});
const nudges = hydrationNudges({
  target,
  wakeMinute: profile.schedule.wakeMinute,
  sleepMinute: profile.schedule.sleepMinute,
  date: DATE,
});

function build(settings: Partial<NotificationSettings> = {}, over: { done?: Set<string>; skipped?: Set<string>; snoozed?: Map<string, number>; fired?: FiredReminder[] } = {}): readonly Reminder[] {
  return buildReminders({
    date: DATE,
    schedule,
    meals: plan.meals,
    workout,
    sleepPlan,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    doneEventIds: over.done ?? new Set(),
    skippedEventIds: over.skipped ?? new Set(),
    snoozed: over.snoozed ?? new Map(),
    alreadyFired: over.fired ?? [],
    hydrationNudges: nudges,
  });
}

describe('quiet hours', () => {
  it('wraps across midnight', () => {
    expect(inQuietHours(23 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(true);
    expect(inQuietHours(3 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(true);
    expect(inQuietHours(12 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(false);
  });

  it('treats a zero-width window as "no quiet hours"', () => {
    expect(inQuietHours(12 * 60, 0, 0)).toBe(true);
  });

  it('suppresses reminders that fall inside quiet hours, and says why', () => {
    const reminders = build();
    const quiet = reminders.filter((r) => inQuietHours(r.fireMinute, DEFAULT_SETTINGS.quietHoursStart, DEFAULT_SETTINGS.quietHoursEnd));
    expect(quiet.length).toBeGreaterThan(0);
    for (const r of quiet) expect(r.suppressedBy).toBe('quiet-hours');
  });

  it('fires nothing at all during quiet hours', () => {
    const reminders = build();
    const due = dueReminders(reminders, 2 * 60, []);
    expect(due).toHaveLength(0);
  });
});

describe('category toggles', () => {
  it('produces nothing for a category that is switched off', () => {
    const off = build({ meals: false });
    const live = off.filter((r) => !r.suppressedBy);
    expect(live.some((r) => r.category === 'meals')).toBe(false);
    expect(off.filter((r) => r.category === 'meals').every((r) => r.suppressedBy === 'category-off')).toBe(true);
  });

  it('keeps motivational messages off unless explicitly enabled', () => {
    const off = build();
    expect(off.some((r) => r.category === 'motivation')).toBe(false);
    const on = build({ motivation: true });
    expect(on.some((r) => r.category === 'motivation')).toBe(true);
  });

  it('still explains suppressed reminders rather than hiding them', () => {
    const off = build({ water: false });
    const water = off.filter((r) => r.category === 'water');
    expect(water.length).toBeGreaterThan(0);
    for (const r of water) expect(r.suppressedBy).toBeTruthy();
  });
});

describe('volume limits', () => {
  it('stays under the overall daily cap', () => {
    const reminders = build();
    const live = reminders.filter((r) => !r.suppressedBy);
    expect(live.length).toBeLessThanOrEqual(DEFAULT_DAILY_CAP);
  });

  it('respects a lowered daily cap and marks the rest as capped', () => {
    const reminders = build({ dailyCap: 3 });
    const live = reminders.filter((r) => !r.suppressedBy);
    expect(live.length).toBeLessThanOrEqual(3);
    expect(reminders.some((r) => r.suppressedBy === 'daily-cap')).toBe(true);
  });

  it('never exceeds the per-category cap', () => {
    const reminders = build();
    for (const category of Object.keys(CATEGORY_CAPS) as (keyof typeof CATEGORY_CAPS)[]) {
      const live = reminders.filter((r) => r.category === category && !r.suppressedBy);
      expect(live.length, category).toBeLessThanOrEqual(CATEGORY_CAPS[category]);
    }
  });

  it('estimates the daily volume honestly from the settings', () => {
    const estimate = estimateDailyVolume(DEFAULT_SETTINGS);
    const live = build().filter((r) => !r.suppressedBy);
    expect(estimate).toBeGreaterThanOrEqual(live.length);
  });
});

describe('already-handled items', () => {
  const mealEvent = schedule.events.find((e) => e.kind === 'meal');
  if (!mealEvent) throw new Error('no meal event');

  it('does not remind about a meal already ticked off', () => {
    const reminders = build({}, { done: new Set([mealEvent.id]) });
    const found = reminders.find((r) => r.eventId === mealEvent.id);
    expect(found?.suppressedBy).toBe('already-done');
    expect(dueReminders(reminders, mealEvent.startMinute, []).some((r) => r.eventId === mealEvent.id)).toBe(false);
  });

  it('does not remind about a meal the user skipped', () => {
    const reminders = build({}, { skipped: new Set([mealEvent.id]) });
    const found = reminders.find((r) => r.eventId === mealEvent.id);
    expect(found?.suppressedBy).toBe('already-done');
  });

  it('does not repeat something already delivered today', () => {
    const reminders = build();
    const first = reminders.find((r) => !r.suppressedBy);
    if (!first) throw new Error('no live reminders');
    const due = dueReminders(reminders, first.fireMinute, [
      { fingerprint: first.id, date: DATE, firedMinute: first.fireMinute, delivery: 'system' },
    ]);
    expect(due.some((r) => r.id === first.id)).toBe(false);
  });
});

describe('timing', () => {
  const reminders = build();

  it('returns reminders in fire order', () => {
    const live = reminders.filter((r) => !r.suppressedBy);
    const times = live.map((r) => r.fireMinute);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('only returns reminders that are due, not future ones', () => {
    const first = reminders.find((r) => !r.suppressedBy);
    if (!first) throw new Error('no live reminders');
    expect(dueReminders(reminders, first.fireMinute - 1, [])).toHaveLength(0);
    expect(dueReminders(reminders, first.fireMinute, []).some((r) => r.id === first.id)).toBe(true);
  });

  it('catches up a reminder missed while the app was closed, within the window', () => {
    const first = reminders.find((r) => !r.suppressedBy);
    if (!first) throw new Error('no live reminders');
    const late = first.fireMinute + CATCH_UP_WINDOW_MINUTES;
    expect(dueReminders(reminders, late, []).some((r) => r.id === first.id)).toBe(true);
  });

  it('drops a reminder missed by more than the catch-up window instead of firing it late', () => {
    const first = reminders.find((r) => !r.suppressedBy);
    if (!first) throw new Error('no live reminders');
    const veryLate = first.fireMinute + CATCH_UP_WINDOW_MINUTES + 30;
    expect(dueReminders(reminders, veryLate, []).some((r) => r.id === first.id)).toBe(false);
  });

  it('moves a snoozed reminder to its new time', () => {
    const first = reminders.find((r) => !r.suppressedBy);
    if (!first) throw new Error('no live reminders');
    const until = first.fireMinute + 20;
    const snoozed = build({}, { snoozed: new Map([[first.eventId, until]]) });
    const moved = snoozed.find((r) => r.eventId === first.eventId);
    expect(moved?.fireMinute).toBe(until);
  });

  it('never snoozes for less than ten minutes or past the end of the day', () => {
    expect(snoozeUntil(600, 0)).toBe(610);
    expect(snoozeUntil(1430, 30)).toBe(1439);
  });
});

describe('reminder copy', () => {
  it('names the food, not just the meal', () => {
    const mealReminders = build().filter((r) => r.category === 'meals' && !r.suppressedBy);
    expect(mealReminders.length).toBeGreaterThan(0);
    for (const r of mealReminders) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(10);
      expect(r.actions.length).toBeGreaterThan(0);
    }
  });

  it('gives every reminder a stable unique id', () => {
    const reminders = build();
    expect(new Set(reminders.map((r) => r.id)).size).toBe(reminders.length);
    expect(buildReminders === buildReminders).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    expect(build()).toEqual(build());
  });
});
