# Product Architecture

> "I have a personal health assistant in my pocket." — not "a webpage containing a diet chart."

## 1. Product thesis

Most diet content is **static and passive**. It describes what an ideal week looks like. It does not
answer the only question that matters at 8:30 AM on a Tuesday:

> *What do I do right now, how much, how do I make it, why does it matter, and what comes next?*

This product inverts the model. Instead of the user opening a **diet chart** and interpreting it, the
app opens on a **command center** that has already interpreted it for them using their own profile,
budget, schedule, season, and location.

### 1.1 The core loop

Every screen and every notification is an expression of one six-beat loop:

| Beat | Question answered | Surfaced as |
| --- | --- | --- |
| **NOW** | What should I do right now? | `NowCard` — pinned to top of Today |
| **WHY** | Why am I doing this? | `WhyThisMatters` — plain-language reason |
| **HOW** | How do I do it? | `PreparationSteps` — numbered, ≤6 steps |
| **HOW MUCH** | How much? | `PortionRow` — grams/cups/counts |
| **COST** | Roughly what does it cost? | `CostBadge` — ₹ range, always "approx." |
| **NEXT** | What comes next? | `NextUp` — one card, never a list |

If a screen cannot fill all six beats for an item, the item does not belong on a main surface.

### 1.2 The NOW / NEXT / LATER decision algorithm

This is the most important algorithm in the product, because it is what the user sees first.

```
resolveNow(events, now, log):
  1. In-flight item with an active snooze?          -> NOW   (honour the snooze)
  2. Event whose window contains `now`             -> NOW   (in-window)
  3. Nearest uncompleted past event (<= graceMins)  -> NOW   (overdue, highlighted)
  4. Nearest upcoming event                         -> NEXT  (countdown)
  5. Nothing scheduled today                       -> NOW   (rest / recovery state)
```

**Window model.** Every timeline event carries `[startMinute, endMinute]`. Meals are deliberately
generous (default 60–75 min) because "breakfast" is a period, not an instant. Workout windows are
tighter. Sleep is the widest and last.

**Overdue grace.** If a user opens the app 40 minutes after their lunch window closed, they should be
told "Lunch was 40 min ago — you can still have it", not shown a guilt trip. Overdue items get a
softer tone (`still-open`) and are auto-dismissed at +180 min so the dashboard never becomes a wall of
missed work.

**Snooze precedence.** A snoozed item is promoted to NOW even if it is in the future, because the
user explicitly asked for it. Snooze is capped at 3 per event per day to prevent unbounded nagging.

### 1.3 Skip, not shame

Skipping is normal data, not failure. The product treats a skip as a **missing observation**, asks one
low-friction reason question, and returns a *practical substitute* — not a scolding.

```
skip → reason (6 options) → resolution
  not_hungry       → shrink portion to the lower bound, mark meal done at 0.6 credit
  no_time          → emit a 5-minute "fast version" variant of the same meal
  unavailable      → substitute from the same food group within budget (see substitution engine)
  disliked         → offer 3 alternatives, permanently blacklist on "never again"
  forgot           → offer "do it now" if still in window, else convert to next-day prep note
  other            → free text, logged, used in weekly review patterns
```

A skipped meal still counts toward the **routine** score at reduced credit; it is never rendered as a
red failure state. The weekly review reports skips as *patterns* ("most frequently skipped: 17:00
snack — 4 of 7 days") with a concrete suggestion, because patterns are actionable and guilt is not.

### 1.4 Non-negotiable product safety rails

Enforced in code (`lib/domain/safety.ts`), tested in `tests/safety.test.ts`:

1. **No diagnosis.** The engine never infers, names, or grades a condition.
2. **Declared-condition gate.** If a user declares diabetes, kidney disease, pregnancy, an eating
   disorder, a serious allergy, or significant GI symptoms, the app switches to **advisory mode**:
   meals still render (a blank app helps nobody) but every plan is prefixed with a persistent,
   non-dismissible-for-the-session banner routing to a qualified professional. Portion targets are
   not auto-adjusted — that would be prescribing.
3. **No anti-aging / disease / guaranteed-outcome claims.** Enforced by a lint-style test that greps
   every user-facing string in the codebase for a banned-phrase list.
4. **No supplementation upsell.** The budget optimizer is structurally forbidden from spending on
   imported berries, protein bars, whey, or supplements (§8 of the spec).
5. **Estimates are always labelled.** Nutrition, cost, and price values carry `approximate` semantics
   in the type system (`Estimate<T>`) so the UI cannot render them as facts.
6. **No forced water.** Hydration is target-*and*-ceiling guided; targets are adjusted for heat,
   exercise, and body size, and never chased past a safe ceiling.

### 1.5 Scope boundaries

| In scope | Explicitly out of scope |
| --- | --- |
| General wellness, nutrition, hydration, movement, sleep routine | Diagnosis, treatment, medication advice |
| Estimated nutrition and cost | Laboratory-grade nutrient data |
| Household grocery planning and cost estimation | Live e-commerce pricing / shopping carts |
| Habit consistency and routine progress | Clinical risk scores, BMI-as-diagnosis |
| Regional Indian food context (Bihar-friendly by default) | Athletic performance or competition nutrition |

BMI is shown as *informational context only*, never as a verdict, and is hidden entirely when the user
has not opted into it.

---

## 2. System architecture

### 2.1 Layering — the dependency rule

```
┌─────────────────────────────────────────────────────────────────┐
│  UI  (app/**, components/**)                                    │
│  React Server + Client Components. Rendering only.               │
│  Contains ZERO nutrition arithmetic and ZERO scheduling logic.   │
└────────────────────────────┬────────────────────────────────────┘
                             │ depends on ↓ (never the reverse)
┌────────────────────────────┴────────────────────────────────────┐
│  APPLICATION  (src/lib/app/**)                                  │
│  Zustand stores · repositories · orchestration · clock/scheduling│
│  Orchestrates: on day-tick → resolve schedule → persist log     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  DOMAIN  (src/lib/domain/**)  ← PURE TypeScript, ZERO React     │
│  Deterministic. No Date.now(), no fetch, no IndexedDB, no Math.  │
│  Foods · nutrition · targets · schedule · meals · budget ·       │
│  grocery · hydration · fitness · sleep · progress · safety      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│  REPOSITORY  (src/lib/repo/**)                                  │
│  Storage interface (ISync) + IndexedDB impl + memory impl.      │
│  Swappable for HTTP later with zero domain changes.              │
└─────────────────────────────────────────────────────────────────┘

  PLATFORM  (src/lib/platform/**) — clock, tz, notifications, service
             worker, media queries. All impure browser APIs, isolated
             behind interfaces so tests inject fakes.
```

**The single most important rule: `lib/domain` is pure.** It takes a `Date`-like context and inputs and
returns data. `new Date()` never appears inside domain code — the caller passes `ctx.now`. This is what
makes "what should I do now" testable at 03:47 on a Sunday without mocking globals, and it is why the
nutrition and schedule test suites can be exhaustive rather than hopeful.

### 2.2 Why the domain is pure

A health app lives or dies on correctness of daily arithmetic. Testing that against a real clock is
flaky and unreviewable. Purity buys:

- **Exhaustive time testing** — iterate every minute of a 24h day × 6 schedule profiles = 8,640
  assertions in under a second.
- **Deterministic golden files** — a snapshot of "23yo, ₹120/day, egg-veg, Patna, winter" is a
  committed artifact that fails the build on regression.
- **Future AI layer** — an LLM recommender can be added as *another input producer* feeding the same
  deterministic renderer, so the app never becomes non-deterministic even when AI is on.

### 2.3 Module map

Each module owns one bounded concern and exports a pure surface.

| Module | Owns | Key exports |
| --- | --- | --- |
| `domain/types` | Entity contracts | `User`, `Profile`, `Food`, `MealPlan`, `DailySchedule`, … |
| `domain/foods` | Food database + lookup | `FOODS`, `getFood`, `searchFoods`, `foodsInGroup` |
| `domain/nutrition` | Nutrient math | `sumNutrition`, `per100g`, `portionOf`, `dailyTarget` |
| `domain/targets` | BMR/TDEE-ish, portions | `dailyTargets`, `portionScale` |
| `domain/schedule` | The day timeline | `buildSchedule`, `resolveNow`, `nextEvent`, `inWindow` |
| `domain/meals` | Meal assembly engine | `buildMealPlan`, `MEAL_TEMPLATES`, `substituteFor` |
| `domain/budget` | Money | `priceOf`, `optimizeBudget`, `rankByValue` |
| `domain/grocery` | Lists + waste logic | `buildDailyGrocery`, `buildWeeklyGrocery`, `mergeOwned` |
| `domain/seasonal` | Month → region availability | `seasonFor`, `inSeason`, `seasonalSwap` |
| `domain/hydration` | Target + logging rules | `hydrationTarget`, `hydrationReminders` |
| `domain/fitness` | Plans + workouts | `buildWorkout`, `WORKOUT_LIBRARY` |
| `domain/sleep` | Wind-down ladder | `buildSleepPlan`, `sleepTarget` |
| `domain/progress` | Scoring + review | `dailyProgress`, `weeklyReview` |
| `domain/notifications` | Scheduling rules | `buildReminders`, `inQuietHours`, `snoozeUntil` |
| `domain/safety` | Safety rails | `advisoryFor`, `assertSafeClaims` |
| `app/*` | State + orchestration | stores, repositories, `useToday` |
| `platform/*` | Browser APIs | `clock`, `tz`, `notify`, `sw`, `motion` |

**Cross-module imports are allowed; cycles are not.** `meals` may import `foods`, `budget`, `seasonal`.
Nothing imports `meals` except `app/`. A `madge`-style test enforces this.

### 2.4 Data flow — a single tick

The app is a **tick-driven state machine**, not a request/response app. One `useDayTick` hook fires on
(a) a 30-second interval and (b) any clock-change or profile-change event.

```
tick()
  ├─ ctx.now = clock.now()                        (platform)
  ├─ schedule = buildSchedule(profile, ctx)       (pure)
  ├─ plan     = buildMealPlan(profile, ctx)      (pure)
  ├─ grocery  = buildDailyGrocery(plan, owned)    (pure)
  ├─ now/next = resolveNow(schedule, ctx, log)    (pure)
  ├─ diff     = what changed since last tick?
  │     └─ if a reminder crossed its fire time → notify(reminder)  (platform)
  ├─ persist  (repo) : log mutations, daily snapshot
  └─ render   (UI)
```

The critical property: **all derived state is recomputed from (profile + date + log), never
incrementally mutated.** A 60-day-old plan replays identically, a mid-day profile edit reflows the
rest of the day correctly, and there is no drift between what was stored and what is shown.

### 2.5 Persistence

Local-first, IndexedDB (via a thin typed wrapper — no ORM) with `localStorage` for tiny hot paths
(current profile, snoozes, notification prefs) and an in-memory adapter for tests.

```
idb: profile · days/{date} → DaySnapshot{ plan, schedule, progress }
     logs/hydration · logs/workout · logs/sleep · logs/skips · owned { pantry }
```

A `DaySnapshot` is written once per day and is the *authoritative record* of what the user was shown.
This matters for two reasons: (1) the weekly review can reconstruct past days even if the profile has
since changed, and (2) a plan generated on 3G in the morning renders instantly offline at 6 PM.

**Migration.** `SCHEMA_VERSION` + pure `migrate(raw)` functions, run on read. Old data upgrades; it is
never silently dropped.

### 2.6 Time, timezone, and the "no clock in domain" contract

- `Clock` interface: `now()`, `tz()`. Real impl reads `Intl.DateTimeFormat().resolvedOptions()`.
- All domain time is **`MinuteOfDay`** (0–1439) plus a **`CalendarDay`** (`YYYY-MM-DD` string). Never
  `Date` objects, never epoch math inside domain code.
- `buildSchedule` is a pure function `(profile, { day, tz, now }) → DailySchedule`.
- Recurring/ DST behaviour: wake/sleep/meal times are stored as wall-clock minutes the user typed.
  Daylight-saving shifts never move a meal; that is correct behaviour for this product.
- "Yesterday" is computed in the *user's* local timezone via `tzOffsetMinutes`, not UTC, so a user in
  India logging at 11:50 PM gets the correct day boundary.

### 2.7 Notifications

Three cooperating layers, deliberately separated:

1. **`buildReminders(profile, schedule, settings, log)`** — pure. Decides *what* should fire *when*,
   honours quiet hours, snooze, category toggles, daily caps, and skip-state. Fully testable.
2. **`NotificationScheduler`** (platform) — a 30s tick that diffs `firedReminders` against
   `buildReminders` and fires only newly-due items. Fires via the **Service Worker** `showNotification`
   when available (survives tab backgrounding on Android), falling back to the `Notification` API, then
   to in-app toasts. Three graceful degradation levels.
3. **UI** — the in-app reminder surface, always available even with zero permissions granted.

**Anti-spam policy (hard requirements, tested):**

| Rule | Value |
| --- | --- |
| Max reminders / day | 12 |
| Max per category / day | meals 4, water 4, exercise 1, sleep 2, motivation 1 |
| Quiet hours | user-defined, default 22:30–06:30, enforced **always** |
| Snooze minimum | 10 min |
| Missed-fire catch-up | only if within 90 min of fire time, else dropped |
| Duplicate suppression | `(date, eventId, kind)` fingerprint persisted |

If the user grants no permission at all, the app remains fully functional — reminders surface as
in-app banners on the Today screen. Notifications are an enhancement, never a dependency.

### 2.8 Extensibility seams (deliberately built, not bolted on)

- **`RecommendationProvider`** — the seam for the later AI layer. `RuleBasedProvider` ships now;
  `AiProvider` can be dropped in and will be *blended* deterministically (AI proposes food swaps and
  local alternatives, the budget engine still vetoes anything unaffordable, the safety engine still
  has final say). Non-determinism is quarantined to one module.
- **`PriceSource`** — `StaticPriceBook` now; a future `/api/prices` adapter implements the same
  interface and every ₹ figure in the UI updates.
- **`ISync`** — repository interface; a Postgres/HTTP adapter drops in for accounts + sync.
- **`FoodSource`** — local JSON now; crowdsourced or API-backed foods later, same `Food` contract.

### 2.9 Quality gates

| Gate | Command | Bar |
| --- | --- | --- |
| Types | `tsc --noEmit` | zero errors, `strict` + `noUncheckedIndexedAccess` |
| Lint | `eslint` | zero errors |
| Tests | `vitest run` | 100% pass, coverage ≥ 80% on `lib/domain` |
| Build | `next build` | no errors, first-load JS budget documented |
| Safety | `tests/claims.test.ts` | zero banned phrases across all user-facing strings |
| A11y | manual + axe | AA contrast, keyboard-complete, focus-visible everywhere |
| Offline | manual | Today screen renders with network disabled after first visit |

---

## 3. Data model

Full field-level definitions live in `docs/02-data-model.md`; entity relationships and lifecycle in the
same file. Summary of the layering:

```
User 1─1 Profile                identity + anthropometrics + schedule + location
     1─1 DietPreference         diet type, exclusions, dislikes, allergies
     1─1 HealthPreference       declared conditions (safety gate), sun/tobacco/alcohol habits
     1─1 UserSettings           notifications, quiet hours, units, price overrides

CalendarDay 1─1 DailySnapshot    the *authoritative* plan+schedule+progress shown on that date
             1─* Meal             4–6 meals, each 1─* MealIngredient → Food
             1─* TimelineEvent    every scheduled moment incl. non-meal (hydration, workout, sleep)
             1─* GroceryItem      required purchases, with `owned` flag
             1─1 DailyProgress    routine completion percentages

HydrationLog · WorkoutLog · SleepLog · SkipLog · SwapLog
Notification (fire history, snooze state)
WeeklyReview (rollup of 7 DailySnapshots)
Food (static DB, seeded) · Recipe (static DB, seeded)
```

`DailySnapshot` is immutable once written except for `DailyProgress` and log back-references. This is
what makes the weekly review honest: you review what actually happened, not what today's engine would
have produced.

---

## 4. User flows

Full step-by-step flows with decision branches live in `docs/03-user-flows.md`. Summary:

```
FIRST RUN
  Landing → Health disclaimer + advisory notice → 6-step onboarding
          → "Your day is ready" preview → Today

RETURNING (the 3-second path — the most important flow in the product)
  Open → NOW card already answered → Done/Skip → next action visible → close

MEAL INTERACTION
  Timeline → tap meal → detail sheet (portions/prep/cost/nutrition/alternatives)
           → Done · Skip(reason→substitute) · Swap food · Change portion

COMMERCIAL FAILURE
  Cannot afford / cannot find food → skip(unavailable) → in-budget local substitute in one tap

MISSED DAY
  Open after 24h → streak is preserved but not celebrated as a win
                 → "Yesterday: 3 of 4 meals" → one concrete suggestion, no lecture

RECOVERY / RESET
  Settings → Reset plan · Edit any profile input → tomorrow's plan reflows
           → Export all data (JSON) · Clear all data (double confirm)
```

**Data exit is mandatory.** Everything the app stores lives on the user's device; settings expose a
one-tap JSON export and a double-confirmed wipe. A local-first app that traps your data is a dark
pattern.

---

## 5. Screen & component plan

Full inventory with props, states, and a11y notes lives in `docs/04-screen-component-plan.md`.
Route and component summary:

```
app/
  onboarding/          6 steps + review          multi-step, one question per screen, progress bar
  (app)/
    today/             ★ strongest screen        NOW · NEXT · timeline · FOOD · SHOPPING · PROGRESS
    meals/             meals + detail sheet      plan, swap, portion edit, prep
    grocery/           daily + weekly planner    owned checkboxes, cost, waste-aware
    fitness/           plan + today's workout    beginner/intermediate/advanced, no-gym options
    progress/          daily + weekly review     trends, streaks, cost per day, suggestions
  settings/            profile, notifications,   quiet hours, price overrides, data export
                       prices, safety, data

components/
  ui/                  primitives (button, sheet, dialog, slider, toggle, …)
  now/                 NowCard · NextUp · WhyThisMatters · PortionRow · CostBadge
  meal/                MealCard · MealDetailSheet · SubstitutionList · PreparationSteps
  timeline/            Timeline · TimelineItem (past|current|future|overdue|snoozed|done)
  grocery/             GroceryItem · GroceryList · WeeklyGroceryGroup · OwnedToggle
  fitness/             WorkoutCard · ExerciseBlock · SetRow · ProgressRing
  hydration/           HydrationTracker · QuickAdd
  progress/            DailySummary · ProgressRing · StreakChip · WeeklyReviewCard
  safety/              SafetyBanner · AdvisoryBanner · ClaimsNote
  nav/                 AppShell · BottomNav · TopBar
```

Component contract rules:

1. **Presentational components never import from `lib/domain` math helpers** — they receive computed
   values as props. This is what keeps components dumb and testable in isolation.
2. **Every card answers the six beats.** If a component cannot render "why" and "how much", it belongs
   in a detail sheet, not a card.
3. **`MealCard` is used identically** in Today, Meals, and notifications — one component, three
   surfaces, zero divergence.
4. **Sheet over route for detail**, route over sheet for navigation. Deep-linkable views (meals,
   progress) get real URLs; transient inspection gets a sheet.

---

## 6. Build phases

| Phase | Delivers | Gate to next phase |
| --- | --- | --- |
| 1 | Design system, app shell, routing, state, persistence, onboarding | Onboarding completes and persists |
| 2 | Food DB, nutrition math, recipes, seasonal intelligence | Nutrition tests green |
| 3 | Schedule + meal-plan + portion engines | Schedule golden files stable |
| 4 | Budget optimizer, daily + weekly grocery, substitution engine | Budget tests green |
| 5 | Hydration, fitness, sleep modules | Target calculators tested |
| 6 | Reminder engine, scheduler, PWA, service worker, offline | Notification tests green |
| 7 | Progress scoring, streaks, weekly review | Review matches fixtures |
| 8 | A11y, performance, empty/error/loading states, lint/type/test/build | All gates in §2.9 green |

Phases are ordered so that every phase is independently demoable — no phase leaves the app in a
non-functional state, and the whole product degrades gracefully if later phases never ship.
