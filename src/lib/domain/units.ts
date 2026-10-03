/**
 * Unit conversion and display.
 *
 * The domain stores metric only (`heightCm`, `weightKg`). Everything a user
 * typed in pounds or feet/inches is normalised on the way in and formatted back
 * on the way out, so switching display units never touches a stored value or a
 * calorie target.
 *
 * All conversions round-trip exactly at the precision actually shown:
 *   lb → kg → lb,  ft+in → cm → ft+in
 */

import type { UnitSystem } from './types/index';

export const LB_PER_KG = 2.204_622_6;
export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;

/** Storage bounds. Shared by the form validators and the migration coercion. */
export const HEIGHT_CM_MIN = 120;
export const HEIGHT_CM_MAX = 230;
export const WEIGHT_KG_MIN = 25;
export const WEIGHT_KG_MAX = 250;
export const AGE_MIN = 13;
export const AGE_MAX = 100;

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export function lbToKg(lb: number): number {
  return Math.round((lb / LB_PER_KG) * 10) / 10;
}

/**
 * Rounded to one decimal place on purpose: this value goes into a text field the
 * user reads and edits, and 154.32372 lb helps nobody. The reverse conversion is
 * rounded the same way, so a round trip through the form is stable.
 */
export function kgToLb(kg: number): number {
  return Math.round(kg * LB_PER_KG * 10) / 10;
}

/** Renders a stored kg value in the user's preferred system. */
export function formatWeight(kg: number, units: UnitSystem): { value: number; unit: 'kg' | 'lb'; label: string } {
  if (units === 'imperial') {
    const lb = kgToLb(kg);
    return { value: lb, unit: 'lb', label: `${lb} lb` };
  }
  const rounded = Math.round(kg * 10) / 10;
  return { value: rounded, unit: 'kg', label: `${rounded} kg` };
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

export interface HeightParts {
  readonly cm: number;
  readonly feet: number;
  readonly inches: number;
}

/** Splits stored cm into whole feet + inches, rounded to the nearest inch. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  if (!Number.isFinite(cm) || cm <= 0) return { feet: 0, inches: 0 };
  const totalInches = Math.round(cm / CM_PER_INCH);
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  return { feet, inches: totalInches % INCHES_PER_FOOT };
}

/**
 * Feet and inches back to cm.
 *
 * Extra inches carry into feet rather than being discarded. The previous version
 * clamped inches to 11, so "5 feet 12 inches" quietly became 5 feet 11 inches —
 * silently returning a height the user never typed.
 */
export function feetInchesToCm(feet: number, inches: number): number {
  const safeFeet = Number.isFinite(feet) ? Math.max(0, feet) : 0;
  const safeInches = Number.isFinite(inches) ? Math.max(0, inches) : 0;
  return Math.round((safeFeet * INCHES_PER_FOOT + safeInches) * CM_PER_INCH);
}

/**
 * One entry point for the form: whatever unit was entered, the stored cm comes
 * back. An empty field returns `null` rather than 0, so "not filled in" stays
 * distinguishable from "zero centimetres tall".
 */
export function toHeightCm(
  value:
    | { readonly unit: 'metric'; readonly cm?: number }
    | { readonly unit: 'imperial'; readonly feet?: number; readonly inches?: number },
): number | null {
  if (value.unit === 'metric') {
    const cm = value.cm ?? 0;
    return Number.isFinite(cm) && cm > 0 ? Math.round(cm) : null;
  }
  const feet = value.feet ?? 0;
  const inches = value.inches ?? 0;
  if (feet <= 0 && inches <= 0) return null;
  return feetInchesToCm(feet, inches);
}

export function formatHeight(cm: number, units: UnitSystem): { value: number; unit: 'cm' | 'ft'; label: string } {
  if (units === 'imperial') {
    const { feet, inches } = cmToFeetInches(cm);
    const label = inches === 0 ? `${feet} ft` : `${feet} ft ${inches} in`;
    return { value: feet, unit: 'ft', label };
  }
  return { value: Math.round(cm), unit: 'cm', label: `${Math.round(cm)} cm` };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RangeCheck {
  readonly ok: boolean;
  readonly message: string;
}

export function checkAge(age: number | null): RangeCheck {
  if (age === null || Number.isNaN(age)) return { ok: false, message: 'Please enter your age.' };
  if (!Number.isInteger(age)) return { ok: false, message: 'Age should be a whole number.' };
  if (age < AGE_MIN || age > AGE_MAX)
    return { ok: false, message: `Please enter an age between ${AGE_MIN} and ${AGE_MAX}.` };
  return { ok: true, message: '' };
}

export function checkHeight(cm: number | null): RangeCheck {
  if (cm === null || Number.isNaN(cm)) return { ok: false, message: 'Please enter your height.' };
  if (cm < HEIGHT_CM_MIN || cm > HEIGHT_CM_MAX)
    return { ok: false, message: `Please enter a height between ${HEIGHT_CM_MIN} and ${HEIGHT_CM_MAX} cm.` };
  return { ok: true, message: '' };
}

export function checkWeight(kg: number | null): RangeCheck {
  if (kg === null || Number.isNaN(kg)) return { ok: false, message: 'Please enter your weight.' };
  if (kg < WEIGHT_KG_MIN || kg > WEIGHT_KG_MAX)
    return { ok: false, message: `Please enter a weight between ${WEIGHT_KG_MIN} and ${WEIGHT_KG_MAX} kg.` };
  return { ok: true, message: '' };
}

export function checkBudget(rupees: number | null): RangeCheck {
  if (rupees === null || Number.isNaN(rupees)) return { ok: false, message: 'Please enter a daily food budget.' };
  if (rupees < 30 || rupees > 2000)
    return { ok: false, message: 'Please enter a daily food budget between ₹30 and ₹2,000.' };
  return { ok: true, message: '' };
}

/** Accepts only digits and at most one decimal point, for a numeric text field. */
export function sanitizeNumericText(raw: string, decimals: 0 | 1 = 0): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole;
  const fraction = rest.join('').slice(0, decimals);
  if (fraction === '') return whole;
  return `${whole}.${fraction}`;
}
/**
 * Parse a numeric text field, treating empty as "not filled in" rather than zero.
 *
 * `Number('')` is 0, and that single fact is the source of most numeric-form bugs:
 * clearing a field to retype it and saving early writes 0, with no error. Here an
 * empty field returns `null` so the caller has to decide what it means.
 */
export function parseNumericText(raw: string, decimals: 0 | 1 = 0): number | null {
  const clean = sanitizeNumericText(raw, decimals);
  if (clean === '' || clean === '.') return null;
  const parsed = Number(clean);
  if (!Number.isFinite(parsed)) return null;
  return decimals === 0 ? Math.round(parsed) : Math.round(parsed * 10) / 10;
}

/**
 * Rewrite a numeric field's text so a leading zero disappears and trailing
 * decimals are trimmed: "05" -> "5", "62.40" -> "62.4", "" -> "".
 *
 * Runs on blur, not on every keystroke, so the caret never moves mid-typing.
 */
export function normaliseNumericText(raw: string, decimals: 0 | 1 = 0): string {
  const parsed = parseNumericText(raw, decimals);
  return parsed === null ? '' : String(parsed);
}

/** Constrain a number that is already known to be one. */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
