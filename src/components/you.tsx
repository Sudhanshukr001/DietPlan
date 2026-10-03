'use client';

import type { AppStore } from '@/lib/app/store';
import { Button, Card, Field, SectionTitle, Stat } from './ui';
import { useMemo, useState } from 'react';
import { clampNumber, parseNumericText } from '@/lib/domain/units';

interface YouProps {
  readonly store: AppStore;
}

export function You({ store }: YouProps): React.ReactNode {
  const p = store.profile;
  const s = store.state.settings;
  const [name, setName] = useState(p?.name ?? '');
  // Text while editing. `Number(exercise) || 0` looked harmless but meant that
  // clearing the field and hitting Save wrote 0 minutes, with no warning.
  const [exercise, setExercise] = useState(String(p?.exerciseMinutesPerDay ?? 30));
  const [budget, setBudget] = useState(String(s.dailyBudget ?? 150));
  const [city, setCity] = useState(p?.city ?? '');
  const [stateName, setStateName] = useState(p?.state ?? '');

  const bmi = useMemo(() => {
    if (!p) return null;
    const h = p.heightCm / 100;
    const v = p.weightKg / (h * h);
    return Math.round(v * 10) / 10;
  }, [p]);

  if (!p) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">You</h1>
        <p className="text-sm text-ink-3">Tweak your preferences. The plan reflows immediately.</p>
      </header>

      <Card>
        <SectionTitle title="Quick profile" />
        <div className="space-y-4">
          <Field label="Name">
            <input className="field min-h-11 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Exercise (minutes/day)">
              <input
                type="number"
                inputMode="numeric"
                className="field min-h-11 w-full"
                value={exercise}
                onChange={(e) => setExercise(e.target.value)}
                min={0}
                max={90}
              />
            </Field>
            <Field label="Daily budget (₹)">
              <input
                type="number"
                inputMode="numeric"
                className="field min-h-11 w-full"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                min={0}
                max={500}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City">
              <input className="field min-h-11 w-full" value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="State">
              <input className="field min-h-11 w-full" value={stateName} onChange={(e) => setStateName(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                // An empty field means "leave it alone", not "set it to zero".
                const nextExercise = parseNumericText(exercise);
                const nextBudget = parseNumericText(budget);
                store.updateProfile({
                  name: name.trim() || p.name,
                  city: city.trim() || p.city,
                  state: stateName.trim() || p.state,
                  ...(nextExercise !== null
                    ? { exerciseMinutesPerDay: clampNumber(nextExercise, 0, 90) }
                    : {}),
                });
                if (nextBudget !== null) {
                  store.updateSettings({ dailyBudget: clampNumber(nextBudget, 0, 500) });
                }
              }}
            >
              Save changes
            </Button>
          </div>
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
