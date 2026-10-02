# Data Model

All types are TypeScript, defined in `src/lib/domain/types/`. Every value the user sees that is
*estimated* is wrapped in `Estimate<T>` so the UI physically cannot render it as a fact.

---

## 1. Core value wrappers

```ts
/** Marks a value as an estimate rather than a measured fact. */
export interface Estimate<T> {
  readonly value: T;
  readonly range?: { readonly low: T; readonly high: T };
  readonly basis: 'database' | 'derived' | 'regional-average' | 'user-entry';
  readonly confidence: 'low' | 'medium' | 'high';
}

export type EstimateKind = 'nutrition' | 'cost' | 'time' | 'quantity';

/** Minutes since midnight, 0–1439. Domain code never handles Date objects. */
export type MinuteOfDay = number;

/** Local calendar day in the user's timezone: 'YYYY-MM-DD'. */
export type CalendarDay = string;

/** What the engine actually knows: a range is not a point. */
export interface Portion {
  readonly grams: number;
  readonly gramsLow: number;
  readonly gramsHigh: number;
  /** Human-readable serving, e.g. '1 cup (cooked)', '2 medium rotis'. */
  readonly label: string;
  readonly unit: 'g' | 'ml' | 'piece' | 'cup' | 'tbsp' | 'tsp' | 'bowl';
}
```

---

## 2. Identity & profile

```ts
export type Sex = 'female' | 'male' | 'other' | 'prefer-not-to-say';
export type UnitSystem = 'metric' | 'imperial';
export type DietType = 'vegetarian' | 'egg-vegetarian' | 'non-vegetarian';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';

export type FitnessGoal =
  | 'maintain-weight'
  | 'lose-fat'
  | 'gain-weight'
  | 'build-muscle'
  | 'improve-fitness'
  | 'improve-energy'
  | 'build-healthy-lifestyle';

export interface User {
  readonly id: string;
  readonly createdAt: string;   // ISO — the only place Date/ISO strings live
  readonly schemaVersion: number;
}

export interface Profile {
  readonly userId: string;
  readonly name: string;
  readonly age: number;                          // 13–100
  readonly sex: Sex;
  readonly heightCm: number;                     // 120–230
  readonly weightKg: number;                     // 30–250
  readonly targetWeightKg?: number;
  readonly activityLevel: ActivityLevel;
  readonly fitnessLevel: FitnessLevel;
  readonly goal: FitnessGoal;
  readonly units: UnitSystem;
  readonly city: string;
  readonly state: string;
  readonly region: RegionId;                    // drives seasonality + price book
  /** Wall-clock minutes the user actually keeps. The schedule engine respects these. */
  readonly schedule: DailySchedulePreference;
  readonly exerciseMinutesPerDay: number;       // 0–180
  readonly hasGymAccess: boolean;
  readonly medicalConsentVersion: string;        // which safety version they accepted
  readonly onboardingComplete: boolean;
  readonly showBmi: boolean;
}

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
  readonly chronotype: 'early' | 'intermediate' | 'late';
}

export type WorkPattern =
  | 'school' | 'office-desk' | 'office-field' | 'shift' | 'student' | 'home' | 'other';
```

### Derived, never stored

`Bmi`, `Bmr`, `Tdee`, `HydrationTarget` are all computed on demand by `domain/targets` and
`domain/hydration`. Storing derived values guarantees eventual inconsistency with the profile.

BMI is informational only, gated behind `profile.showBmi`, and rendered without a verdict label.

---

## 3. Diet, health & safety

```ts
export interface DietPreference {
  readonly userId: string;
  readonly dietType: DietType;
  /** Hard excludes — engine must never substitute into these. */
  readonly allergies: readonly FoodKey[];       // e.g. 'peanut', 'egg'
  readonly intolerances: readonly FoodKey[];    // e.g. 'lactose', 'gluten-mild'
  readonly dislikes: readonly FoodKey[];        // soft — avoided unless nothing else fits
  readonly neverAgain: readonly FoodKey[];      // user-taught, permanent blacklist
  readonly staples: readonly FoodKey[];         // user says they always have these at home
}

export type DeclaredCondition =
  | 'diabetes' | 'kidney-disease' | 'pregnancy' | 'eating-disorder'
  | 'serious-allergy' | 'gi-symptoms' | 'thyroid' | 'hypertension'
  | 'cardiac' | 'none';

/**
 * NOT medical advice. A self-declared flag that switches the app into advisory mode:
 * plans still render, but a persistent banner routes the user to a qualified professional.
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
```

`safety.ts` maps `declaredConditions` → `AdvisoryMode`. Any condition outside `'none'` and not in the
benign set triggers advisory mode. The domain layer does not branch its portion math on conditions —
that would be prescribing.

---

## 4. Foods

```ts
export type FoodCategory =
  | 'staple' | 'protein' | 'vegetable' | 'fruit' | 'dairy'
  | 'fat' | 'nut' | 'legume' | 'egg-meat' | 'beverage' | 'other';

export type FoodKey =
  // staples
  | 'rice' | 'atta' | 'sattu' | 'bread' | 'poha' | 'ragi' | 'maida' | 'soba'
  // protein
  | 'dal-mix' | 'toor-dal' | 'moong-dal' | 'chana' | 'rajma' | 'soy-chunks'
  | 'egg' | 'chicken' | 'fish' | 'paneer' | 'milk' | 'curd' | 'buttermilk'
  // vegetables
  | 'potato' | 'onion' | 'tomato' | 'cauliflower' | 'cabbage' | 'spinach' | 'pumpkin'
  | 'gourd' | 'carrot' | 'beans' | 'brinjal' | 'mushroom' | 'cucumber' | 'radish' | 'beetroot'
  // fruits
  | 'banana' | 'guava' | 'apple' | 'orange' | 'papaya' | 'watermelon' | 'mango' | 'sapodilla'
  | 'pomelo' | 'pineapple' | 'grapes' | 'pomegranate' | 'amla' | 'lemon'
  // fats & extras
  | 'peanut' | 'sesame-seed' | 'mustard-oil' | 'ghee' | 'sugar' | 'jaggery' | 'tea' | 'coffee'
  // mixed / composite
  | 'sattu-drink' | 'chana-chat' | 'sprout-salad' | 'fruit-salad' | 'dal-rice-combo'
  | 'roti' | 'paratha' | 'khichdi' | 'dosa' | 'idli' | 'upma' | 'salad-plate';

export type DietTag = 'veg' | 'egg' | 'nonveg';
export type SeasonId = 'winter' | 'summer' | 'monsoon' | 'post-monsoon' | 'all-year';

export interface FoodNutrition {
  readonly caloriesPer100g: number;
  readonly proteinPer100g: number;
  readonly carbsPer100g: number;
  readonly fatPer100g: number;
  readonly fiberPer100g: number;
  readonly keyMicronutrients: readonly Micronutrient[];
}

export interface Micronutrient {
  readonly name: string;        // 'Iron', 'Vitamin C', 'Calcium'
  readonly benefit: string;     // plain language, never a health claim
  readonly sourceNote: string;  // 'notable in dal and leafy greens'
}

export interface FoodPrice {
  /** ₹ per `unit` of purchase (typically per 1 kg or per piece). */
  readonly typicalPrice: number;
  readonly low: number;
  readonly high: number;
  readonly unit: 'kg' | 'piece' | 'litre' | 'dozen';
  readonly unitGrams: number;   // grams in one purchase unit
  readonly sourceNote: 'regional-avg' | 'user-entry' | 'national-avg';
}

export interface Food {
  readonly key: FoodKey;
  readonly name: string;
  readonly localNames: readonly string[];   // 'chana dal', 'sattu', 'lauki'
  readonly category: FoodCategory;
  readonly dietTag: DietTag;
  readonly defaultPortion: Portion;
  readonly nutrition: FoodNutrition;
  readonly price: FoodPrice;
  readonly allergens: readonly string[];    // 'peanut', 'gluten', 'lactose', 'egg'
  readonly seasons: readonly SeasonId[];    // 'all-year' = always available
  readonly states: readonly RegionId[] | 'all';
  readonly prepMethods: readonly string[];
  readonly substitutes: readonly FoodKey[];
  readonly isRawIngredient: boolean;
  /** Nutrition data provenance — surfaced in the UI as an "estimate" note. */
  readonly dataConfidence: 'low' | 'medium' | 'high';
}
```

**Price regionalisation.** `FOODS` ships a national base price; `domain/budget` applies a
`RegionPriceIndex` multiplier (Bihar/Jharkhand lower than metro) on top. Users can override any single
food's price, which then wins permanently. All prices render as `₹30–45 (approx.)` ranges.

---

## 5. Meals & recipes

```ts
export type MealSlot = 'breakfast' | 'fruit' | 'lunch' | 'snack' | 'dinner';

export interface MealIngredient {
  readonly foodKey: FoodKey;
  readonly portion: Portion;
  readonly nutrition: NutritionTotals;        // precomputed for this portion
  readonly cost: Estimate<number>;            // ₹ for this portion
  readonly prepNote?: string;
  readonly optional: boolean;                 // 'add lemon if available'
}

export interface NutritionTotals {
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly fiber: number;
}

export interface MealAlternative {
  readonly kind: 'vegetarian' | 'budget' | 'allergy-safe' | 'seasonal' | 'quick';
  readonly label: string;
  readonly swap: readonly FoodSwap[];
  readonly note: string;
}

export interface FoodSwap {
  readonly from: FoodKey;
  readonly to: FoodKey;
  readonly reason: string;
  readonly costDelta?: number;   // ₹ impact, signed
}

export interface Meal {
  readonly id: string;
  readonly slot: MealSlot;
  readonly date: CalendarDay;
  readonly startMinute: MinuteOfDay;
  readonly endMinute: MinuteOfDay;
  readonly title: string;
  readonly subtitle: string;                 // 'Dal + Rice + Seasonal Sabzi + Curd'
  readonly ingredients: readonly MealIngredient[];
  readonly prepSteps: readonly string[];
  readonly prepMinutes: number;
  readonly nutrition: NutritionTotals;
  readonly cost: Estimate<number>;
  readonly whyItMatters: string;              // NEVER a claim; always mechanism + benefit
  readonly alternatives: readonly MealAlternative[];
  readonly hydrationMl: number;
  readonly tags: readonly string[];          // 'high-protein', 'quick', 'budget'
}

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly localName?: string;
  readonly ingredients: readonly MealIngredient[];
  readonly steps: readonly string[];
  readonly minutes: number;
  readonly cost: Estimate<number>;
  readonly nutrition: NutritionTotals;
  readonly alternatives: readonly MealAlternative[];
  readonly bestFor: readonly MealSlot[];
  readonly season: SeasonId;
  readonly foodSafetyNote?: string;
}
```

---

## 6. Schedule & day snapshot

```ts
export type TimelineEventKind =
  | 'wake' | 'hydration' | 'movement' | 'meal' | 'exercise'
  | 'post-workout' | 'wind-down' | 'sleep-prep' | 'sleep' | 'custom';

export type TimelineState =
  | 'done' | 'skipped' | 'missed' | 'current' | 'upcoming' | 'snoozed';

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
  readonly optional: boolean;     // water nudges are optional; meals are not
  readonly icon: string;
}

export interface DailySchedule {
  readonly date: CalendarDay;
  readonly events: readonly TimelineEvent[];
  readonly wakeMinute: MinuteOfDay;
  readonly sleepMinute: MinuteOfDay;
  readonly tz: string;
  readonly generatedFrom: ScheduleStrategy;   // which rules produced it
}

export type ScheduleStrategy =
  | 'fixed-preference'      // user times honoured exactly
  | 'shifted-for-goal'       // e.g. protein-forward breakfast for muscle goal
  | 'compressed-window'      // long work shift → tighter meal spacing
  | 'recovery-day';         // rest day → no workout, earlier dinner

export interface DaySnapshot {
  readonly date: CalendarDay;
  readonly tz: string;
  readonly profileHash: string;     // invalidate & regenerate if profile changed
  readonly meals: readonly Meal[];
  readonly schedule: DailySchedule;
  readonly grocery: readonly GroceryItem[];
  readonly progress: DailyProgress;
  readonly writtenAt: string;
}
```

---

## 7. Grocery & budget

```ts
export interface GroceryItem {
  readonly id: string;
  readonly foodKey: FoodKey;
  readonly name: string;
  readonly emoji: string;
  readonly category: GroceryCategory;
  readonly quantity: Portion;
  /** Total purchase qty after aggregating across meals in the period. */
  readonly buyQuantity: Portion;
  readonly unitCost: FoodPrice;
  readonly estimatedCost: Estimate<number>;
  readonly meals: readonly MealSlot[];      // which meals need it
  readonly owned: boolean;                  // "already at home"
  readonly purchaseRequired: boolean;       // false when owned
  readonly storage: string;                 // 'refrigerate; use within 3 days'
  readonly expectedDaysOfUse: number;
  readonly seasonalNote?: string;
  readonly budgetPriority: number;          // 1 = buy first
}

export type GroceryCategory = 'protein' | 'vegetable' | 'fruit' | 'staple' | 'fat' | 'other';

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
```

---

## 8. Hydration, fitness, sleep

```ts
export interface HydrationEntry {
  readonly id: string;
  readonly date: CalendarDay;
  readonly minute: MinuteOfDay;
  readonly ml: number;
  readonly source: 'quick-add' | 'meal' | 'workout' | 'manual';
  readonly eventId?: string;
}

export interface HydrationTarget {
  readonly targetMl: number;
  readonly floorMl: number;
  readonly ceilingMl: number;
  readonly adjustments: readonly HydrationAdjustment[];  // 'warmer weather (+400ml)'
  readonly basis: string;                                 // plain-language explanation
  readonly consultNote?: string;                          // fluid-restriction safety
}

export interface HydrationAdjustment {
  readonly factor: HydrationFactor;
  readonly label: string;
  readonly deltaMl: number;
}

export type HydrationFactor =
  | 'base' | 'body-weight' | 'activity' | 'exercise' | 'weather' | 'climate' | 'medical-caution';

export interface ExerciseBlock {
  readonly id: string;
  readonly name: string;
  readonly sets?: number;
  readonly reps?: number;
  readonly holdSeconds?: number;
  readonly minutes: number;
  readonly instructions: string;
  readonly scalable: boolean;
  readonly regression?: string;      // 'wall push-ups instead'
  readonly equipment: 'none' | 'optional';
}

export interface Workout {
  readonly id: string;
  readonly date: CalendarDay;
  readonly name: string;
  readonly level: FitnessLevel;
  readonly focus: 'full-body' | 'lower' | 'upper' | 'cardio' | 'mobility' | 'recovery';
  readonly blocks: readonly ExerciseBlock[];
  readonly totalMinutes: number;
  readonly equipmentRequired: 'none' | 'optional';
  readonly noGymVersionNote: string;
}

export interface SleepPlan {
  readonly wakeMinute: MinuteOfDay;
  readonly targetBedMinute: MinuteOfDay;
  readonly targetHours: number;
  readonly ladder: readonly SleepStep[];   // wind-down → screen dim → prep → sleep
  readonly notes: readonly string[];
}

export interface SleepStep {
  readonly minute: MinuteOfDay;
  readonly title: string;
  readonly action: string;
}
```

---

## 9. Progress

```ts
export interface DomainProgress {
  readonly value: number;        // 0..1
  readonly earned: number;
  readonly possible: number;
  readonly label: string;
  readonly detail: string;
}

export interface DailyProgress {
  readonly date: CalendarDay;
  readonly nutrition: DomainProgress;   // meals completed & portions followed
  readonly hydration: DomainProgress;
  readonly exercise: DomainProgress;
  readonly sleep: DomainProgress;
  readonly mealsDone: number;
  readonly mealsTotal: number;
  readonly overall: number;
  readonly streak: number;
  readonly disclaimer: string;         // 'Routine progress, not a health score'
}

export interface WeeklyReview {
  readonly weekStart: CalendarDay;
  readonly weekEnd: CalendarDay;
  readonly daysTracked: number;
  readonly mealsCompleted: { readonly done: number; readonly total: number };
  readonly exerciseSessions: number;
  readonly hydrationConsistency: number;   // 0..1
  readonly sleepConsistency: number;
  readonly averageFoodCost: Estimate<number>;
  readonly grocerySpend: Estimate<number>;
  readonly mostSkippedSlot: MealSlot | null;
  readonly topConsumedFoods: readonly { key: FoodKey; count: number }[];
  readonly vegetableVariety: number;
  readonly suggestions: readonly ReviewSuggestion[];   // max 3, always actionable
}

export interface ReviewSuggestion {
  readonly id: string;
  readonly headline: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly actionRoute?: string;
}
```

Named **"Daily Routine Progress"** throughout the UI — never a health score. The disclaimer string is a
required field on the type, not an optional footnote.

---

## 10. Notifications

```ts
export type NotificationCategory = 'meals' | 'water' | 'exercise' | 'sleep' | 'motivation';

export interface Reminder {
  readonly id: string;              // `${date}:${eventId}:${kind}` — dedupe fingerprint
  readonly date: CalendarDay;
  readonly category: NotificationCategory;
  readonly eventId: string;
  readonly fireMinute: MinuteOfDay;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly ReminderAction[];   // done | skip | snooze | view | start
  readonly route?: string;
  readonly priority: 'low' | 'normal' | 'high';
}

export type ReminderAction = 'done' | 'skip' | 'snooze' | 'view-meal' | 'start-workout';

export interface NotificationSettings {
  readonly meals: boolean;
  readonly water: boolean;
  readonly exercise: boolean;
  readonly sleep: boolean;
  readonly motivation: boolean;
  readonly quietHoursStart: MinuteOfDay;   // supports wrapping past midnight
  readonly quietHoursEnd: MinuteOfDay;
  readonly snoozeMinutes: number;          // min 10
  readonly dailyCap: number;               // default 12
  readonly browserPermission: NotificationPermissionState;
  readonly delivery: 'auto' | 'system' | 'in-app' | 'off';
}

export type NotificationPermissionState =
  | 'unsupported' | 'default' | 'granted' | 'denied' | 'insecure-context';

export interface FiredReminder {
  readonly fingerprint: string;
  readonly firedAt: string;
  readonly actionedAt?: string;
  readonly action?: ReminderAction;
  readonly delivery: 'system' | 'in-app' | 'suppressed-quiet-hours' | 'suppressed-cap';
}
```

---

## 11. Persistence & migration

```ts
export const SCHEMA_VERSION = 1;

export interface PersistedShape {
  profile: Profile | null;
  diet: DietPreference | null;
  health: HealthPreference | null;
  settings: UserSettings;
  snapshots: Record<CalendarDay, DaySnapshot>;
  hydration: HydrationEntry[];
  workouts: WorkoutLog[];
  sleep: SleepLog[];
  skips: SkipLog[];
  swaps: SwapLog[];
  firedReminders: FiredReminder[];
  weeklyReviews: WeeklyReview[];
  pantry: Record<FoodKey, { quantity: Portion; updatedAt: string }>;
  localPriceOverrides: Record<FoodKey, number>;
}
```

**Migration contract.** `migrate(raw: unknown): PersistedShape` is pure and total — it accepts any
historical shape (including `null` and garbage) and returns a valid current shape. Never throws. Run on
read in `repo.load()`. Tested against fixtures in `tests/migration.test.ts`.

**Repository interface** (`src/lib/repo/types.ts`):

```ts
export interface Repository {
  load(): Promise<PersistedShape>;
  saveProfile(p: Profile): Promise<void>;
  saveDiet(d: DietPreference): Promise<void>;
  saveHealth(h: HealthPreference): Promise<void>;
  saveSettings(s: UserSettings): Promise<void>;
  getSnapshot(day: CalendarDay): Promise<DaySnapshot | null>;
  putSnapshot(s: DaySnapshot): Promise<void>;
  appendHydration(e: HydrationEntry): Promise<void>;
  appendWorkoutLog(e: WorkoutLog): Promise<void>;
  appendSleepLog(e: SleepLog): Promise<void>;
  appendSkipLog(e: SkipLog): Promise<void>;
  appendSwapLog(e: SwapLog): Promise<void>;
  recordFired(f: FiredReminder): Promise<void>;
  getFiredSince(day: CalendarDay): Promise<FiredReminder[]>;
  setPantry(items: Record<FoodKey, { quantity: Portion; updatedAt: string }>): Promise<void>;
  setPriceOverride(k: FoodKey, price: number | null): Promise<void>;
  putWeeklyReview(r: WeeklyReview): Promise<void>;
  exportAll(): Promise<string>;      // JSON download
  clearAll(): Promise<void>;
}
```

Two implementations: `IndexedDbRepository` (browser default) and `MemoryRepository` (SSR + tests).
Adding a server-backed account later means writing a third implementation — no domain or UI change.

---

## 12. Log entities

```ts
export interface WorkoutLog {
  readonly id: string;
  readonly date: CalendarDay;
  readonly workoutId: string;
  readonly completedBlockIds: readonly string[];
  readonly minutes: number;
  readonly completedAt: string;
  readonly perceivedEffort?: 'easy' | 'moderate' | 'hard';
}

export interface SleepLog {
  readonly id: string;
  readonly date: CalendarDay;              // the night that *began* this date
  readonly bedtimeActual: MinuteOfDay | null;
  readonly wakeMinute: number;
  readonly windDownCompleted: boolean;
  readonly screensOff: boolean;
  readonly selfRatedQuality?: 1 | 2 | 3 | 4 | 5;
}

export type SkipReason =
  | 'not-hungry' | 'no-time' | 'unavailable' | 'disliked' | 'forgot' | 'other';

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
```

---

## 13. Invariants

Enforced by `tests/domain-invariants.test.ts` across generated plans:

1. `sum(ingredients.nutrition) ≈ meal.nutrition` within 1 unit.
2. `sum(ingredient costs) ≈ meal.cost.value` within ₹1.
3. No meal contains a food in `diet.allergies`, `neverAgain`, or `intolerances`.
4. No meal contains a non-veg food when `dietType = 'vegetarian'`.
5. No meal contains egg when `dietType = 'vegetarian'`.
6. Every event's `[start, end)` lies within `[0, 1440)`, and meal events are ordered by start time.
7. No two meal events overlap by more than 15 minutes.
8. `wakeMinute < sleepMinute` in wall-clock terms (may cross midnight → stored as pairs).
9. Every meal's ingredients resolve to foods present in the database.
10. Daily cost ≤ budget × 1.15, or the engine records a documented `budgetRelaxed` reason.
11. `dailyTargets.protein` is met within ±12% across a 7-day generated week, or the engine documents why.
12. Hydration target always within `[floorMl, ceilingMl]`.
13. Every `TimelineEvent.why` is non-empty and contains no banned claim phrase.
14. Weekly grocery aggregates to ≤ 7 days of consumption per item (waste guard).
