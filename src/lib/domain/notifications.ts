/**
 * Reminder engine + anti-spam policy.
 *
 * `buildReminders` is pure: it decides what *should* fire today. A platform
 * scheduler diffs that against `firedReminders` and fires only newly-due items.
 * Nothing here touches the Notification API.
 *
 * Anti-spam is enforced here (not in the scheduler) so it is testable:
 *   · category toggles       · quiet hours (wrapping past midnight)
 *   · per-category daily cap · overall daily cap   · snooze
 *   · skip-state             · fired-state          · catch-up window
 */

import type {
  CalendarDay,
  DailySchedule,
  FiredReminder,
  Meal,
  MinuteOfDay,
  NotificationCategory,
  NotificationSettings,
  Reminder,
  ReminderAction,
  SleepPlan,
  SuppressionReason,
  TimelineEvent,
  Workout,
} from './types/index';
import { formatMinute, isWithin, minutesBetween } from './time';
import { motivationFor } from './fitness';

export const CATEGORY_CAPS: Readonly<Record<NotificationCategory, number>> = {
  meals: 4,
  water: 4,
  exercise: 1,
  sleep: 2,
  motivation: 1,
};

export const DEFAULT_DAILY_CAP = 12;
/** A reminder missed by more than this is dropped rather than fired late. */
export const CATCH_UP_WINDOW_MINUTES = 90;
export const MIN_SNOOZE_MINUTES = 10;

export const DEFAULT_SETTINGS: NotificationSettings = {
  meals: true,
  water: true,
  exercise: true,
  sleep: true,
  motivation: false,
  quietHoursStart: 22 * 60 + 30,
  quietHoursEnd: 6 * 60 + 30,
  snoozeMinutes: 15,
  dailyCap: DEFAULT_DAILY_CAP,
  browserPermission: 'default',
  delivery: 'auto',
};

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

/** Handles the wrap case (22:30 → 06:30) correctly. */
export function inQuietHours(minute: MinuteOfDay, start: MinuteOfDay, end: MinuteOfDay): boolean {
  return isWithin(minute, start, end);
}

// ---------------------------------------------------------------------------
// Reminder construction
// ---------------------------------------------------------------------------

export interface ReminderInput {
  readonly date: CalendarDay;
  readonly schedule: DailySchedule;
  readonly meals: readonly Meal[];
  readonly workout: Workout | null;
  readonly sleepPlan: SleepPlan | null;
  readonly settings: NotificationSettings;
  readonly doneEventIds: ReadonlySet<string>;
  readonly skippedEventIds: ReadonlySet<string>;
  readonly snoozed: ReadonlyMap<string, MinuteOfDay>;
  readonly alreadyFired: readonly FiredReminder[];
  readonly hydrationNudges: readonly { id: string; minute: MinuteOfDay; label: string; suggestedMl: number; reason: string }[];
}

/**
 * Returns every reminder for today, including suppressed ones with
 * `suppressedBy` set. Keeping them (rather than filtering) lets the settings
 * screen explain *why* a category produced nothing.
 */
export function buildReminders(input: ReminderInput): readonly Reminder[] {
  const { settings, date } = input;
  const candidates: Reminder[] = [];

  const mealById = new Map(input.meals.map((m) => [m.id, m]));

  for (const event of input.schedule.events) {
    if (event.optional && event.kind !== 'hydration') continue;

    const settled = input.doneEventIds.has(event.id) || input.skippedEventIds.has(event.id);
    const snoozedUntil = input.snoozed.get(event.id);
    const fireMinute =
      snoozedUntil !== undefined && snoozedUntil > event.startMinute
        ? snoozedUntil
        : event.startMinute;

    const category = categoryFor(event);
    if (category === null) continue;

    const { title, body, actions, route } = compose(event, mealById.get(event.mealId ?? ''), input);

    candidates.push({
      id: `${date}:${event.id}:${category}`,
      date,
      category,
      eventId: event.id,
      fireMinute,
      title,
      body,
      actions,
      route,
      priority: priorityFor(event),
      ...(settled ? { suppressedBy: 'already-done' as SuppressionReason } : {}),
    });
  }

  // Water nudges are timeline-driven, not event-driven.
  if (settings.water) {
    for (const nudge of input.hydrationNudges) {
      const snoozedUntil = input.snoozed.get(nudge.id);
      candidates.push({
        id: `${nudge.id}:water`,
        date,
        category: 'water',
        eventId: nudge.id,
        fireMinute:
          snoozedUntil !== undefined && snoozedUntil > nudge.minute ? snoozedUntil : nudge.minute,
        title: 'Water break',
        body: `About ${nudge.suggestedMl} ml. ${nudge.reason}.`,
        actions: ['done'],
        priority: 'low',
      });
    }
  }

  if (settings.motivation) {
    candidates.push({
      id: `${date}:motivation`,
      date,
      category: 'motivation',
      eventId: `${date}:motivation`,
      fireMinute: 7 * 60 + 45,
      title: 'One thing today',
      body: motivationFor(date),
      actions: [],
      priority: 'low',
    });
  }

  return applySuppression(candidates, input);
}

function categoryFor(event: TimelineEvent): NotificationCategory | null {
  switch (event.kind) {
    case 'meal':
      return 'meals';
    case 'hydration':
    case 'post-workout':
      return 'water';
    case 'movement':
    case 'exercise':
      return 'exercise';
    case 'wind-down':
    case 'sleep-prep':
    case 'sleep':
      return 'sleep';
    case 'wake':
    case 'custom':
      return null;
    default:
      return null;
  }
}

function priorityFor(event: TimelineEvent): 'low' | 'normal' | 'high' {
  if (event.kind === 'meal') return 'high';
  if (event.kind === 'exercise') return 'normal';
  if (event.kind === 'sleep' || event.kind === 'sleep-prep') return 'normal';
  return 'low';
}

/**
 * Reminder copy. Written as a person would say it: what, how much, why.
 */
function compose(
  event: TimelineEvent,
  meal: Meal | undefined,
  input: ReminderInput,
): {
  title: string;
  body: string;
  actions: readonly ReminderAction[];
  route?: string;
} {
  const route = event.mealId ? '/today?meal=' + encodeURIComponent(event.mealId) : undefined;

  if (event.kind === 'meal' && meal) {
    const items = meal.ingredients
      .filter((i) => !i.optional)
      .slice(0, 3)
      .map((i) => i.portion.label.replace(/^\d+\s*/, ''))
      .join(', ');
    const amounts = meal.ingredients
      .filter((i) => !i.optional)
      .slice(0, 3)
      .map((i) => i.portion.label)
      .join(' + ');
    const slotWord = mealLabel(meal.slot);

    if (meal.slot === 'fruit') {
      return {
        title: 'Fruit time',
        body: `Today's fruit: ${meal.ingredients[0]?.name ?? 'a seasonal fruit'}. Have one serving and drink some water with it.`,
        actions: ['done', 'skip'],
        route,
      };
    }

    return {
      title: `${slotWord} time`,
      body: `Today's ${meal.slot}: ${amounts || items}. ${
        meal.prepMinutes > 0 ? `Takes about ${meal.prepMinutes} minutes.` : ''
      }`.trim(),
      actions: meal.prepMinutes > 0 ? ['done', 'skip', 'view-meal'] : ['done', 'view-meal'],
      route,
    };
  }

  switch (event.kind) {
    case 'hydration':
      return {
        title: 'Water break',
        body: `About ${event.hydrationMl ?? 300} ml. ${event.why}`,
        actions: ['done'],
      };
    case 'post-workout':
      return {
        title: 'Rehydrate',
        body: `Sip about ${event.hydrationMl ?? 400} ml over the next half hour.`,
        actions: ['done'],
      };
    case 'exercise': {
      const workout = input.workout;
      return {
        title: 'Movement time',
        body: workout
          ? `${workout.totalMinutes} minutes — ${workout.blocks.length} exercises. ${workout.noGymNote}`
          : `${Math.min(30, 30)} minutes of walking and simple bodyweight exercises.`,
        actions: ['start-workout', 'snooze'],
        route: '/fitness',
      };
    }
    case 'wind-down':
      return {
        title: 'Start winding down',
        body: 'Dim the lights and finish anything that needs real thinking.',
        actions: ['done'],
      };
    case 'sleep-prep':
      return {
        title: 'Prepare for sleep',
        body: input.sleepPlan
          ? `Wind-down starts at ${formatMinute(input.sleepPlan.ladder[0]?.minute ?? input.sleepPlan.targetBedMinute)}. Brush teeth, wash up, set your alarm.`
          : 'Brush teeth, wash up, set your alarm.',
        actions: ['done'],
      };
    case 'sleep':
      return {
        title: 'Sleep time',
        body: input.sleepPlan
          ? `Lights out. About ${input.sleepPlan.targetHours} hours from now.`
          : 'Lights out. Keep the wake time steady tomorrow, even if tonight is not perfect.',
        actions: ['done'],
      };
    case 'wake':
      return {
        title: 'Good morning',
        body: 'Glass of water first, then look at today\'s plan.',
        actions: ['done'],
        route: '/today',
      };
    case 'movement':
      return {
        title: 'Light movement',
        body: `${event.detail} ${event.why}`,
        actions: ['done'],
      };
    default:
      return { title: event.title, body: event.detail, actions: ['done'] };
  }
}

function mealLabel(slot: Meal['slot']): string {
  switch (slot) {
    case 'breakfast':
      return 'Breakfast';
    case 'fruit':
      return 'Fruit';
    case 'lunch':
      return 'Lunch';
    case 'snack':
      return 'Snack';
    case 'dinner':
      return 'Dinner';
    default:
      return 'Meal';
  }
}

// ---------------------------------------------------------------------------
// Suppression — the anti-spam policy
// ---------------------------------------------------------------------------

function applySuppression(
  candidates: readonly Reminder[],
  input: ReminderInput,
): readonly Reminder[] {
  const { settings } = input;
  const firedFingerprints = new Set(input.alreadyFired.map((f) => f.fingerprint));
  const perCategory = new Map<NotificationCategory, number>();

  const enabled: Record<NotificationCategory, boolean> = {
    meals: settings.meals,
    water: settings.water,
    exercise: settings.exercise,
    sleep: settings.sleep,
    motivation: settings.motivation,
  };

  let total = 0;

  const out = candidates.map((r): Reminder => {
    if (!enabled[r.category]) return { ...r, suppressedBy: 'category-off' };
    if (r.suppressedBy === 'already-done') return r;
    if (firedFingerprints.has(r.id)) return { ...r, suppressedBy: 'already-done' };
    if (inQuietHours(r.fireMinute, settings.quietHoursStart, settings.quietHoursEnd)) {
      return { ...r, suppressedBy: 'quiet-hours' };
    }

    const used = perCategory.get(r.category) ?? 0;
    const cap = Math.min(CATEGORY_CAPS[r.category], settings.dailyCap);
    if (used >= cap) return { ...r, suppressedBy: 'daily-cap' };
    if (total >= settings.dailyCap) return { ...r, suppressedBy: 'daily-cap' };

    perCategory.set(r.category, used + 1);
    total += 1;
    return r;
  });

  // Deterministic order: by fire time, then priority.
  const rank: Record<'low' | 'normal' | 'high', number> = { high: 0, normal: 1, low: 2 };
  return out.sort((a, b) => a.fireMinute - b.fireMinute || rank[a.priority] - rank[b.priority]);
}

/** Reminders that should fire right now, given what has already fired. */
export function dueReminders(
  reminders: readonly Reminder[],
  nowMinute: MinuteOfDay,
  alreadyFired: readonly FiredReminder[],
): readonly Reminder[] {
  const fired = new Set(alreadyFired.map((f) => f.fingerprint));
  return reminders.filter((r) => {
    if (r.suppressedBy) return false;
    if (fired.has(r.id)) return false;
    const dueIn = minutesBetween(r.fireMinute, nowMinute);
    // Fires when its time arrives, or shortly after if the app was closed.
    return dueIn >= 0 && dueIn <= CATCH_UP_WINDOW_MINUTES;
  });
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

export function snoozeUntil(current: MinuteOfDay, minutes: number): MinuteOfDay {
  return Math.max(0, Math.min(1439, current + Math.max(MIN_SNOOZE_MINUTES, minutes)));
}

/** Estimate of how many reminders a day will actually produce. */
export function estimateDailyVolume(settings: NotificationSettings): number {
  let n = 0;
  if (settings.meals) n += 5;
  if (settings.water) n += 4;
  if (settings.exercise) n += 1;
  if (settings.sleep) n += 2;
  if (settings.motivation) n += 1;
  return Math.min(n, settings.dailyCap);
}

export const QUIET_HOURS_PRESETS: readonly {
  readonly label: string;
  readonly start: MinuteOfDay;
  readonly end: MinuteOfDay;
  readonly detail: string;
}[] = [
  { label: '10:30 PM – 6:30 AM', start: 22 * 60 + 30, end: 6 * 60 + 30, detail: 'Default' },
  { label: '9:30 PM – 5:30 AM', start: 21 * 60 + 30, end: 5 * 60 + 30, detail: 'Earlier nights' },
  { label: '11:30 PM – 7:00 AM', start: 23 * 60 + 30, end: 7 * 60, detail: 'Late nights' },
  { label: 'No quiet hours', start: 0, end: 0, detail: 'Reminders any time' },
];

export const SNOOZE_OPTIONS: readonly number[] = [10, 15, 20, 30, 45];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  meals: 'Meals',
  water: 'Water',
  exercise: 'Exercise',
  sleep: 'Sleep',
  motivation: 'Motivational messages',
};

export const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  meals: 'A nudge at each meal time with today\'s food',
  water: 'A few gentle water reminders through the day',
  exercise: 'One reminder at your movement time',
  sleep: 'Wind-down and sleep-time reminders',
  motivation: 'One short encouraging line in the morning',
};
