/**
 * Meal rotation and anti-repetition.
 *
 * THE defect this module exists to fix: the engine used to pick a vegetable and a
 * fruit with a seasonal bonus that dominated every other signal, so the same
 * in-season item came back every single day for weeks. Rotation has to be able
 * to *outrank* seasonality, which means the penalty below is expressed on the
 * same scale as the seasonal bonus and applied per-food, per-slot, from real
 * recorded history rather than a hash of the date.
 *
 * Two ideas do all the work:
 *
 *  1. `repetitionPenalty` — how much a food costs for having been used N days ago
 *     in the same slot. Yesterday is a hard penalty, a week ago is free. It is a
 *     function of *history*, so two users with the same profile but different
 *     histories get genuinely different plans.
 *  2. `rotationOrder` — a deterministic shuffle over the candidate pool used to
 *     break ties *among foods that are already close on merit*. This guarantees
 *     spread across the week without letting novelty override season, budget or
 *     nutrition. Those are handled by scoring in `meals.ts`.
 *
 * Pure and clock-free: every date arrives as a `CalendarDay` string.
 */

import type {
  AvailabilityMap,
  CalendarDay,
  DayPreference,
  FoodAvailabilityState,
  FoodKey,
  FoodPreference,
  MealHistoryEntry,
  MealSlot,
} from './types/index';

// ---------------------------------------------------------------------------
// Date helpers (string-in, string-out — never `Date.now()`)
// ---------------------------------------------------------------------------

/** Whole days from `a` to `b`. Negative when `b` precedes `a`. */
export function daysApart(a: CalendarDay, b: CalendarDay): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const from = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const to = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((to - from) / 86_400_000);
}

/**
 * A stable per-(day, slot) integer seed. Deterministic across reloads, which is
 * what lets a stored plan be replayed and match what the user was shown.
 */
export function rotationSeed(date: CalendarDay, slot: MealSlot): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.abs((y ?? 1970) * 31_000 + (m ?? 1) * 617 + (d ?? 1) * 13 + slotSeed(slot));
}

function slotSeed(slot: MealSlot): number {
  return { breakfast: 0, fruit: 1, lunch: 2, snack: 3, dinner: 4 }[slot];
}

/**
 * Small deterministic jitter, -3..+3, used only to break exact score ties.
 *
 * It is deliberately tiny: novelty must never outvote season, budget or
 * nutrition, but two genuinely equivalent foods should not resolve to the same
 * answer on every day of the season.
 */
export function jitter(date: CalendarDay, slot: MealSlot, key: string): number {
  const seed = rotationSeed(date, slot);
  let h = seed;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 7) - 3;
}

// ---------------------------------------------------------------------------
// Repetition penalty
// ---------------------------------------------------------------------------

/** Tunables. Exposed so tests and the settings screen can reason about them. */
export interface RotationRules {
  /** Same food yesterday in the same slot. */
  readonly consecutiveDays: number;
  /** Two days back. */
  readonly recentDays: number;
  /** Within a week but not consecutive. */
  readonly withinWeekDays: number;
  /** Beyond this, a food is fully welcome again. */
  readonly cooldownDays: number;
  /** Applies to a food used *this often in the last `cooldownDays`* anywhere. */
  readonly frequencyPenalty: number;
  readonly maxConsecutiveRepeats: number;
}

export const DEFAULT_ROTATION_RULES: RotationRules = {
  consecutiveDays: 55,
  recentDays: 22,
  withinWeekDays: 9,
  cooldownDays: 7,
  frequencyPenalty: 7,
  maxConsecutiveRepeats: 2,
};

/**
 * How much a food loses points because it has been eaten recently.
 *
 * `history` is every recorded day, `date` is the day being planned. Returns 0 for
 * a food never used, and grows sharply the closer it was. Deliberately bounded
 * so a user with a very small food pool is never starved of options — the
 * engine falls back on `relaxed` scoring when every candidate is penalised.
 *
 * Only the *same slot* counts, unless the slot is `'*'`. Dal at lunch and dal at
 * dinner are not the same meal twice, and a food that legitimately appears at two
 * meals in a day (roti at lunch and dinner) must not be punished at breakfast for
 * it. Callers pass `'*'` for a food whose slot is irrelevant to the user — a
 * vegetable that turns up four days running reads as one vegetable to someone
 * reading a week, even when two of those were lunch and two were dinner.
 */
/**
 * Index of what was eaten, keyed by history array then by slot.
 *
 * Scoring asks about every candidate food, and each candidate used to walk the
 * entire history entry by entry, splitting meal ids apart as it went. For a pool
 * of fifteen foods across five meals that is tens of thousands of string splits
 * per meal, which showed up as a visibly slow first paint.
 *
 * Keyed on the history array by identity, so it is discarded as soon as the plan
 * is rebuilt and can never serve a stale answer.
 */
type FoodUseIndex = Map<FoodKey, { date: CalendarDay; gap: number }[]>;

const historyIndexCache = new WeakMap<readonly MealHistoryEntry[], Map<string, FoodUseIndex>>();

function indexHistory(history: readonly MealHistoryEntry[], slot: MealSlot | '*'): FoodUseIndex {
  let bySlot = historyIndexCache.get(history);
  if (!bySlot) {
    bySlot = new Map();
    historyIndexCache.set(history, bySlot);
  }
  const cacheKey = slot === '*' ? '*' : slot;
  const cached = bySlot.get(cacheKey);
  if (cached) return cached;

  const built: FoodUseIndex = new Map();
  for (const entry of history) {
    for (const [mealId, keys] of Object.entries(entry.meals)) {
      if (slot !== '*') {
        const mealSlot = mealSlotOf(mealId);
        if (mealSlot !== slot && mealSlot !== null) continue;
      }
      for (const key of keys) {
        const list = built.get(key);
        if (list) list.push({ date: entry.date, gap: 0 });
        else built.set(key, [{ date: entry.date, gap: 0 }]);
      }
    }
  }
  bySlot.set(cacheKey, built);
  return built;
}

export function repetitionPenalty(
  key: FoodKey,
  slot: MealSlot | '*',
  date: CalendarDay,
  history: readonly MealHistoryEntry[],
  rules: RotationRules = DEFAULT_ROTATION_RULES,
): number {
  let penalty = 0;
  let sameSlotUses = 0;
  const seenDays = new Set<number>();

  const uses = indexHistory(history, slot).get(key);
  if (!uses) return 0;

  for (const use of uses) {
    const entry = { date: use.date };
    const gap = daysApart(entry.date, date);
    if (gap <= 0) continue; // never let future days influence today
    if (gap > rules.cooldownDays) continue;

    // A day counts at most once, however many times the food was listed that day.
    if (seenDays.has(gap)) continue;
    seenDays.add(gap);

    sameSlotUses += 1;
    if (gap === 1) penalty = Math.max(penalty, rules.consecutiveDays);
    else if (gap === 2) penalty = Math.max(penalty, rules.recentDays);
    else penalty = Math.max(penalty, rules.withinWeekDays);
  }

  // Used several times in this slot inside the window — worth avoiding, but far
  // less than a direct repeat.
  penalty += Math.max(0, sameSlotUses - 1) * rules.frequencyPenalty;

  return Math.min(80, penalty);
}

/** `2026-10-03:lunch` -> `lunch`. Returns null when the id has no slot suffix. */
export function mealSlotOf(mealId: string): MealSlot | null {
  const tail = mealId.slice(mealId.lastIndexOf(':') + 1);
  return tail === 'breakfast' || tail === 'fruit' || tail === 'lunch' || tail === 'snack' || tail === 'dinner'
    ? tail
    : null;
}

/** Has this exact food been used on any of the last N days in this slot? */
export function usedOn(
  key: FoodKey,
  slot: MealSlot,
  date: CalendarDay,
  history: readonly MealHistoryEntry[],
  windowDays = 3,
): boolean {
  for (let gap = 1; gap <= windowDays; gap += 1) {
    const day = shiftDay(date, -gap);
    const entry = history.find((h) => h.date === day);
    if (!entry) continue;
    const mealId = `${day}:${slot}`;
    if (entry.meals[mealId]?.includes(key)) return true;
  }
  return false;
}

export function shiftDay(date: CalendarDay, delta: number): CalendarDay {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Whether a food has already run its consecutive allowance. Used to *permit*
 * repetition honestly rather than pretending it never happens.
 */
export function consecutiveStreak(
  key: FoodKey,
  slot: MealSlot,
  date: CalendarDay,
  history: readonly MealHistoryEntry[],
): number {
  let streak = 0;
  for (let gap = 1; gap <= 30; gap += 1) {
    const day = shiftDay(date, -gap);
    const entry = history.find((h) => h.date === day);
    const used = entry?.meals[`${day}:${slot}`]?.includes(key) ?? false;
    if (!used) break;
    streak += 1;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Tie-breaking rotation
// ---------------------------------------------------------------------------

/**
 * Deterministic rotation over an already-screened candidate pool.
 *
 * The caller passes candidates whose *merit* is close; this reorders them so
 * consecutive days land on different items. Weight is derived from the date, so
 * re-running plan generation for the same day always returns the same order —
 * that is what keeps a stored plan stable across refreshes.
 */
export function rotationOrder<T>(
  candidates: readonly T[],
  date: CalendarDay,
  slot: MealSlot,
  keyOf: (item: T) => string,
): readonly T[] {
  const seed = rotationSeed(date, slot);
  return [...candidates]
    .map((item, index) => {
      const k = keyOf(item);
      let h = seed;
      for (let i = 0; i < k.length; i += 1) h = (h * 31 + k.charCodeAt(i)) >>> 0;
      h = (h + index * 2654435761) >>> 0;
      return { item, rank: h };
    })
    .sort((a, b) => a.rank - b.rank || keyOf(a.item).localeCompare(keyOf(b.item)))
    .map((x) => x.item);
}

// ---------------------------------------------------------------------------
// Weekly distribution (eggs, non-veg, protein anchors)
// ---------------------------------------------------------------------------

export interface WeeklyQuota {
  /** Total servings across the week. */
  readonly perWeek: number;
  /** Lowest and highest servings allowed on any single day. */
  readonly minPerDay: number;
  readonly maxPerDay: number;
  readonly rationale: string;
}

/**
 * Day-of-week index for a calendar day, 0 = Sunday. Derived arithmetically from
 * the string, so it needs no clock and is identical on every machine.
 */
export function dayOfWeekIndex(date: CalendarDay): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * THE weekly pattern, indexed 0 = Sunday.
 *
 * This is the table that answers the "why did I get eggs on Monday but not
 * Tuesday?" question. It is deliberately not "N every day": eggs land on four
 * days out of seven at varying counts, so a week of plans reads as a rotation
 * rather than a single meal repeated with the date changed.
 */
export const EGG_WEEK_PATTERN: readonly number[] = [
  // Sunday-first, matching CalendarDay ordering.
  //
  // Sunday-first and five servings a week, with a clear day between every pair:
  //   Sun - | Mon 2 | Tue - | Wed 1 | Thu - | Fri 2 | Sat -
  //
  // The first draft of this pattern read `0 2 0 2 1 0 1`, which put eggs on
  // Wednesday *and* Thursday. A pattern that hands someone two eggs on back-to-back
  // mornings is not a rotation, it is a rule nobody would follow.
  0, 2, 0, 1, 0, 2, 0,
]; // Sun Sat
/** Chicken / fish. Never on consecutive days, never more than once a day. */
export const MEAT_WEEK_PATTERN: readonly number[] = [0, 1, 0, 0, 1, 0, 0];

export function eggServingsFor(date: CalendarDay): number {
  return EGG_WEEK_PATTERN[dayOfWeekIndex(date)] ?? 0;
}

export function meatServingsFor(date: CalendarDay): number {
  return MEAT_WEEK_PATTERN[dayOfWeekIndex(date)] ?? 0;
}

/**
 * Where a food should sit in the week.
 *
 * For eggs this is the whole point: `Monday 2, Tuesday 0, Wednesday 2, …` comes
 * from this table rather than "2 every day". Non-vegetarian users get a smaller
 * number of meat/fish servings per week for the same reason — a chicken curry
 * every single evening is not a plan, it is a habit the app cannot justify.
 */
export function weeklyQuota(
  key: FoodKey,
  dietAllows: (key: FoodKey) => boolean,
  dailyBudget: number,
): WeeklyQuota | null {
  if (!dietAllows(key)) return null;

  if (key === 'egg') {
    return {
      perWeek: EGG_WEEK_PATTERN.reduce((s, n) => s + n, 0),
      minPerDay: 0,
      maxPerDay: 2,
      rationale: `spread across the week — ${EGG_WEEK_PATTERN.reduce((s, n) => s + n, 0)} eggs in seven days, not two every morning`,
    };
  }

  if (key === 'chicken' || key === 'fish') {
    if (dailyBudget < 180) {
      return {
        perWeek: 0,
        minPerDay: 0,
        maxPerDay: 0,
        rationale: 'at this budget dal, soy and eggs cover the protein more cheaply',
      };
    }
    const perWeek = dailyBudget >= 260 ? MEAT_WEEK_PATTERN.reduce((s, n) => s + n, 0) : 2;
    return {
      perWeek,
      minPerDay: 0,
      maxPerDay: 1,
      rationale: `${perWeek} servings a week, never on consecutive days`,
    };
  }

  return null;
}

/**
 * Which of chicken/fish to use on a given meat day.
 *
 * Alternates on the ISO week number so a four-week run reads
 * chicken → fish → chicken → fish rather than four weeks of chicken.
 */
export function meatChoiceFor(date: CalendarDay, options: readonly FoodKey[]): FoodKey | null {
  const usable = options.filter((k) => k === 'chicken' || k === 'fish');
  if (usable.length === 0) return null;
  const [y, m, d] = date.split('-').map(Number);
  const epochDays = Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
  const week = Math.floor(epochDays / 7);
  return usable[Math.abs(week) % usable.length] ?? null;
}

// ---------------------------------------------------------------------------
// User signals: availability + preference
// ---------------------------------------------------------------------------

export interface SignalScore {
  readonly score: number;
  readonly reason: string;
}

const AVAILABILITY_SCORE: Record<FoodAvailabilityState, number> = {
  available: 0,
  local: 14,
  unavailable: -70,
  'too-expensive': -28,
};

const PREFERENCE_SCORE: Record<FoodPreference, number> = {
  favourite: 22,
  neutral: 0,
  disliked: -60,
};

export const AVAILABILITY_LABELS: Record<FoodAvailabilityState, string> = {
  available: 'Available',
  local: 'Local and fresh',
  unavailable: 'Not available',
  'too-expensive': 'Too expensive',
};

export const PREFERENCE_LABELS: Record<FoodPreference, string> = {
  favourite: 'Favourite',
  neutral: 'Neutral',
  disliked: "Don't like",
};

/**
 * Combines the user's own signals about a food. A favourite that is `unavailable`
 * still loses — the user's shelf is a stronger signal than their preference, and
 * suggesting something they cannot buy is worse than suggesting a second choice.
 */
export function foodSignal(key: FoodKey, map: AvailabilityMap): SignalScore {
  const entry = map[key];
  const availability = entry?.availability ?? 'available';
  const preference = entry?.preference ?? 'neutral';

  if (availability === 'unavailable' && preference !== 'favourite') {
    return { score: AVAILABILITY_SCORE[availability], reason: 'you marked this as not available near you' };
  }
  if (preference === 'disliked' && availability !== 'unavailable') {
    return { score: PREFERENCE_SCORE[preference], reason: 'you said you would rather avoid this' };
  }
  return { score: AVAILABILITY_SCORE[availability] + PREFERENCE_SCORE[preference], reason: '' };
}

/** True when the user told us not to suggest it, whatever the fallback logic. */
export function isExcludedForDay(key: FoodKey, preference: DayPreference | undefined): boolean {
  return preference?.excluded.includes(key) ?? false;
}

/** True when the user pinned it for this slot; rotation must not override it. */
export function isPinnedFor(
  key: FoodKey,
  slot: MealSlot,
  preference: DayPreference | undefined,
): boolean {
  return preference?.pinned[slot] === key;
}

// ---------------------------------------------------------------------------
// Rotation memory — build history from stored snapshots
// ---------------------------------------------------------------------------

/**
 * Projects stored day snapshots down to the tiny shape rotation needs.
 * Called on every plan build, so it must stay cheap: it reads meal ingredients
 * and nothing else.
 */
/**
 * Stricter repetition rules for fruit and vegetables.
 *
 * The default rules exist so that a *meal* changes. Produce needs a stronger
 * nudge because nobody experiences "beans at lunch again" as an interesting meal —
 * they experience "beans again" as a week with one vegetable in it. With the
 * default numbers, an in-season local vegetable out-scored the penalty and the
 * week came out looking identical.
 */
export const PRODUCE_ROTATION_RULES: RotationRules = {
  ...DEFAULT_ROTATION_RULES,
  consecutiveDays: 70,
  recentDays: 40,
  withinWeekDays: 18,
  frequencyPenalty: 12,
};

/**
 * How many recorded days back the anti-repetition memory reaches. Matched to
 * `DEFAULT_ROTATION_RULES.cooldownDays` — a day older than that cannot change a
 * choice anyway, so carrying it costs storage for nothing.
 */
export const ROTATION_WINDOW_DAYS = 7;

export function historyFromSnapshots(
  snapshots: Readonly<Partial<Record<CalendarDay, { readonly meals: readonly { readonly id: string; readonly ingredients: readonly { readonly foodKey: FoodKey }[] }[] }>>>,
  days: number,
  before: CalendarDay,
): readonly MealHistoryEntry[] {
  const out: MealHistoryEntry[] = [];
  for (let gap = 1; gap <= days; gap += 1) {
    const day = shiftDay(before, -gap);
    const snapshot = snapshots[day];
    if (!snapshot) continue;
    const meals: Record<string, readonly FoodKey[]> = {};
    for (const meal of snapshot.meals) {
      meals[meal.id] = meal.ingredients.map((i) => i.foodKey);
    }
    out.push({ date: day, meals });
  }
  return out;
}