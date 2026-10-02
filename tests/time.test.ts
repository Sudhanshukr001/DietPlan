import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeekFor,
  daysBetween,
  formatCountdown,
  formatDuration,
  formatMinute,
  humanDate,
  hoursBetweenSleep,
  isWithin,
  localMinuteOfDay,
  minutesBetween,
  monthFor,
  parseMinute24,
  relativeDayLabel,
  shortDate,
  startOfWeek,
  toCalendarDay,
  wrapMinute,
} from '@/lib/domain/time';
import { CTX, DATE, NOW, TZ } from './fixtures';

describe('formatting minutes', () => {
  it('renders 12-hour time without a leading zero', () => {
    expect(formatMinute(0)).toBe('12:00 AM');
    expect(formatMinute(9 * 60 + 5)).toBe('9:05 AM');
    expect(formatMinute(12 * 60)).toBe('12:00 PM');
    expect(formatMinute(13 * 60 + 30)).toBe('1:30 PM');
    expect(formatMinute(23 * 60 + 45)).toBe('11:45 PM');
    expect(formatMinute(12 * 60 + 1)).toBe('12:01 PM');
  });

  it('round-trips through 24-hour parsing', () => {
    for (const m of [0, 1, 359, 720, 743, 1080, 1439]) {
      expect(parseMinute24(formatMinute24OrPad(m))).toBe(m);
    }
  });

  it('rejects malformed input instead of guessing', () => {
    expect(parseMinute24('')).toBeNull();
    expect(parseMinute24('7')).toBeNull();
    expect(parseMinute24('25:00')).toBeNull();
    expect(parseMinute24('12:60')).toBeNull();
    expect(parseMinute24('7:0a')).toBeNull();
  });

  it('accepts 24-hour input from time inputs', () => {
    expect(parseMinute24('07:05')).toBe(425);
    expect(parseMinute24('23:59')).toBe(1439);
  });
});

function formatMinute24OrPad(m: number): string {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}`;
}

describe('minute comparison helpers', () => {
  it('treats quiet hours as wrapping past midnight', () => {
    expect(isWithin(23 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(true);
    expect(isWithin(2 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(true);
    expect(isWithin(6 * 60 + 30, 22 * 60 + 30, 6 * 60 + 30)).toBe(false);
    expect(isWithin(12 * 60, 22 * 60 + 30, 6 * 60 + 30)).toBe(false);
    expect(isWithin(22 * 60 + 30, 22 * 60 + 30, 6 * 60 + 30)).toBe(true);
  });

  it('treats an empty range as always true, which is how "no quiet hours" is expressed', () => {
    expect(isWithin(500, 0, 0)).toBe(true);
  });

  it('computes forward distance across midnight', () => {
    expect(minutesBetween(23 * 60 + 30, 30)).toBe(60);
    expect(minutesBetween(9 * 60, 10 * 60 + 30)).toBe(90);
    expect(minutesBetween(10 * 60, 10 * 60)).toBe(0);
  });

  it('wraps minute arithmetic', () => {
    expect(wrapMinute(-30)).toBe(1410);
    expect(wrapMinute(1450)).toBe(10);
    expect(wrapMinute(600)).toBe(600);
  });

  it('measures sleep across midnight', () => {
    expect(hoursBetweenSleep(23 * 60, 7 * 60)).toBeCloseTo(8, 1);
    expect(hoursBetweenSleep(22 * 60 + 30, 6 * 60)).toBeCloseTo(7.5, 1);
  });
});

describe('duration wording', () => {
  it('never uses shame language', () => {
    const skipped = formatCountdown(45);
    expect(skipped.toLowerCase()).not.toContain('miss');
    expect(skipped.toLowerCase()).not.toContain('fail');
  });

  it('describes durations in hours and minutes', () => {
    expect(formatDuration(90)).toMatch(/1/);
    expect(formatDuration(45)).toMatch(/45/);
    expect(formatDuration(0)).toBe('less than a minute');
  });
});

describe('timezone handling', () => {
  it('derives the calendar day in the target timezone, not UTC', () => {
    // 2026-01-14T18:30:00Z is 2026-01-15 00:00 IST.
    const late = new Date('2026-01-14T18:30:00.000Z');
    expect(toCalendarDay(late, TZ)).toBe('2026-01-15');
    expect(localMinuteOfDay(late, TZ)).toBe(0);
  });

  it('resolves the local minute of day', () => {
    expect(localMinuteOfDay(NOW, TZ)).toBe(13 * 60 + 42);
    expect(monthFor(NOW, TZ)).toBe(0);
    expect(typeof dayOfWeekFor(NOW, TZ)).toBe('number');
  });

  it('is stable for the same instant regardless of the host timezone', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(toCalendarDay(NOW, TZ)).toBe('2026-01-14');
      expect(localMinuteOfDay(NOW, TZ)).toBe(13 * 60 + 42);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('calendar day arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-01-14', '2026-01-15')).toBe(1);
    expect(daysBetween('2026-01-15', '2026-01-14')).toBe(-1);
    expect(daysBetween(DATE, DATE)).toBe(0);
  });

  it('finds the week start for a given weekday index', () => {
    // Monday-first, so a Wednesday belongs to the week starting Monday.
    expect(startOfWeek('2026-01-14', 3)).toBe('2026-01-12');
    expect(startOfWeek('2026-01-12', 1)).toBe('2026-01-12');
    expect(startOfWeek('2026-01-18', 0)).toBe('2026-01-12');
  });

  it('labels relative days and returns null beyond that', () => {
    expect(relativeDayLabel(DATE, DATE)).toBe('Today');
    expect(relativeDayLabel('2026-01-15', DATE)).toBe('Tomorrow');
    expect(relativeDayLabel('2026-01-13', DATE)).toBe('Yesterday');
    expect(relativeDayLabel('2026-01-20', DATE)).toBeNull();
  });

  it('formats human and short dates', () => {
    expect(humanDate(DATE)).toBe('Wednesday, January 14');
    expect(shortDate(DATE)).toMatch(/14/);
  });
});

describe('injected context', () => {
  it('uses the supplied instant, never the wall clock', () => {
    expect(CTX.now.getTime()).toBe(NOW.getTime());
    expect(CTX.tz).toBe(TZ);
    expect(CTX.month).toBe(0);
  });
});
