/**
 * Pure time helpers. Domain code never calls `Date.now()`; the caller injects
 * the `Date` via `EngineContext` and everything below operates on integers.
 *
 * `CalendarDay` is computed in the USER'S timezone, never UTC — a user in
 * India logging at 11:50 PM must land on the correct local day.
 */

import type { CalendarDay, MinuteOfDay } from './types/index';
import { MINUTES_PER_DAY } from './types/index';

export const clampMinute = (m: number): MinuteOfDay =>
  Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(m)));

export const wrapMinute = (m: number): MinuteOfDay =>
  ((Math.round(m) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

/** 510 → '8:30 AM'. All user-facing times use this. */
export function formatMinute(minute: MinuteOfDay): string {
  const m = wrapMinute(minute);
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/** 510 → '08:30'. Used for `<input type="time">` and keys. */
export function formatMinute24(minute: MinuteOfDay): string {
  const m = wrapMinute(minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** '08:30' → 510 */
export function parseMinute24(value: string): MinuteOfDay | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** True when `a` <= `b` in wrapped-midnight-tolerant terms. */
export function isBeforeOrEqual(a: MinuteOfDay, b: MinuteOfDay): boolean {
  return a <= b;
}

/** True when `minute` lies within `[start, end)`, tolerating wrap past midnight. */
export function isWithin(
  minute: MinuteOfDay,
  start: MinuteOfDay,
  end: MinuteOfDay,
): boolean {
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** Forward distance from `from` to `to`, wrapping at midnight. 0..1439. */
export function minutesBetween(from: MinuteOfDay, to: MinuteOfDay): number {
  return wrapMinute(to - from);
}

/** "2h 56m" / "45m" / "in a moment" */
export function formatDuration(totalMinutes: number): string {
  const abs = Math.abs(Math.round(totalMinutes));
  if (abs < 1) return 'less than a minute';
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Relative countdown for the NEXT card: 'in 2h 56m'. */
export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'now';
  return `in ${formatDuration(minutes)}`;
}

// ---------------------------------------------------------------------------
// Calendar days
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/** Minutes from local midnight for a Date, in a given IANA timezone. */
export function localMinuteOfDay(date: Date, tz: string): MinuteOfDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string): number => {
    const found = parts.find((p) => p.type === t);
    return found ? Number(found.value) : 0;
  };
  const h = get('hour') % 24;
  return h * 60 + get('minute');
}

/** 'YYYY-MM-DD' for a Date, in a given IANA timezone. */
export function toCalendarDay(date: Date, tz: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 0 = Sunday, in the user's timezone. */
export function dayOfWeekFor(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).formatToParts(
    date,
  );
  const name = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return order.indexOf(name);
}

/** Month index 0-11 in the user's timezone. */
export function monthFor(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).formatToParts(
    date,
  );
  const v = parts.find((p) => p.type === 'month')?.value;
  return v ? Number(v) - 1 : 0;
}

/** Shift a 'YYYY-MM-DD' string by whole days without touching the local clock. */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const base = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(base);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return 0;
  const at = Date.UTC(a[0] ?? 1970, (a[1] ?? 1) - 1, a[2] ?? 1);
  const bt = Date.UTC(b[0] ?? 1970, (b[1] ?? 1) - 1, b[2] ?? 1);
  return Math.round((bt - at) / 86_400_000);
}

/** Monday-first week start containing `day`. */
export function startOfWeek(day: CalendarDay, dayOfWeek: number): CalendarDay {
  const offset = (dayOfWeek + 6) % 7;
  return addDays(day, -offset);
}

export function humanDate(day: CalendarDay): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function shortDate(day: CalendarDay): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

export function relativeDayLabel(day: CalendarDay, today: CalendarDay): string | null {
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return null;
}

/** Wall-clock hours of sleep implied by a bedtime/wake pair (may cross midnight). */
export function hoursBetweenSleep(bedMinute: MinuteOfDay, wakeMinute: MinuteOfDay): number {
  return minutesBetween(bedMinute, wakeMinute) / 60;
}
