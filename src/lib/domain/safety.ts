/**
 * Safety rails.
 *
 * The hard line: this app removes friction and uncertainty. It does NOT compute
 * medical plans. Concretely that means the domain layer has NO branches on
 * declared conditions for portion mathematics — only for wording, warnings, and
 * suppression of pressure elements. Tested in tests/safety.test.ts.
 */

import type {
  AdvisoryConditionCopy,
  AdvisoryMode,
  DeclaredCondition,
  HealthPreference,
} from './types/index';
import { allergenSet, dietFilter, isAllowed, type DietFilter } from './diet';
import type { DietPreference } from './types/index';
import { FOODS } from './data/foods';
import { SLEEP_DISCLAIMER } from './sleep';

export const SAFETY_VERSION = '2026-01-general-wellness';

export const DISCLAIMER_SHORT =
  'General wellness guidance, not medical advice. Talk to a doctor or dietitian about your own situation.';

export const DISCLAIMER_FULL =
  'This app gives general food, hydration and movement guidance based on the information you enter. It does not diagnose conditions, treat illness, or replace advice from a qualified doctor or registered dietitian. Nutrition figures are estimates, not measurements. If you have a health condition, are pregnant, or have a serious food allergy, get personalised guidance from a professional before changing how you eat.';

/** Conditions that must route the user to a professional. */
export const REFER_TO_PROFESSIONAL: readonly DeclaredCondition[] = [
  'diabetes',
  'kidney-disease',
  'pregnancy',
  'eating-disorder',
  'serious-allergy',
  'gi-symptoms',
  'thyroid',
  'hypertension',
  'cardiac',
];

export const CONDITION_LABELS: Record<DeclaredCondition, string> = {
  diabetes: 'Diabetes or blood sugar concerns',
  'kidney-disease': 'Kidney disease',
  pregnancy: 'Pregnancy or breastfeeding',
  'eating-disorder': 'A history of disordered eating',
  'serious-allergy': 'A serious food allergy',
  'gi-symptoms': 'Ongoing stomach or gut symptoms',
  thyroid: 'A thyroid condition',
  hypertension: 'High blood pressure',
  cardiac: 'A heart condition',
  none: 'None of these',
};

export const DECLARED_CONDITION_VALUES = Object.keys(CONDITION_LABELS) as readonly DeclaredCondition[];

/**
 * This app must never imply disease prevention, guaranteed skin change, or
 * anti-aging outcomes. Used by the claims test to lint every user-facing string.
 */
export const BANNED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bcures?\b/i,
  /\btreats?\b/i,
  /\bheals?\b/i,
  /\bdiagnos(e|es|ed|ing)\b/i,
  /\banti-?aging\b/i,
  /\bwrinkles? will\b/i,
  /\bguarantee[sd]?\b/i,
  /\bprevent(s|ed)? (diabetes|cancer|disease|heart disease)\b/i,
  /\blose\s+\d+\s*kg\b/i,
  /\blose\s+\d+\s*(pounds|lbs)\b/i,
  /\bmelts? fat\b/i,
  /\bburns? fat fast\b/i,
  /\bdetox\w*/i,
  /\bboosts? (your )?(immunity|metabolism) (by|to)\b/i,
  /\bno side effects\b/i,
  /\b100% natural\b/i,
  /\bproven to\b/i,
  /\byou will (lose|gain|be)\b/i,
  /\beliminates? (toxins|bad cholesterol)\b/i,
];

export function advisoryFor(health: HealthPreference): AdvisoryMode {
  const conditions = health.declaredConditions.filter((c) => c !== 'none');

  const active = conditions.length > 0;

  const copy: AdvisoryConditionCopy[] = conditions.map((condition) => ({
    condition,
    headline: CONDITION_LABELS[condition],
    body: conditionBody(condition),
    route: `/settings/health`,
  }));

  return {
    active,
    conditions,
    copy,
    suppressCalorieTargets: health.declaredConditions.includes('eating-disorder'),
    suppressStreakPressure: health.declaredConditions.includes('eating-disorder'),
    fluidCaution:
      health.declaredConditions.includes('kidney-disease') ||
      health.declaredConditions.includes('cardiac') ||
      health.declaredConditions.includes('hypertension'),
    generalGuidanceChip: active,
  };
}

function conditionBody(condition: DeclaredCondition): string {
  switch (condition) {
    case 'diabetes':
      return 'The food suggestions here are general. Carbohydrate amounts, timing and portion sizes for blood sugar should come from a doctor or dietitian who knows your numbers.';
    case 'kidney-disease':
      return 'Protein, potassium and fluid amounts depend entirely on your stage of kidney disease. Please do not use these suggestions to set your protein or water intake — take those numbers from your doctor.';
    case 'pregnancy':
      return 'Pregnancy changes what you need. The general suggestions here are a starting point only; a doctor or dietitian should review your plan.';
    case 'eating-disorder':
      return 'You have told us about a history of disordered eating, so this app hides calorie targets and streak pressure entirely. Please work with a professional who can support you properly.';
    case 'serious-allergy':
      return 'A serious allergy needs professional guidance. Always read labels yourself, and check for cross-contamination — this app cannot verify what is in your food.';
    case 'gi-symptoms':
      return 'Ongoing gut symptoms should be looked into by a doctor. Some everyday foods that seem harmless can make them worse for some people.';
    case 'thyroid':
      return 'Thyroid conditions change what you need day to day. Keep your plan general and let your doctor guide the specifics.';
    case 'hypertension':
      return 'Salt matters a great deal here. Keep added salt low and ask your doctor how much fits your situation.';
    case 'cardiac':
      return 'Heart conditions need individualised guidance on fat, salt and fluid. Please do not adjust your diet based on this app alone.';
    default:
      return 'Please discuss your situation with a qualified healthcare professional.';
  }
}

export const CRISIS_BANNER =
  'If you are struggling with food or body image, please reach out to a mental health professional or a helpline in your country. You do not have to handle this alone.';

// ---------------------------------------------------------------------------
// Food safety
// ---------------------------------------------------------------------------

export interface FoodSafetyTopic {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/** Topics shown based on what actually appears in the meal. */
export function foodSafetyTopicsFor(foodKeys: readonly string[]): readonly FoodSafetyTopic[] {
  const topics: FoodSafetyTopic[] = [];

  const hasRawEgg = foodKeys.includes('egg');
  if (hasRawEgg) {
    topics.push({
      id: 'egg',
      title: 'Eggs',
      detail: 'Boil until the white is completely firm, or cook omelettes through. Avoid runny yolks if you are pregnant, elderly or immunocompromised. Keep raw and cooked eggs separate.',
    });
  }

  if (foodKeys.includes('chicken') || foodKeys.includes('fish')) {
    topics.push({
      id: 'meat',
      title: 'Meat and fish',
      detail: 'Cook all the way through with no pink or translucent parts. Keep raw meat separate from vegetables, and refrigerate anything left over within two hours.',
    });
  }

  const hasDairy = foodKeys.some((k) => ['milk', 'curd', 'paneer', 'buttermilk', 'ghee'].includes(k));
  if (hasDairy) {
    topics.push({
      id: 'dairy',
      title: 'Dairy',
      detail: 'Keep curd and milk cold and use within the date on the pack. If it smells sour or off, discard it — do not taste to check.',
    });
  }

  const hasCutProduce = foodKeys.some((k) =>
    ['cucumber', 'tomato', 'onion', 'carrot', 'cabbage', 'spinach', 'beans', 'brinjal', 'gourd', 'bottle-gourd', 'radish', 'pumpkin'].includes(k),
  );
  if (hasCutProduce) {
    topics.push({
      id: 'produce',
      title: 'Cut vegetables and fruit',
      detail: 'Wash produce under running water before cutting. Store cut vegetables covered and refrigerated, and use them within a day.',
    });
  }

  const hasFlour = foodKeys.some((k) => ['atta', 'maida', 'sattu', 'besan', 'ragi'].includes(k));
  if (hasFlour) {
    topics.push({
      id: 'dry',
      title: 'Flours and dry goods',
      detail: 'Keep flour and dry pulses in sealed containers — a strong smell or damp patches means insects or moisture, and it goes straight in the bin.',
    });
  }

  return topics;
}

export const GENERAL_FOOD_SAFETY: readonly FoodSafetyTopic[] = [
  {
    id: 'spoiled',
    title: 'When in doubt, throw it out',
    detail: 'Do not eat anything that smells sour, looks discoloured, has mould, or is slimy. You cannot reliably tell if something is safe by tasting it.',
  },
  {
    id: 'water',
    title: 'Use safe drinking water',
    detail: 'Use clean, safe drinking water — boiled, filtered or properly treated. This matters more than any single food choice.',
  },
  {
    id: 'refrigerate',
    title: 'Refrigerate perishables',
    detail: 'Keep cooked food, curd, milk, eggs and cut vegetables refrigerated. Do not leave cooked food at room temperature for more than about two hours.',
  },
  {
    id: 'wash',
    title: 'Wash before cutting',
    detail: 'Wash vegetables and fruit under running water before cutting, and wash your hands and knives before preparing food.',
  },
];

// ---------------------------------------------------------------------------
// String linting (used by tests and by a dev-only audit)
// ---------------------------------------------------------------------------

/**
 * Copy that is *required* to mention the words it does. The disclaimers have to
 * be able to say "this does not diagnose or treat illness" — which is the
 * opposite of the claims above. These strings are exempt by exact match.
 */
export const SAFE_COPY: ReadonlySet<string> = new Set([
  DISCLAIMER_SHORT,
  DISCLAIMER_FULL,
  CRISIS_BANNER,
  SLEEP_DISCLAIMER,
  'Talk to a doctor or dietitian about your own situation.',
]);

export function findBannedClaims(text: string): readonly string[] {
  if (SAFE_COPY.has(text)) return [];
  return BANNED_CLAIM_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

export function isSafeString(text: string): boolean {
  return findBannedClaims(text).length === 0;
}

/**
 * Lists foods that share an allergen with something the user declared.
 *
 * The audit runs against a filter with the declared allergies *removed*,
 * because otherwise the very foods we want to warn about are the ones the
 * engine has already excluded and the warning could never fire.
 */
export function auditAllergies(diet: DietPreference): readonly string[] {
  const declared = allergenSet(diet);
  const withoutAllergies: DietFilter = { ...dietFilter(diet), allergies: new Set<string>() };

  const warnings: string[] = [];
  for (const other of FOODS) {
    if (diet.allergies.includes(other.key)) continue;
    if (!isAllowed(other, withoutAllergies)) continue;
    const shared = other.allergens.filter((a) => declared.has(a));
    if (shared.length === 0) continue;
    const names = [...new Set(shared)].join(' and ');
    warnings.push(
      `${other.name} contains ${names}, which you listed as an allergy. The app already avoids it — check the label if you buy it yourself.`,
    );
  }
  return warnings;
}
