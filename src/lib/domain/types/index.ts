/**
 * Domain value types.
 *
 * RULES FOR THIS DIRECTORY:
 *  - Pure TypeScript. No React, no `Date`, no `fetch`, no `localStorage`.
 *  - Time is `MinuteOfDay` (0..1439) or `CalendarDay` ('YYYY-MM-DD'), never epoch ms.
 *  - Anything the user sees as an approximation is wrapped in `Estimate<T>`.
 */

export const MINUTES_PER_DAY = 1440;
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Core wrappers
// ---------------------------------------------------------------------------

/** A value that is an approximation, not a measurement. */
export interface Estimate<T> {
  readonly value: T;
  readonly range?: { readonly low: T; readonly high: T };
  readonly basis: 'database' | 'derived' | 'regional-average' | 'user-entry';
  readonly confidence: 'low' | 'medium' | 'high';
}

export type MinuteOfDay = number;

/** Local calendar day in the user's timezone: 'YYYY-MM-DD'. */
export type CalendarDay = string;

export type PortionUnit = 'g' | 'ml' | 'piece' | 'cup' | 'tbsp' | 'tsp' | 'bowl' | 'glass' | 'slice';

/** A quantity the engine is confident about, expressed as a band not a point. */
export interface Portion {
  readonly grams: number;
  readonly gramsLow: number;
  readonly gramsHigh: number;
  /** Human-readable serving, e.g. '1 cup (cooked)', '2 medium rotis'. */
  readonly label: string;
  readonly unit: PortionUnit;
}

// ---------------------------------------------------------------------------
// Identity & profile
// ---------------------------------------------------------------------------

export type Sex = 'female' | 'male' | 'other' | 'prefer-not-to-say';
export type UnitSystem = 'metric' | 'imperial';
export type DietType = 'vegetarian' | 'egg-vegetarian' | 'non-vegetarian';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';
export type Chronotype = 'early' | 'intermediate' | 'late';
export type WorkPattern =
  | 'school'
  | 'office-desk'
  | 'office-field'
  | 'shift'
  | 'student'
  | 'home'
  | 'other';

export type FitnessGoal =
  | 'maintain-weight'
  | 'lose-fat'
  | 'gain-weight'
  | 'build-muscle'
  | 'improve-fitness'
  | 'improve-energy'
  | 'build-healthy-lifestyle';

export type RegionId =
  | 'bihar'
  | 'jharkhand'
  | 'up'
  | 'mp'
  | 'rajasthan'
  | 'maharashtra'
  | 'gujarat'
  | 'wb'
  | 'odisha'
  | 'karnataka'
  | 'tn'
  | 'kerala'
  | 'ap-telangana'
  | 'assam'
  | 'himachal'
  | 'jammu-kashmir'
  | 'north-delhi'
  | 'metro-south'
  | 'metro-west'
  | 'other';

export interface DailySchedulePreference {
  readonly wakeMinute: MinuteOfDay;
  readonly breakfastMinute: MinuteOfDay;
  readonly lunchMinute: MinuteOfDay;
  readonly dinnerMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly exerciseMinute: MinuteOfDay;
  readonly snackMinute: MinuteOfDay;
  readonly fruitMinute: MinuteOfDay;
  readonly workPattern: WorkPattern;
  readonly chronotype: Chronotype;
}

export interface User {
  readonly id: string;
  readonly createdAt: string;
  readonly schemaVersion: number;
}

export interface Profile {
  readonly userId: string;
  readonly name: string;
  readonly age: number;
  readonly sex: Sex;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly targetWeightKg?: number;
  readonly activityLevel: ActivityLevel;
  readonly fitnessLevel: FitnessLevel;
  readonly goal: FitnessGoal;
  readonly units: UnitSystem;
  readonly city: string;
  readonly state: string;
  readonly region: RegionId;
  readonly schedule: DailySchedulePreference;
  readonly exerciseMinutesPerDay: number;
  readonly hasGymAccess: boolean;
  readonly acceptedSafetyVersion: string;
  readonly onboardingComplete: boolean;
  readonly showBmi: boolean;
}

// ---------------------------------------------------------------------------
// Diet & safety
// ---------------------------------------------------------------------------

export type DietTag = 'veg' | 'egg' | 'nonveg';

export interface DietPreference {
  readonly userId: string;
  readonly dietType: DietType;
  /** Hard excludes. The engine must never substitute into these. */
  readonly allergies: readonly FoodKey[];
  readonly intolerances: readonly FoodKey[];
  readonly dislikes: readonly FoodKey[];
  /** User-taught permanent blacklist ("never suggest this again"). */
  readonly neverAgain: readonly FoodKey[];
  /** Foods the user says are always already at home. */
  readonly staples: readonly FoodKey[];
}

export type DeclaredCondition =
  | 'diabetes'
  | 'kidney-disease'
  | 'pregnancy'
  | 'eating-disorder'
  | 'serious-allergy'
  | 'gi-symptoms'
  | 'thyroid'
  | 'hypertension'
  | 'cardiac'
  | 'none';

/**
 * Self-declared wellness context. NOT medical advice and NOT used to compute
 * portion math — it only switches the app into advisory wording (see safety.ts).
 */
export interface HealthPreference {
  readonly userId: string;
  readonly declaredConditions: readonly DeclaredCondition[];
  readonly usesTobacco: boolean;
  readonly alcoholFrequency: 'never' | 'occasional' | 'weekly' | 'daily';
  readonly sunExposure: 'low' | 'moderate' | 'high';
  readonly sleepDifficulty: 'none' | 'occasional' | 'frequent';
  readonly digestionNotes: string;
}

// ---------------------------------------------------------------------------
// Foods
// ---------------------------------------------------------------------------

export type FoodCategory =
  | 'staple'
  | 'protein'
  | 'legume'
  | 'vegetable'
  | 'fruit'
  | 'dairy'
  | 'fat'
  | 'nut'
  | 'egg-meat'
  | 'beverage'
  | 'other';

export type FoodKey =
  // Staples
  | 'rice'
  | 'atta'
  | 'sattu'
  | 'poha'
  | 'ragi'
  | 'bread'
  | 'maida'
  // Protein / legumes
  | 'dal-mix'
  | 'toor-dal'
  | 'moong-dal'
  | 'chana'
  | 'chana-dal'
  | 'rajma'
  | 'soy-chunks'
  | 'besan'
  // Animal protein
  | 'egg'
  | 'chicken'
  | 'fish'
  // Dairy
  | 'milk'
  | 'curd'
  | 'buttermilk'
  | 'paneer'
  // Vegetables
  | 'potato'
  | 'onion'
  | 'tomato'
  | 'cauliflower'
  | 'cabbage'
  | 'spinach'
  | 'pumpkin'
  | 'gourd'
  | 'carrot'
  | 'beans'
  | 'brinjal'
  | 'mushroom'
  | 'cucumber'
  | 'radish'
  | 'beetroot'
  | 'bottle-gourd'
  // Fruits
  | 'banana'
  | 'guava'
  | 'apple'
  | 'orange'
  | 'papaya'
  | 'watermelon'
  | 'mango'
  | 'sapodilla'
  | 'pomelo'
  | 'pineapple'
  | 'grapes'
  | 'pomegranate'
  | 'amla'
  | 'lemon'
  | 'jujube'
  // Fats
  | 'peanut'
  | 'sesame-seed'
  | 'mustard-oil'
  | 'ghee'
  // Sweeteners / drinks
  | 'jaggery'
  | 'sugar'
  | 'tea'
  | 'coffee'
  // Composite / composite-prep items the plan references directly
  | 'roti'
  | 'dal-rice-combo'
  | 'sattu-drink'
  | 'chana-roasted'
  | 'sprouts'
  | 'salad-plate';

export type SeasonId = 'winter' | 'summer' | 'monsoon' | 'post-monsoon' | 'all-year';

export interface Micronutrient {
  readonly name: string;
  readonly benefit: string;
  readonly sourceNote: string;
}

export interface NutritionTotals {
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly fiber: number;
}

export interface FoodNutrition extends NutritionTotals {
  readonly keyMicronutrients: readonly Micronutrient[];
}

export interface FoodPrice {
  /** ₹ per one purchase unit (1 kg, per piece, per litre, per dozen). */
  readonly typicalPrice: number;
  readonly low: number;
  readonly high: number;
  readonly unit: 'kg' | 'piece' | 'litre' | 'dozen' | 'bowl' | 'glass';
  /** Grams in one purchase unit — used to convert portion grams to purchase qty. */
  readonly unitGrams: number;
  readonly sourceNote: 'regional-avg' | 'user-entry' | 'national-avg' | 'derived';
}

export interface Food {
  readonly key: FoodKey;
  readonly name: string;
  readonly localNames: readonly string[];
  readonly category: FoodCategory;
  readonly dietTag: DietTag;
  readonly emoji: string;
  readonly defaultPortion: Portion;
  readonly nutrition: FoodNutrition;
  readonly price: FoodPrice;
  readonly allergens: readonly string[];
  readonly seasons: readonly SeasonId[];
  readonly prepMethods: readonly string[];
  readonly substitutes: readonly FoodKey[];
  readonly isRawIngredient: boolean;
  readonly dataConfidence: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Meals & recipes
// ---------------------------------------------------------------------------

export type MealSlot = 'breakfast' | 'fruit' | 'lunch' | 'snack' | 'dinner';

export interface MealIngredient {
  readonly foodKey: FoodKey;
  readonly name: string;
  readonly emoji: string;
  readonly portion: Portion;
  readonly nutrition: NutritionTotals;
  readonly cost: Estimate<number>;
  readonly prepNote?: string;
  readonly optional: boolean;
  readonly allergenNote?: string;
}

export type AlternativeKind = 'vegetarian' | 'budget' | 'allergy-safe' | 'seasonal' | 'quick';

export interface FoodSwap {
  readonly from: FoodKey;
  readonly to: FoodKey;
  readonly toName: string;
  readonly reason: string;
  /** Signed ₹ impact at the swapped portion. Negative = cheaper. */
  readonly costDelta: number;
}

export interface MealAlternative {
  readonly kind: AlternativeKind;
  readonly label: string;
  readonly swaps: readonly FoodSwap[];
  readonly note: string;
}

export interface Meal {
  readonly id: string;
  readonly slot: MealSlot;
  readonly date: CalendarDay;
  readonly startMinute: MinuteOfDay;
  readonly endMinute: MinuteOfDay;
  readonly title: string;
  readonly subtitle: string;
  readonly ingredients: readonly MealIngredient[];
  readonly prepSteps: readonly string[];
  readonly prepMinutes: number;
  readonly nutrition: NutritionTotals;
  readonly cost: Estimate<number>;
  readonly whyItMatters: string;
  readonly alternatives: readonly MealAlternative[];
  readonly hydrationMl: number;
  readonly tags: readonly string[];
  readonly foodSafetyNote?: string;
}

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly localName?: string;
  readonly emoji: string;
  readonly ingredientKeys: readonly FoodKey[];
  readonly steps: readonly string[];
  readonly minutes: number;
  readonly alternatives: readonly MealAlternative[];
  readonly bestFor: readonly MealSlot[];
  readonly season: SeasonId;
  readonly foodSafetyNote?: string;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export type TimelineEventKind =
  | 'wake'
  | 'hydration'
  | 'movement'
  | 'meal'
  | 'exercise'
  | 'post-workout'
  | 'wind-down'
  | 'sleep-prep'
  | 'sleep'
  | 'custom';

export type TimelineState =
  | 'done'
  | 'skipped'
  | 'overdue'
  | 'current'
  | 'upcoming'
  | 'snoozed';

export interface TimelineEvent {
  readonly id: string;
  readonly kind: TimelineEventKind;
  readonly mealId?: string;
  readonly title: string;
  readonly detail: string;
  readonly startMinute: MinuteOfDay;
  readonly endMinute: MinuteOfDay;
  readonly why: string;
  readonly hydrationMl?: number;
  readonly workoutId?: string;
  readonly optional: boolean;
  readonly emoji: string;
  /** Prep action chips shown inside the NOW card. */
  readonly actions: readonly string[];
}

export type ScheduleStrategy =
  | 'fixed-preference'
  | 'shifted-for-goal'
  | 'compressed-window'
  | 'recovery-day';

export interface DailySchedule {
  readonly date: CalendarDay;
  readonly events: readonly TimelineEvent[];
  readonly wakeMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly strategy: ScheduleStrategy;
}

/** How the engine decides what is happening at any given minute. */
export interface ScheduleResolution {
  readonly nowEvent: TimelineEvent | null;
  readonly nextEvent: TimelineEvent | null;
  readonly tone: ResolutionTone;
  readonly state: TimelineState | null;
  readonly minutesIntoWindow: number;
  readonly minutesUntilNext: number | null;
  readonly minutesSinceWindowEnd: number | null;
  readonly completedCount: number;
  readonly totalCount: number;
}

export type ResolutionTone = 'live' | 'still-open' | 'rest' | 'complete' | 'empty';

// ---------------------------------------------------------------------------
// Grocery & budget
// ---------------------------------------------------------------------------

export type GroceryCategory = 'protein' | 'vegetable' | 'fruit' | 'staple' | 'fat' | 'other';

export interface GroceryItem {
  readonly id: string;
  readonly foodKey: FoodKey;
  readonly name: string;
  readonly emoji: string;
  readonly category: GroceryCategory;
  readonly quantity: Portion;
  readonly buyQuantity: Portion;
  readonly buyUnitLabel: string;
  readonly unitCost: FoodPrice;
  readonly estimatedCost: Estimate<number>;
  readonly meals: readonly MealSlot[];
  readonly owned: boolean;
  readonly purchaseRequired: boolean;
  readonly storage: string;
  readonly expectedDaysOfUse: number;
  readonly seasonalNote?: string;
  /** 1 = buy first, 10 = buy last. Derived from budget pressure + perishability. */
  readonly budgetPriority: number;
}

export interface WeeklyGroceryGroup {
  readonly category: GroceryCategory;
  readonly label: string;
  readonly items: readonly GroceryItem[];
  readonly subtotal: Estimate<number>;
}

export interface WeeklyGroceryList {
  readonly fromDay: CalendarDay;
  readonly toDay: CalendarDay;
  readonly groups: readonly WeeklyGroceryGroup[];
  readonly totalCost: Estimate<number>;
  readonly perDayCost: Estimate<number>;
  readonly withinBudget: boolean;
  readonly wasteReductionNotes: readonly string[];
}

export interface BudgetPlan {
  readonly dailyBudget: number;
  readonly allocated: number;
  readonly proteinBudget: number;
  readonly priorityOrder: readonly FoodKey[];
  readonly excludedExpensive: readonly FoodKey[];
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

export interface HydrationEntry {
  readonly id: string;
  readonly date: CalendarDay;
  readonly minute: MinuteOfDay;
  readonly ml: number;
  readonly source: 'quick-add' | 'meal' | 'workout' | 'manual';
  readonly eventId?: string;
}

export type HydrationFactor =
  | 'base'
  | 'body-weight'
  | 'activity'
  | 'exercise'
  | 'weather'
  | 'humidity'
  | 'climate'
  | 'medical-caution';

export interface HydrationAdjustment {
  readonly factor: HydrationFactor;
  readonly label: string;
  readonly deltaMl: number;
}

export interface HydrationTarget {
  readonly targetMl: number;
  readonly floorMl: number;
  readonly ceilingMl: number;
  readonly adjustments: readonly HydrationAdjustment[];
  readonly basis: string;
  readonly consultNote?: string;
}

export interface HydrationNudge {
  readonly id: string;
  readonly minute: MinuteOfDay;
  readonly label: string;
  readonly suggestedMl: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Fitness
// ---------------------------------------------------------------------------

export type WorkoutFocus = 'full-body' | 'lower' | 'upper' | 'cardio' | 'mobility' | 'recovery';

export interface ExerciseBlock {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly sets?: number;
  readonly reps?: number;
  readonly holdSeconds?: number;
  readonly minutes: number;
  readonly instructions: string;
  readonly scalable: boolean;
  readonly regression?: string;
  readonly equipment: 'none' | 'optional';
}

export interface Workout {
  readonly id: string;
  readonly date: CalendarDay;
  readonly name: string;
  readonly level: FitnessLevel;
  readonly focus: WorkoutFocus;
  readonly blocks: readonly ExerciseBlock[];
  readonly totalMinutes: number;
  readonly equipmentRequired: 'none' | 'optional';
  readonly noGymNote: string;
  readonly whyItMatters: string;
}

export interface WorkoutLog {
  readonly id: string;
  readonly date: CalendarDay;
  readonly workoutId: string;
  readonly completedBlockIds: readonly string[];
  readonly minutes: number;
  readonly completedAt: string;
  readonly perceivedEffort?: 'easy' | 'moderate' | 'hard';
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

export interface SleepStep {
  readonly id: string;
  readonly minute: MinuteOfDay;
  readonly title: string;
  readonly action: string;
  readonly emoji: string;
}

export interface SleepPlan {
  readonly wakeMinute: MinuteOfDay;
  readonly targetBedMinute: MinuteOfDay;
  readonly targetHours: number;
  readonly ladder: readonly SleepStep[];
  readonly notes: readonly string[];
}

export interface SleepLog {
  readonly id: string;
  /** The night that BEGAN on this date. */
  readonly date: CalendarDay;
  readonly bedtimeActual: MinuteOfDay | null;
  readonly wakeMinute: number;
  readonly windDownCompleted: boolean;
  readonly screensOff: boolean;
  readonly selfRatedQuality?: 1 | 2 | 3 | 4 | 5;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface DomainProgress {
  readonly value: number;
  readonly earned: number;
  readonly possible: number;
  readonly label: string;
  readonly detail: string;
}

export interface DailyProgress {
  readonly date: CalendarDay;
  readonly nutrition: DomainProgress;
  readonly hydration: DomainProgress;
  readonly exercise: DomainProgress;
  readonly sleep: DomainProgress;
  readonly mealsDone: number;
  readonly mealsTotal: number;
  readonly overall: number;
  readonly streak: number;
  readonly disclaimer: string;
}

export type ReviewTopic =
  | 'meals'
  | 'exercise'
  | 'hydration'
  | 'sleep'
  | 'cost'
  | 'variety'
  | 'skips'
  | 'wins';

export interface ReviewSuggestion {
  readonly id: string;
  readonly topic: ReviewTopic;
  readonly headline: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly actionRoute?: string;
}

export interface WeeklyReview {
  readonly weekStart: CalendarDay;
  readonly weekEnd: CalendarDay;
  readonly daysTracked: number;
  readonly mealsCompleted: { readonly done: number; readonly total: number };
  readonly exerciseSessions: number;
  readonly hydrationConsistency: number;
  readonly sleepConsistency: number;
  readonly averageFoodCost: Estimate<number>;
  readonly grocerySpend: Estimate<number>;
  readonly mostSkippedSlot: MealSlot | null;
  readonly topConsumedFoods: readonly { readonly key: FoodKey; readonly name: string; count: number }[];
  readonly vegetableVariety: number;
  readonly suggestions: readonly ReviewSuggestion[];
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type SkipReason = 'not-hungry' | 'no-time' | 'unavailable' | 'disliked' | 'forgot' | 'other';

export interface SkipLog {
  readonly id: string;
  readonly date: CalendarDay;
  readonly eventId: string;
  readonly mealId?: string;
  readonly slot: MealSlot;
  readonly reason: SkipReason;
  readonly note?: string;
  readonly substituteOffered?: string;
  readonly substituteAccepted?: boolean;
  readonly minute: MinuteOfDay;
}

export interface SwapLog {
  readonly id: string;
  readonly date: CalendarDay;
  readonly mealId: string;
  readonly from: FoodKey;
  readonly to: FoodKey;
  readonly reason: string;
  readonly minute: MinuteOfDay;
  readonly costDelta: number;
}

export interface SkipResolution {
  readonly reason: SkipReason;
  /** One-line, non-judgemental acknowledgement. */
  readonly acknowledgement: string;
  /** A concrete next food action, or null if the user genuinely wants nothing. */
  readonly substitute: SkipSubstitute | null;
}

export interface SkipSubstitute {
  readonly label: string;
  readonly detail: string;
  readonly swaps: readonly FoodSwap[];
  readonly costDelta: number;
  readonly minutesToPrepare: number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationCategory = 'meals' | 'water' | 'exercise' | 'sleep' | 'motivation';

export type ReminderAction = 'done' | 'skip' | 'snooze' | 'view-meal' | 'start-workout';

export interface Reminder {
  readonly id: string;
  readonly date: CalendarDay;
  readonly category: NotificationCategory;
  readonly eventId: string;
  readonly fireMinute: MinuteOfDay;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly ReminderAction[];
  readonly route?: string;
  readonly priority: 'low' | 'normal' | 'high';
  readonly suppressedBy?: SuppressionReason;
}

export type SuppressionReason = 'category-off' | 'quiet-hours' | 'daily-cap' | 'already-done';

export interface NotificationSettings {
  readonly meals: boolean;
  readonly water: boolean;
  readonly exercise: boolean;
  readonly sleep: boolean;
  readonly motivation: boolean;
  /** May wrap past midnight, e.g. 1350 → 390. */
  readonly quietHoursStart: MinuteOfDay;
  readonly quietHoursEnd: MinuteOfDay;
  readonly snoozeMinutes: number;
  readonly dailyCap: number;
  readonly browserPermission: NotificationPermissionState;
  readonly delivery: 'auto' | 'system' | 'in-app' | 'off';
}

export type NotificationPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'
  | 'insecure-context';

export interface FiredReminder {
  readonly fingerprint: string;
  readonly date: CalendarDay;
  readonly firedMinute: MinuteOfDay;
  readonly actionedAt?: string;
  readonly action?: ReminderAction;
  readonly delivery: 'system' | 'in-app' | SuppressionReason;
}

// ---------------------------------------------------------------------------
// Day snapshot (the authoritative record of what the user was shown)
// ---------------------------------------------------------------------------

export interface DaySnapshot {
  readonly date: CalendarDay;
  readonly tz: string;
  readonly profileHash: string;
  readonly meals: readonly Meal[];
  readonly schedule: DailySchedule;
  readonly grocery: readonly GroceryItem[];
  readonly progress: DailyProgress;
  readonly workout: Workout;
  readonly sleepPlan: SleepPlan;
  readonly hydrationTarget: HydrationTarget;
  readonly advisory: AdvisoryMode;
  readonly writtenAt: string;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export interface AdvisoryConditionCopy {
  readonly condition: DeclaredCondition;
  readonly headline: string;
  readonly body: string;
  readonly route: string;
}

export interface AdvisoryMode {
  readonly active: boolean;
  readonly conditions: readonly DeclaredCondition[];
  readonly copy: readonly AdvisoryConditionCopy[];
  readonly suppressCalorieTargets: boolean;
  readonly suppressStreakPressure: boolean;
  readonly fluidCaution: boolean;
  readonly generalGuidanceChip: boolean;
}

// ---------------------------------------------------------------------------
// Engine context — the only time input the domain ever receives
// ---------------------------------------------------------------------------

export interface EngineContext {
  readonly now: Date;
  readonly tz: string;
  readonly weather: WeatherContext;
  /** Day-of-week, 0 = Sunday. Supplied so the domain never re-derives from Date. */
  readonly dayOfWeek: number;
  readonly month: number;
}

export interface WeatherContext {
  readonly kind: WeatherKind;
  readonly temperatureC?: number;
  readonly humidityPercent?: number;
}

export type WeatherKind = 'mild' | 'hot' | 'cold' | 'humid' | 'unknown';

/** Everything the engines need, in one bundle. */
export interface EngineInput {
  readonly profile: Profile;
  readonly diet: DietPreference;
  readonly health: HealthPreference;
  readonly settings: UserSettings;
  readonly pantry: readonly FoodKey[];
  readonly priceOverrides: Readonly<Partial<Record<FoodKey, number>>>;
  readonly date: CalendarDay;
  readonly season: SeasonId;
  readonly isRestDay: boolean;
}

export interface UserSettings {
  readonly theme: 'light' | 'dark' | 'system';
  readonly reduceMotion: boolean;
  readonly textScale: 1 | 1.15 | 1.3;
  readonly notifications: NotificationSettings;
  readonly lastPlanRebuildAt?: string;
  readonly dailyBudget: number;
}

export const GOAL_LABELS: Record<FitnessGoal, string> = {
  'maintain-weight': 'Maintain healthy weight',
  'lose-fat': 'Lose fat',
  'gain-weight': 'Gain weight',
  'build-muscle': 'Build muscle',
  'improve-fitness': 'Improve general fitness',
  'improve-energy': 'Improve daily energy',
  'build-healthy-lifestyle': 'Build a healthier lifestyle',
};

export const GOAL_DESCRIPTIONS: Record<FitnessGoal, string> = {
  'maintain-weight': 'Keep your weight steady with a simple, repeatable routine.',
  'lose-fat': 'Slightly smaller portions, more movement, steady protein.',
  'gain-weight': 'Larger portions and an extra snack, without relying on supplements.',
  'build-muscle': 'More protein each day plus regular resistance movement.',
  'improve-fitness': 'A balanced mix of everyday food and daily movement.',
  'improve-energy': 'Regular meals, steady hydration, and consistent sleep timing.',
  'build-healthy-lifestyle': 'The gentlest start: a few good habits that are easy to keep.',
};

export const PROGRESS_DISCLAIMER =
  'This tracks how much of your daily routine you completed. It is not a health or fitness score.';
