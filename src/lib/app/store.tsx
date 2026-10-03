'use client';

/**
 * App store.
 *
 * A thin reducer over `PersistedShape` plus a derived `DayResult` from the pure
 * pipeline. No business rules live here: actions only record *what the user did*,
 * and every screen reads from `buildDay()` output. That is what keeps the UI and
 * the domain from drifting apart.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import { buildDay, type DayInputs, type DayResult } from '@/lib/domain/pipeline';
import { historyFromSnapshots, ROTATION_WINDOW_DAYS } from '@/lib/domain/rotation';
import { archiveDay } from '@/lib/domain/planArchive';
import { typicalDailyCost } from '@/lib/domain/costProjection';
import { blankState, type PersistedShape } from '@/lib/domain/state';
import {
  dayOfWeekFor,
  localMinuteOfDay,
  monthFor,
  toCalendarDay,
} from '@/lib/domain/time';
import type {
  CalendarDay,
  DietPreference,
  EngineContext,
  FoodKey,
  HealthPreference,
  HydrationEntry,
  MinuteOfDay,
  Portion,
  Profile,
  SkipLog,
  SkipReason,
  UserSettings,
  WeatherKind,
} from '@/lib/domain/types/index';
import { getFood } from '@/lib/domain/data/foods';
import { clearState, loadStateAsync, saveState, storageAvailable } from '@/lib/repo/storage';

export const APP_TZ = 'Asia/Kolkata';
export const QUICK_ADD_ML = [250, 500, 750] as const;

type Action =
  | { readonly type: 'replace'; readonly state: PersistedShape }
  | { readonly type: 'update'; readonly fn: (prev: PersistedShape) => PersistedShape };

function reducer(state: PersistedShape, action: Action): PersistedShape {
  return action.type === 'replace' ? action.state : action.fn(state);
}

type EditableProfile = Partial<
  Pick<Profile, 'name' | 'city' | 'state' | 'goal' | 'exerciseMinutesPerDay' | 'fitnessLevel' | 'hasGymAccess' | 'showBmi'>
>;

export interface AppStore {
  readonly state: PersistedShape;
  readonly ready: boolean;
  readonly canPersist: boolean;
  readonly today: CalendarDay;
  readonly nowMinute: MinuteOfDay;
  readonly day: DayResult | null;
  /** Today plus the next six days, each derived through the same pipeline. */
  readonly upcoming: readonly DayResult[];
  readonly profile: Profile | null;
  completeOnboarding(payload: {
    readonly profile: Profile;
    readonly diet: DietPreference;
    readonly health: HealthPreference;
    readonly settings: UserSettings;
  }): void;
  completeEvent(eventId: string, day: CalendarDay): void;
  skipEvent(eventId: string, day: CalendarDay, slot: SkipLog['slot'], reason: SkipReason): void;
  uncompleteEvent(eventId: string): void;
  togglePantry(key: FoodKey): void;
  addWater(ml: number, day: CalendarDay, minute: MinuteOfDay): void;
  /** Editable from the You tab. Both reflow the plan through buildDay(). */
  updateProfile(patch: EditableProfile): void;
  updateSettings(patch: Partial<UserSettings>): void;
  reset(): void;
}

/** Local storage is bounded; keep a season of plans, not a year. */
const SNAPSHOT_RETENTION_DAYS = 90;

/**
 * What the last few recorded days actually cost, newest first.
 *
 * Without this the weekly and monthly figures are just today's plan times seven,
 * which is a multiplication dressed up as a projection. A real average is the
 * honest basis, and `typicalDailyCost` says in its `basis` string which one is
 * being shown so the number never pretends to know more than it does.
 */
function recentSpend(snapshots: NonNullable<PersistedShape['snapshots']>): { date: string; rupees: number }[] {
  return Object.entries(snapshots)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, snapshot]) => ({
      date,
      rupees: snapshot.meals.reduce((sum, meal) => sum + (meal.cost?.value ?? 0), 0),
    }))
    .filter((entry) => entry.rupees > 0);
}

const StoreContext = createContext<AppStore | null>(null);

function contextAt(now: Date): EngineContext {
  return {
    now,
    tz: APP_TZ,
    weather: { kind: 'unknown' as WeatherKind },
    dayOfWeek: dayOfWeekFor(now, APP_TZ),
    month: monthFor(now, APP_TZ),
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Drop one key without leaving an unused binding behind. */
function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  if (!(key in record)) return { ...record };
  const next = { ...record };
  delete next[key];
  return next;
}

function pantryPortion(key: FoodKey): Portion {
  return getFood(key)?.defaultPortion ?? { grams: 100, gramsLow: 100, gramsHigh: 100, label: '100 g', unit: 'g' };
}

export function AppStoreProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [canPersist, setCanPersist] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [state, dispatch] = useReducer(reducer, null, () => blankState('1970-01-01'));

  // One-shot mount hydration. This has to be an effect: localStorage does not
  // exist on the server, so reading it during render would make the server and
  // client trees differ — the exact "flash of onboarding for a returning user"
  // this app must never show. The lint rule flags all setState-in-effect; here it
  // runs exactly once, before anything is interactive.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let live = true;
    const clock = new Date();
    setNow(clock);
    setCanPersist(storageAvailable());
    // The async read falls back to IndexedDB when localStorage is blocked, so a
    // returning user never has to answer the setup questions a second time.
    void loadStateAsync(toCalendarDay(clock, APP_TZ)).then((loaded) => {
      if (!live) return;
      dispatch({ type: 'replace', state: loaded });
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // One debounced write per burst of edits.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => saveState(state), 250);
    return () => window.clearTimeout(id);
  }, [state, ready]);

  // One clock for the app; the pipeline re-derives everything from it.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const today = now ? toCalendarDay(now, APP_TZ) : state._today;
  const nowMinute = now ? localMinuteOfDay(now, APP_TZ) : 0;
  const profile = state.profile;

  // One assembly point for pipeline inputs, so a future day and today can
  // never drift apart in how they are derived.
  const inputsFor = useCallback(
    (date: CalendarDay): DayInputs => ({
      // Rotation memory comes from recorded snapshots.
      profile: profile as Profile,
      diet: state.diet,
      health: state.health,
      settings: state.settings,
      pantry: Object.keys(state.pantry) as FoodKey[],
      priceOverrides: state.localPriceOverrides,
      hydration: state.hydration,
      workouts: state.workouts,
      sleep: state.sleep,
      skips: state.skips,
      doneEventIds: new Set(
        Object.entries(state.completedEvents)
          .filter(([, on]) => on === date)
          .map(([id]) => id),
      ),
      snoozed: new Map(Object.entries(state.snoozedUntil).map(([id, minute]) => [id, Number(minute)])),
      streak: 0,
      isRestDay: false,
      // Only days that were actually recorded feed rotation, and never today's
      // own plan — otherwise planning today would penalise the food it just chose.
      history: historyFromSnapshots(state.snapshots, ROTATION_WINDOW_DAYS, date),
      recentDailyCost: typicalDailyCost(recentSpend(state.snapshots)),
      availability: state.availability,
      dayPreference: state.dayPreferences[date],
      writtenAt: now ? now.toISOString() : '',
    }),
    [profile, state, now],
  );

  const day = useMemo<DayResult | null>(() => {
    if (!profile || !now) return null;
    return buildDay(inputsFor(today), contextAt(now));
  }, [inputsFor, profile, now, today]);

  // Record the day once it has been planned. Without this, `snapshots` stayed
  // empty forever and the anti-repetition memory had nothing to remember, so the
  // same meals came back every day.
  //
  // The decision lives in `archiveDay` so it can be proven idempotent. This
  // version of the logic sat inline and looped forever on a profile edit.
  useEffect(() => {
    if (!day) return;
    const decision = archiveDay({
      today,
      snapshot: day.snapshot,
      snapshots: state.snapshots,
      revisions: state.planRevisions,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
    });
    if (!decision.write) return;
    const { snapshots, revision } = decision;
    dispatch({
      type: 'update',
      fn: (prev) => ({
        ...prev,
        snapshots,
        ...(revision ? { planRevisions: { ...prev.planRevisions, [revision.date]: revision } } : {}),
      }),
    });
  }, [day, state.snapshots, state.planRevisions, today]);

  const upcoming = useMemo<readonly DayResult[]>(() => {
    if (!profile || !now) return [];
    const out: DayResult[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const at = new Date(now);
      at.setDate(at.getDate() + offset);
      out.push(buildDay(inputsFor(toCalendarDay(at, APP_TZ)), contextAt(at)));
    }
    return out;
  }, [inputsFor, profile, now]);

  const completeOnboarding = useCallback<AppStore['completeOnboarding']>((payload) => {
    dispatch({
      type: 'update',
      fn: (prev) => ({
        ...prev,
        profile: payload.profile,
        diet: payload.diet,
        health: payload.health,
        settings: payload.settings,
      }),
    });
  }, []);

  const completeEvent = useCallback(
    (eventId: string, date: CalendarDay) => {
      dispatch({
        type: 'update',
        fn: (prev) => {
          return {
            ...prev,
            completedEvents: { ...omitKey(prev.completedEvents, eventId), [eventId]: date },
            snoozedUntil: omitKey(prev.snoozedUntil, eventId),
            // Completing supersedes any earlier skip for the same event.
            skips: prev.skips.filter((s) => s.eventId !== eventId),
          };
        },
      });
    },
    [],
  );

  const skipEvent = useCallback(
    (eventId: string, date: CalendarDay, slot: SkipLog['slot'], reason: SkipReason) => {
      dispatch({
        type: 'update',
        fn: (prev) => {
          const log: SkipLog = {
            id: nextId('skip'),
            date,
            eventId,
            slot,
            reason,
            minute: localMinuteOfDay(new Date(), APP_TZ),
          };
          return {
            ...prev,
            completedEvents: omitKey(prev.completedEvents, eventId),
            skips: [...prev.skips.filter((s) => s.eventId !== eventId), log],
          };
        },
      });
    },
    [],
  );

  const uncompleteEvent = useCallback((eventId: string) => {
    dispatch({
      type: 'update',
      fn: (prev) => ({
        ...prev,
        completedEvents: omitKey(prev.completedEvents, eventId),
        skips: prev.skips.filter((s) => s.eventId !== eventId),
      }),
    });
  }, []);

  const togglePantry = useCallback((key: FoodKey) => {
    dispatch({
      type: 'update',
      fn: (prev) => {
        const pantry = { ...prev.pantry };
        if (pantry[key]) {
          delete pantry[key];
        } else {
          pantry[key] = { quantity: pantryPortion(key), updatedAt: new Date().toISOString() };
        }
        return { ...prev, pantry };
      },
    });
  }, []);

  const addWater = useCallback((ml: number, date: CalendarDay, minute: MinuteOfDay) => {
    dispatch({
      type: 'update',
      fn: (prev) => {
        const entry: HydrationEntry = {
          id: nextId('water'),
          date,
          minute,
          ml,
          source: 'quick-add',
        };
        // One entry per minute per amount, so a double tap is not two glasses.
        const deduped = prev.hydration.filter(
          (h) => !(h.date === date && h.minute === minute && h.ml === ml && h.source === 'quick-add'),
        );
        return { ...prev, hydration: [...deduped, entry] };
      },
    });
  }, []);

  const updateProfile = useCallback<AppStore['updateProfile']>((patch) => {
    if (!profile) return;
    dispatch({
      type: 'update',
      fn: (prev) => (prev.profile ? { ...prev, profile: { ...prev.profile, ...patch } } : prev),
    });
  }, [profile]);

  const updateSettings = useCallback<AppStore['updateSettings']>((patch) => {
    dispatch({ type: 'update', fn: (prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }) });
  }, []);

  const reset = useCallback(() => {
    // Both stores: leaving the IndexedDB mirror behind would let a reload
    // resurrect the profile the user just asked us to delete.
    clearState();
    dispatch({ type: 'replace', state: blankState(today) });
  }, [today]);

  const value: AppStore = {
    state,
    ready,
    canPersist,
    today,
    nowMinute,
    day,
    upcoming,
    profile,
    completeOnboarding,
    updateProfile,
    updateSettings,
    completeEvent,
    skipEvent,
    uncompleteEvent,
    togglePantry,
    addWater,
    reset,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useAppStore must be used inside <AppStoreProvider>');
  return store;
}
