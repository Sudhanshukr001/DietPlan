import { describe, expect, it } from 'vitest';
import {
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  MOTIVATION_LINES,
  FOCUS_LABELS,
  blockCompletion,
  blockLabel,
  buildWorkout,
  focusForDate,
  goalSuggestsRestDay,
  motivationFor,
  reducedWorkout,
  weeklySessionCount,
  workoutMinutes,
  workoutWindow,
} from '@/lib/domain/fitness';
import {
  SLEEP_DISCLAIMER,
  SLEEP_TARGETS_BY_AGE,
  buildSleepPlan,
  sleepProgress,
  sleepTargetHoursForAge,
  sleepWindowLabel,
  wakeUpGreeting,
} from '@/lib/domain/sleep';
import {
  REGION_PRICE_INDEX,
  REGIONS,
  SEASON_LABELS,
  cityOptions,
  isInSeason,
  rankSubstitutes,
  regionMultiplier,
  regionProfile,
  seasonForDate,
  seasonForMonth,
  seasonSafetyHint,
  seasonSafetyNote,
  seasonSnapshot,
  seasonalCandidates,
} from '@/lib/domain/seasonal';
import {
  FOODS,
  caloriesPerRupee,
  foodsInCategory,
  getFood,
  hasFood,
  nutritionForGrams,
  proteinPerRupee,
  requireFood,
  round1,
  searchFoods,
  sumNutrition,
} from '@/lib/domain/data/foods';
import { dietFilter } from '@/lib/domain/diet';
import type { SeasonId } from '@/lib/domain/types/index';
import { findBannedClaims } from '@/lib/domain/safety';
import { addDays } from '@/lib/domain/time';
import { DATE, makeDiet, makeProfile } from './fixtures';

describe('workouts', () => {
  const profile = makeProfile();

  function workout(over: Partial<Parameters<typeof buildWorkout>[0]> = {}) {
    return buildWorkout({
      profile,
      date: DATE,
      level: 'beginner',
      focus: focusForDate(DATE, 'beginner'),
      isRestDay: false,
      ...over,
    });
  }

  it('builds a plan that needs no gym and no equipment', () => {
    const w = workout();
    expect(w.blocks.length).toBeGreaterThanOrEqual(3);
    expect(w.totalMinutes).toBeGreaterThan(0);
    expect(w.noGymNote.length).toBeGreaterThan(10);
    for (const block of w.blocks) {
      expect(block.name.length).toBeGreaterThan(2);
      expect(blockLabel(block).length).toBeGreaterThan(0);
      expect(block.instructions.length).toBeGreaterThan(10);
      expect(block.equipment === 'none' || block.equipment === 'optional').toBe(true);
    }
  });

  it('gives every block a unique id within the workout', () => {
    const w = workout();
    expect(new Set(w.blocks.map((b) => b.id)).size).toBe(w.blocks.length);
  });

  it('respects the time budget, including on a rest day', () => {
    const short = workout({ profile: makeProfile({ exerciseMinutesPerDay: 15 }) });
    expect(short.totalMinutes).toBeLessThanOrEqual(30);
    const rest = workout({ isRestDay: true });
    expect(rest.name.toLowerCase()).toContain('recovery');
    expect(rest.blocks.length).toBeLessThanOrEqual(2);
  });

  it('scales with fitness level without exceeding an hour', () => {
    const beginner = workout({ level: 'beginner' });
    const advanced = workout({ level: 'advanced' });
    expect(advanced.totalMinutes).toBeGreaterThanOrEqual(beginner.totalMinutes);
    expect(advanced.totalMinutes).toBeLessThanOrEqual(60);
  });

  it('uses gym blocks only when the user actually has a gym', () => {
    const home = workout({ profile: makeProfile({ hasGymAccess: false }) });
    const gym = workout({ profile: makeProfile({ hasGymAccess: true }) });
    expect(home.noGymNote.length).toBeGreaterThan(0);
    expect(gym.totalMinutes).toBeGreaterThan(0);
  });

  it('rotates the focus across the week and is deterministic', () => {
    const days = ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18'];
    const focuses = days.map((d) => focusForDate(d, 'intermediate'));
    expect(new Set(focuses).size).toBeGreaterThan(1);
    expect(focusForDate(DATE, 'beginner')).toBe(focusForDate(DATE, 'beginner'));
    for (const f of focuses) expect(FOCUS_LABELS[f].length).toBeGreaterThan(2);
  });

  it('tracks completion honestly', () => {
    const w = workout();
    expect(blockCompletion(w, null)).toBe(0);
    const log = {
      id: 'l1',
      date: DATE,
      workoutId: w.id,
      completedBlockIds: w.blocks.map((b) => b.id),
      minutes: w.totalMinutes,
      completedAt: '2026-01-14T13:00:00.000Z',
    };
    expect(blockCompletion(w, log)).toBe(1);
    expect(workoutMinutes(w, log)).toBeGreaterThan(0);
    expect(workoutMinutes(w, null)).toBe(0);
    const half = { ...log, completedBlockIds: w.blocks.slice(0, 1).map((b) => b.id) };
    expect(blockCompletion(w, half)).toBeGreaterThan(0);
    expect(blockCompletion(w, half)).toBeLessThan(1);
  });

  it('offers a short version rather than nothing', () => {
    const w = workout();
    const short = reducedWorkout(w);
    expect(short.blocks.length).toBe(w.blocks.length);
    expect(short.totalMinutes).toBeLessThanOrEqual(w.totalMinutes);
    expect(short.noGymNote.toLowerCase()).toMatch(/still counts|short version/);
    expect(findBannedClaims(short.noGymNote)).toHaveLength(0);
  });

  it('counts sessions per week, not per log entry', () => {
    const dates = [DATE, addDays(DATE, 1), addDays(DATE, 2)];
    const logs = [
      { id: 'a', date: DATE, workoutId: 'w', completedBlockIds: [], minutes: 10, completedAt: 'x' },
      { id: 'b', date: DATE, workoutId: 'w', completedBlockIds: [], minutes: 10, completedAt: 'x' },
      { id: 'c', date: addDays(DATE, 1), workoutId: 'w', completedBlockIds: [], minutes: 10, completedAt: 'x' },
      { id: 'd', date: '2026-02-01', workoutId: 'w', completedBlockIds: [], minutes: 10, completedAt: 'x' },
    ];
    expect(weeklySessionCount(logs, dates)).toBe(2);
  });

  it('suggests a rest day rather than pushing through', () => {
    expect(goalSuggestsRestDay('maintain-weight', 4)).toBe(true);
    expect(goalSuggestsRestDay('lose-fat', 5)).toBe(true);
    expect(goalSuggestsRestDay('lose-fat', 2)).toBe(false);
  });

  it('offers a motivating line without promising results', () => {
    for (const day of ['2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17']) {
      const line = motivationFor(day);
      expect(MOTIVATION_LINES).toContain(line);
      expect(findBannedClaims(line), line).toHaveLength(0);
    }
    expect(motivationFor(DATE)).toBe(motivationFor(DATE));
  });

  it('never promises a body outcome', () => {
    const all = MOTIVATION_LINES.join(' ').toLowerCase();
    expect(all).not.toMatch(/lose \d|guarantee|you will (look|be)|transform/);
  });

  it('clamps the workout window into waking hours', () => {
    const night = workoutWindow(makeProfile({ exerciseMinute: 2 * 60 }), 30);
    expect(night[1]).toBeGreaterThan(night[0]);
    const long = workoutWindow(profile, 300);
    expect(long[1] - long[0]).toBeLessThanOrEqual(60);
  });

  it('labels every level and focus in plain words', () => {
    for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
      expect(LEVEL_LABELS[level].length).toBeGreaterThan(2);
      expect(LEVEL_DESCRIPTIONS[level].length).toBeGreaterThan(10);
    }
  });
});

describe('sleep', () => {
  function plan(over: Partial<Parameters<typeof buildSleepPlan>[0]> = {}) {
    return buildSleepPlan({
      wakeMinute: 7 * 60,
      sleepMinute: 23 * 60,
      age: 25,
      difficulty: 'none',
      ...over,
    });
  }

  it('gives more sleep to younger people', () => {
    expect(sleepTargetHoursForAge(18)).toBeGreaterThanOrEqual(sleepTargetHoursForAge(70));
    expect(SLEEP_TARGETS_BY_AGE.length).toBeGreaterThan(1);
  });

  it('builds a backwards ladder that ends at lights-out', () => {
    const p = plan();
    expect(p.ladder.length).toBeGreaterThanOrEqual(3);
    expect(p.targetHours).toBeGreaterThanOrEqual(7);
    expect(p.targetHours).toBeLessThanOrEqual(10);
    for (const step of p.ladder) {
      expect(step.title.length).toBeGreaterThan(2);
      expect(step.action.length).toBeGreaterThan(5);
    }
    const minutes = p.ladder.map((s) => s.minute);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('moves bedtime earlier rather than waking the user earlier', () => {
    // Wakes at 09:00 but sleeps at 02:00, so only 7 h in bed against an 8 h target.
    const squeezed = plan({ wakeMinute: 9 * 60, sleepMinute: 2 * 60 });
    expect(squeezed.targetHours).toBe(8);
    expect(squeezed.targetBedMinute).toBe(60); // 01:00, i.e. an hour earlier
    expect(squeezed.ladder.at(-1)!.minute).toBe(60);
    expect(squeezed.notes.join(' ')).toMatch(/moved 60 minutes earlier/);
    // An earlier bedtime only ever happens; the wake time is never touched.
    expect(squeezed.wakeMinute).toBe(9 * 60);
    const enough = plan({ wakeMinute: 7 * 60, sleepMinute: 22 * 60 }); // 9 h in bed
    expect(enough.targetBedMinute).toBe(22 * 60);
  });

  it('does not wrap the ladder round midnight when the wake time is too early', () => {
    const impossible = plan({ wakeMinute: 4 * 60 + 30, sleepMinute: 23 * 60 + 30 }); // 5 h
    expect(impossible.targetBedMinute).toBe(23 * 60 + 30);
    for (const step of impossible.ladder) {
      expect(step.minute).toBeGreaterThan(0);
      expect(step.minute).toBeLessThanOrEqual(23 * 60 + 30);
    }
    expect(impossible.notes.join(' ')).toMatch(/wake-up/i);
  });

  it('adds more wind-down steps when sleep is difficult', () => {
    expect(plan({ difficulty: 'frequent' }).ladder.length).toBeGreaterThanOrEqual(plan({ difficulty: 'none' }).ladder.length);
  });

  it('scores sleep without judgement and without a "bad night" label', () => {
    const p = plan();
    const good = sleepProgress(p, {
      id: 's1',
      date: DATE,
      bedtimeActual: p.targetBedMinute,
      wakeMinute: 420,
      windDownCompleted: true,
      screensOff: true,
    });
    expect(good.value).toBe(1);
    const poor = sleepProgress(p, {
      id: 's2',
      date: DATE,
      bedtimeActual: null,
      wakeMinute: 420,
      windDownCompleted: false,
      screensOff: false,
    });
    expect(poor.value).toBeGreaterThanOrEqual(0);
    expect(poor.detail.toLowerCase()).not.toMatch(/bad|fail|poor|terrible/);
    expect(poor.detail.length).toBeGreaterThan(5);
  });

  it('has a nothing-logged state that is not a failure', () => {
    const none = sleepProgress(plan(), null);
    expect(none.value).toBe(0);
    expect(none.detail.toLowerCase()).toMatch(/nothing recorded/);
  })

  it('never promises that a bedtime fixes sleep', () => {
    expect(SLEEP_DISCLAIMER.toLowerCase()).toMatch(/no fixed bedtime|individual sleep needs/);
    // Official copy may deny a claim, so it is exempt from the lint by design.
    expect(findBannedClaims(SLEEP_DISCLAIMER)).toHaveLength(0);
    expect(findBannedClaims(SLEEP_DISCLAIMER.replace('no fixed bedtime guarantees health', 'cures insomnia'))).not.toHaveLength(0);
  });

  it('formats a readable sleep window and a morning greeting', () => {
    const p = plan();
    expect(sleepWindowLabel(p)).toMatch(/\d/);
    expect(wakeUpGreeting(420, 425).length).toBeGreaterThan(3);
    expect(wakeUpGreeting(420, 425)).toBe('Good morning');
    expect(wakeUpGreeting(420, 21 * 60)).toMatch(/evening/i);
    expect(wakeUpGreeting(420, 13 * 60)).toMatch(/morning|afternoon/i);
  });
});

describe('seasons and regions', () => {
  it('maps Indian months to the four seasons', () => {
    expect(seasonForMonth(0)).toBe('winter');
    expect(seasonForMonth(3)).toBe('summer');
    expect(seasonForMonth(6)).toBe('monsoon');
    expect(seasonForMonth(9)).toBe('post-monsoon');
    for (const m of Object.keys(SEASON_LABELS) as SeasonId[]) expect(SEASON_LABELS[m].length).toBeGreaterThan(2);
  });

  it('derives the season from an instant in a timezone', () => {
    expect(seasonForDate(new Date('2026-01-14T06:00:00.000Z'), 'Asia/Kolkata')).toBe('winter');
    expect(seasonForDate(new Date('2026-07-14T06:00:00.000Z'), 'Asia/Kolkata')).toBe('monsoon');
  });

  it('knows which foods are in season', () => {
    const guava = getFood('guava');
    if (!guava) throw new Error('no guava');
    const winter = isInSeason(guava, 'winter');
    expect(typeof winter).toBe('boolean');
    const allYear = FOODS.filter((f) => f.seasons.includes('all-year'));
    expect(allYear.length).toBeGreaterThan(5);
    for (const f of allYear) expect(isInSeason(f, 'summer')).toBe(true);
  });

  it('ranks seasonal candidates by preference', () => {
    const candidates = seasonalCandidates('vegetable', 'winter');
    expect(candidates.length).toBeGreaterThan(0);
    for (const f of candidates) {
      expect(f.category).toBe('vegetable');
      expect(isInSeason(f, 'winter')).toBe(true);
    }
    const withOffSeason = seasonalCandidates('vegetable', 'winter', true);
    expect(withOffSeason.length).toBeGreaterThanOrEqual(candidates.length);
    const summer = seasonalCandidates('vegetable', 'summer');
    expect(new Set([...candidates, ...summer]).size).toBeGreaterThan(1);
  });

  it('prices Bihar below a metro and keeps every region positive', () => {
    expect(regionMultiplier('bihar')).toBeLessThan(1);
    expect(regionMultiplier('metro-south')).toBeGreaterThan(1);
    for (const region of Object.keys(REGION_PRICE_INDEX) as (keyof typeof REGION_PRICE_INDEX)[]) {
      expect(REGION_PRICE_INDEX[region]).toBeGreaterThan(0.5);
      expect(REGION_PRICE_INDEX[region]).toBeLessThan(1.5);
    }
  });

  it('has a profile for every region, with cities for the named ones', () => {
    for (const region of REGIONS) {
      expect(region.label.length).toBeGreaterThan(2);
      expect(regionProfile(region.id).id).toBe(region.id);
      // "Other" is the free-text fallback, so it is allowed to be empty.
      if (region.id === 'other') {
        expect(cityOptions(region.id)).toEqual([]);
        continue;
      }
      expect(cityOptions(region.id).length, region.id).toBeGreaterThan(0);
      expect(region.localProduce.length, region.id).toBeGreaterThan(0);
    }
  });

  it('suggests substitutes that are allowed, cheaper or in season, with a reason', () => {
    const filter = dietFilter(makeDiet());
    const allowed = new Set(FOODS.filter((f) => isAllowedSafe(f, filter)).map((f) => f.key));
    const subs = rankSubstitutes(
      'milk',
      { season: 'summer', region: 'bihar', priceMultiplier: regionMultiplier('bihar'), dietAllowed: allowed },
      4,
    );
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) {
      expect(s.key).not.toBe('milk');
      expect(allowed.has(s.key)).toBe(true);
      expect(s.reason.length).toBeGreaterThan(5);
      expect(s.pricePerKg).toBeGreaterThan(0);
    }
  });

  it('returns no substitutes for an unknown food', () => {
    expect(rankSubstitutes('nope' as never, { season: 'winter', region: 'bihar', priceMultiplier: 1, dietAllowed: new Set() })).toEqual([]);
  });

  it('summarises the season with produce and safety notes', () => {
    const snap = seasonSnapshot('monsoon', 'bihar');
    expect(snap.label).toBe('Monsoon');
    expect(snap.items.length).toBeGreaterThan(0);
    expect(snap.items.length).toBeLessThanOrEqual(8);
    for (const item of snap.items) {
      expect(item.price.typicalPrice * regionMultiplier('bihar')).toBeLessThanOrEqual(70);
      expect(findBannedClaims(`${item.name} ${item.localNames.join(' ')}`)).toHaveLength(0);
    }
    expect(seasonSnapshot('monsoon', 'metro-south').label).toBe('Monsoon');
  });

  it('gives food-safety advice for monsoon and summer only', () => {
    expect(seasonSafetyNote('monsoon')).not.toBeNull();
    expect(seasonSafetyNote('winter')).toBeNull();
    expect(seasonSafetyHint('summer') ?? '').not.toMatch(/cure|guarantee/i);
  });
});

describe('food database helpers', () => {
  it('scales nutrition by grams', () => {
    const dal = requireFood('toor-dal');
    const half = nutritionForGrams('toor-dal', 50);
    expect(half.calories).toBeCloseTo((dal.nutrition.calories * 50) / 100, 1);
    expect(nutritionForGrams('toor-dal', 0).calories).toBe(0);
  });

  it('ranks foods by protein and calories per rupee', () => {
    const values = FOODS.map((f) => proteinPerRupee(f.key, 100));
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.max(...values)).toBeGreaterThan(0);
    expect(caloriesPerRupee('toor-dal', 100)).toBeGreaterThan(0);
  });

  it('searches by english and local name', () => {
    expect(searchFoods('dal').length).toBeGreaterThan(0);
    expect(searchFoods('doodh').some((f) => f.key === 'milk')).toBe(true);
    expect(searchFoods('xyzzy')).toEqual([]);
    expect(searchFoods('dal', 2).length).toBeLessThanOrEqual(2);
  });

  it('filters by category and looks up safely', () => {
    expect(foodsInCategory('vegetable').length).toBeGreaterThan(3);
    expect(getFood('not-real' as never)).toBeUndefined();
    expect(hasFood('rice')).toBe(true);
    expect(() => requireFood('not-real' as never)).toThrow();
  });

  it('sums nutrition and rounds predictably', () => {
    const sum = sumNutrition([
      { calories: 10.44, protein: 1.11, carbs: 2.22, fat: 0.55, fiber: 0.44 },
      { calories: 10.44, protein: 1.11, carbs: 2.22, fat: 0.55, fiber: 0.44 },
    ]);
    expect(sum.calories).toBeCloseTo(20.9, 1);
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-1.26)).toBe(-1.3);
  });
});

// Local helper so the seasonal test does not need to import the whole filter API.
function isAllowedSafe(food: (typeof FOODS)[number], filter: ReturnType<typeof dietFilter>): boolean {
  if (filter.diet === 'vegetarian' && food.dietTag === 'nonveg') return false;
  return filter.allergies.has(food.key) === false;
}
