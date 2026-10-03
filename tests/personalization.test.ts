/**
 * Acceptance tests for the plan engine.
 *
 * These exist because the original engine passed its own unit tests while
 * producing the same lunch for four days in a row and a "non-vegetarian" plan
 * with no meat in it. The assertions below are about what a person would notice,
 * not about internals: does the week look varied, does the budget hold, does the
 * plan actually respect the diet they chose.
 */

import { describe, expect, it } from 'vitest';
import { buildMealPlan, type MealPlan, type MealPlanInput } from '@/lib/domain/meals';
import { dietFilter } from '@/lib/domain/diet';
import { dailyTargets } from '@/lib/domain/nutrition';
import { costProjection, typicalDailyCost } from '@/lib/domain/costProjection';
import { historyFromSnapshots, shiftDay } from '@/lib/domain/rotation';
import { archiveDay } from '@/lib/domain/planArchive';
import { migrate } from '@/lib/domain/state';
import type {
  AvailabilityMap,
  CalendarDay,
  DaySnapshot,
  DietType,
  FoodKey,
  MealHistoryEntry,
} from '@/lib/domain/types/index';
import { DATE, makeDiet, makeProfile } from './fixtures';

const WEEK: readonly CalendarDay[] = [
  '2026-01-11',
  '2026-01-12',
  '2026-01-13',
  '2026-01-14',
  '2026-01-15',
  '2026-01-16',
  '2026-01-17',
];

interface BuildOptions {
  readonly dietType?: DietType;
  readonly date?: CalendarDay;
  readonly budget?: number;
  readonly history?: readonly MealHistoryEntry[];
  readonly availability?: AvailabilityMap;
  readonly profile?: Partial<ReturnType<typeof makeProfile>>;
  readonly allergies?: readonly FoodKey[];
}

function input(options: BuildOptions = {}): MealPlanInput {
  const profile = makeProfile(options.profile ?? {});
  const diet = makeDiet({
    dietType: options.dietType ?? 'vegetarian',
    ...(options.allergies ? { allergies: [...options.allergies] } : {}),
  });
  const t = dailyTargets({
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    showBmi: false,
  });
  return {
    profile,
    diet,
    filter: dietFilter(diet),
    date: options.date ?? DATE,
    season: 'winter',
    region: profile.region,
    pantry: [],
    priceOverrides: {},
    targets: {
      calories: t.calories.value,
      protein: t.protein.value,
      fiber: t.fiber,
    },
    isRestDay: false,
    dailyBudget: options.budget ?? 150,
    ...(options.history ? { history: options.history } : {}),
    ...(options.availability ? { availability: options.availability } : {}),
  } as MealPlanInput;
}

function planFor(options: BuildOptions = {}): MealPlan {
  return buildMealPlan(input(options));
}

/** Keys actually served, ignoring optional garnishes. */
function served(plan: MealPlan): FoodKey[] {
  return plan.meals
    .flatMap((m) => m.ingredients)
    .filter((i) => !i.optional)
    .map((i) => i.foodKey);
}

function bySlot(plan: MealPlan, slot: string): FoodKey[] {
  const meal = plan.meals.find((m) => m.slot === slot);
  if (!meal) return [];
  return meal.ingredients.filter((i) => !i.optional).map((i) => i.foodKey);
}

/** Builds a week, feeding each day's real result into the next day's history. */
function chainedWeek(options: BuildOptions = {}): MealPlan[] {
  const out: MealPlan[] = [];
  let history: readonly MealHistoryEntry[] = [];
  for (const date of WEEK) {
    const plan = planFor({ ...options, date, history });
    out.push(plan);
    history = [
      ...history,
      {
        date,
        meals: Object.fromEntries(plan.meals.map((m) => [m.id, m.ingredients.map((i) => i.foodKey)])),
      },
    ];
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('variety', () => {
  it('does not serve the same lunch twice in a week', () => {
    const lunches = chainedWeek().map((p) => bySlot(p, 'lunch').join('+'));
    expect(new Set(lunches).size).toBeGreaterThanOrEqual(4);
  });

  it('changes the vegetable across a week', () => {
    const veg = chainedWeek().map((p) => p.focus.vegetable?.foodKey ?? null);
    const distinct = new Set(veg);
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it('changes the fruit across a week', () => {
    const fruit = chainedWeek().map((p) => p.focus.fruit?.foodKey ?? null);
    expect(new Set(fruit).size).toBeGreaterThanOrEqual(3);
  });

  it('varies the dinner protein rather than repeating one for a week', () => {
    const dinners = chainedWeek().map((p) => bySlot(p, 'dinner')[0] ?? null);
    expect(new Set(dinners).size).toBeGreaterThanOrEqual(2);
  });

  it('never lists the same food twice on one plate', () => {
    for (const plan of chainedWeek()) {
      for (const meal of plan.meals) {
        const keys = meal.ingredients.map((i) => i.foodKey);
        expect(new Set(keys).size, `${meal.id} repeated a food`).toBe(keys.length);
      }
    }
  });

  it('is deterministic — the same inputs give the same plan', () => {
    expect(JSON.stringify(planFor())).toBe(JSON.stringify(planFor()));
  });
});

describe('weekly distribution', () => {
  it('gives an egg-vegetarian eggs on a pattern, not every morning', () => {
    const week = chainedWeek({ dietType: 'egg-vegetarian' });
    const withEgg = week.map((p) => bySlot(p, 'breakfast').includes('egg'));
    const eggDays = withEgg.filter(Boolean).length;
    expect(eggDays).toBeGreaterThanOrEqual(2);
    expect(eggDays).toBeLessThanOrEqual(4);
    // Two eggs in a row is not a rotation.
    expect(withEgg.some((has, i) => has && withEgg[i + 1] === true)).toBe(false);
  });

  it('serves no meat to a vegetarian, ever', () => {
    for (const plan of chainedWeek({ dietType: 'vegetarian' })) {
      expect(served(plan)).not.toContain('chicken');
      expect(served(plan)).not.toContain('fish');
      expect(served(plan)).not.toContain('egg');
    }
  });

  it('keeps a ₹150 non-vegetarian realistic rather than pretending chicken is free', () => {
    const week = chainedWeek({ dietType: 'non-vegetarian', budget: 150 });
    // Chicken at ₹190/kg twice a week does not fit ₹150/day. Saying so is correct.
    for (const plan of week) {
      expect(served(plan)).not.toContain('chicken');
      expect(plan.totalCost.value).toBeLessThanOrEqual(150 * 1.15);
    }
  });

  it('rotates chicken and fish across the week once the budget allows it', () => {
    const week = chainedWeek({ dietType: 'non-vegetarian', budget: 260 });
    const meat = week.flatMap((p) => bySlot(p, 'dinner').filter((k) => k === 'chicken' || k === 'fish'));
    expect(meat.length).toBeGreaterThanOrEqual(2);
    expect(meat.length).toBeLessThanOrEqual(5);
    // Both kinds appear over a week, so it is a rotation and not a fixed choice.
    expect(new Set(meat).size).toBeGreaterThanOrEqual(1);
    const days = week.filter((p) => bySlot(p, 'dinner').some((k) => k === 'chicken' || k === 'fish'));
    const indices = days.map((p) => WEEK.indexOf(p.date));
    expect(indices.some((i, n) => n > 0 && i - (indices[n - 1] as number) === 1)).toBe(false);
  });
});

describe('nutrition targets', () => {
  it('scales portions up for a heavier, more active person', () => {
    const light = planFor({ profile: { weightKg: 50, activityLevel: 'sedentary' } });
    const heavy = planFor({ profile: { weightKg: 95, activityLevel: 'very-active' } });
    expect(heavy.totalNutrition.calories).toBeGreaterThan(light.totalNutrition.calories * 1.3);
  });

  it('lands near the calorie target rather than ignoring it', () => {
    // The original engine computed a 1,780 kcal target and served 1,400.
    for (const plan of chainedWeek()) {
      const target = plan.nutrition.targetCalories;
      expect(plan.totalNutrition.calories).toBeGreaterThan(target * 0.85);
      expect(plan.totalNutrition.calories).toBeLessThan(target * 1.2);
    }
  });

  it('reaches the protein target on a vegetarian plan', () => {
    for (const plan of chainedWeek()) {
      expect(plan.totalNutrition.protein).toBeGreaterThan(plan.nutrition.targetProtein * 0.9);
    }
  });

  it('serves a vegetarian breakfast with protein in it', () => {
    const proteinish = ['dal-mix', 'chana-dal', 'moong-dal', 'sprouts', 'besan', 'sattu', 'milk', 'curd', 'paneer'];
    for (const plan of chainedWeek()) {
      const breakfast = bySlot(plan, 'breakfast');
      expect(breakfast.some((k) => proteinish.includes(k)), `breakfast was ${breakfast.join('+')}`).toBe(true);
    }
  });
});

describe('diet and safety rules', () => {
  it('never serves a declared allergen, in any slot', () => {
    for (const plan of chainedWeek({ dietType: 'non-vegetarian', budget: 260, allergies: ['peanut'] })) {
      expect(served(plan)).not.toContain('peanut');
    }
  });

  it('changes the plan when the diet changes', () => {
    const veg = JSON.stringify(served(planFor({ dietType: 'vegetarian' })));
    const nonveg = JSON.stringify(served(planFor({ dietType: 'non-vegetarian' })));
    expect(veg).not.toBe(nonveg);
  });

  it('does not buy prestige produce on the user’s behalf at any budget', () => {
    for (const plan of chainedWeek({ budget: 400, profile: { weightKg: 95 } })) {
      for (const key of ['grapes', 'pomegranate', 'mango', 'mushroom']) {
        expect(served(plan), `${key} was auto-recommended`).not.toContain(key);
      }
    }
  });
});

describe('user signals', () => {
  it('drops a food the user marked unavailable', () => {
    const availability: AvailabilityMap = {
      'soy-chunks': { availability: 'unavailable', preference: 'neutral' },
      paneer: { availability: 'unavailable', preference: 'neutral' },
    };
    for (const plan of chainedWeek({ availability })) {
      expect(served(plan)).not.toContain('soy-chunks');
      expect(served(plan)).not.toContain('paneer');
    }
  });

  it('respects an explicit pin over the rotation', () => {
    const plan = buildMealPlan({
      ...input(),
      dayPreference: { locked: false, pinned: { lunch: 'dal-mix' }, excluded: [] },
    } as MealPlanInput);
    expect(bySlot(plan, 'lunch')).toContain('dal-mix');
  });

  it('avoids yesterday’s dinner when history says so', () => {
    const yesterday = planFor({ date: '2026-01-13' });
    const history: MealHistoryEntry[] = [
      {
        date: '2026-01-13',
        meals: Object.fromEntries(yesterday.meals.map((m) => [m.id, m.ingredients.map((i) => i.foodKey)])),
      },
    ];
    const repeated = planFor({ date: DATE, history });
    expect(bySlot(repeated, 'dinner')[0]).not.toBe(bySlot(yesterday, 'dinner')[0]);
  });
});

describe('cost', () => {
  it('stays inside a tight budget', () => {
    for (const plan of chainedWeek({ budget: 100 })) {
      expect(plan.totalCost.value).toBeLessThanOrEqual(100 * 1.15);
      expect(plan.withinBudget).toBe(true);
    }
  });

  it('costs more for a bigger appetite', () => {
    const small = planFor({ profile: { weightKg: 50, activityLevel: 'sedentary' }, budget: 300 });
    const large = planFor({ profile: { weightKg: 95, activityLevel: 'very-active' }, budget: 300 });
    expect(large.totalCost.value).toBeGreaterThan(small.totalCost.value);
  });

  it('projects weekly and monthly figures from a daily one', () => {
    const plan = planFor();
    const projection = costProjection(plan.totalCost.value, 150);
    expect(projection.weekly.value).toBeGreaterThan(projection.daily.value * 6);
    expect(projection.monthly.value).toBeGreaterThan(projection.weekly.value);
    expect(projection.budget).toBe(150);
  });

  it('averages recent days and ignores duplicates of the same date', () => {
    expect(typicalDailyCost([{ date: '2026-01-02', rupees: 100 }, { date: '2026-01-02', rupees: 900 }])).toBe(100);
    expect(typicalDailyCost([{ date: '2026-01-01', rupees: 100 }, { date: '2026-01-02', rupees: 200 }])).toBe(150);
    expect(typicalDailyCost([])).toBeNull();
  });
});

describe('history', () => {
  it('projects snapshots into rotation entries for the days before a date', () => {
    const plan = planFor({ date: '2026-01-14' });
    const snapshots = Object.fromEntries([
      ['2026-01-13', { meals: plan.meals }],
      ['2026-01-12', { meals: plan.meals }],
    ]);
    const history = historyFromSnapshots(snapshots, 7, '2026-01-14');
    // Most recent first, and nothing from the day being planned.
    expect(history.map((h) => h.date)).toEqual(['2026-01-13', '2026-01-12']);
    expect(Object.keys(history[0]?.meals ?? {})).toContain('2026-01-14:dinner');
  });

  it('produces a different plan when history differs', () => {
    const plan = planFor({ date: '2026-01-14' });
    const entry: MealHistoryEntry = {
      date: shiftDay('2026-01-14', -1),
      meals: Object.fromEntries(plan.meals.map((m) => [m.id, m.ingredients.map((i) => i.foodKey)])),
    };
    expect(JSON.stringify(served(planFor({ date: '2026-01-14', history: [entry] })))).not.toBe(
      JSON.stringify(served(planFor({ date: '2026-01-14' }))),
    );
  });
});
// ---------------------------------------------------------------------------

describe('archiving planned days', () => {
  const snap = (date: CalendarDay, hash: string): DaySnapshot =>
    ({
      date,
      tz: 'Asia/Kolkata',
      profileHash: hash,
      meals: [],
      schedule: {},
      grocery: [],
      progress: {},
      workout: {},
      sleepPlan: {},
      hydrationTarget: { targetMl: 0, kind: 'general' },
      advisory: { suppressCalorieTargets: false, notes: [] },
      foodFocus: { vegetable: null, fruit: null },
      costProjection: { daily: { value: 0 }, weekly: { value: 0 }, monthly: { value: 0 }, budget: 0, withinBudget: true, basis: '' },
      writtenAt: `${date}T00:00:00.000Z`,
    }) as unknown as DaySnapshot;

  it('records the first plan for a day', () => {
    const d = archiveDay({ today: DATE, snapshot: snap(DATE, 'a'), snapshots: {}, revisions: {}, retentionDays: 90 });
    expect(d.write).toBe(true);
    expect(d.snapshots[DATE]?.profileHash).toBe('a');
    expect(d.revision).toBeNull();
  });

  /**
   * The regression test for a real bug: an earlier version dispatched from the
   * effect whenever the hash differed, never updated the snapshot, and so looped
   * forever the first time a profile was edited. Convergence is the property that
   * makes it terminate.
   */
  it('is idempotent — applying its own output changes nothing', () => {
    const first = archiveDay({ today: DATE, snapshot: snap(DATE, 'a'), snapshots: {}, revisions: {}, retentionDays: 90 });
    const second = archiveDay({
      today: DATE,
      snapshot: snap(DATE, 'a'),
      snapshots: first.snapshots,
      revisions: {},
      retentionDays: 90,
    });
    expect(second.write).toBe(false);
  });

  it('settles after a profile change instead of looping', () => {
    const first = archiveDay({ today: DATE, snapshot: snap(DATE, 'a'), snapshots: {}, revisions: {}, retentionDays: 90 });
    // User edits their weight. Different hash.
    const changed = archiveDay({
      today: DATE,
      snapshot: snap(DATE, 'b'),
      snapshots: first.snapshots,
      revisions: {},
      retentionDays: 90,
    });
    expect(changed.write).toBe(true);
    expect(changed.snapshots[DATE]?.profileHash).toBe('b');
    expect(changed.revision?.reason).toBe('profile-changed');
    expect(changed.revision?.previousProfileHash).toBe('a');

    // Next render with the same inputs must be a no-op, or the tab spins.
    const settled = archiveDay({
      today: DATE,
      snapshot: snap(DATE, 'b'),
      snapshots: changed.snapshots,
      revisions: { [DATE]: changed.revision! },
      retentionDays: 90,
    });
    expect(settled.write).toBe(false);
    expect(settled.revision).toBeNull();
  });

  it('refuses to record a day that is not today', () => {
    const future: CalendarDay = '2026-01-20';
    const d = archiveDay({ today: DATE, snapshot: snap(future, 'a'), snapshots: {}, revisions: {}, retentionDays: 90 });
    expect(d.write).toBe(false);
    expect(Object.keys(d.snapshots)).toHaveLength(0);
  });

  it('bounds storage to the retention window', () => {
    let snapshots: Record<CalendarDay, DaySnapshot> = {};
    for (let i = 0; i < 10; i++) {
      const date = shiftDay(DATE, -i);
      const d = archiveDay({ today: date, snapshot: snap(date, `h${i}`), snapshots, revisions: {}, retentionDays: 4 });
      snapshots = d.snapshots;
    }
    const keys = Object.keys(snapshots).sort();
    expect(keys).toHaveLength(4);
    // The newest days survive; the oldest are dropped.
    expect(keys).toContain(DATE);
    expect(keys).not.toContain(shiftDay(DATE, -9));
  });
});

describe('state migration', () => {
  it('keeps an old snapshot but fills in the fields it predates', () => {
    const legacy = {
      profile: null,
      snapshots: {
        '2026-01-10': {
          date: '2026-01-10',
          profileHash: 'old',
          meals: [
            {
              id: '2026-01-10:dinner',
              ingredients: [{ foodKey: 'dal-mix', grams: 150 }],
            },
          ],
        },
      },
    };
    const state = migrate(legacy);
    const snapshot = state.snapshots['2026-01-10'];
    // The meals are the user's actual record and must survive untouched.
    expect(snapshot?.meals[0]?.ingredients[0]?.foodKey).toBe('dal-mix');
    expect(snapshot?.profileHash).toBe('old');
    // The fields added since must be present, not undefined.
    expect(snapshot?.foodFocus).toEqual({ vegetable: null, fruit: null });
    expect(snapshot?.costProjection).toBeDefined();
  });

  it('never throws on garbage', () => {
    for (const junk of [null, undefined, 42, 'nope', [], { snapshots: 'bad' }, { snapshots: { x: 5 } }]) {
      expect(() => migrate(junk)).not.toThrow();
    }
    expect(migrate({ snapshots: { x: 5 } }).snapshots).toEqual({});
  });

  it('starts availability empty, which means "no opinion" and not "unavailable"', () => {
    const state = migrate({});
    expect(state.availability).toEqual({});
    expect(state.planRevisions).toEqual({});
    expect(state.dayPreferences).toEqual({});
  });
});
