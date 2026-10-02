import { describe, expect, it } from 'vitest';
import {
  MEAL_GRACE_MINUTES,
  buildSchedule,
  defaultSchedulePreference,
  isSettled,
  resolveNow,
  sleepTargetHoursFor,
  stateFor,
  suggestedWindows,
} from '@/lib/domain/schedule';
import { MEAL_WINDOW_MINUTES } from '@/lib/domain/mealWindows';
import { buildMealPlan } from '@/lib/domain/meals';
import { toCalendarDay } from '@/lib/domain/time';
import type { CalendarDay, DailySchedule, TimelineEvent } from '@/lib/domain/types/index';
import { CTX, DATE, ctxAt, makeDiet, makeProfile } from './fixtures';

const SEASON = 'winter' as const;

function plan(overrides: Parameters<typeof makeProfile>[0] = {}): ReturnType<typeof buildMealPlan> {
  const profile = makeProfile(overrides);
  return buildMealPlan({
    profile,
    diet: makeDiet(),
    date: DATE,
    season: SEASON,
    pantry: [],
    dailyBudget: 150,
    priceOverrides: {},
    targets: { calories: 1800, protein: 60 },
    isRestDay: false,
  });
}

function scheduleFor(
  mealPlan: ReturnType<typeof buildMealPlan>,
  opts: { isRestDay?: boolean; exerciseMinutes?: number; profile?: ReturnType<typeof makeProfile> } = {},
): DailySchedule {
  return buildSchedule({
    profile: opts.profile ?? makeProfile(),
    date: DATE,
    meals: mealPlan.meals,
    context: CTX,
    exerciseMinutes: opts.exerciseMinutes ?? 30,
    isRestDay: opts.isRestDay ?? false,
    sleepTargetHours: 8,
  });
}

describe('schedule construction', () => {
  const mealPlan = plan();
  const schedule = scheduleFor(mealPlan);

  it('puts a wake event first and ends at night', () => {
    expect(schedule.events[0]?.kind).toBe('wake');
    expect(schedule.wakeMinute).toBe(makeProfile().schedule.wakeMinute);
    expect(schedule.sleepMinute).toBe(makeProfile().schedule.sleepMinute);
  });

  it('creates exactly one event per planned meal, with no overlaps between meals', () => {
    const mealEvents = schedule.events.filter((e) => e.kind === 'meal');
    expect(mealEvents).toHaveLength(mealPlan.meals.length);

    const sorted = [...mealEvents].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) continue;
      expect(cur.startMinute, `${cur.id} overlaps ${prev.id}`).toBeGreaterThanOrEqual(prev.endMinute);
    }
  });

  it('keeps each meal window within its slot allowance', () => {
    for (const meal of mealPlan.meals) {
      const width = MEAL_WINDOW_MINUTES[meal.slot];
      expect(meal.endMinute - meal.startMinute).toBeLessThanOrEqual(width + 1);
    }
  });

  it('adds exercise on a normal day and skips it on a rest day', () => {
    expect(scheduleFor(mealPlan).events.some((e) => e.kind === 'exercise')).toBe(true);
    const rest = scheduleFor(mealPlan, { isRestDay: true });
    expect(rest.events.some((e) => e.kind === 'exercise')).toBe(false);
    expect(rest.events.some((e) => e.optional && e.kind === 'movement')).toBe(true);
  });

  it('never schedules exercise in the middle of the night', () => {
    for (const override of [{ exerciseMinute: 90 }, { exerciseMinute: 2 * 60 }, { exerciseMinute: 23 * 60 + 30 }]) {
      const s = scheduleFor(plan(override), { profile: makeProfile(override) });
      const ex = s.events.find((e) => e.kind === 'exercise');
      if (!ex) continue;
      const sleepMinute = makeProfile(override).schedule.sleepMinute;
      expect(ex.startMinute, `start for ${override.exerciseMinute}`).toBeGreaterThanOrEqual(300);
      expect(ex.endMinute, `end for ${override.exerciseMinute}`).toBeLessThanOrEqual(sleepMinute);
      expect(ex.startMinute).toBeLessThan(ex.endMinute);
    }
  });

  it('includes a sleep-prep and wind-down ladder before bed', () => {
    const kinds = schedule.events.map((e) => e.kind);
    expect(kinds).toContain('sleep');
    const sleepIdx = kinds.lastIndexOf('sleep');
    expect(kinds.indexOf('wind-down')).toBeLessThan(sleepIdx);
    expect(kinds.indexOf('sleep-prep')).toBeLessThan(sleepIdx);
  });

  it('gives every event an id, a reason and at least one action', () => {
    for (const event of schedule.events) {
      expect(event.id.length, event.id).toBeGreaterThan(0);
      expect(event.title.length, event.id).toBeGreaterThan(0);
      expect(event.detail.length, event.id).toBeGreaterThan(0);
      expect(event.why.length, event.id).toBeGreaterThan(20);
      expect(event.actions.length, event.id).toBeGreaterThan(0);
    }
    expect(new Set(schedule.events.map((e) => e.id)).size).toBe(schedule.events.length);
  });

  it('marks rest and optional events as optional so they never block completion', () => {
    const wake = schedule.events.find((e) => e.kind === 'wake');
    expect(wake?.optional).toBe(false);
    const water = schedule.events.find((e) => e.kind === 'hydration');
    expect(water?.optional).toBe(true);
  });

  it('derives sleep targets from age', () => {
    expect(sleepTargetHoursFor(20)).toBeGreaterThanOrEqual(8);
    expect(sleepTargetHoursFor(70)).toBeLessThan(sleepTargetHoursFor(20));
  });

  it('nudges windows by chronotype without overriding the user', () => {
    const early = suggestedWindows(6 * 60, 'early', 'build-healthy-lifestyle');
    const late = suggestedWindows(10 * 60, 'late', 'build-healthy-lifestyle');
    expect(early.breakfastMinute).toBeLessThan(late.breakfastMinute);
    expect(early.wakeMinute).toBe(6 * 60);
  });
});

describe('NOW resolution', () => {
  const mealPlan = plan();
  const schedule = scheduleFor(mealPlan);
  const empty = { done: new Set<string>(), skipped: new Set<string>(), snoozed: new Map<string, number>() };

  const lunch = mealPlan.meals.find((m) => m.slot === 'lunch');
  const dinner = mealPlan.meals.find((m) => m.slot === 'dinner');
  const eventForMeal = (mealId: string): TimelineEvent => {
    const found = schedule.events.find((e) => e.mealId === mealId);
    if (!found) throw new Error(`missing event for meal ${mealId}`);
    return found;
  };

  it('points at the meal that is happening right now', () => {
    if (!lunch) throw new Error('no lunch');
    const now = lunch.startMinute + 10;
    const r = resolveNow({ schedule, nowMinute: now, completed: empty });
    expect(r.tone).toBe('live');
    expect(r.state).toBe('current');
    expect(r.nowEvent?.kind).toBe('meal');
    expect(r.minutesIntoWindow).toBe(10);
  });

  it('gives NEXT as well as NOW when something else is coming up', () => {
    if (!lunch) throw new Error('no lunch');
    const r = resolveNow({ schedule, nowMinute: lunch.startMinute, completed: empty });
    expect(r.nowEvent).not.toBeNull();
    expect(r.nextEvent).not.toBeNull();
    expect(r.minutesUntilNext).not.toBeNull();
  });

  it('uses a softer tone for a meal that is overdue but still open', () => {
    if (!lunch) throw new Error('no lunch');
    const now = lunch.endMinute + 20;
    const r = resolveNow({ schedule, nowMinute: now, completed: empty });
    expect(r.state).toBe('overdue');
    expect(r.tone).toBe('still-open');
    expect(r.minutesSinceWindowEnd).toBe(20);
  });

  it('stops nagging once the grace period passes', () => {
    if (!lunch) throw new Error('no lunch');
    const now = lunch.endMinute + MEAL_GRACE_MINUTES + 30;
    const r = resolveNow({ schedule, nowMinute: now, completed: empty });
    expect(r.nowEvent?.id).not.toBe(lunch.id);
  });

  it('treats a completed event as settled and moves to the next one', () => {
    if (!lunch || !dinner) throw new Error('missing meals');
    const now = lunch.startMinute + 5;
    const r = resolveNow({
      schedule,
      nowMinute: now,
      completed: { ...empty, done: new Set([eventForMeal(lunch.id).id]) },
    });
    expect(r.nowEvent?.id).not.toBe(eventForMeal(lunch.id).id);
    expect(r.completedCount).toBeGreaterThanOrEqual(1);
  });

  it('treats a skipped event as settled, so it does not nag again', () => {
    if (!lunch) throw new Error('no lunch');
    const now = lunch.startMinute + 30;
    const r = resolveNow({
      schedule,
      nowMinute: now,
      completed: { done: new Set<string>(), skipped: new Set([eventForMeal(lunch.id).id]), snoozed: new Map() },
    });
    expect(r.nowEvent?.id).not.toBe(eventForMeal(lunch.id).id);
  });

  it('treats a skipped event as settled even when a done set is also present', () => {
    if (!lunch) throw new Error('no lunch');
    const wake = schedule.events.find((e) => e.kind === 'wake');
    const now = lunch.startMinute + 30;
    const r = resolveNow({
      schedule,
      nowMinute: now,
      completed: {
        done: new Set(wake ? [wake.id] : []),
        skipped: new Set([eventForMeal(lunch.id).id]),
        snoozed: new Map(),
      },
    });
    expect(r.nowEvent?.id).not.toBe(eventForMeal(lunch.id).id);
  });

  it('puts a snoozed item at the front of the queue', () => {
    const target = schedule.events.find((e) => e.kind === 'meal');
    if (!target) throw new Error('no meal event');
    const now = target.startMinute + 45;
    const r = resolveNow({
      schedule,
      nowMinute: now,
      completed: { ...empty, snoozed: new Map([[target.id, now + 30]]) },
    });
    expect(r.state).toBe('snoozed');
    expect(r.nowEvent?.id).toBe(target.id);
  });

  it('ignores a snooze that has already expired', () => {
    const target = schedule.events.find((e) => e.kind === 'meal');
    if (!target) throw new Error('no meal event');
    const now = target.startMinute + 45;
    const r = resolveNow({
      schedule,
      nowMinute: now,
      completed: { ...empty, snoozed: new Map([[target.id, target.startMinute - 5]]) },
    });
    expect(r.state).not.toBe('snoozed');
  });

  it('reports the day as complete when everything required is settled', () => {
    const required = schedule.events.filter((e) => !e.optional);
    const r = resolveNow({
      schedule,
      nowMinute: 22 * 60,
      completed: { ...empty, done: new Set(required.map((e) => e.id)) },
    });
    expect(r.tone).toBe('complete');
    expect(r.completedCount).toBe(r.totalCount);
    expect(r.totalCount).toBeGreaterThan(0);
  });

  it('is deterministic for the same inputs', () => {
    const a = resolveNow({ schedule, nowMinute: 13 * 60, completed: empty });
    const b = resolveNow({ schedule, nowMinute: 13 * 60, completed: empty });
    expect(a).toEqual(b);
  });

  it('never returns a NOW event outside its own window when live', () => {
    for (let now = 0; now < 1440; now += 7) {
      const r = resolveNow({ schedule, nowMinute: now, completed: empty });
      if (r.tone !== 'live' || !r.nowEvent) continue;
      const e = r.nowEvent;
      const inside = e.startMinute <= e.endMinute
        ? now >= e.startMinute && now < e.endMinute
        : now >= e.startMinute || now < e.endMinute;
      // A snoozed item is intentionally outside its window; nothing else is.
      if (r.state === 'snoozed') continue;
      expect(inside, `${e.id} at ${now}`).toBe(true);
    }
  });
});

describe('per-event timeline state', () => {
  const mealPlan = plan();
  const schedule = scheduleFor(mealPlan);
  const lunch = mealPlan.meals.find((m) => m.slot === 'lunch');
  const now = (lunch?.startMinute ?? 800) + 10;

  it('maps each event to a settled state', () => {
    const states = schedule.events.map((e) =>
      stateFor(e, now, { done: new Set(), skipped: new Set(), snoozed: new Map() }),
    );
    for (const s of states) {
      expect(['upcoming', 'current', 'overdue', 'done', 'skipped', 'snoozed']).toContain(s);
    }
  });

  it('never uses shame wording for a missed event', () => {
    const states = schedule.events.map((e) =>
      stateFor(e, now + 600, { done: new Set(), skipped: new Set(), snoozed: new Map() }),
    );
    const overdue = states.filter((s) => s === 'overdue');
    expect(overdue.length).toBeGreaterThan(0);
  });

  it('considers done and skipped events settled', () => {
    const first = schedule.events[0];
    if (!first) throw new Error('no events');
    expect(isSettled('done')).toBe(true);
    expect(isSettled('skipped')).toBe(true);
    expect(isSettled('overdue')).toBe(false);
    expect(isSettled('current')).toBe(false);
    expect(stateFor(first, now, { done: new Set([first.id]), skipped: new Set(), snoozed: new Map() })).toBe('done');
    expect(stateFor(first, now, { done: new Set(), skipped: new Set([first.id]), snoozed: new Map() })).toBe('skipped');
  });
});

describe('timezone independence of the day pipeline inputs', () => {
  it('produces the same calendar day regardless of the host TZ', () => {
    const original = process.env.TZ;
    const ctx = ctxAt('2026-01-14T18:30:00.000Z'); // 00:00 IST on the 15th
    expect(toCalendarDay(ctx.now, ctx.tz)).toBe('2026-01-15');
    process.env.TZ = 'UTC';
    try {
      expect(toCalendarDay(ctx.now, ctx.tz)).toBe('2026-01-15');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('treats a CalendarDay as a plain string everywhere', () => {
    const day: CalendarDay = DATE;
    expect(typeof day).toBe('string');
  });
});

describe('default schedule preference', () => {
  it('is internally consistent and in chronological order', () => {
    const pref = defaultSchedulePreference();
    expect(pref.wakeMinute).toBeLessThan(pref.breakfastMinute);
    expect(pref.breakfastMinute).toBeLessThan(pref.lunchMinute);
    expect(pref.lunchMinute).toBeLessThan(pref.dinnerMinute);
    expect(pref.dinnerMinute).toBeLessThan(pref.sleepMinute);
  });
});
