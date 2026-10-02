# Screen & Component Plan

Design principles: **mobile-first, one dominant idea per screen, no card soup, no fake data, readable
numbers, and a timeline as the primary organisational spine.**

---

## 1. Design system

### 1.1 Visual language

Soft, warm, calm. Health-adjacent without being clinical or childish. The palette is warm-neutral
(daylight, grain, produce) with a single confident accent — this is a *companion*, not a hospital chart.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#FBF9F6` warm paper | page |
| `--surface` | `#FFFFFF` | cards, sheets |
| `--surface-2` | `#F4F1EC` | inset, timeline rail |
| `--ink` | `#1A1714` | primary text (15.8:1 on bg) |
| `--ink-2` | `#5C534B` | secondary (7.1:1) |
| `--ink-3` | `#8A7F74` | tertiary, captions (4.6:1 — AA for ≥16px only) |
| `--accent` | `#0F7A5A` deep green | primary actions, active nav, progress |
| `--accent-soft` | `#E6F2EC` | accent tints, chips |
| `--warm` | `#C2610F` amber | cost, streak, "approx." labels |
| `--calm` | `#3B6FD4` blue | water, hydration |
| `--plum` | `#6B4E9E` | sleep, wind-down |
| `--alert` | `#B3261E` | **safety only** — never used for a missed meal |
| `--line` | `#E8E2D9` | hairlines |

**Typography.** One family: `Inter` (variable) for UI, tabular numerals for all metrics so digits don't
jitter as they update. Scale: `display 34/38`, `h1 26/32`, `h2 20/26`, `h3 17/24`, `body 15/22`,
`small 13/18`, `cap 12/16`. Body never below 15px; captions never below 12px and never carry meaning
alone.

**Spacing.** 4px base; `space-1..space-12` = 4/8/12/16/20/24/32/40/48/64/80/96. Section rhythm uses
`space-8`; card padding `space-5`; sheet padding `space-6`.

**Radius.** `sm 8` (chips), `md 12` (buttons/inputs), `lg 16` (cards), `xl 24` (sheets), `full` (avatars,
rings). Elevation via `1px solid var(--line)` + tiny shadow — **not** heavy drop shadows.

**Motion.** 120 ms micro (state), 200 ms standard (sheet, card), 300 ms timeline reflow. Easing
`cubic-bezier(.2,.8,.2,1)`. All motion behind `prefers-reduced-motion`; the timeline still updates, it
just doesn't slide.

### 1.2 Anti-patterns explicitly banned

Bootstrap-looking default shadows · more than 3 competing accent colours in one viewport · icon-only
buttons without labels · fake progress bars with invented percentages · stock-photo hero · calorie
counters as the largest element · red for anything except a safety warning · text below 12px · infinite
spinners without skeleton content · modals for navigation.

---

## 2. Routes

| Route | Purpose | Primary action |
| --- | --- | --- |
| `/` | Landing + safety notice | Start onboarding |
| `/onboarding` | 6-step wizard + plan preview | Finish → Today |
| `/today` | ★ Command centre | Do the NOW item |
| `/meals` | Full day plan | Open meal sheet |
| `/grocery` | Daily + weekly lists | Check off owned items |
| `/fitness` | Plan + today's workout | Start / log workout |
| `/progress` | Daily + weekly review | Act on a suggestion |
| `/settings` | Profile, diet, prices, notifications, data | Change anything |

Bottom nav on mobile: `Today · Meals · Grocery · Fitness · Progress`. Settings via top-right avatar.
Desktop: persistent left sidebar, content max-width 720 px centred (readable measure), rail shows the
NOW card above content so the six-beat answer is always present.

---

## 3. Screens

### 3.1 `/` Landing

- Hero: value promise + `[Get my plan]` / `[How it works]`.
- Three panels: **Now** (what to do) → **Why** (reasoned, not preachy) → **Real food, real cost**
  (₹50–200/day, Indian staples, Bihar-friendly).
- Safety note, above the fold, no scroll required.
- Skeleton-free; LCP target < 1.2 s.

### 3.2 `/onboarding`

Per-step layout: `Step X of 6` + progress bar · single question · large touch targets (≥48px) ·
`Continue` bottom-right (sticky on mobile) · `Back` top-left · step dots tappable to revisit.

| Step | Components | Validation |
| --- | --- | --- |
| 1 About you | `TextField` `NumberField` `SegmentedControl` (units) `SexSelect` | name 1–40 chars · age 13–100 · height 120–230 · weight 30–250 |
| 2 Goal | `GoalCardGrid` (7, one selected) | required |
| 3 Diet | `DietOptionCards` `FoodPicker` ×3 (allergy / intolerance / dislike) | allergy ≠ empty list may be empty but shows warning copy |
| 4 Budget | `BudgetSlider` (₹50–₹200) + custom input + `LiveCostPreview` | ₹30–₹1000 |
| 5 Rhythm | `TimeChips` ×7 + `WorkPatternSelect` + live `SchedulePreview` graphic | chronological sanity (breakfast < lunch < dinner), min 1 h gaps |
| 6 Location & activity | `RegionSelect` (state→city) `ActivityCards` `GymToggle` + seasonal preview | required |

Then `PlanPreviewScreen` — the generated day, timeline, meals, cost, hydration target, advisory banner
if applicable, `[Start] [Change something]`.

**A11y.** Progress bar is `role="progressbar"` with `aria-valuenow`. Step changes move focus to the new
heading and announce via a polite live region. Validation errors use `role="alert"`. Radio groups use
`role="radiogroup"` with arrow-key support.

### 3.3 `/today` — the strongest screen

Ordered by information value, top to bottom:

```
┌ TopBar ─────────────────────────────────────────────┐
│ Good morning, Sudhanshu          Thursday, 12 June  │
│ 🔥 6-day streak                          ⚙ Profile  │
└─────────────────────────────────────────────────────┘

┌ NOW CARD (never scrolls out of reach) ──────────────┐
│ 08:34 · 4 min into a 75-min window                  │
│ 🍳 Breakfast time                                     │
│ 2 eggs · 2 rotis · 1 banana                           │
│ 22 g protein   ·   ₹25 approx                        │
│                                                      │
│ WHY  Protein + carbohydrate + micronutrients to       │
│       start the day.                                  │
│                                                      │
│ DO THIS NOW                                           │
│  ☐ Boil 2 eggs          ☐ Cook 2 rotis              │
│  ☐ Eat 1 banana         ☐ Drink 350 ml water         │
│                                                      │
│ [ ✓ Done ]   Skip · Swap food                        │
│                                                      │
│ NEXT IN 2 h 56 m                                     │
│ 11:30 🍊 Fruit + water                                │
└─────────────────────────────────────────────────────┘

TODAY            ← collapsible sections, all visible by default on desktop
  vertical timeline, 07:00 → 23:00, now-marker
  · 07:00 Wake up            [done ✓]
  · 07:05 💧 First water     [done ✓]
  · 07:30 Light movement     [done ✓]
  · 08:30 🍳 Breakfast        ← CURRENT (accent left-rail, subtle lift)
  · 11:30 🍊 Fruit            upcoming (dimmed)
  · 13:30 🍛 Lunch
  · 16:30 🥜 Snack
  · 18:00 🏃 Workout
  · 19:00 💧 Rehydrate
  · 20:00 🍲 Dinner
  · 21:30 🌙 Wind-down
  · 22:30 Sleep prep
  · 23:00 😴 Sleep

FOOD         Today's 5 meals as MealCard rows → sheet
SHOPPING     Compact grocery preview + [See full list]
PROGRESS     Nutrition / Hydration / Exercise rings + meals done x/5
```

**States.** First run → empty state pointing to onboarding. No plan for today → generating skeleton.
Mid-day catch-up → NOW card switches to `still-open` tone. Everything done → "Day complete" summary +
tomorrow preview.

**A11y.** Timeline is an ordered list with a text `aria-current="step"` on the current event; the
now-marker is `aria-hidden` decorative with a text equivalent. Rings expose `aria-label` + numeric
text. All interactive rows are buttons with descriptive labels ("Breakfast, 8:30 AM, 2 eggs, 2 rotis,
1 banana, done").

### 3.4 `/meals`

Day tabs (yesterday / today / tomorrow) · meal cards grouped by slot · each card shows portions,
nutrition, cost, tags · tap → detail sheet. Swipe left on a card → quick actions (Done / Skip / Swap).
"Change this meal" opens `MealSwitcher` (3 alternatives + search the food DB).

### 3.5 `/grocery`

`Tabs: Today | This week`. Today: grouped items, per-item owned checkbox, running total vs budget,
"₹22 under budget". Week: five category groups with aggregate purchase packs (1 kg bag, not 340 g),
days-of-use, storage notes, subtotals, total, per-day, and waste-reduction callouts. Sticky total bar.

### 3.6 `/fitness`

Level selector (beginner/intermediate/advanced) · today's `WorkoutCard` with blocks, each a tappable
`SetRow` (sets × reps, tap to complete, counter persists) · start/pause timer · total minutes ·
`Swap to no-equipment version` · weekly session count · "You don't need a gym to use this" note.

### 3.7 `/progress`

`Daily Routine Progress` heading with the explicit disclaimer line. Four `ProgressRing`s + meals done.
Weekly: bars for meals/exercise/hydration/sleep across 7 days, avg cost/day, grocery spend, most-skipped
slot, top foods, vegetable variety, then **max 3** suggestions with optional deep-link actions.

### 3.8 `/settings`

Sections: Profile · Goal & activity · Diet & exclusions · Declared health conditions (safety) · Meal
times · Nutrition targets (calories/protein/water, with "how this was calculated" disclosure) · Price
overrides · Notifications (categories, quiet hours, snooze, cap, permission state) · Appearance
(theme, reduce motion, text size) · Data (export, reset, delete).

---

## 4. Component inventory

### 4.1 Primitives (`components/ui/`)

`Button` (primary/secondary/ghost/danger, sizes sm/md/lg, icon+label, loading, full-width) · `IconButton`
(always requires `aria-label`) · `Card` · `Sheet` (bottom sheet on mobile, centred dialog on desktop,
focus trap, Esc close, swipe-to-dismiss) · `Tabs` · `SegmentedControl` · `Select` · `TextField` ·
`NumberField` · `TimeField` · `Slider` · `Toggle` · `Checkbox` · `Chip` · `Badge` · `Toast` ·
`Skeleton` · `EmptyState` · `ErrorState` · `ProgressBar` · `ProgressRing` · `Stepper` (portions) ·
`Banner` (info/safety/advisory) · `Section` (collapsible, with heading + optional action).

### 4.2 Domain components

| Component | Key props | Notes |
| --- | --- | --- |
| `NowCard` | `event`, `meal?`, `progress`, `next`, `handlers` | the six beats in fixed order; `tone: 'live'\|'still-open'\|'rest'\|'complete'` |
| `NextUp` | `event`, `minutesAway` | one line, countdown, tappable |
| `WhyThisMatters` | `text` | always rendered on meals; never a claim |
| `PortionRow` | `portion`, `onChange` | Stepper, live delta (+45 kcal · +₹4) |
| `CostBadge` | `estimate` | `₹30–45` + `approx.` chip, tap → price override |
| `PreparationSteps` | `steps`, `minutes` | numbered, ≤6, checkboxable in NOW card |
| `MealCard` | `meal`, `variant: 'compact'\|'full'`, `state` | used identically in Today/Meals/notifications |
| `MealDetailSheet` | `meal`, `open` | six beats + alternatives + food safety |
| `SubstitutionList` | `alternatives`, `onSwap` | shows cost delta and availability; hides irrelevant groups |
| `Timeline` / `TimelineItem` | `events`, `nowMinute`, `states` | `past\|current\|future\|overdue\|snoozed\|done\|skipped`; now-marker |
| `GroceryItem` | `item`, `onToggleOwned` | emoji, qty, ₹, meals-used, storage |
| `WeeklyGroceryGroup` | `group` | collapsible, subtotal, purchase-pack qty |
| `WorkoutCard` / `ExerciseBlockRow` | `workout`, `completed`, `onToggle` | tap-to-complete, scalable variants |
| `HydrationTracker` | `target`, `consumed`, `reminders` | ring + quick-add 250/500/750/1000 + timeline dots |
| `ProgressRing` | `value`, `label`, `size`, `tone` | `aria-label` with numeric text |
| `DailySummary` | `progress` | 4 rings + meals done + disclaimer |
| `StreakChip` | `streak`, `best` | warm accent, no red |
| `WeeklyReviewCard` | `review` | metrics + ≤3 suggestions with actions |
| `SkipReasonSheet` | `open`, `onReason` | 6 options, one tap each, then substitute offer |
| `SafetyBanner` / `AdvisoryBanner` | `conditions` | non-dismissable in-session |
| `FoodSafetyNote` | `keys` | collapsible, appears for egg/meat/dairy/cut produce |
| `NotificationCard` | `reminder` | in-app fallback with the same action buttons as system notifications |
| `AppShell` / `BottomNav` / `TopBar` | `route`, `user` | responsive sidebar ↔ bottom nav |

### 4.3 Component contracts

1. **Dumb by rule.** Components take computed values; they never call `lib/domain` math. A component
   that needs computation gets it from a hook in `lib/app/hooks`.
2. **Single-source rendering.** `MealCard` in the timeline, the meals tab, and the notification body is
   one implementation — copy drift is a bug.
3. **Six beats or a sheet.** If a card can't show what/how-much/why, it navigates to a sheet instead.
4. **Zero fake data.** No component renders a placeholder percentage. Loading = skeleton that mirrors
   final layout; empty = explicit `EmptyState` with a next action.
5. **Accessible by default.** Visible focus rings, ≥44px targets, `aria-label` on all icon-only
   controls, `role="status"` for toasts, `aria-live="polite"` for the NOW card when it changes, full
   keyboard operation, AA contrast everywhere.
6. **Mobile-first CSS.** Base styles are the phone; `@media (min-width:)` only ever adds. Safe-area insets
   respected via `env(safe-area-inset-bottom)`.

---

## 5. Responsive behaviour

| Breakpoint | Layout |
| --- | --- |
| < 640 (phone) | Single column; bottom nav; NOW card full-bleed with sticky action bar; sheets from bottom, drag-dismissable |
| 640–1023 (large phone / small tablet) | Single column, wider gutters, bottom nav retained |
| 1024–1279 (tablet / small laptop) | Left rail nav; content max 720 px; NOW card above the fold; timeline rail visible |
| ≥ 1280 (desktop) | 240 px sidebar + 720 px content + 320 px context rail (NOW card, hydration, progress) |

Content never exceeds ~720 px for text measure. No horizontal scrolling at 320 px width. All grids
collapse to one column. Tables become definition lists on small screens.

---

## 6. Performance

- Route-level code splitting; the food database loads with meals, not with the shell.
- `DaySnapshot` cached in memory → Today renders without awaiting IndexedDB.
- Pure engine memoised per `(profileHash, date)` — no recompute storm on re-render.
- Timeline renders only the visible window plus ±2 events on mobile (`content-visibility: auto`).
- Icons: inline SVG sprite, no icon font, no per-icon network request.
- Fonts: `font-display: swap`, self-hosted subset, preloaded.
- Target: Today interactive < 1 s on a mid-range Android over 4G; cold offline < 200 ms.
- No layout shift: all media containers have reserved aspect ratios; numerals are tabular.

---

## 7. Accessibility checklist

- Contrast ≥ AA for all text; accent green `#0F7A5A` on white = 5.4:1, used only at ≥16px or bold.
- Focus ring `2px solid var(--accent)` + `2px` offset, visible on every interactive element.
- Full keyboard path: onboarding → today → complete an item → open a meal → swap a food. No traps.
- Sheets trap focus, restore it on close, close on Esc, labelled by their heading.
- Live regions: NOW card `aria-live="polite"`; toasts `role="status"`; errors `role="alert"`.
- Colour is never the only signal — states also use icon + text (`done` shows a check and the word).
- `prefers-reduced-motion` honoured globally.
- Text scaling to 200% without clipping or overlap; layouts use `min()` and wrap.
- Emoji are decorative and `aria-hidden`, always paired with a text label.
