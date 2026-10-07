'use client';

/**
 * Today.
 *
 * Reads everything from the `DayResult` the pipeline produced — this file makes no
 * calculations of its own. If a number appears here, it came from the domain.
 */

import { useState, type ReactNode } from 'react';
import {
  Activity,
  Apple,
  BadgeIndianRupee,
  ChevronDown,
  Clock,
  Cookie,
  Droplets,
  Flame,
  Leaf,
  Moon,
  MoonStar,
  RotateCcw,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Sunrise,
  Timer,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { QUICK_ADD_ML, useAppStore } from '@/lib/app/store';
import { formatCost, totalCost } from '@/lib/domain/budget';
import { budgetLine } from '@/lib/domain/grocery';
import { formatCountdown, formatDuration, formatMinute, humanDate, shortDate } from '@/lib/domain/time';
import { DISCLAIMER_SHORT } from '@/lib/domain/safety';
import { SLEEP_DISCLAIMER } from '@/lib/domain/sleep';
import { skipOptionsFor } from '@/lib/domain/meals';
import type { Meal, MealSlot, SkipReason, TimelineEvent } from '@/lib/domain/types/index';
import { Badge, Button, Card, EmptyState, Eyebrow, Meter, Pill, Ring, SectionTitle, Stat } from './ui';
import { BrandMark } from './brand';
import { Sheet } from './sheet';

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  fruit: 'Fruit',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

const SLOT_TONE: Record<MealSlot, 'accent' | 'warm' | 'calm' | 'plum'> = {
  breakfast: 'warm',
  fruit: 'plum',
  lunch: 'accent',
  snack: 'calm',
  dinner: 'plum',
};

const SLOT_ICON: Record<MealSlot, LucideIcon> = {
  breakfast: Sunrise,
  fruit: Apple,
  lunch: Utensils,
  snack: Cookie,
  dinner: MoonStar,
};

/** Reasons offered when someone skips a meal. Plain words, no judgement. */
const SKIP_REASONS: readonly { readonly value: SkipReason; readonly label: string }[] = [
  { value: 'not-hungry', label: 'Not hungry' },
  { value: 'no-time', label: 'No time' },
  { value: 'unavailable', label: 'Could not get it' },
  { value: 'disliked', label: 'Did not want it' },
  { value: 'forgot', label: 'Forgot' },
];

function NowCard({
  event,
  tone,
  countdown,
}: {
  readonly event: TimelineEvent | null;
  readonly tone: string;
  readonly countdown: string;
}): ReactNode {
  if (!event) {
    return (
      <Card tone="accent" className="overflow-hidden">
        <div className="flex items-center gap-2">
          <Pill tone="accent" icon={<Leaf size={12} />}>
            Free time
          </Pill>
        </div>
        <h2 className="mt-2.5 text-xl font-semibold tracking-tight text-ink">Nothing scheduled right now</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Enjoy the gap. The next thing appears here when it is time, and your plan stays put either way.
        </p>
      </Card>
    );
  }
  const live = tone === 'live';
  return (
    <Card className="edge-light overflow-hidden border-0 p-0 shadow-[var(--shadow-float)]">
      <div className="wash-accent relative px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] ${
              live ? 'bg-accent text-[var(--color-accent-ink)]' : 'bg-surface text-ink-2 ring-1 ring-inset ring-line'
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full bg-current ${live ? 'animate-pulse-ring' : 'animate-breathe'}`}
            />
            {live ? 'Happening now' : 'Coming up'}
          </span>
          <span className="nums inline-flex items-center gap-1 text-xs font-medium text-ink-2">
            <Clock size={12} aria-hidden />
            {formatMinute(event.startMinute)}–{formatMinute(event.endMinute)}
          </span>
        </div>

        <h2 className="mt-3 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-balance text-ink">
          <Badge tone="accent" size="md">
            {event.emoji}
          </Badge>
          <span className="min-w-0">{event.title}</span>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{event.detail}</p>
      </div>

      {event.actions.length > 0 ? (
        <ul className="grid gap-2 px-5 pt-4">
          {event.actions.map((action) => (
            <li key={action} className="flex items-start gap-2.5 text-sm text-ink">
              <span
                aria-hidden
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
              >
                <Leaf size={10} strokeWidth={2.5} />
              </span>
              {action}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <p className="text-xs leading-relaxed text-ink-3">{event.why}</p>
        <span className="nums shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-2">
          {live ? `Started ${countdown} ago` : countdown}
        </span>
      </div>
    </Card>
  );
}

function MealCard({
  meal,
  event,
  done,
  onComplete,
  onSkip,
}: {
  readonly meal: Meal;
  readonly event: TimelineEvent | null;
  readonly done: boolean;
  readonly onComplete: () => void;
  readonly onSkip: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const SlotIcon = SLOT_ICON[meal.slot];
  return (
    <Card
      as="li"
      className={`overflow-hidden ${done ? 'bg-surface-2/70' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Badge tone={SLOT_TONE[meal.slot]} size="md">
            <SlotIcon size={18} strokeWidth={2} />
          </Badge>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Eyebrow>{SLOT_LABEL[meal.slot]}</Eyebrow>
              <span aria-hidden className="text-ink-4">
                ·
              </span>
              <span className="nums inline-flex items-center gap-1 text-[0.6875rem] font-medium text-ink-3">
                <Clock size={11} aria-hidden />
                {formatMinute(meal.startMinute)}
              </span>
              {done ? <Pill tone="accent">Done</Pill> : null}
            </div>
            <h3 className="mt-1 text-[0.9375rem] font-semibold leading-snug text-ink">{meal.title}</h3>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-2">{meal.subtitle}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="nums inline-flex items-center gap-0.5 text-sm font-semibold text-ink">
            <BadgeIndianRupee size={13} aria-hidden />
            {formatCost(meal.cost).replace(/₹/g, '')}
          </p>
          <p className="nums mt-0.5 text-[0.6875rem] text-ink-3">{Math.round(meal.nutrition.calories)} kcal</p>
        </div>
      </div>

      <ul className="mt-4 grid gap-2 rounded-md bg-surface-2/70 p-3">
        {meal.ingredients.map((item) => (
          <li key={item.foodKey} className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="text-ink">
              <span aria-hidden>{item.emoji} </span>
              {item.name}
              {item.allergenNote ? <span className="ml-1 text-xs text-warm">{item.allergenNote}</span> : null}
            </span>
            <span className="nums shrink-0 text-xs text-ink-3">{item.portion.label}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />
        {meal.whyItMatters}
      </p>
      {meal.foodSafetyNote ? (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-warm-soft px-3 py-2 text-xs leading-relaxed text-ink">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-warm" aria-hidden />
          {meal.foodSafetyNote}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={onComplete} variant={done ? 'secondary' : 'primary'} size="sm">
          {done ? 'Undo done' : 'Mark done'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={done}>
          Skip
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="ml-auto"
        >
          <span className="inline-flex items-center gap-1.5">
            <Timer size={14} aria-hidden />
            {open ? 'Less' : `How (${formatDuration(meal.prepMinutes)})`}
            <ChevronDown
              size={14}
              aria-hidden
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </Button>
      </div>

      <div className="expand" data-open={open}>
        <div>
          <div className="mt-4 rounded-md border border-line bg-surface-2/60 p-4">
            <Eyebrow>How to make it</Eyebrow>
            <ol className="mt-2 grid gap-2">
              {meal.prepSteps.map((step, index) => (
                <li key={step} className="flex gap-3 text-[0.8125rem] leading-relaxed text-ink">
                  <span className="nums flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[0.6875rem] font-semibold text-ink-2">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            {meal.alternatives.length > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-xs font-semibold text-ink">If you cannot get this</p>
                <ul className="mt-1.5 grid gap-1.5">
                  {meal.alternatives.map((alt) => (
                    <li key={alt.label} className="text-xs leading-relaxed text-ink-2">
                      <span className="font-semibold text-ink">{alt.label}:</span> {alt.note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {event ? <p className="mt-3 text-xs leading-relaxed text-ink-4">{event.why}</p> : null}
    </Card>
  );
}

export function Today(): ReactNode {
  const store = useAppStore();
  const [skipping, setSkipping] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const { day, today, nowMinute, state } = store;

  if (!day) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <Card>
          <p className="text-sm text-ink-2">Preparing your day…</p>
        </Card>
      </div>
    );
  }

  const { resolution, plan, snapshot } = day;
  const progress = snapshot.progress;
  const advisory = snapshot.advisory;
  // The same capped figure the meter uses, so the header and the bar can never
  // disagree about how much has been drunk.
  const hydration = day.consumedMl;
  const groceryToBuy = snapshot.grocery.filter((item) => item.purchaseRequired && !item.owned);
  const groceryCost = totalCost(groceryToBuy.map((item) => item.estimatedCost));
  const budget = budgetLine(Math.round(plan.totalCost.value), state.settings.dailyBudget);
  const budgetTone = budget.tone === 'over' ? 'alert' : budget.tone === 'under' ? 'accent' : 'warm';
  const skipOptions = skipping
    ? skipOptionsFor(skipping as MealSlot, {
        profile: store.profile!,
        diet: state.diet,
        date: today,
        season: day.season,
        pantry: Object.keys(state.pantry) as never,
        dailyBudget: state.settings.dailyBudget,
        priceOverrides: state.localPriceOverrides,
        targets: { calories: day.targets.calories.value, protein: day.targets.protein.value },
        isRestDay: false,
      })
    : [];
  const skippingMeal = skipping ? plan.meals.find((m) => m.slot === skipping) ?? null : null;
  const skippingEvent = skippingMeal
    ? snapshot.schedule.events.find((e) => e.mealId === skippingMeal.id) ?? null
    : null;
  const skippingEventId =
    skippingEvent?.id ?? (skippingMeal ? `${today}:meal:${skippingMeal.id}` : null);

  const doneIds = new Set(
    Object.entries(state.completedEvents)
      .filter(([, d]) => d === today)
      .map(([id]) => id),
  );
  // The movement event is the one non-meal thing the day counts towards "done".
  const exerciseEvent = snapshot.schedule.events.find((e) => e.kind === 'exercise') ?? null;
  const exerciseDone = exerciseEvent !== null && doneIds.has(exerciseEvent.id);
  const windDownLogged = state.sleep.some((s) => s.date === today);

  const doneCount = resolution.completedCount;
  const totalCount = resolution.totalCount;
  const allDone = totalCount > 0 && doneCount >= totalCount;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark size={34} />
          <div>
            <Eyebrow>{humanDate(today)}</Eyebrow>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">
              {store.profile?.name ? `${store.profile.name}, here is today` : 'Here is today'}
            </h1>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setResetting(true)} aria-label="Settings and reset">
          <RotateCcw size={15} aria-hidden />
          <span className="sr-only sm:not-sr-only">Reset</span>
        </Button>
      </header>

      {!store.canPersist ? (
        <Card tone="warm" className="mb-4">
          <p className="text-sm leading-relaxed text-ink">
            This browser is blocking local storage, so today&rsquo;s plan will disappear when you close the tab.
            Private browsing is the usual cause.
          </p>
        </Card>
      ) : null}

      {advisory.active ? (
        <Card tone="calm" className="mb-4">
          <SectionTitle title="We have softened some numbers" icon={<ShieldCheck size={16} className="text-calm" />} />
          <ul className="mt-2.5 grid gap-2">
            {advisory.copy.map((line) => (
              <li key={line.condition} className="text-[0.8125rem] leading-relaxed text-ink">
                <span className="font-semibold">{line.headline}:</span> {line.body}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="stack-8">
        <NowCard
          event={resolution.nowEvent}
          tone={resolution.tone}
          countdown={
            resolution.minutesUntilNext !== null ? formatCountdown(resolution.minutesUntilNext) : 'nothing else today'
          }
        />

        <section aria-labelledby="today-progress" className="stagger">
          <h2 id="today-progress" className="sr-only">
            Where you are
          </h2>
          <Card>
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
              <Ring
                value={progress.overall}
                label="Where you are"
                caption="Meals, water, movement and sleep"
              />
              <div className="w-full min-w-0 flex-1">
                <SectionTitle
                  title="Where you are"
                  hint={progress.disclaimer}
                  action={
                    allDone ? (
                      <Pill tone="accent">All done</Pill>
                    ) : (
                      <Pill tone="neutral">{Math.round(progress.overall * 100)}%</Pill>
                    )
                  }
                />
                <div className="mt-4 grid gap-4">
                  <Meter
                    value={progress.nutrition.value}
                    label="Meals"
                    detail={progress.nutrition.detail}
                    suffix={`${progress.mealsDone}/${progress.mealsTotal}`}
                  />
                  <Meter
                    value={progress.hydration.value}
                    label="Water"
                    detail={progress.hydration.detail}
                    tone="calm"
                  />
                  <Meter
                    value={progress.exercise.value}
                    label="Movement"
                    detail={progress.exercise.detail}
                    tone="warm"
                  />
                  <Meter
                    value={progress.sleep.value}
                    label="Sleep routine"
                    detail={progress.sleep.detail}
                    tone="calm"
                  />
                </div>
              </div>
            </div>
            <p className="nums mt-4 border-t border-line pt-3 text-xs text-ink-3">
              {doneCount} of {totalCount} things done today
            </p>
          </Card>
        </section>

        <section aria-labelledby="today-water">
          <h2 id="today-water" className="sr-only">
            Water
          </h2>
          <Card>
            <SectionTitle
              title="Water"
              hint={day.hydrationTarget.basis}
              icon={<Droplets size={16} className="text-calm" />}
              action={
                <span className="nums text-sm font-semibold text-ink">
                  {hydration}
                  <span className="text-xs font-medium text-ink-3"> of {day.hydrationTarget.targetMl} ml</span>
                </span>
              }
            />
            <Meter
              value={progress.hydration.value}
              label="Drunk so far"
              tone="calm"
              suffix={`${Math.round(progress.hydration.value * 100)}%`}
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {QUICK_ADD_ML.map((ml) => (
                <Button
                  key={ml}
                  variant="secondary"
                  onClick={() => store.addWater(ml, today, nowMinute)}
                  className="nums"
                >
                  +{ml} ml
                </Button>
              ))}
            </div>
            {day.hydrationTarget.consultNote ? (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-calm-soft px-3 py-2 text-xs leading-relaxed text-ink">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-calm" aria-hidden />
                {day.hydrationTarget.consultNote}
              </p>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="today-meals">
          <h2 id="today-meals" className="sr-only">
            Your food for today
          </h2>
          <div className="flex items-end justify-between gap-3">
            <div>
              <SectionTitle
                title="Your food for today"
                hint={`${formatCost(plan.totalCost)} · ${budget.detail}`}
                icon={<Flame size={16} className="text-warm" />}
              />
            </div>
            <Pill tone={budgetTone}>{budget.tone === 'over' ? 'Over budget' : 'Within budget'}</Pill>
          </div>
          <ul className="stagger mt-3 grid gap-3">
            {plan.meals.map((meal) => {
              const event = snapshot.schedule.events.find((e) => e.mealId === meal.id) ?? null;
              const eventId = event?.id ?? `${today}:meal:${meal.id}`;
              return (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  event={event}
                  done={doneIds.has(eventId)}
                  onComplete={() => {
                    if (doneIds.has(eventId)) store.uncompleteEvent(eventId);
                    else store.completeEvent(eventId, today);
                  }}
                  onSkip={() => setSkipping(meal.slot)}
                />
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="today-grocery">
          <h2 id="today-grocery" className="sr-only">
            Shopping list
          </h2>
          <Card>
            <SectionTitle
              title="Shopping list"
              hint={`${groceryToBuy.length} to buy · ${formatCost(groceryCost)} estimated`}
              icon={<ShoppingBasket size={16} className="text-accent" />}
              action={<Pill tone="neutral">{groceryToBuy.length}</Pill>}
            />
            {groceryToBuy.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon="🧺"
                  title="Nothing to buy"
                  detail="Everything in today&rsquo;s plan is already in your kitchen."
                />
              </div>
            ) : (
              <ul className="stagger mt-4 grid gap-2">
                {groceryToBuy.slice(0, 8).map((item) => {
                  const owned = Object.keys(state.pantry).includes(item.foodKey);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => store.togglePantry(item.foodKey)}
                        aria-pressed={owned}
                        className="press focus-ring flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left hover:border-line hover:bg-surface-2"
                      >
                        <span
                          aria-hidden
                          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-lg transition-colors ${
                            owned ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink'
                          }`}
                        >
                          {item.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[0.8125rem] font-medium ${owned ? 'text-ink-3 line-through' : 'text-ink'}`}>
                            {item.name}
                          </span>
                          {item.seasonalNote ? (
                            <span className="block text-[0.6875rem] text-ink-3">{item.seasonalNote}</span>
                          ) : null}
                        </span>
                        <span className="nums shrink-0 text-right text-xs text-ink-3">
                          {item.buyUnitLabel}
                          <span className="mx-1.5 text-ink-4" aria-hidden>
                            ·
                          </span>
                          <span className="font-semibold text-ink-2">{formatCost(item.estimatedCost)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {groceryToBuy.length > 8 ? (
              <p className="mt-3 text-xs text-ink-3">
                Plus {groceryToBuy.length - 8} more from this week&rsquo;s plan.
              </p>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="today-move">
          <h2 id="today-move" className="sr-only">
            Movement
          </h2>
          <Card>
            <SectionTitle
              title={day.workout.name}
              hint={`${day.workout.totalMinutes} min · ${day.workout.noGymNote}`}
              icon={<Activity size={16} className="text-warm" />}
              action={
                <span className="nums inline-flex items-center gap-1 text-sm font-semibold text-ink">
                  <Timer size={14} aria-hidden />
                  {day.workout.totalMinutes}m
                </span>
              }
            />
            <ol className="stagger mt-4 grid gap-2">
              {day.workout.blocks.map((block) => (
                <li
                  key={block.id}
                  className="flex items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2.5"
                >
                  <Badge tone="warm" size="sm">
                    {block.emoji}
                  </Badge>
                  <span className="min-w-0 flex-1 text-[0.8125rem] font-medium text-ink">{block.name}</span>
                  <span className="nums shrink-0 text-xs text-ink-2">
                    {block.sets ? `${block.sets}×` : ''}
                    {block.reps ?? (block.holdSeconds ? `${block.holdSeconds}s` : `${block.minutes} min`)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
              <TrendingUp size={13} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />
              {day.workout.whyItMatters}
            </p>
            {exerciseEvent ? (
              <div className="mt-4 border-t border-line pt-3">
                <Button
                  size="sm"
                  variant={exerciseDone ? 'secondary' : 'primary'}
                  onClick={() => {
                    if (!exerciseEvent) return;
                    if (exerciseDone) store.uncompleteEvent(exerciseEvent.id);
                    else store.completeEvent(exerciseEvent.id, today);
                  }}
                >
                  {exerciseDone ? 'Undo done' : 'Mark movement done'}
                </Button>
              </div>
            ) : null}
          </Card>
        </section>

        <section aria-labelledby="today-sleep">
          <h2 id="today-sleep" className="sr-only">
            Tonight
          </h2>
          <Card>
            <SectionTitle
              title="Tonight"
              hint={`Around ${formatMinute(day.sleepPlan.targetBedMinute)}`}
              icon={<Moon size={16} className="text-plum" />}
            />
            <ol className="mt-4 grid gap-0">
              {day.sleepPlan.ladder.map((step, index) => (
                <li key={step.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden
                      className={`mt-0.5 size-2.5 rounded-full ring-4 ring-surface ${
                        index === 0 ? 'bg-plum' : 'bg-line-strong'
                      }`}
                    />
                    {index < day.sleepPlan.ladder.length - 1 ? (
                      <span aria-hidden className="w-px flex-1 bg-line" />
                    ) : null}
                  </div>
                  <div className="pb-4">
                    <span className="nums block text-[0.6875rem] font-semibold text-ink-3">
                      {formatMinute(step.minute)}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] font-medium text-ink">
                      <span aria-hidden>{step.emoji} </span>
                      {step.title}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Button
                size="sm"
                variant={windDownLogged ? 'secondary' : 'primary'}
                onClick={() => store.logSleep(today, !windDownLogged)}
              >
                {windDownLogged ? 'Undo wind-down' : 'Mark wind-down done'}
              </Button>
            </div>
            <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-3">
              <Moon size={13} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />
              {SLEEP_DISCLAIMER}
            </p>
          </Card>
        </section>
      </div>

      <footer className="mt-8 hairline flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="max-w-md text-xs leading-relaxed text-ink-3">{DISCLAIMER_SHORT}</p>
        <div className="shrink-0">
          <Stat value={shortDate(today)} label="saved on this device" />
        </div>
      </footer>

      <Sheet
        open={skipping !== null}
        title={skipping ? `Skipping ${SLOT_LABEL[skipping as MealSlot]}?` : ''}
        description="Pick something instead — nothing here is a lecture."
        onClose={() => setSkipping(null)}
      >
        {skipOptions.length > 0 ? (
          <ul className="grid gap-2">
            {skipOptions.map((option) => (
              <li key={option.headline}>
                <button
                  type="button"
                  onClick={() => {
                    if (skippingEventId) {
                      store.skipEvent(skippingEventId, today, skipping as MealSlot, 'not-hungry');
                    }
                    setSkipping(null);
                  }}
                  className="press focus-ring w-full rounded-md border border-line bg-surface p-3.5 text-left hover:border-accent-line hover:bg-accent-soft"
                >
                  <span className="block text-sm font-semibold text-ink">{option.headline}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{option.detail}</span>
                  <span className="nums mt-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      <Timer size={11} aria-hidden />
                      {formatDuration(option.minutesToPrepare)}
                    </span>
                    {option.costDelta !== 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <BadgeIndianRupee size={11} aria-hidden />
                        {option.costDelta < 0 ? 'saves' : 'costs'}{' '}
                        {formatCost({
                          value: Math.abs(option.costDelta),
                          range: { low: Math.abs(option.costDelta), high: Math.abs(option.costDelta) },
                          basis: 'derived',
                          confidence: 'medium',
                        })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="🍽️"
            title="No swap needed"
            detail="There is nothing better to suggest for this one — eating it as planned is fine."
          />
        )}
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-xs font-semibold text-ink">Or just tell us why</p>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((reason) => (
              <Button
                key={reason.value}
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (skippingEventId) {
                    store.skipEvent(skippingEventId, today, skipping as MealSlot, reason.value);
                  }
                  setSkipping(null);
                }}
              >
                {reason.label}
              </Button>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet
        open={resetting}
        title="Start over?"
        description="This clears your profile and every plan saved on this device. It cannot be undone."
        onClose={() => setResetting(false)}
      >
        <div className="grid gap-2">
          <Button
            variant="danger"
            onClick={() => {
              store.reset();
              setResetting(false);
            }}
          >
            Yes, clear everything
          </Button>
          <Button variant="secondary" onClick={() => setResetting(false)}>
            Keep my data
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
