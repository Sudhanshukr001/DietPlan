import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_FLOOR_ML,
  HARD_CEILING_ML,
  ML_PER_LITRE,
  QUICK_ADD_ML,
  consumedMl,
  hydrationAdvice,
  hydrationNudges,
  hydrationSummary,
  hydrationTarget,
  remainingMl,
} from '@/lib/domain/hydration';
import type { HydrationEntry } from '@/lib/domain/types/index';
import { DATE, makeProfile } from './fixtures';

function target(over: Partial<Parameters<typeof hydrationTarget>[0]> = {}) {
  return hydrationTarget({
    weightKg: 58,
    activityLevel: 'light',
    exerciseMinutes: 30,
    weather: 'mild',
    fluidRestrictionCaution: false,
    isRestDay: false,
    ...over,
  });
}

describe('hydration target', () => {
  it('scales with body weight and explains every adjustment', () => {
    const light = target({ weightKg: 50 });
    const heavy = target({ weightKg: 90 });
    expect(heavy.targetMl).toBeGreaterThan(light.targetMl);
    expect(target().adjustments.length).toBeGreaterThan(1);
    for (const a of target().adjustments) {
      expect(a.label.length).toBeGreaterThan(3);
    }
    expect(target().basis.length).toBeGreaterThan(10);
  });

  it('adds more in hot weather and around exercise', () => {
    const mild = target({ weather: 'mild' });
    const hot = target({ weather: 'hot', temperatureC: 39 });
    const rest = target({ isRestDay: true, exerciseMinutes: 0 });
    expect(hot.targetMl).toBeGreaterThan(mild.targetMl);
    expect(rest.targetMl).toBeLessThan(mild.targetMl);
  });

  it('never falls below a sane floor, however small the person is', () => {
    const tiny = target({ weightKg: 35 });
    expect(tiny.targetMl).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_ML);
  });

  it('never exceeds a safe ceiling, however large the person is', () => {
    const huge = target({ weightKg: 200, activityLevel: 'very-active', exerciseMinutes: 180, weather: 'hot', temperatureC: 45 });
    expect(huge.targetMl).toBeLessThanOrEqual(HARD_CEILING_ML);
    expect(huge.ceilingMl).toBeLessThanOrEqual(HARD_CEILING_ML);
  });

  it('adds a professional note when fluid needs a clinician', () => {
    const caution = target({ fluidRestrictionCaution: true });
    expect(caution.consultNote ?? '').toMatch(/doctor|clinician|medical/i);
    expect(target().consultNote).toBeUndefined();
  });

  it('never asks a restricted user to drink more', () => {
    const caution = target({ fluidRestrictionCaution: true });
    const normal = target();
    expect(caution.targetMl).toBeLessThanOrEqual(normal.targetMl);
  });

  it('is deterministic', () => {
    expect(target()).toEqual(target());
  });
});

describe('logging water', () => {
  const entries: HydrationEntry[] = [
    { id: '1', date: DATE, minute: 420, ml: 500, source: 'quick-add' },
    { id: '2', date: DATE, minute: 720, ml: 300, source: 'quick-add' },
    { id: '3', date: '2026-01-15', minute: 420, ml: 1000, source: 'quick-add' },
  ];

  it('sums only today', () => {
    expect(consumedMl(entries, DATE)).toBe(800);
  });

  it('never lets one entry claim an absurd amount', () => {
    const silly: HydrationEntry[] = [{ id: 'x', date: DATE, minute: 600, ml: 9000, source: 'quick-add' }];
    expect(consumedMl(silly, DATE)).toBeLessThanOrEqual(1500);
  });

  it('reports the remaining amount without going negative', () => {
    const t = target();
    expect(remainingMl(t, 500)).toBe(t.targetMl - 500);
    expect(remainingMl(t, t.targetMl + 5000)).toBe(0);
  });

  it('offers sensible quick-add sizes', () => {
    expect(QUICK_ADD_ML).toContain(250);
    expect(QUICK_ADD_ML).toContain(500);
    expect(Math.min(...QUICK_ADD_ML)).toBeLessThanOrEqual(ML_PER_LITRE / 2);
  });
});

describe('water nudges', () => {
  const t = target();
  const nudges = hydrationNudges({
    target: t,
    wakeMinute: makeProfile().schedule.wakeMinute,
    sleepMinute: makeProfile().schedule.sleepMinute,
    date: DATE,
  });

  it('spreads the day into a handful of nudges, not a stream', () => {
    expect(nudges.length).toBeGreaterThanOrEqual(3);
    expect(nudges.length).toBeLessThanOrEqual(6);
  });

  it('places nudges inside waking hours and in order', () => {
    const wake = makeProfile().schedule.wakeMinute;
    const sleep = makeProfile().schedule.sleepMinute;
    let prev = -1;
    for (const n of nudges) {
      expect(n.minute).toBeGreaterThanOrEqual(wake);
      expect(n.minute).toBeLessThan(sleep);
      expect(n.minute).toBeGreaterThan(prev);
      prev = n.minute;
    }
  });

  it('gives each nudge a reason, not just a number', () => {
    for (const n of nudges) {
      expect(n.label.length).toBeGreaterThan(3);
      expect(n.reason.length).toBeGreaterThan(10);
      expect(n.suggestedMl).toBeGreaterThan(0);
    }
  });

  it('adds a nudge around exercise when there is one', () => {
    const withExercise = hydrationNudges({
      target: t,
      wakeMinute: makeProfile().schedule.wakeMinute,
      sleepMinute: makeProfile().schedule.sleepMinute,
      date: DATE,
      exerciseMinute: makeProfile().schedule.exerciseMinute,
    });
    expect(withExercise.length).toBeGreaterThanOrEqual(nudges.length);
  });

  it('handles a night-shift sleeper without producing impossible times', () => {
    const night = hydrationNudges({
      target: t,
      wakeMinute: 16 * 60,
      sleepMinute: 4 * 60,
      date: DATE,
    });
    expect(night.length).toBeGreaterThan(0);
    for (const n of night) {
      expect(n.minute).toBeGreaterThanOrEqual(0);
      expect(n.minute).toBeLessThanOrEqual(1439);
    }
  });
});

describe('summary and advice', () => {
  const t = target();

  it('summarises progress towards the target', () => {
    const summary = hydrationSummary([{ id: '1', date: DATE, minute: 420, ml: 1200, source: 'quick-add' }], DATE, t);
    expect(summary.consumed).toBe(1200);
    expect(summary.target).toBe(t.targetMl);
    expect(summary.remaining).toBe(t.targetMl - 1200);
    expect(summary.entriesToday).toBe(1);
    expect(summary.percent).toBeGreaterThan(0);
    expect(summary.lastEntryMinute).toBe(420);
  });

  it('caps the displayed percentage at 100%', () => {
    const over = hydrationSummary(
      [
        { id: '1', date: DATE, minute: 600, ml: 1500, source: 'quick-add' },
        { id: '2', date: DATE, minute: 900, ml: 1500, source: 'quick-add' },
        { id: '3', date: DATE, minute: 1200, ml: 1500, source: 'quick-add' },
      ],
      DATE,
      t,
    );
    expect(over.percent).toBe(1);
  });

  it('is encouraging when behind rather than nagging', () => {
    const behind = hydrationAdvice(
      hydrationSummary([{ id: '1', date: DATE, minute: 500, ml: 300, source: 'quick-add' }], DATE, t),
      t,
    );
    const text = behind.toLowerCase();
    expect(text).not.toMatch(/fail|behind|missed|should have/);
    expect(behind.length).toBeGreaterThan(10);
  });

  it('says something useful when the target is met', () => {
    const done = hydrationAdvice(
      hydrationSummary(
        [{ id: '1', date: DATE, minute: 900, ml: t.targetMl, source: 'quick-add' }],
        DATE,
        t,
      ),
      t,
    );
    expect(done.length).toBeGreaterThan(5);
    expect(done.toLowerCase()).not.toMatch(/drink more/);
  });
});
