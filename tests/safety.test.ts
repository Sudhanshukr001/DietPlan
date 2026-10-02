import { describe, expect, it } from 'vitest';
import {
  BANNED_CLAIM_PATTERNS,
  CONDITION_LABELS,
  CRISIS_BANNER,
  DECLARED_CONDITION_VALUES,
  DISCLAIMER_FULL,
  DISCLAIMER_SHORT,
  GENERAL_FOOD_SAFETY,
  REFER_TO_PROFESSIONAL,
  SAFETY_VERSION,
  advisoryFor,
  auditAllergies,
  findBannedClaims,
  foodSafetyTopicsFor,
  isSafeString,
} from '@/lib/domain/safety';
import { FOODS, hasFood } from '@/lib/domain/data/foods';
import { defaultHealth, defaultProfile } from '@/lib/domain/defaults';
import { conditions, makeDiet, makeHealth } from './fixtures';

describe('advisory mode', () => {
  it('stays off for a user with no declared conditions', () => {
    const advisory = advisoryFor(makeHealth({ declaredConditions: ['none'] }));
    expect(advisory.active).toBe(false);
    expect(advisory.conditions).toHaveLength(0);
    expect(advisory.copy).toHaveLength(0);
    expect(advisory.suppressCalorieTargets).toBe(false);
    expect(advisory.generalGuidanceChip).toBe(false);
  });

  it('activates and routes to a professional for a declared condition', () => {
    const advisory = advisoryFor(conditions('diabetes'));
    expect(advisory.active).toBe(true);
    expect(advisory.conditions).toEqual(['diabetes']);
    expect(advisory.copy[0]?.headline).toBe(CONDITION_LABELS.diabetes);
    expect(advisory.copy[0]?.route).toBe('/settings/health');
    expect(advisory.copy[0]?.body).toMatch(/doctor|dietitian/i);
  });

  it('suppresses calorie targets and streak pressure for disordered-eating history', () => {
    const advisory = advisoryFor(conditions('eating-disorder'));
    expect(advisory.suppressCalorieTargets).toBe(true);
    expect(advisory.suppressStreakPressure).toBe(true);
    expect(advisory.active).toBe(true);
  });

  it('raises the fluid caution for conditions where fluid is prescribed', () => {
    for (const c of ['kidney-disease', 'cardiac', 'hypertension'] as const) {
      expect(advisoryFor(conditions(c)).fluidCaution).toBe(true);
    }
    expect(advisoryFor(conditions('thyroid')).fluidCaution).toBe(false);
  });

  it('never gives condition-specific portion numbers', () => {
    for (const condition of REFER_TO_PROFESSIONAL) {
      const advisory = advisoryFor(conditions(condition));
      const allText = advisory.copy.map((c) => `${c.headline} ${c.body}`).join(' ');
      // A prescriptive number in advisory copy would mean we are second-guessing
      // a clinician. Words like "half a cup" must not appear.
      expect(allText).not.toMatch(/\b\d+\s?(g|ml|grams?|cups?|tbsp|litres?|liters?)\b/i);
    }
  });

  it('covers every declared condition value with copy', () => {
    for (const condition of DECLARED_CONDITION_VALUES) {
      const advisory = advisoryFor(conditions(condition));
      if (condition === 'none') {
        expect(advisory.active).toBe(false);
        continue;
      }
      expect(advisory.copy[0]?.body.length ?? 0).toBeGreaterThan(40);
      expect(findBannedClaims(advisory.copy[0]?.body ?? '')).toHaveLength(0);
    }
  });

  it('tolerates "none" mixed with a real condition', () => {
    const advisory = advisoryFor(makeHealth({ declaredConditions: ['none', 'thyroid'] }));
    expect(advisory.conditions).toEqual(['thyroid']);
    expect(advisory.active).toBe(true);
  });
});

describe('banned claim patterns', () => {
  const shouldFail = [
    'This app cures diabetes',
    'Lemon detoxifies your body',
    'Lose 10 kg in 10 days',
    'Guaranteed results in a week',
    'Prevents heart disease',
    'Anti-aging foods for younger skin',
    'This burns fat fast',
    'Melts fat while you sleep',
    '100% natural, no side effects',
    'You will lose weight in a month',
  ];

  it.each(shouldFail)('rejects the claim in %j', (claim) => {
    expect(findBannedClaims(claim).length).toBeGreaterThan(0);
    expect(isSafeString(claim)).toBe(false);
  });

  const shouldPass = [
    'Dal, roti and seasonal vegetables are an affordable everyday meal in Bihar.',
    'This is an estimate, not a measurement.',
    'Talk to a doctor before changing how you eat.',
    'You lost your streak, but your routine is still going.',
    'Cooking at home usually costs less than eating out.',
  ];

  it.each(shouldPass)('allows the honest copy in %j', (copy) => {
    expect(findBannedClaims(copy)).toHaveLength(0);
    expect(isSafeString(copy)).toBe(true);
  });

  it('does not flag the words "treat" or "cure" inside longer words', () => {
    // "detreated"/"pretreated" style collisions are not user-facing claims.
    expect(isSafeString('A pretreated sample')).toBe(true);
  });

  it('has at least one pattern for each high-risk category', () => {
    expect(BANNED_CLAIM_PATTERNS.length).toBeGreaterThanOrEqual(15);
  });
});

describe('every user-facing string in the domain passes the claims lint', () => {
  function collectStrings(value: unknown, out: string[], depth = 0): void {
    if (depth > 8) return;
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) collectStrings(v, out, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
    }
  }

  it('holds for the food database', () => {
    const strings: string[] = [];
    collectStrings(FOODS, strings);
    expect(strings.length).toBeGreaterThan(500);
    for (const s of strings) {
      expect(findBannedClaims(s), `offending string: ${s}`).toHaveLength(0);
    }
  });

  it('holds for the disclaimers, labels and safety copy', () => {
    const strings: string[] = [];
    collectStrings(
      {
        DISCLAIMER_SHORT,
        DISCLAIMER_FULL,
        CRISIS_BANNER,
        CONDITION_LABELS,
        GENERAL_FOOD_SAFETY,
        topics: foodSafetyTopicsFor(['egg', 'chicken', 'milk', 'onion', 'atta']),
      },
      strings,
    );
    for (const s of strings) {
      expect(findBannedClaims(s), `offending string: ${s}`).toHaveLength(0);
    }
  });

  it('states plainly that this is not medical advice', () => {
    expect(DISCLAIMER_SHORT).toMatch(/not medical advice/i);
    expect(DISCLAIMER_FULL).toMatch(/does not diagnose/i);
    expect(SAFETY_VERSION).toMatch(/^\d{4}-\d{2}/);
  });
});

describe('food safety topics', () => {
  it('only shows guidance relevant to what is actually in the meal', () => {
    expect(foodSafetyTopicsFor(['dal', 'roti']).map((t) => t.id)).not.toContain('egg');
    expect(foodSafetyTopicsFor(['egg']).map((t) => t.id)).toContain('egg');
    expect(foodSafetyTopicsFor(['chicken']).map((t) => t.id)).toContain('meat');
    expect(foodSafetyTopicsFor(['milk']).map((t) => t.id)).toContain('dairy');
    expect(foodSafetyTopicsFor(['onion']).map((t) => t.id)).toContain('produce');
    expect(foodSafetyTopicsFor(['atta']).map((t) => t.id)).toContain('dry');
  });

  it('returns nothing for a meal with no flagged topics', () => {
    expect(foodSafetyTopicsFor(['dal'])).toHaveLength(0);
  });

  it('always includes a general spoilage reminder set', () => {
    expect(GENERAL_FOOD_SAFETY.length).toBeGreaterThan(0);
    for (const topic of GENERAL_FOOD_SAFETY) {
      expect(topic.detail.length).toBeGreaterThan(30);
    }
  });
});

describe('allergy audit', () => {
  it('warns about other foods that carry the same allergen', () => {
    const warnings = auditAllergies(makeDiet({ allergies: ['milk'] }));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/app already avoids it/i);
    expect(warnings.join(' ')).toMatch(/lactose/i);
  });

  it('says nothing when no other food shares the allergen', () => {
    expect(auditAllergies(makeDiet({ allergies: ['jaggery'] }))).toHaveLength(0);
  });

  it('does not warn about foods the diet type already excludes', () => {
    // Meat is not in a vegetarian diet, so a non-veg allergen cannot leak in.
    const warnings = auditAllergies(makeDiet({ dietType: 'vegetarian', allergies: ['chicken'] }));
    expect(warnings).toHaveLength(0);
  });

  it('never returns duplicates', () => {
    const warnings = auditAllergies(makeDiet({ allergies: ['milk', 'curd', 'paneer'] }));
    expect(new Set(warnings).size).toBe(warnings.length);
  });
});

describe('default health state', () => {
  it('defaults to no conditions and no advisory', () => {
    const advisory = advisoryFor(defaultHealth());
    expect(advisory.active).toBe(false);
  });

  it('ships a profile whose safety version matches the current one', () => {
    expect(defaultProfile().acceptedSafetyVersion).toBe(SAFETY_VERSION);
  });
});

describe('food database integrity', () => {
  it('has no duplicate keys', () => {
    const keys = FOODS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has positive prices and non-negative nutrition for every food', () => {
    for (const food of FOODS) {
      expect(food.price.typicalPrice, food.key).toBeGreaterThan(0);
      expect(food.price.low, food.key).toBeGreaterThan(0);
      expect(food.price.high, food.key).toBeGreaterThanOrEqual(food.price.low);
      expect(food.price.unitGrams, food.key).toBeGreaterThan(0);
      expect(food.price.sourceNote, food.key).toBeTruthy();
      expect(food.nutrition.calories, food.key).toBeGreaterThanOrEqual(0);
      expect(food.nutrition.protein, food.key).toBeGreaterThanOrEqual(0);
      expect(food.name.length, food.key).toBeGreaterThan(0);
    }
  });

  it('has local names for most foods, since this is a Bihar-first product', () => {
    const withLocalName = FOODS.filter((f) => f.localNames.length > 0);
    expect(withLocalName.length / FOODS.length).toBeGreaterThan(0.5);
  });

  it('gives every food at least one substitute or is a raw staple', () => {
    for (const food of FOODS) {
      if (food.substitutes.length === 0) {
        expect(food.isRawIngredient, food.key).toBe(true);
      }
    }
  });

  it('resolves keys by lookup', () => {
    expect(hasFood('toor-dal')).toBe(true);
    expect(hasFood('roti')).toBe(true);
    expect(hasFood('not-a-real-food' as never)).toBe(false);
  });
});
