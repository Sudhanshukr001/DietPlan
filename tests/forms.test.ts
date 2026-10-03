/**
 * Numeric form behaviour.
 *
 * The defect these guard against is specific and was present in the original
 * code: `onChange={(e) => set(Number(e.target.value))}`. Clearing a field set it to
 * 0 and rendered it back as 0, so a user clearing their budget to retype it and
 * hitting Save wrote ₹0 — and there was no state in which the field could be empty.
 */

import { describe, expect, it } from 'vitest';
import {
  clampNumber,
  normaliseNumericText,
  parseNumericText,
  sanitizeNumericText,
} from '@/lib/domain/units';
import { budgetPosition, costProjection } from '@/lib/domain/costProjection';

describe('sanitizeNumericText', () => {
  it('keeps only digits and a single decimal point', () => {
    expect(sanitizeNumericText('62')).toBe('62');
    expect(sanitizeNumericText('62.5', 1)).toBe('62.5');
    expect(sanitizeNumericText('62.55', 1)).toBe('62.5');
    expect(sanitizeNumericText('6a2b')).toBe('62');
    expect(sanitizeNumericText('-5')).toBe('5');
  });

  it('cannot be used to inject anything into a number field', () => {
    for (const hostile of ['<script>', '1e10', '1;2', ' 12 ', 'NaN', 'Infinity']) {
      expect(sanitizeNumericText(hostile)).toMatch(/^[0-9.]*$/);
    }
  });
});

describe('parseNumericText', () => {
  it('treats empty as not filled in, never as zero', () => {
    expect(parseNumericText('')).toBeNull();
    expect(parseNumericText('.')).toBeNull();
    expect(parseNumericText('   ')).toBeNull();
  });

  it('parses what the user actually typed', () => {
    expect(parseNumericText('150')).toBe(150);
    expect(parseNumericText('62.4', 1)).toBe(62.4);
    expect(parseNumericText('05')).toBe(5);
  });
});

describe('normaliseNumericText', () => {
  it('drops the leading zero a field would otherwise keep', () => {
    expect(normaliseNumericText('05')).toBe('5');
    expect(normaliseNumericText('007')).toBe('7');
  });

  it('leaves an empty field empty rather than showing a 0', () => {
    expect(normaliseNumericText('')).toBe('');
  });

  it('trims surplus decimals', () => {
    expect(normaliseNumericText('62.40', 1)).toBe('62.4');
    expect(normaliseNumericText('62.00', 1)).toBe('62');
  });
});

describe('clampNumber', () => {
  it('holds a value inside its bounds', () => {
    expect(clampNumber(-10, 0, 90)).toBe(0);
    expect(clampNumber(500, 0, 500)).toBe(500);
    expect(clampNumber(30, 0, 90)).toBe(30);
  });
});

describe('cost projection honesty', () => {
  it('never shows a range that excludes the figure it is describing', () => {
    // A range that does not contain its own value displays a different number
    // from the one the rest of the app uses, which is worse than showing none.
    const p = costProjection(137.4, 150);
    for (const figure of [p.daily, p.weekly, p.monthly]) {
      if (figure.range) {
        expect(figure.range.low).toBeLessThanOrEqual(figure.value);
        expect(figure.range.high).toBeGreaterThanOrEqual(figure.value);
      }
    }
  });

  it('scales up with the period', () => {
    const p = costProjection(120, 150);
    expect(p.weekly.value).toBeGreaterThan(p.daily.value);
    expect(p.monthly.value).toBeGreaterThan(p.weekly.value);
    expect(p.daily.value).toBeGreaterThan(0);
  });

  it('reports an over-budget day rather than hiding it', () => {
    expect(costProjection(200, 150).withinBudget).toBe(false);
    expect(costProjection(120, 150).withinBudget).toBe(true);
  });

  it('says where the figure came from', () => {
    expect(costProjection(120, 150).basis).toMatch(/today/i);
    expect(costProjection(120, 150, 95).basis).toMatch(/average/i);
  });

  it('places a day against the budget', () => {
    expect(budgetPosition(50, 40, 150).state).toBe('under');
    // 140/150 is 93%: close enough to the limit to flag.
    expect(budgetPosition(140, 0, 150).state).toBe('on-track');
    expect(budgetPosition(100, 0, 150).state).toBe('under');
    expect(budgetPosition(200, 0, 150).state).toBe('over');
    expect(budgetPosition(200, 0, 150).remaining).toBe(-50);
  });

  it('counts the larger of spent and planned, so a plan cannot hide behind a low spend', () => {
    expect(budgetPosition(10, 120, 150).remaining).toBe(30);
  });
});
