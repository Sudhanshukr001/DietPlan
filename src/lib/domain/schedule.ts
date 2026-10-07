/**
 * Schedule engine + the NOW resolution algorithm.
 *
 * This is the product. `resolveNow` is what the user sees first, every time,
 * so it is written as an explicit priority ladder rather than a filter.
 *
 * No `Date` here: the caller passes `EngineContext` and this module deals only
 * in MinuteOfDay integers and CalendarDay strings.
 */

import type {
  CalendarDay,
  DailySchedule,
  DailySchedulePreference,
  EngineContext,
  FitnessGoal,
  Meal,
  MinuteOfDay,
  Profile,
  ScheduleResolution,
  ScheduleStrategy,
  TimelineEvent,
  TimelineState,
} from './types/index';
import { MINUTES_PER_DAY } from './types/index';
import { DEFAULT_SCHEDULE } from './defaults';
import {
  clampMinute,
  hoursBetweenSleep,
  isWithin,
  minutesBetween,
  wrapMinute,
} from './time';

export const MEAL_GRACE_MINUTES = 180;
export const DEFAULT_MEAL_WINDOW = 75;
export const DEFAULT_SNACK_WINDOW = 45;

/** A user set this time but the window has closed. */
export interface CompletedEvents {
  readonly done?: ReadonlySet<string>;
  readonly skipped?: ReadonlySet<string>;
  readonly snoozed?: ReadonlyMap<string, MinuteOfDay>;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export function mealWindow(start: MinuteOfDay, slot: 'meal' | 'snack' | 'fruit'): readonly [MinuteOfDay, MinuteOfDay] {
  const length = slot === 'meal' ? DEFAULT_MEAL_WINDOW : slot === 'snack' ? DEFAULT_SNACK_WINDOW : 40;
  return [clampMinute(start), clampMinute(start + length)];
}

/**
 * Order events by start time, treating post-midnight events (sleep) as last.
 * `isPostMidnight` is the only place the wrap-around subtlety is handled.
 */
function sortEvents(events: readonly TimelineEvent[]): readonly TimelineEvent[] {
  return [...events].sort((a, b) => {
    const aPost = a.startMinute < 300 ? 1 : 0;
    const bPost = b.startMinute < 300 ? 1 : 0;
    if (aPost !== bPost) return aPost - bPost;
    return a.startMinute - b.startMinute;
  });
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

export interface ScheduleBuildInput {
  readonly profile: Profile;
  readonly date: CalendarDay;
  readonly meals: readonly Meal[];
  readonly context: EngineContext;
  readonly exerciseMinutes: number;
  readonly isRestDay: boolean;
  readonly sleepTargetHours: number;
}

export function buildSchedule(input: ScheduleBuildInput): DailySchedule {
  const { profile, meals, context, isRestDay } = input;
  const pref = profile.schedule;
  const events: TimelineEvent[] = [];

  const wake = clampMinute(pref.wakeMinute);

  // --- Wake -------------------------------------------------------------
  events.push({
    id: `${input.date}:wake`,
    kind: 'wake',
    title: 'Wake up',
    detail: 'Start slow. Sit up, drink a glass of water, and look at the day once.',
    startMinute: wake,
    endMinute: clampMinute(wake + 20),
    why: 'A steady start time makes the rest of the day predictable, including sleep later on.',
    optional: false,
    emoji: '🌅',
    actions: ['Sit up slowly', 'Drink a glass of water', 'Stretch for 2 minutes'],
  });

  // --- First hydration --------------------------------------------------
  const firstWater = clampMinute(wake + 5);
  events.push({
    id: `${input.date}:water-first`,
    kind: 'hydration',
    title: 'First water',
    detail: 'One full glass, about 300 ml.',
    startMinute: firstWater,
    endMinute: clampMinute(firstWater + 25),
    why: 'Drinking water after waking up rehydrates you after a night without fluids.',
    hydrationMl: 300,
    optional: true,
    emoji: '💧',
    actions: ['Drink 300 ml water'],
  });

  // --- Light movement ---------------------------------------------------
  // Placed in the gap between waking and breakfast; 15 min after waking at the
  // earliest, and never overlapping the breakfast window.
  const breakfastStart = clampMinute(pref.breakfastMinute);
  const movementStart = clampMinute(Math.max(wake + 25, breakfastStart - 25));
  const movementEnd = Math.min(clampMinute(movementStart + 12), breakfastStart);
  if (movementEnd - movementStart >= 5) {
    events.push({
      id: `${input.date}:movement`,
      kind: 'movement',
      title: 'Light movement',
      detail: '12 minutes of walking, stretching or easy joint circles.',
      startMinute: movementStart,
      endMinute: movementEnd,
      why: 'Moving gently in the morning wakes up your joints and digestion before the day starts.',
      optional: true,
      emoji: '🚶',
      actions: ['Walk for 10 minutes', 'Do 10 shoulder rolls', 'Stretch your hamstrings'],
    });
  }

  // --- Meals ------------------------------------------------------------
  for (const meal of meals) {
    events.push(mealEvent(meal));
  }

  // --- Exercise ---------------------------------------------------------
  // The user's chosen time is only a preference: if it lands overnight or
  // before they are properly awake, it moves into a sane waking window rather
  // than producing a 1:30 AM "movement time".
  if (!isRestDay && input.exerciseMinutes > 0) {
    const exDuration = Math.min(input.exerciseMinutes, 45);
    const earliest = clampMinute(wake + 45);
    // Bed can be after midnight; work unwrapped so the window is not inverted.
    const bed = pref.sleepMinute < wake ? pref.sleepMinute + MINUTES_PER_DAY : pref.sleepMinute;
    const requested =
      pref.exerciseMinute < wake && bed >= MINUTES_PER_DAY
        ? pref.exerciseMinute + MINUTES_PER_DAY
        : pref.exerciseMinute;
    const latestStart = Math.max(earliest, bed - exDuration - 30);
    const exStart = wrapMinute(Math.min(Math.max(requested, earliest), latestStart));
    const exEnd = wrapMinute(exStart + exDuration);
    events.push({
      id: exerciseEventId(input.date),
      kind: 'exercise',
      title: 'Movement time',
      detail: `${exDuration} minutes — walking and simple bodyweight exercises.`,
      startMinute: exStart,
      endMinute: exEnd,
      why: 'Regular movement supports circulation, muscle strength and mood. Any amount counts.',
      optional: false,
      emoji: '🏃',
      actions: ['5 min warm-up', 'Do the planned exercises', '10–20 min walk', '5 min cool-down'],
    });

    const postStart = clampMinute(exEnd);
    events.push({
      id: `${input.date}:post-workout`,
      kind: 'post-workout',
      title: 'Rehydrate',
      detail: 'Sip water steadily — about 400 ml over the next half hour.',
      startMinute: postStart,
      endMinute: clampMinute(postStart + 30),
      why: 'You lose fluid while moving, especially in warm weather. Replacing it helps you feel normal.',
      hydrationMl: 400,
      optional: true,
      emoji: '🥤',
      actions: ['Sip 400 ml water slowly'],
    });
  }

  // --- Sleep ladder -----------------------------------------------------
  const sleep = clampMinute(pref.sleepMinute);
  const targetHours = input.sleepTargetHours;

  // Wind-down begins 75 minutes before bedtime.
  const windDown = clampMinute(sleep - 75);
  events.push({
    id: `${input.date}:wind-down`,
    kind: 'wind-down',
    title: 'Wind-down',
    detail: 'Dim the lights, stop heavy tasks, finish anything screen-related.',
    startMinute: windDown,
    endMinute: clampMinute(sleep - 45),
    why: 'A calmer hour before bed usually makes falling asleep easier than any supplement.',
    optional: false,
    emoji: '🌆',
    actions: ['Dim lights', 'Finish work and study tasks', 'Put the phone away'],
  });

  events.push({
    id: `${input.date}:sleep-prep`,
    kind: 'sleep-prep',
    title: 'Prepare for sleep',
    detail: 'Brush teeth, wash up, set your alarm, keep the room cool.',
    startMinute: clampMinute(sleep - 30),
    endMinute: clampMinute(sleep - 10),
    why: 'A repeated bedtime routine tells your body that sleep is coming.',
    optional: false,
    emoji: '🛁',
    actions: ['Brush teeth', 'Wash face and hands', 'Set your alarm'],
  });

  events.push({
    id: `${input.date}:sleep`,
    kind: 'sleep',
    title: 'Sleep time',
    detail: `Aim for about ${targetHours} hours. Consistency matters more than perfection.`,
    startMinute: sleep,
    endMinute: clampMinute(sleep + 5),
    why: 'Going to bed and waking at similar times is the part of sleep that helps most.',
    optional: false,
    emoji: '😴',
    actions: ['Lights out'],
  });

  return {
    date: input.date,
    events: sortEvents(events),
    wakeMinute: wake,
    sleepMinute: sleep,
    strategy: strategyFor({ profile, isRestDay, context }),
  };
}

/** Ticking-off chips for the NOW card: what the user physically has to do. */
function mealActionChips(meal: Meal): readonly string[] {
  const chips = meal.prepSteps.slice(0, 3).map((s) => s.replace(/\.$/, ''));
  if (meal.hydrationMl > 0) chips.push(`Drink ${meal.hydrationMl} ml water`);
  return chips.slice(0, 4);
}

function mealEvent(meal: Meal): TimelineEvent {
  return {
    id: `${meal.date}:meal:${meal.id}`,
    kind: 'meal',
    mealId: meal.id,
    title: mealTitle(meal.slot),
    detail: meal.subtitle,
    startMinute: meal.startMinute,
    endMinute: meal.endMinute,
    why: meal.whyItMatters,
    hydrationMl: meal.hydrationMl,
    optional: false,
    emoji: mealEmoji(meal.slot),
    actions: mealActionChips(meal),
  };
}

function strategyFor(input: {
  profile: Profile;
  isRestDay: boolean;
  context: EngineContext;
}): ScheduleStrategy {
  if (input.isRestDay) return 'recovery-day';
  if (input.profile.schedule.workPattern === 'shift') return 'compressed-window';
  if (input.profile.goal === 'build-muscle' || input.profile.goal === 'gain-weight') {
    return 'shifted-for-goal';
  }
  return 'fixed-preference';
}

export function mealTitle(slot: Meal['slot']): string {
  switch (slot) {
    case 'breakfast':
      return 'Breakfast time';
    case 'fruit':
      return 'Fruit + water';
    case 'lunch':
      return 'Lunch time';
    case 'snack':
      return 'Snack time';
    case 'dinner':
      return 'Dinner time';
    default:
      return 'Meal time';
  }
}

export function mealEmoji(slot: Meal['slot']): string {
  switch (slot) {
    case 'breakfast':
      return '🍳';
    case 'fruit':
      return '🍊';
    case 'lunch':
      return '🍛';
    case 'snack':
      return '🥜';
    case 'dinner':
      return '🍲';
    default:
      return '🍽';
  }
}

// ---------------------------------------------------------------------------
// The NOW algorithm
// ---------------------------------------------------------------------------

export interface ResolveInput {
  readonly schedule: DailySchedule;
  readonly nowMinute: MinuteOfDay;
  readonly completed: CompletedEvents;
}

/**
 * Priority ladder (see docs/01 §1.2):
 *   1. snoozed item       -> NOW
 *   2. in-window item     -> NOW
 *   3. overdue (unfinished, within grace) -> NOW, softer tone
 *   4. nearest upcoming   -> NEXT
 *   5. nothing scheduled  -> NOW in a rest state
 */
export function resolveNow(input: ResolveInput): ScheduleResolution {
  const { schedule, nowMinute, completed } = input;
  const events = schedule.events;

  // Done OR skipped both mean "settled". These must be combined with `||`:
  // short-circuiting on the first set would resurrect skipped meals forever.
  const isFinished = (e: TimelineEvent): boolean =>
    completed.done?.has(e.id) === true || completed.skipped?.has(e.id) === true;

  // Only events the user can actually settle count towards the day's total.
  // Wake, wind-down, sleep-prep and sleep are guidance — there is no control for
  // them anywhere, so counting them made "5 of 9 things done" the permanent best
  // case and made the "All done" state unreachable even on a perfect day.
  const countable = (e: TimelineEvent): boolean => e.kind === 'meal' || e.kind === 'exercise';
  const totalCount = events.filter(countable).length;
  const completedCount = events.filter((e) => countable(e) && isFinished(e)).length;

  // 1. Snoozed items jump the queue — the user explicitly asked for this one.
  const snoozed = events.filter((e) => {
    const until = completed.snoozed?.get(e.id);
    return until !== undefined && nowMinute <= until && !isFinished(e);
  });
  if (snoozed.length > 0) {
    const chosen = snoozed.reduce((best, e) =>
      (completed.snoozed?.get(e.id) ?? 0) < (completed.snoozed?.get(best.id) ?? 0) ? e : best,
    );
    return {
      nowEvent: chosen,
      nextEvent: nextAfter(chosen, events, isFinished),
      tone: 'live',
      state: 'snoozed',
      minutesIntoWindow: nowMinute - chosen.startMinute,
      minutesUntilNext: minutesUntil(chosen, events, nowMinute, isFinished),
      minutesSinceWindowEnd: null,
      completedCount,
      totalCount,
    };
  }

  // 2. In-window, preferring the required (non-optional) event.
  const inWindow = events.filter(
    (e) => isWithin(nowMinute, e.startMinute, e.endMinute) && !isFinished(e),
  );
  const current = pickPreferred(inWindow);
  if (current) {
    return {
      nowEvent: current,
      nextEvent: nextAfter(current, events, isFinished),
      tone: 'live',
      state: 'current',
      minutesIntoWindow: nowMinute - current.startMinute,
      minutesUntilNext: minutesUntil(current, events, nowMinute, isFinished),
      minutesSinceWindowEnd: null,
      completedCount,
      totalCount,
    };
  }

  // 3. Overdue but still worth surfacing, within the grace period.
  const overdue = events.filter((e) => {
    if (isFinished(e)) return false;
    const closedAt = minutesBetween(e.startMinute, nowMinute);
    return (
      minutesBetween(e.endMinute, nowMinute) < MEAL_GRACE_MINUTES &&
      closedAt > 0
    );
  });
  const chosen = pickPreferred(overdue);
  if (chosen) {
    return {
      nowEvent: chosen,
      nextEvent: nextAfter(chosen, events, isFinished),
      tone: 'still-open',
      state: 'overdue',
      minutesIntoWindow: nowMinute - chosen.startMinute,
      minutesUntilNext: minutesUntil(chosen, events, nowMinute, isFinished),
      minutesSinceWindowEnd: minutesBetween(chosen.endMinute, nowMinute),
      completedCount,
      totalCount,
    };
  }

  // 4. Nothing is open — point at the next one.
  const next = nextUpcoming(events, nowMinute, isFinished);
  if (next) {
    return {
      nowEvent: null,
      nextEvent: next,
      tone: totalCount > 0 && completedCount >= totalCount ? 'complete' : 'empty',
      state: null,
      minutesIntoWindow: 0,
      minutesUntilNext: minutesBetween(nowMinute, next.startMinute),
      minutesSinceWindowEnd: null,
      completedCount,
      totalCount,
    };
  }

  // 5. The day is over (or nothing is scheduled).
  const restEvent = events.find((e) => e.kind === 'sleep');
  return {
    nowEvent: restEvent && !isFinished(restEvent) ? restEvent : null,
    nextEvent: null,
    tone: totalCount > 0 && completedCount >= totalCount ? 'complete' : 'rest',
    state: restEvent && !isFinished(restEvent) ? 'current' : null,
    minutesIntoWindow: 0,
    minutesUntilNext: null,
    minutesSinceWindowEnd: null,
    completedCount,
    totalCount,
  };
}

/** Required events beat optional ones; ties break by how recently the window opened. */
function pickPreferred(events: readonly TimelineEvent[]): TimelineEvent | null {
  if (events.length === 0) return null;
  const required = events.filter((e) => !e.optional);
  const pool = required.length > 0 ? required : events;
  return pool.reduce((best, e) => (e.startMinute >= best.startMinute ? e : best));
}

function nextUpcoming(
  events: readonly TimelineEvent[],
  nowMinute: MinuteOfDay,
  isFinished: (e: TimelineEvent) => boolean,
): TimelineEvent | null {
  const upcoming = events
    .filter((e) => !isFinished(e) && minutesBetween(nowMinute, e.startMinute) < MINUTES_AHEAD && e.startMinute >= 300)
    .sort((a, b) => minutesBetween(nowMinute, a.startMinute) - minutesBetween(nowMinute, b.startMinute));
  return upcoming[0] ?? null;
}

const MINUTES_AHEAD = 20 * 60;

/** The next unfinished event that starts after `current`. */
function nextAfter(
  current: TimelineEvent,
  events: readonly TimelineEvent[],
  isFinished: (e: TimelineEvent) => boolean,
): TimelineEvent | null {
  const after = events
    .filter((e) => e.id !== current.id && !isFinished(e) && e.startMinute > current.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute);
  return after[0] ?? null;
}

function minutesUntil(
  current: TimelineEvent,
  events: readonly TimelineEvent[],
  nowMinute: MinuteOfDay,
  isFinished: (e: TimelineEvent) => boolean,
): number | null {
  const n = nextAfter(current, events, isFinished);
  return n ? minutesBetween(nowMinute, n.startMinute) : null;
}

// ---------------------------------------------------------------------------
// Per-event state for the timeline
// ---------------------------------------------------------------------------

export function stateFor(
  event: TimelineEvent,
  nowMinute: MinuteOfDay,
  completed: CompletedEvents,
): TimelineState {
  if (completed.skipped?.has(event.id)) return 'skipped';
  if (completed.done?.has(event.id)) {
    return minutesBetween(event.endMinute, nowMinute) < MEAL_GRACE_MINUTES ? 'current' : 'done';
  }
  const snoozedUntil = completed.snoozed?.get(event.id);
  if (snoozedUntil !== undefined && nowMinute <= snoozedUntil) return 'snoozed';
  if (isWithin(nowMinute, event.startMinute, event.endMinute)) return 'current';
  if (minutesBetween(event.endMinute, nowMinute) < MEAL_GRACE_MINUTES) return 'overdue';
  return 'upcoming';
}

export function isSettled(state: TimelineState): boolean {
  return state === 'done' || state === 'skipped';
}

// ---------------------------------------------------------------------------
// Defaults for a brand-new user
// ---------------------------------------------------------------------------

export function defaultSchedulePreference(): DailySchedulePreference {
  return {
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
}

/** Chronotype nudges the derived meal windows without overriding user input. */
export function suggestedWindows(
  wakeMinute: MinuteOfDay,
  chronotype: DailySchedulePreference['chronotype'],
  goal: FitnessGoal,
): DailySchedulePreference {
  const base = defaultSchedulePreference();
  const shift = chronotype === 'early' ? -60 : chronotype === 'late' ? 60 : 0;

  const breakfast = clampMinute(wakeMinute + (chronotype === 'early' ? 90 : 120) + shift * 0.25);
  const lunch = clampMinute(breakfast + 5 * 60);
  const dinner = clampMinute(Math.max(breakfast + 11 * 60, 19 * 60 + 30) + shift * 0.5);

  return {
    ...base,
    wakeMinute: clampMinute(wakeMinute),
    breakfastMinute: breakfast,
    fruitMinute: clampMinute(breakfast + 3 * 60),
    lunchMinute: lunch,
    snackMinute: clampMinute(lunch + 3 * 60),
    exerciseMinute: clampMinute(dinner - (goal === 'build-muscle' ? 120 : 90)),
    dinnerMinute: dinner,
    sleepMinute: clampMinute(dinner + 150),
  };
}

/** `dinner` must finish before wind-down starts; `lo` keeps the day ordered. */
function clampBetween(value: number, lo: number, hi: number): number {
  return hi >= lo ? clampMinute(Math.max(lo, Math.min(value, hi))) : clampMinute(lo);
}

/**
 * The meal times the plan is actually built from, derived from the two times a
 * user really enters: when they wake and when they sleep.
 *
 * Before this, onboarding collected wake/sleep but every meal kept the fixed
 * 8:30/13:30/20:00 defaults, so a 6 AM riser got breakfast after they had
 * already been up for hours and a 9 PM sleeper got a dinner window that closed
 * after bedtime. Nothing here overrides an explicit user time — the wake,
 * sleep and exercise minutes come straight back in.
 */
export function deriveSchedule(input: {
  readonly wakeMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly exerciseMinute: MinuteOfDay;
  readonly chronotype: DailySchedulePreference['chronotype'];
  readonly workPattern: DailySchedulePreference['workPattern'];
  readonly goal: FitnessGoal;
  /**
   * What the profile had before this run. A meal time the user actually set
   * (anything that is not still the factory default) is kept as-is; only the
   * untouched ones are re-derived from wake/sleep.
   */
  readonly current?: DailySchedulePreference;
}): DailySchedulePreference {
  const wake = clampMinute(input.wakeMinute);
  const sleep = clampMinute(input.sleepMinute);
  const suggested = suggestedWindows(wake, input.chronotype, input.goal);

  // Bed after midnight sits on an unwrapped axis, so "dinner before wind-down"
  // never turns into a negative minute for a 1 AM bedtime.
  const bed = sleep < wake ? sleep + MINUTES_PER_DAY : sleep;
  const beforeWindDown = bed - 75 - DEFAULT_MEAL_WINDOW;

  const keep = (
    key:
      | 'breakfastMinute'
      | 'fruitMinute'
      | 'lunchMinute'
      | 'snackMinute'
      | 'dinnerMinute',
    derived: MinuteOfDay,
  ): MinuteOfDay => {
    const mine = input.current?.[key];
    return mine !== undefined && mine !== DEFAULT_SCHEDULE[key] ? mine : derived;
  };

  const breakfast = keep('breakfastMinute', suggested.breakfastMinute);
  const lunch = keep('lunchMinute', suggested.lunchMinute);
  const dinner = clampBetween(
    keep('dinnerMinute', suggested.dinnerMinute),
    lunch + 90,
    beforeWindDown,
  );

  return {
    ...suggested,
    wakeMinute: wake,
    breakfastMinute: breakfast,
    fruitMinute: clampBetween(
      keep('fruitMinute', suggested.fruitMinute),
      breakfast + 60,
      Math.max(breakfast + 60, lunch - 60),
    ),
    lunchMinute: lunch,
    snackMinute: clampBetween(
      keep('snackMinute', suggested.snackMinute),
      lunch + 60,
      Math.max(lunch + 60, dinner - 60),
    ),
    dinnerMinute: dinner,
    exerciseMinute: clampMinute(input.exerciseMinute),
    sleepMinute: sleep,
    chronotype: input.chronotype,
    workPattern: input.workPattern,
  };
}

/** The one id the movement event is ticked off with, in the engine and the UI. */
export function exerciseEventId(date: CalendarDay): string {
  return `${date}:exercise`;
}

/**
 * A copy of the profile whose meal times are re-derived from its wake and sleep
 * times. Every build runs through this, so there is exactly one place where the
 * plan learns when the user's day starts and ends.
 */
export function deriveScheduleForProfile(profile: Profile): Profile {
  const pref = profile.schedule;
  return {
    ...profile,
    schedule: deriveSchedule({
      wakeMinute: pref.wakeMinute,
      sleepMinute: pref.sleepMinute,
      exerciseMinute: pref.exerciseMinute,
      chronotype: pref.chronotype,
      workPattern: pref.workPattern,
      goal: profile.goal,
      current: pref,
    }),
  };
}

export function sleepTargetHoursFor(age: number): number {
  if (age < 18) return 9;
  if (age <= 60) return 8;
  return 7.5;
}

export function impliedSleepHours(pref: DailySchedulePreference): number {
  return Math.round(hoursBetweenSleep(pref.sleepMinute, pref.wakeMinute) * 10) / 10;
}

export { wrapMinute };
