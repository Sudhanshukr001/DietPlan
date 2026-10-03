import { describe, expect, it } from 'vitest';
import { buildDay, type DayInputs } from '@/lib/domain/pipeline';
import { blankState, migrate } from '@/lib/domain/state';
import { resolveNow } from '@/lib/domain/schedule';
import { advisoryFor } from '@/lib/domain/safety';
import { CTX, DATE, ctxAt, makeDiet, makeHealth, makeProfile, makeSettings } from './fixtures';

function inputs(over: Partial<DayInputs> = {}): DayInputs {
  return {
    profile: makeProfile(),
    diet: makeDiet(),
    health: makeHealth(),
    settings: makeSettings(),
    pantry: [],
    priceOverrides: {},
    hydration: [],
    workouts: [],
    sleep: [],
    skips: [],
    doneEventIds: new Set(),
    snoozed: new Map(),
    streak: 3,
    isRestDay: false,
    history: [] as never[],
    availability: {},
    writtenAt: '2026-01-14T05:42:00.000Z',
    ...over,
  };
}

describe('day pipeline', () => {
  it('produces everything a day screen needs from one call', () => {
    const r = buildDay(inputs(), CTX);
    expect(r.date).toBe(DATE);
    expect(r.snapshot.date).toBe(DATE);
    expect(r.snapshot.meals.length).toBe(5);
    expect(r.snapshot.schedule.events.length).toBeGreaterThan(5);
    expect(r.snapshot.grocery.length).toBeGreaterThan(0);
    expect(r.snapshot.workout.blocks.length).toBeGreaterThan(0);
    expect(r.snapshot.sleepPlan.ladder.length).toBeGreaterThan(0);
    expect(r.snapshot.hydrationTarget.targetMl).toBeGreaterThan(0);
    expect(r.resolution.nowEvent ?? r.resolution.nextEvent).not.toBeNull();
    expect(r.tz).toBe(CTX.tz);
  });

  it('is pure: identical inputs give an identical snapshot', () => {
    const a = buildDay(inputs(), CTX);
    const b = buildDay(inputs(), CTX);
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot));
    expect(a.resolution).toEqual(b.resolution);
  });

  it('uses the injected clock, never the wall clock', () => {
    const morning = ctxAt('2026-01-14T02:30:00.000Z'); // 08:00 IST
    const night = ctxAt('2026-01-14T18:30:00.000Z'); // 00:00 IST next day
    expect(buildDay(inputs(), morning).date).toBe('2026-01-14');
    expect(buildDay(inputs(), night).date).toBe('2026-01-15');
    expect(buildDay(inputs(), night).nowMinute).toBe(0);
  });

  it('changes the plan when a profile changes mid-day', () => {
    const before = buildDay(inputs(), CTX);
    const after = buildDay(inputs({ profile: makeProfile({ goal: 'gain-weight', weightKg: 52 }) }), CTX);
    expect(after.targetNutrition.calories).not.toBe(before.targetNutrition.calories);
    expect(after.plan.meals).not.toEqual(before.plan.meals);
  });

  it('reflows NOW when the user changes their meal times', () => {
    const late = buildDay(inputs({ profile: makeProfile({ lunchMinute: 16 * 60 }) }), CTX);
    const lunch = late.plan.meals.find((m) => m.slot === 'lunch');
    expect(lunch?.startMinute).toBe(16 * 60);
    // At 13:42 nothing should be pointing at lunch any more.
    const r = resolveNow({
      schedule: late.snapshot.schedule,
      nowMinute: late.nowMinute,
      completed: late.completed,
    });
    if (r.nowEvent?.mealId) expect(r.nowEvent.mealId).not.toBe(lunch?.id);
  });

  it('carries the advisory mode into the snapshot when conditions are declared', () => {
    const r = buildDay(inputs({ health: makeHealth({ declaredConditions: ['kidney-disease'] }) }), CTX);
    expect(r.snapshot.advisory.active).toBe(true);
    // Deliberately unchanged: we do not invent a clinical fluid number, we tell
    // the user not to use ours.
    expect(r.hydrationTarget.targetMl).toBe(buildDay(inputs(), CTX).hydrationTarget.targetMl);
    expect(r.hydrationTarget.consultNote ?? '').toMatch(/doctor/i);
  });

  it('reflects logged water, meals and workouts in progress', () => {
    const meal = buildDay(inputs(), CTX).snapshot.meals[0];
    if (!meal) throw new Error('no meals');
    const r = buildDay(
      inputs({
        hydration: [
          { id: 'h1', date: DATE, minute: 480, ml: 500, source: 'quick-add' },
          { id: 'h2', date: '2026-01-13', minute: 480, ml: 900, source: 'quick-add' },
        ],
        doneEventIds: new Set([`${DATE}:meal:${meal.id}`]),
        streak: 6,
      }),
      CTX,
    );
    expect(r.consumedMl).toBe(500);
    expect(r.snapshot.progress.mealsDone).toBe(1);
    expect(r.snapshot.progress.streak).toBe(6);
  });

  it('removes a skipped meal from the day without deleting the record', () => {
    const meal = buildDay(inputs(), CTX).snapshot.meals[1];
    if (!meal) throw new Error('no meals');
    const r = buildDay(
      inputs({ skips: [{ id: 's1', date: DATE, slot: meal.slot, reason: 'no-time', eventId: `${DATE}:meal:${meal.id}`, minute: 700 }] }),
      CTX,
    );
    expect(r.completed.skipped?.has(`${DATE}:meal:${meal.id}`)).toBe(true);
    const resolution = resolveNow({ schedule: r.snapshot.schedule, nowMinute: meal.startMinute, completed: r.completed });
    expect(resolution.nowEvent?.id).not.toBe(`${DATE}:meal:${meal.id}`);
  });

  it('respects the day budget end to end', () => {
    const tight = buildDay(inputs({ settings: makeSettings({ dailyBudget: 60 }) }), CTX);
    const loose = buildDay(inputs({ settings: makeSettings({ dailyBudget: 400 }) }), CTX);
    expect(tight.plan.totalCost.value).toBeLessThanOrEqual(loose.plan.totalCost.value * 1.1);
    expect(tight.budgetCheck.budget).toBe(60);
  });

  it('gives a rest day a recovery workout and no exercise event', () => {
    const r = buildDay(inputs({ isRestDay: true }), CTX);
    expect(r.snapshot.workout.blocks.length).toBeLessThanOrEqual(2);
    expect(r.snapshot.schedule.events.some((e) => e.kind === 'exercise')).toBe(false);
  });

  it('stays consistent with the advisory function it depends on', () => {
    const health = makeHealth({ declaredConditions: ['hypertension'] });
    const r = buildDay(inputs({ health }), CTX);
    expect(r.snapshot.advisory).toEqual(advisoryFor(health));
  });
});

describe('persisted state round-trip through the pipeline', () => {
  it('can replay a day from migrated storage alone', () => {
    const stored = JSON.parse(
      JSON.stringify({
        ...blankState(DATE),
        profile: makeProfile(),
        diet: makeDiet({ allergies: ['milk'] }),
        health: makeHealth(),
        settings: makeSettings(),
      }),
    ) as ReturnType<typeof blankState>;

    const migrated = migrate(stored);
    const ctx = CTX;

    const r = buildDay(
      {
        profile: migrated.profile ?? makeProfile(),
        diet: migrated.diet,
        health: migrated.health,
        settings: migrated.settings,
        pantry: Object.keys(migrated.pantry) as Parameters<typeof buildDay>[0]['pantry'],
        priceOverrides: migrated.localPriceOverrides,
        hydration: migrated.hydration,
        workouts: migrated.workouts,
        sleep: migrated.sleep,
        skips: migrated.skips,
        doneEventIds: new Set(),
        snoozed: new Map(),
        streak: 0,
        isRestDay: false,
        history: [] as never[],
        availability: {},
        writtenAt: '2026-01-14T05:42:00.000Z',
      },
      ctx,
    );

    expect(r.snapshot.meals.length).toBe(5);
    for (const meal of r.snapshot.meals) {
      expect(meal.ingredients.every((i) => i.foodKey !== 'milk')).toBe(true);
    }
  });
});
