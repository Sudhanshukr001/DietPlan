import { describe, expect, it } from 'vitest';
import {
  ALLERGY_OPTIONS,
  DIET_DESCRIPTIONS,
  DIET_LABELS,
  DIET_TAG_LABELS,
  INTOLERANCE_OPTIONS,
  allowedFoods,
  allowedKeys,
  allergenSet,
  dietAllowsTag,
  dietFilter,
  intoleranceSet,
  isAllowed,
  isIdeal,
  maxDietTag,
  rejectionReason,
} from '@/lib/domain/diet';
import { FOODS, getFood, requireFood } from '@/lib/domain/data/foods';
import { findBannedClaims } from '@/lib/domain/safety';
import type { DietTag, DietType, Food } from '@/lib/domain/types/index';

const ALLERGEN_VOCABULARY = new Set(FOODS.flatMap((f) => f.allergens));
import { DATE, makeDiet } from './fixtures';

function food(key: string): Food {
  return requireFood(key as Food['key']);
}

describe('diet legality', () => {
  it('ranks diet tags so a stricter diet cannot leak a looser food', () => {
    expect(maxDietTag('vegetarian')).toBe('veg');
    expect(maxDietTag('egg-vegetarian')).toBe('egg');
    expect(maxDietTag('non-vegetarian')).toBe('nonveg');
    expect(dietAllowsTag('vegetarian', 'veg')).toBe(true);
    expect(dietAllowsTag('vegetarian', 'egg')).toBe(false);
    expect(dietAllowsTag('egg-vegetarian', 'nonveg')).toBe(false);
    expect(dietAllowsTag('non-vegetarian', 'nonveg')).toBe(true);
  });

  it('treats allergies and intolerances as absolute', () => {
    const f = dietFilter(makeDiet({ allergies: ['milk'] }));
    expect(isAllowed(food('milk'), f)).toBe(false);
    expect(isAllowed(food('curd'), f)).toBe(false); // shares the dairy allergen
    expect(isAllowed(food('toor-dal'), f)).toBe(true);
    expect(isAllowed(food('toor-dal'), dietFilter(makeDiet()))).toBe(true);
  });

  it('honours an intolerance without pretending it is an allergy', () => {
    const f = dietFilter(makeDiet({ intolerances: ['milk'] }));
    expect(isAllowed(food('milk'), f)).toBe(false);
    expect(isAllowed(food('paneer'), f)).toBe(false); // shares the lactose allergen
    expect(rejectionReason(food('milk'), f)).toMatch(/difficult to digest/);
    expect(rejectionReason(food('toor-dal'), f)).toBeNull();
  });

  it('remembers a food the user asked us never to suggest again', () => {
    const f = dietFilter(makeDiet({ neverAgain: ['brinjal'] }));
    expect(isAllowed(food('brinjal'), f)).toBe(false);
    expect(rejectionReason(food('brinjal'), f)).toMatch(/never to suggest/);
    expect(rejectionReason(food('brinjal'), dietFilter(makeDiet()))).toBeNull();
  });

  it('explains every rejection in plain words', () => {
    const f = dietFilter(
      makeDiet({ dietType: 'non-vegetarian', allergies: ['milk'], neverAgain: ['brinjal'], dislikes: ['fish'] }),
    );
    expect(rejectionReason(food('milk'), f)).toMatch(/allergy/);
    expect(rejectionReason(food('paneer'), f)).toMatch(/contains lactose/);
    expect(rejectionReason(food('fish'), f)).toMatch(/rather avoid/);
    expect(isAllowed(food('fish'), f)).toBe(true); // disliked, never forbidden
    expect(rejectionReason(food('egg'), dietFilter(makeDiet({ dietType: 'vegetarian' })))).toMatch(
      /diet type/,
    );
    expect(rejectionReason(food('rice'), f)).toBeNull();
    for (const reason of [
      rejectionReason(food('milk'), f),
      rejectionReason(food('paneer'), f),
      rejectionReason(food('brinjal'), f),
    ]) {
      expect(findBannedClaims(reason ?? '')).toHaveLength(0);
    }
  });

  it('keeps a dislike out of the ideal list but never out of the legal one', () => {
    const f = dietFilter(makeDiet({ dislikes: ['tomato'] }));
    expect(isIdeal(food('tomato'), f, 'winter')).toBe(false);
    expect(isAllowed(food('tomato'), f)).toBe(true);
  });

  it('treats off-season food as merely not ideal', () => {
    const f = dietFilter(makeDiet());
    const tomato = getFood('tomato');
    if (!tomato) throw new Error('tomato missing');
    expect(tomato.seasons).not.toContain('monsoon');
    expect(isIdeal(tomato, f, 'monsoon')).toBe(false);
    expect(isAllowed(tomato, f)).toBe(true);
    expect(isIdeal(tomato, f, 'winter')).toBe(true);
  });

  it('produces a non-empty allowed list for every diet type', () => {
    for (const dietType of ['vegetarian', 'egg-vegetarian', 'non-vegetarian'] as DietType[]) {
      const f = dietFilter(makeDiet({ dietType }));
      const keys = allowedKeys(f);
      expect(keys.size).toBeGreaterThan(20);
      expect(allowedFoods(f).length).toBe(keys.size);
      for (const food of allowedFoods(f)) expect(isAllowed(food, f)).toBe(true);
    }
  });

  it('maps a declared allergy onto its shared allergens', () => {
    const allergens = allergenSet(makeDiet({ allergies: ['milk'] }));
    expect(allergens.has('milk')).toBe(true);
    expect(allergens.has('lactose')).toBe(true);
    expect(allergens.has('gluten')).toBe(false);
    const wheat = allergenSet(makeDiet({ allergies: ['atta'] }));
    expect(wheat.has('gluten')).toBe(true);
    expect(intoleranceSet(makeDiet({ intolerances: ['besan'] })).size).toBeGreaterThan(1);
    // A key that is not in the database is kept verbatim rather than dropped.
    expect(allergenSet(makeDiet({ allergies: ['unknown-thing' as never] })).has('unknown-thing')).toBe(true);
  });

  it('offers onboarding options that only name foods in the database', () => {
    for (const group of [...ALLERGY_OPTIONS, ...INTOLERANCE_OPTIONS]) {
      expect(group.label.length).toBeGreaterThanOrEqual(3);
      for (const key of group.keys) expect(getFood(key), key).toBeDefined();
    }
    const milk = ALLERGY_OPTIONS.find((o) => o.label.includes('dairy'));
    expect(milk?.keys).toContain('paneer');
  });

  it('describes every diet and tag without a health promise', () => {
    for (const dietType of Object.keys(DIET_LABELS) as DietType[]) {
      expect(DIET_DESCRIPTIONS[dietType].length).toBeGreaterThan(15);
      expect(findBannedClaims(DIET_LABELS[dietType] + DIET_DESCRIPTIONS[dietType])).toHaveLength(0);
    }
    for (const tag of Object.keys(DIET_TAG_LABELS) as DietTag[]) {
      expect(DIET_TAG_LABELS[tag].length).toBeGreaterThan(2);
    }
  });

  it('never lists the same food twice in a diet option group', () => {
    for (const group of [...ALLERGY_OPTIONS, ...INTOLERANCE_OPTIONS]) {
      expect(new Set(group.keys).size).toBe(group.keys.length);
    }
  });

  it('leaves the database consistent with the diet rules', () => {
    for (const f of FOODS) {
      expect(f.key.length).toBeGreaterThan(1);
      expect(DIET_TAG_LABELS[f.dietTag], f.key).toBeTruthy();
      expect(f.allergens.every((a) => ALLERGEN_VOCABULARY.has(a)), f.key).toBe(true);
      expect(f.nutrition.calories, f.key).toBeGreaterThan(0);
    }
    const vegFilter = dietFilter(makeDiet({ dietType: 'vegetarian' }));
    expect(allowedFoods(vegFilter).some((f) => f.dietTag === 'nonveg')).toBe(false);
    expect(DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
