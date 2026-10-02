import type { MealSlot } from './types/index';

/** How long each meal slot stays "open". Meals are periods, not instants. */
export const MEAL_WINDOW_MINUTES: Record<MealSlot, number> = {
  breakfast: 75,
  fruit: 40,
  lunch: 75,
  snack: 45,
  dinner: 70,
};
