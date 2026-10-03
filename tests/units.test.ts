/**
 * Unit conversion and validation.
 *
 * These back the kg/lb and cm/ft-in inputs the profile editor is specified to
 * accept. They are deliberately tested even though the onboarding form currently
 * collects metric only: the conversion is where an off-by-one (or a swapped
 * feet/inches) becomes a wrong calorie target, and a wrong calorie target is
 * something the user cannot see.
 */

import { describe, expect, it } from 'vitest';
import {
  AGE_MAX,
  AGE_MIN,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  INCHES_PER_FOOT,
  LB_PER_KG,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  checkAge,
  checkBudget,
  checkHeight,
  checkWeight,
  clampNumber,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatWeight,
  kgToLb,
  lbToKg,
  toHeightCm,
} from '@/lib/domain/units';

describe('weight', () => {
  it('round-trips without drift', () => {
    expect(lbToKg(kgToLb(72.4))).toBeCloseTo(72.4, 6);
    // Rounded to a tenth on purpose, so the form shows a readable number.
    expect(kgToLb(1)).toBeCloseTo(LB_PER_KG, 1);
    expect(lbToKg(lbToKg(0))).toBe(0);
  });

  it('renders in the system the user chose', () => {
    expect(formatWeight(70, 'metric')).toEqual({ value: 70, unit: 'kg', label: '70 kg' });
    const imperial = formatWeight(70, 'imperial');
    expect(imperial.unit).toBe('lb');
    expect(imperial.value).toBeCloseTo(154.3, 0);
  });
});

describe('height', () => {
  it('splits cm into feet and inches', () => {
    expect(cmToFeetInches(170)).toEqual({ feet: 5, inches: 7 });
  });

  it('never reports a negative or 12-inch remainder', () => {
    for (let cm = 100; cm <= 220; cm += 1) {
      const { feet, inches } = cmToFeetInches(cm);
      expect(inches, `${cm}cm gave ${inches} inches`).toBeGreaterThanOrEqual(0);
      expect(inches).toBeLessThan(INCHES_PER_FOOT);
      expect(feet).toBeGreaterThanOrEqual(0);
    }
  });

  it('carries 12 inches into a foot rather than discarding it', () => {
    expect(feetInchesToCm(5, 12)).toBe(feetInchesToCm(6, 0));
    expect(feetInchesToCm(5, 12)).toBeGreaterThan(feetInchesToCm(5, 11));
  });

  it('round-trips feet and inches back to cm', () => {
    for (const cm of [140, 155, 170, 188, 205]) {
      const { feet, inches } = cmToFeetInches(cm);
      // Rounding to a whole inch can cost up to 1.3 cm; anything more is a bug.
      expect(Math.abs(feetInchesToCm(feet, inches) - cm)).toBeLessThanOrEqual(2);
    }
  });

  it('accepts either system through a single entry point', () => {
    expect(toHeightCm({ unit: 'metric', cm: 170 })).toBe(170);
    expect(toHeightCm({ unit: 'imperial', feet: 5, inches: 7 })).toBe(170);
    // An empty field is not a height of zero.
    expect(toHeightCm({ unit: 'metric' })).toBeNull();
    expect(toHeightCm({ unit: 'imperial' })).toBeNull();
  });

  it('renders in the system the user chose', () => {
    expect(formatHeight(170, 'metric')).toEqual({ value: 170, unit: 'cm', label: '170 cm' });
    expect(formatHeight(170, 'imperial').unit).toBe('ft');
  });
});

describe('validation', () => {
  it('accepts values inside the range', () => {
    expect(checkAge(30).ok).toBe(true);
    expect(checkHeight(170).ok).toBe(true);
    expect(checkWeight(65).ok).toBe(true);
    expect(checkBudget(150).ok).toBe(true);
  });

  it('rejects a value that is missing', () => {
    for (const check of [checkAge, checkHeight, checkWeight, checkBudget]) {
      expect(check(null).ok).toBe(false);
    }
  });

  it('rejects values outside the bounds rather than clamping silently', () => {
    expect(checkAge(AGE_MIN - 1).ok).toBe(false);
    expect(checkAge(AGE_MAX + 1).ok).toBe(false);
    expect(checkHeight(HEIGHT_CM_MIN - 1).ok).toBe(false);
    expect(checkHeight(HEIGHT_CM_MAX + 1).ok).toBe(false);
    expect(checkWeight(WEIGHT_KG_MIN - 1).ok).toBe(false);
    expect(checkWeight(WEIGHT_KG_MAX + 1).ok).toBe(false);
    expect(checkBudget(-1).ok).toBe(false);
  });

  it('says why something was rejected', () => {
    expect(checkAge(5).message).toBeTruthy();
    expect(checkHeight(400).message).toBeTruthy();
  });

  it('clamps rather than overflows', () => {
    expect(clampNumber(1e9, WEIGHT_KG_MIN, WEIGHT_KG_MAX)).toBe(WEIGHT_KG_MAX);
  });
});
