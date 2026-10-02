/**
 * Grocery engine.
 *
 * Two jobs beyond aggregation:
 *   1. Waste avoidance — quantities round up to real purchase packs, and items
 *      that spoil fast are capped to what the week actually needs.
 *   2. Pantry awareness — anything the user says they already have is removed
 *      from the buy list and the savings are shown.
 */

import type {
  CalendarDay,
  Estimate,
  Food,
  FoodKey,
  GroceryCategory,
  GroceryItem,
  Meal,
  MealSlot,
  Portion,
  WeeklyGroceryGroup,
  WeeklyGroceryList,
} from './types/index';
import { getFood } from './data/foods';
import { costOfPortion, formatCost, pricePerKg, totalCost } from './budget';
import { regionMultiplier, isInSeason } from './seasonal';
import { estimate, estimate as mkEstimate } from './nutrition';

export const GROCERY_CATEGORY_LABELS: Record<GroceryCategory, string> = {
  protein: 'Protein',
  vegetable: 'Vegetables',
  fruit: 'Fruit',
  staple: 'Staples',
  fat: 'Healthy fats',
  other: 'Other',
};

export const GROCERY_CATEGORY_EMOJI: Record<GroceryCategory, string> = {
  protein: '🫘',
  vegetable: '🥬',
  fruit: '🍊',
  staple: '🌾',
  fat: '🥜',
  other: '🧂',
};

const CATEGORY_OF: Record<Food['category'], GroceryCategory> = {
  protein: 'protein',
  legume: 'protein',
  'egg-meat': 'protein',
  dairy: 'protein',
  vegetable: 'vegetable',
  fruit: 'fruit',
  staple: 'staple',
  fat: 'fat',
  nut: 'fat',
  beverage: 'other',
  other: 'other',
};

/** Order matters — protein first because it is the thing people forget. */
const CATEGORY_ORDER: readonly GroceryCategory[] = ['protein', 'vegetable', 'fruit', 'staple', 'fat', 'other'];

const STORAGE: Record<GroceryCategory, string> = {
  protein: 'Refrigerate dal, curd, milk and eggs. Keep dry dal and chana in sealed containers.',
  vegetable: 'Keep in a cool, dry, ventilated place. Buy only what you will cook within 2–3 days.',
  fruit: 'Keep at room temperature in the shade. Wash just before eating, not before storing.',
  staple: 'Keep flour, rice and sattu in sealed, dry containers away from moisture and insects.',
  fat: 'Keep oil and nuts sealed and away from heat and sunlight.',
  other: 'Keep dry and sealed.',
};

/** How long an item survives realistically in an Indian household kitchen. */
/** Realistic days of use once bought, used for both storage advice and the
 *  anti-waste caps in the weekly list. */
export const SHELF_DAYS: Readonly<Record<GroceryCategory, number>> = {
  vegetable: 3,
  fruit: 5,
  protein: 4,
  staple: 30,
  fat: 30,
  other: 30,
};

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export interface DailyGroceryInput {
  readonly meals: readonly Meal[];
  readonly region: Parameters<typeof regionMultiplier>[0];
  readonly season: Parameters<typeof isInSeason>[1];
  readonly pantry: readonly FoodKey[];
  readonly overrides: Readonly<Partial<Record<FoodKey, number>>>;
  readonly date: CalendarDay;
}

export function buildDailyGrocery(input: DailyGroceryInput): readonly GroceryItem[] {
  const multiplier = regionMultiplier(input.region);

  const totals = new Map<FoodKey, { grams: number; meals: Set<MealSlot> }>();
  for (const meal of input.meals) {
    for (const ing of meal.ingredients) {
      if (ing.optional) continue;
      const existing = totals.get(ing.foodKey);
      if (existing) {
        existing.grams += ing.portion.grams;
        existing.meals.add(meal.slot);
      } else {
        totals.set(ing.foodKey, { grams: ing.portion.grams, meals: new Set([meal.slot]) });
      }
    }
  }

  const items: GroceryItem[] = [];
  for (const [key, agg] of totals) {
    const food = getFood(key);
    if (!food) continue;

    const owned = input.pantry.includes(key);
    const category = CATEGORY_OF[food.category];
    const purchaseUnits = unitsToBuy(agg.grams, food);
    const buyGrams = purchaseUnits * food.price.unitGrams;

    const override = input.overrides[key];
    const cost = costOfPortion(key, Math.min(agg.grams, buyGrams), { multiplier, override });

    items.push({
      id: `${input.date}:g:${key}`,
      foodKey: key,
      name: food.name,
      emoji: food.emoji,
      category,
      quantity: portionFor(agg.grams),
      buyQuantity: portionFor(buyGrams),
      buyUnitLabel: buyLabel(purchaseUnits, food),
      unitCost: food.price,
      estimatedCost: owned ? mkEstimate(0, { low: 0, high: 0 }, 'derived', 'high') : cost,
      meals: [...agg.meals],
      owned,
      purchaseRequired: !owned,
      storage: STORAGE[category],
      expectedDaysOfUse: SHELF_DAYS[category],
      seasonalNote: seasonalNoteFor(food, input.season, multiplier),
      budgetPriority: priorityFor(category, food, multiplier),
    });
  }

  return sortGrocery(items);
}

function unitsToBuy(gramsNeeded: number, food: Food): number {
  // Always round up to a whole pack — nobody should be told to buy 340 g of dal.
  return Math.max(1, Math.ceil(gramsNeeded / food.price.unitGrams));
}

function buyLabel(units: number, food: Food): string {
  switch (food.price.unit) {
    case 'kg':
      return units >= 1 ? `${units} kg pack` : `${Math.round(units * 1000)} g`;
    case 'litre':
      return `${units} litre`;
    case 'dozen':
      return `${units} dozen (${units * food.price.unitGrams} g)`;
    case 'piece':
      return `${units} × ${food.defaultPortion.unit === 'piece' ? food.defaultPortion.label.replace(/^\d+\s*/, '') : 'piece'}`;
    default:
      return `${units} pack${units > 1 ? 's' : ''}`;
  }
}

function portionFor(grams: number): Portion {
  return {
    grams: Math.round(grams),
    gramsLow: Math.round(grams * 0.85),
    gramsHigh: Math.round(grams * 1.15),
    label: `${Math.round(grams)} g`,
    unit: 'g',
  };
}

function seasonalNoteFor(
  food: Food,
  season: Parameters<typeof isInSeason>[1],
  multiplier: number,
): string | undefined {
  const price = Math.round(pricePerKg(food.key, { multiplier }));
  if (food.seasons.includes('all-year')) return `about ₹${price}/kg — available all year`;
  if (food.seasons.includes(season)) return `about ₹${price}/kg — in season now`;
  return `about ₹${price}/kg — cheaper out of season; you may want less of it`;
}

/** 1 = buy first. Protein and perishables outrank staples when money is tight. */
function priorityFor(category: GroceryCategory, food: Food, multiplier: number): number {
  const base: Record<GroceryCategory, number> = {
    protein: 1,
    vegetable: 2,
    fruit: 4,
    staple: 5,
    fat: 6,
    other: 7,
  };
  const price = pricePerKg(food.key, { multiplier });
  const priceBump = price > 120 ? 2 : price > 60 ? 1 : 0;
  const perishBump = category === 'vegetable' || category === 'fruit' ? -1 : 0;
  return Math.max(1, Math.min(10, (base[category] ?? 7) + priceBump + perishBump));
}

function sortGrocery(items: readonly GroceryItem[]): readonly GroceryItem[] {
  return [...items].sort((a, b) => {
    if (a.purchaseRequired !== b.purchaseRequired) return a.purchaseRequired ? -1 : 1;
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.budgetPriority - b.budgetPriority || a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Weekly
// ---------------------------------------------------------------------------

export interface WeeklyGroceryInput {
  readonly mealsByDay: ReadonlyArray<readonly Meal[]>;
  readonly fromDay: CalendarDay;
  readonly toDay: CalendarDay;
  readonly region: Parameters<typeof regionMultiplier>[0];
  readonly season: Parameters<typeof isInSeason>[1];
  readonly pantry: readonly FoodKey[];
  readonly overrides: Readonly<Partial<Record<FoodKey, number>>>;
  readonly dailyBudget: number;
}

export function buildWeeklyGrocery(input: WeeklyGroceryInput): WeeklyGroceryList {
  const multiplier = regionMultiplier(input.region);
  const days = input.mealsByDay.length || 1;

  const totals = new Map<FoodKey, { grams: number; slots: Set<MealSlot> }>();
  for (const meals of input.mealsByDay) {
    for (const meal of meals) {
      for (const ing of meal.ingredients) {
        if (ing.optional) continue;
        const e = totals.get(ing.foodKey);
        if (e) {
          e.grams += ing.portion.grams;
          e.slots.add(meal.slot);
        } else {
          totals.set(ing.foodKey, { grams: ing.portion.grams, slots: new Set([meal.slot]) });
        }
      }
    }
  }

  const items: GroceryItem[] = [];
  const wasteNotes: string[] = [];

  for (const [key, agg] of totals) {
    const food = getFood(key);
    if (!food) continue;
    const category = CATEGORY_OF[food.category];
    const owned = input.pantry.includes(key);

    // Cap perishables at their realistic shelf life — the anti-waste rule.
    const shelf = SHELF_DAYS[category] ?? 7;
    const cappedGrams =
      category === 'vegetable' || category === 'fruit'
        ? Math.min(agg.grams, shelf * days * 0.5)
        : agg.grams;
    if (cappedGrams < agg.grams * 0.9) {
      wasteNotes.push(
        `Cap your ${food.name.toLowerCase()} at about ${Math.round(cappedGrams / 1000)} kg for the week — buying more would spoil before you finish it.`,
      );
    }

    const units = unitsToBuy(cappedGrams, food);
    const buyGrams = units * food.price.unitGrams;
    const override = input.overrides[key];
    const cost = costOfPortion(key, Math.min(cappedGrams, buyGrams), { multiplier, override });

    items.push({
      id: `week:${key}`,
      foodKey: key,
      name: food.name,
      emoji: food.emoji,
      category,
      quantity: portionFor(agg.grams),
      buyQuantity: portionFor(buyGrams),
      buyUnitLabel: buyLabel(units, food),
      unitCost: food.price,
      estimatedCost: owned ? mkEstimate(0, { low: 0, high: 0 }, 'derived', 'high') : cost,
      meals: [...agg.slots],
      owned,
      purchaseRequired: !owned,
      storage: STORAGE[category],
      expectedDaysOfUse: Math.max(1, Math.round((cappedGrams / Math.max(1, agg.grams)) * days)),
      seasonalNote: seasonalNoteFor(food, input.season, multiplier),
      budgetPriority: priorityFor(category, food, multiplier),
    });
  }

  const sorted = sortGrocery(items);
  const groups: WeeklyGroceryGroup[] = CATEGORY_ORDER.map((category) => {
    const catItems = sorted.filter((i) => i.category === category);
    return {
      category,
      label: GROCERY_CATEGORY_LABELS[category],
      items: catItems,
      subtotal: totalCost(catItems.filter((i) => i.purchaseRequired).map((i) => i.estimatedCost)),
    };
  }).filter((g) => g.items.length > 0);

  const total = totalCost(sorted.filter((i) => i.purchaseRequired).map((i) => i.estimatedCost));
  const perDay = Math.round((total.value / days) * 10) / 10;

  if (sorted.some((i) => i.category === 'vegetable' && i.purchaseRequired)) {
    wasteNotes.push('Buy vegetables for the first three days only, then shop again. Fresh food is the biggest waste saver there is.');
  }
  if (sorted.some((i) => i.foodKey === 'dal-mix' && i.purchaseRequired)) {
    wasteNotes.push('Dry dal and chana keep for months. Buy a big bag once rather than small amounts repeatedly — that is where the per-kilo price drops.');
  }

  return {
    fromDay: input.fromDay,
    toDay: input.toDay,
    groups,
    totalCost: total,
    perDayCost: estimate(perDay, { low: Math.round(perDay * 0.93), high: Math.round(perDay * 1.07) }, 'derived', 'medium'),
    withinBudget: perDay <= input.dailyBudget * 1.1,
    wasteReductionNotes: wasteNotes,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function groceryTotal(items: readonly GroceryItem[]): Estimate<number> {
  return totalCost(items.filter((i) => i.purchaseRequired).map((i) => i.estimatedCost));
}

export function ownedSavings(items: readonly GroceryItem[]): number {
  return Math.round(
    items
      .filter((i) => i.owned)
      .reduce((s, i) => s + (i.estimatedCost.value || i.estimatedCost.range?.low || 0), 0),
  );
}

export interface BudgetLine {
  readonly label: string;
  readonly spent: number;
  readonly budget: number;
  readonly tone: 'under' | 'close' | 'over';
  readonly detail: string;
}

export function budgetLine(spent: number, budget: number): BudgetLine {
  const diff = Math.round(budget - spent);
  if (diff >= 0) {
    return {
      label: 'Budget',
      spent,
      budget,
      tone: diff > budget * 0.2 ? 'under' : 'close',
      detail: `₹${diff} left today`,
    };
  }
  return {
    label: 'Budget',
    spent,
    budget,
    tone: 'over',
    detail: `₹${Math.abs(diff)} over — tap any meal for a cheaper swap`,
  };
}

export function formatGroceryCost(items: readonly GroceryItem[]): string {
  return formatCost(groceryTotal(items));
}
