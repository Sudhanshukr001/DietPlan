# User Flows

Every flow below is designed around one rule: **the user should never have to ask "what am I supposed to
do?"** The app answers before the question forms.

---

## 1. First run — cold start

The highest-stakes flow. A new user has no data, and the first five seconds decide whether they trust
the app.

```
Landing
  └─ Hero: "Your day, planned in 60 seconds."
     ├─ [Get my plan]              → Onboarding step 1
     ├─ [How it works]             → 3-panel explainer (Now/Why/Never medical advice)
     └─ Safety note, visible without scrolling:
        "General wellness guidance. Not medical advice. If you have a health
         condition, talk to a doctor or dietitian first."
```

Onboarding is **6 steps, one decision per screen.** Multi-step forms fail when they ask 12 questions at
once; single-question screens have a completion rate roughly 2–3× higher.

| Step | Screen | Inputs | Live feedback |
| --- | --- | --- | --- |
| 1 | About you | name, age, sex, height, weight, units | BMI shown **only if opted in**, framed as context |
| 2 | Goal | 7 goal cards, one selected | plain-language consequence of each goal |
| 3 | Diet | diet type + allergy/intolerance/dislike pickers | "we'll never suggest this again" confirmation on allergy |
| 4 | Budget | ₹50…₹200 + custom | **live preview**: "≈ ₹120/day buys ~3 meals + snacks" |
| 5 | Rhythm | wake, breakfast, lunch, snack, exercise, dinner, sleep, work pattern | timeline preview graphic updates live as you drag time chips |
| 6 | Location + Activity | state, city, activity level, fitness level, gym access | seasonal produce preview ("It's winter in Bihar — guava, orange, carrot are in season and cheap") |

**Step transitions.** Back preserves all input. Validation is on-blur (never on-keystroke) so the user
is not scolded mid-thought. Invalid submit shakes the offending field and focuses it with an
`aria-describedby` error, rather than a toast.

```
Step 6 → [Build my plan]
  └─ Generating state (real work, ~400ms, skeleton shimmer — not a fake spinner)
     └─ Plan preview screen
        ├─ "Here's your Tuesday" — timeline, meals, estimated cost, hydration target
        ├─ ⚠ Advisory banner if declared conditions exist (see §6)
        ├─ [This looks good — start]   → Today
        └─ [Change something]          → deep-links into onboarding at the relevant step
```

The preview screen matters: it converts an abstract signup into a tangible artifact **before** the user
commits, and it is where first-time distrust ("is this real?") is answered.

---

## 2. Returning — the 3-second path (the most important flow)

The defining flow of the product. Optimised for: open → read NOW → act → close.

```
Open app (cold start, network off is fine)
  ├─ TopBar:  "Good morning, Sudhanshu" · Thursday, 12 June · 🔥 6-day streak
  ├─ NOW CARD (visible without scrolling, ~24px from top)
  │    08:34 · 4 min into window
  │    🍳 Breakfast time
  │    2 eggs · 2 rotis · 1 banana
  │    ₹25 approx · 22g protein
  │    WHY:  Protein + carbs + micronutrients to start the day.
  │    DO THIS NOW:  ☐ boil eggs  ☐ cook rotis  ☐ eat banana  ☐ drink 350ml
  │    [✓ Done]  [Skip]  [Swap food]
  │    NEXT: 11:30 — Fruit + water (in 2h 56m)
  └─ Below fold: TODAY timeline · FOOD · SHOPPING · PROGRESS
```

**Design constraints that make this work**

- The NOW card renders from cache in <100 ms — no spinner on a returning user.
- `Done` is a single tap, no confirmation, optimistic UI, undo available for 6 seconds.
- `Skip` never blocks; it is a secondary text button, visually smaller than `Done`.
- If the window has passed (>0 min), the card switches tone to `still-open`: *"Breakfast was 25 min
  ago — still a good time."* No red, no exclamation, no miss language.

```
Tap [✓ Done]
  ├─ Optimistic: checkmark animates, card collapses into timeline as done
  ├─ Streak/meal counters increment
  ├─ Undo snackbar (6s)
  └─ If the done event was the day's last → celebratory but restrained
     "Day complete. Tomorrow's plan is ready."  (no confetti for a routine)
```

---

## 3. Meal detail — the six-beat sheet

Tapping any meal (in timeline, meals tab, or notification) opens the same `MealDetailSheet`.

```
Meal sheet
  ├─ Header: meal name · window (08:30–09:45) · slot icon
  ├─ Portions        → HOW MUCH   [–] 2 rotis [+]  ← portion scales the whole meal
  ├─ Ingredients     → WHAT       (name · grams · kcal · protein · ₹)
  ├─ How to prepare  → HOW        numbered steps, max 6, "≈15 min"
  ├─ Why this helps  → WHY        mechanism, never a claim
  ├─ Cost            → COST       "₹30–45 approx"  [Update local price]
  ├─ Alternatives    → FLEXIBILITY
  │     ├─ Vegetarian   (already veg → hidden, don't show dead options)
  │     ├─ Budget       rice → 2–3 rotis · curd → buttermilk
  │     ├─ Allergy-safe only when relevant
  │     └─ Seasonal     "guava ₹18/kg — apple ₹140/kg this week"
  ├─ Food safety     → shown for egg/chicken/dairy/cut produce, collapsible
  └─ Actions:  [✓ Done]  [Skip…]  [Change portion]  [Report issue]
```

**Portion editing is relative, not absolute.** Stepping from 1 cup to 1.25 cup adjusts protein, cost and
prep proportionally, and shows the delta inline ("+45 kcal · +₹4"). Users think in "a bit more", not
grams.

---

## 4. Skip → reason → substitute

Skipping is a first-class path, not an error state. The reason question is a single screen, six large
options, no typing required (`Other` reveals an optional textarea).

```
Tap [Skip…]
  └─ Sheet: "Why are you skipping?"  ← neutral, not "You failed lunch"
       [Not hungry]  [No time]  [Food unavailable]
       [Didn't like it]  [Forgot]  [Other…]

  not_hungry    → "No problem. Here's a lighter version:"
                  portions scaled to 0.6× · logged as eaten-at-0.6 · [Take this instead]

  no_time       → "5-minute version:" same foods, prep steps filtered to ≤5 min
                  e.g. breakfast → "2 boiled eggs (already boiled) + 1 banana + 2 rotis, no cooking"

  unavailable   → "Can't find dal today?" → ranked substitutes from the same
                  protein group, filtered by budget and season:
                  [Chana (₹28/kg, in season)] [Soy chunks (₹42/kg)]
                  [Moong dal (₹96/kg)]  → one tap swaps, cost recalculated

  disliked      → 3 alternatives + [Never suggest this again] → writes diet.neverAgain

  forgot        → if window still open: "Ready now — takes 10 min" [Do it now]
                  if closed: "Added to tomorrow's prep note" + optional prep suggestion

  other         → free text → logged; patterns surface in Weekly Review
```

Every path ends in **a food decision**, never in a dead end. A user who skips always leaves with a
concrete next action. This is the difference between a diet app that gets abandoned in week 2 and one
that gets opened daily.

---

## 5. Grocery flow

```
Today → SHOPPING section
  ├─ "Today's grocery" — only what isn't already in your pantry
  ├─ Grouped: Protein · Vegetables · Fruit · Staples · Fats
  ├─ Per item: emoji · name · buy quantity · ₹ · used in which meals · storage note
  ├─ Total: ₹98 approx   vs budget ₹120  → "₹22 under budget today"
  └─ [Check off items you already have]
        └─ item flips to owned → removed from total → "Roti and dal already in your
           kitchen. ₹34 not needed." → written to pantry so it stops recurring

Grocery tab
  ├─ Daily tab  (today's list + tomorrow's preview)
  └─ Weekly tab (grouped planner)
        ├─ Quantity aggregated across 7 days, purchase-pack aware
        │   (don't tell them to buy 340 g of dal — sell it in 1 kg)
        ├─ Expected days of use + storage → anti-waste
        ├─ Per-category subtotal + total + per-day cost + budget line
        └─ Waste notes: "Buy spinach for 2 meals, not 7 — it will spoil."
```

---

## 6. Declared condition → advisory mode

Triggered by `diet`/`health` intake at onboarding, or later in Settings → Health.

```
User declares: diabetes / kidney disease / pregnancy / eating disorder /
               serious allergy / significant GI symptoms
  └─ Immediate, non-dismissible-for-session banner:

      ⚠ Before you change anything
      Your plan here is general food guidance — not a treatment plan for
      [diabetes]. Portion and sugar amounts for your condition should come
      from a doctor or registered dietitian.
      [Find a dietitian near me]  [I understand]

  └─ Plan still renders (blank help helps nobody) but:
       · every meal carries a small "general guidance" chip
       · hydration target flags the fluid-restriction safety note
       · sugar/refined-carb items are demoted, never removed (removal = prescribing)
       · NO portion auto-adjustment, NO condition-specific targets, NO risk scoring

  └─ Eating-disorder declaration additionally raises a resource banner
     (practitioner referral + crisis-line pointer) and the app suppresses
     calorie targets and streak pressure entirely.
```

The distinction that matters: **this app removes friction and uncertainty; it does not compute medical
plans.** The engineering consequence is that the domain layer has *no branches on conditions for
mathematics* — it only branches for wording and warnings. This is tested in `tests/safety.test.ts`.

---

## 7. Missed day / streak break

Discipline without shame. Streaks exist to build habits, not to punish a single bad day.

```
Open after a missed day
  ├─ Streak chip shows "🔥 0-day streak · best 6" — never a red X
  ├─ Yesterday's row in Weekly Review: "3 of 4 meals completed"
  ├─ One suggestion, concrete and small:
  │     "Breakfast was the meal you skipped most this week.
  │      Tomorrow's is 5 minutes — 2 eggs, banana, rotis."
  └─ [Adjust tomorrow's plan]  deep-links to the relevant setting

Rules
  · Streak resets on a *day with zero completed items*, not on a partial day
  · 2–4 of 5 meals completed still counts as a successful day (threshold 40%)
  · Best streak is retained and celebrated when the current one is beaten
  · Never show a loss animation, never say "you failed", never streak-shaming copy
```

---

## 8. Settings / profile change → plan reflow

The user is allowed to change their mind at any time, cheaply, and see consequences immediately.

```
Settings → Profile → change any input
  └─ Banner: "Your plan will be rebuilt for today and tomorrow."
     [Rebuild now]  [Later]

Settings → Prices → edit any food's local price
  └─ "Today's cost estimate updates immediately. Future plans use ₹45/kg for dal."

Settings → Notifications
  ├─ Category toggles (meals / water / exercise / sleep / motivation)
  ├─ Quiet hours (with wrap-past-midnight support)
  ├─ Snooze length, daily cap
  ├─ Permission state with contextual primary button:
  │     default → [Enable browser reminders]
  │     denied  → "Blocked in browser settings. Reminders will show in-app."
  │              [How to allow]  (with platform-specific instructions)
  └─ Live preview: "You'll get about 8 reminders/day. None between 22:30–06:30."

Settings → Data
  ├─ [Export all my data (.json)]     ← mandatory exit
  ├─ [Reset today's plan]
  └─ [Delete everything]  → type-to-confirm "DELETE" → wipe IndexedDB + localStorage
```

---

## 9. Notification flows (system-level)

```
Permission not yet asked
  └─ Never on first visit. Asked contextually, after the user completes their
     first meal ("Want a nudge at lunch time?") — contextual asks convert far better.

Granted
  └─ 08:30  🍳 Breakfast time
            "2 eggs + 2 rotis + 1 banana. Takes 10 minutes."
            [Done] [Skip] [Change]
  └─ 11:30  🍊 Fruit time — "Today's fruit: guava. One serving + some water."
  └─ 13:30  🍛 Lunch — "Dal, rice, seasonal sabzi, curd."  [View meal]
  └─ 17:00  🥜 Snack — "Roasted chana + peanuts."          [View]
  └─ 18:30  🏃 Movement time — "20–30 minutes."            [Start]
  └─ 20:30  🍲 Dinner — "2 rotis + dal + vegetables."
  └─ 22:30  🌙 Wind-down — "Dim screens, finish heavy tasks."
  └─ Sleep window respects quiet hours — never wakes the user.

[Skip] from a notification
  └─ Opens the reason sheet (same as in-app) → substitute offered
  └─ Notification dismissed, event marked skipped, next reminder unaffected

[Snooze] from a notification
  └─ +10 / +20 / +30 / custom → event promoted to NOW in-app

Denied / unsupported / insecure context
  └─ Degrades to in-app banners on Today. Zero loss of functionality.
```

---

## 10. Offline & error flows

```
Offline, returning user
  └─ App opens from cache. Today renders fully from the stored DaySnapshot.
     Subtle "You're offline — showing your saved plan" strip.

Offline, first visit, no cache
  └─ Honest empty state: "Connect once to set up your plan."
     Nothing fake, no infinite spinner.

Storage unavailable (private mode / quota)
  └─ Silent fallback to in-memory + localStorage mirror
  └─ Non-blocking toast: "Progress won't be saved after you close this tab."

Network failure on any future sync layer
  └─ Optimistic local write succeeds; sync retries with backoff; conflict-free by design
     (last-write-wins per field, local edits always win)

Unexpected error
  └─ Error boundary per route → plain-language message → [Reload] [Reset today's plan]
     Never a stack trace in the UI. Error id logged for support.
```

---

## 11. Flow principles

| Principle | Implementation |
| --- | --- |
| Answer before asking | NOW card is the first rendered element on Today |
| One decision per screen | 6 onboarding steps, each with 1–2 inputs |
| Never a dead end | Every skip reason terminates in a concrete food action |
| Optimistic + undo | 6-second undo on all completion actions |
| No shame language | Zero words like "fail", "missed", "cheat", "guilty" in any string |
| Honest about estimates | Every nutrition/cost value is a range with an "approx." label |
| Reversible | Every destructive action is confirmed; every data edit is exported |
| Degrades gracefully | No permission, no network, no storage → still a useful day view |
| Mobile-first | One-handed reach: primary actions in the bottom third; bottom nav within thumb arc |
