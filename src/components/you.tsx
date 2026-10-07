'use client';

import type { AppStore } from '@/lib/app/store';
import { Button, Card, Field, SectionTitle, Stat, inputClass, selectClass } from './ui';
import { useMemo, useState } from 'react';
import {
  AGE_MAX,
  AGE_MIN,
  BUDGET_MAX,
  BUDGET_MIN,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  clampNumber,
  parseNumericText,
} from '@/lib/domain/units';
import { ACTIVITY_LABELS, GOAL_LABELS } from '@/lib/domain/nutrition';
import { DIET_LABELS } from '@/lib/domain/diet';
import { REGIONS } from '@/lib/domain/seasonal';
import type { ActivityLevel, DietType, FitnessGoal, Profile, Sex } from '@/lib/domain/types/index';

interface YouProps {
  readonly store: AppStore;
}

export function You({ store }: YouProps): React.ReactNode {
  const p = store.profile;
  const s = store.state.settings;
  const d = store.state.diet;
  const [name, setName] = useState(p?.name ?? '');
  // Text while editing. `Number(exercise) || 0` looked harmless but meant that
  // clearing the field and hitting Save wrote 0 minutes, with no warning.
  const [exercise, setExercise] = useState(String(p?.exerciseMinutesPerDay ?? 30));
  const [budget, setBudget] = useState(String(s.dailyBudget ?? 150));
  const [city, setCity] = useState(p?.city ?? '');
  const [stateName, setStateName] = useState(p?.state ?? '');
  // Core vitals live here too: a mistyped height used to be fixable only by
  // resetting the app and losing every recorded day.
  const [age, setAge] = useState(String(p?.age ?? 25));
  const [heightCm, setHeightCm] = useState(String(p?.heightCm ?? 165));
  const [weightKg, setWeightKg] = useState(String(p?.weightKg ?? 60));

  const bmi = useMemo(() => {
    if (!p) return null;
    const h = p.heightCm / 100;
    const v = p.weightKg / (h * h);
    return Math.round(v * 10) / 10;
  }, [p]);

  if (!p) return null;

  const save = (): void => {
    const nextExercise = parseNumericText(exercise);
    const nextBudget = parseNumericText(budget);
    const nextAge = parseNumericText(age);
    const nextHeight = parseNumericText(heightCm);
    const nextWeight = parseNumericText(weightKg, 1);
    store.updateProfile({
      name: name.trim() || p.name,
      city: city.trim() || p.city,
      state: stateName.trim() || p.state,
      ...(nextExercise !== null
        ? { exerciseMinutesPerDay: clampNumber(nextExercise, 0, 180) }
        : {}),
      ...(nextAge !== null ? { age: clampNumber(nextAge, AGE_MIN, AGE_MAX) } : {}),
      ...(nextHeight !== null ? { heightCm: clampNumber(Math.round(nextHeight), HEIGHT_CM_MIN, HEIGHT_CM_MAX) } : {}),
      ...(nextWeight !== null ? { weightKg: clampNumber(nextWeight, WEIGHT_KG_MIN, WEIGHT_KG_MAX) } : {}),
    });
    if (nextBudget !== null) {
      // Same 30–2000 range the onboarding form and the migration clamp use, so
      // saving here can never quietly shrink a budget the user already set.
      store.updateSettings({ dailyBudget: clampNumber(nextBudget, BUDGET_MIN, BUDGET_MAX) });
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">You</h1>
        <p className="text-sm text-ink-3">Tweak your preferences. The plan reflows immediately.</p>
      </header>

      <Card>
        <SectionTitle title="Quick profile" hint="Saved when you tap Save changes." />
        <div className="space-y-4">
          <Field label="Name">
            <input className={`${inputClass} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Age" hint="Years">
              <input
                type="number"
                inputMode="numeric"
                className={`${inputClass} nums w-full`}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                min={AGE_MIN}
                max={AGE_MAX}
              />
            </Field>
            <Field label="Exercise (minutes/day)">
              <input
                type="number"
                inputMode="numeric"
                className={`${inputClass} nums w-full`}
                value={exercise}
                onChange={(e) => setExercise(e.target.value)}
                min={0}
                max={180}
              />
            </Field>
            <Field label="Height" hint="cm">
              <input
                type="number"
                inputMode="decimal"
                className={`${inputClass} nums w-full`}
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                min={HEIGHT_CM_MIN}
                max={HEIGHT_CM_MAX}
              />
            </Field>
            <Field label="Weight" hint="kg">
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                className={`${inputClass} nums w-full`}
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                min={WEIGHT_KG_MIN}
                max={WEIGHT_KG_MAX}
              />
            </Field>
            <Field label="Daily budget (₹)">
              <input
                type="number"
                inputMode="numeric"
                className={`${inputClass} nums w-full`}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                min={BUDGET_MIN}
                max={BUDGET_MAX}
              />
            </Field>
            <Field label="Sex" hint="Used only for the energy formula">
              <select
                className={`${selectClass} w-full`}
                value={p.sex}
                onChange={(e) => store.updateProfile({ sex: e.target.value as Sex })}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="prefer-not-to-say">Prefer not to say</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <input className={`${inputClass} w-full`} value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="State">
              <input className={`${inputClass} w-full`} value={stateName} onChange={(e) => setStateName(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={save}>Save changes</Button>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Plan settings"
          hint="The engine rebuilds today's meals as soon as you change one of these."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="What you eat">
            <select
              className={`${selectClass} w-full`}
              value={d.dietType}
              onChange={(e) => store.updateDiet({ dietType: e.target.value as DietType })}
            >
              {(Object.keys(DIET_LABELS) as DietType[]).map((type) => (
                <option key={type} value={type}>
                  {DIET_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your goal">
            <select
              className={`${selectClass} w-full`}
              value={p.goal}
              onChange={(e) => store.updateProfile({ goal: e.target.value as FitnessGoal })}
            >
              {(Object.keys(GOAL_LABELS) as FitnessGoal[]).map((goal) => (
                <option key={goal} value={goal}>
                  {GOAL_LABELS[goal]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Normal day activity">
            <select
              className={`${selectClass} w-full`}
              value={p.activityLevel}
              onChange={(e) => store.updateProfile({ activityLevel: e.target.value as ActivityLevel })}
            >
              {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => (
                <option key={level} value={level}>
                  {ACTIVITY_LABELS[level]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region" hint="Sets the price index and seasonal produce.">
            <select
              className={`${selectClass} w-full`}
              value={p.region}
              onChange={(e) => store.updateProfile({ region: e.target.value as Profile['region'] })}
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Vitals" />
        <div className="grid grid-cols-3 gap-3">
          <Stat value={`${p.weightKg} kg`} label="Weight" />
          <Stat value={`${p.heightCm} cm`} label="Height" />
          <Stat value={bmi ? bmi.toString() : '—'} label="BMI" />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle title="Reset everything" />
            <p className="mt-1 text-xs text-ink-3">
              This clears your profile and data. You&apos;ll go back to onboarding.
            </p>
          </div>
          <Button variant="danger" onClick={() => store.reset()}>
            Reset app
          </Button>
        </div>
      </Card>
    </div>
  );
}
