'use client';

/**
 * Onboarding. Four short screens, no account, no email.
 *
 * Everything collected here is either needed for a safe estimate (age, height,
 * weight, activity) or optional personalisation. The declared-condition step is
 * explicitly framed as "changes the wording, not your plan" so it does not read
 * as a medical intake form.
 */

import { useState, type ReactNode } from 'react';
import { ALLERGY_OPTIONS, DIET_DESCRIPTIONS, DIET_LABELS } from '@/lib/domain/diet';
import { CONDITION_LABELS, DISCLAIMER_FULL, SAFETY_VERSION } from '@/lib/domain/safety';
import { REGIONS } from '@/lib/domain/seasonal';
import { ACTIVITY_LABELS, GOAL_DESCRIPTIONS, GOAL_LABELS } from '@/lib/domain/nutrition';
import { LEVEL_DESCRIPTIONS, LEVEL_LABELS } from '@/lib/domain/fitness';
import { defaultDiet, defaultHealth, defaultProfile, defaultSettings } from '@/lib/domain/defaults';
import { parseMinute24 } from '@/lib/domain/time';
import { normaliseNumericText, parseNumericText, sanitizeNumericText } from '@/lib/domain/units';
import type {
  ActivityLevel,
  DeclaredCondition,
  DietPreference,
  DietType,
  FitnessGoal,
  FitnessLevel,
  FoodKey,
  HealthPreference,
  Profile,
  Sex,
  UserSettings,
} from '@/lib/domain/types/index';
import { ArrowLeft, ArrowRight, Check, Lock, Sparkles, WifiOff } from 'lucide-react';
import { Button, Card, Chip, Choice, Field, SectionTitle, inputClass, selectClass } from './ui';
import { BrandMark } from './brand';

interface Draft {
  name: string;
  /**
   * Numeric fields are held as text, not numbers. `Number(e.target.value)` turns
   * a cleared field into 0 and writes it back, so the user can never leave it
   * empty and a typo becomes a silent valid-looking value. Text is parsed once,
   * at validation and at submit, where a failure can actually be reported.
   */
  age: string;
  sex: Sex;
  heightCm: string;
  weightKg: string;
  region: Profile['region'];
  city: string;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
  fitnessLevel: FitnessLevel;
  dietType: DietType;
  allergies: FoodKey[];
  conditions: DeclaredCondition[];
  dailyBudget: string;
  wake: string;
  sleep: string;
  exerciseMinute: string;
  hasGymAccess: boolean;
}

function initialDraft(): Draft {
  const base = defaultProfile();
  return {
    name: '',
    age: String(base.age),
    sex: base.sex,
    heightCm: String(base.heightCm),
    weightKg: String(base.weightKg),
    region: base.region,
    city: '',
    activityLevel: base.activityLevel,
    goal: base.goal,
    fitnessLevel: base.fitnessLevel,
    dietType: 'vegetarian',
    allergies: [],
    conditions: [],
    dailyBudget: '150',
    wake: '07:00',
    sleep: '23:00',
    exerciseMinute: '18:00',
    hasGymAccess: false,
  };
}

const STEPS = ['About you', 'Food and money', 'Your routine', 'Anything we should know'] as const;

const STEP_SUBTITLE: readonly string[] = [
  'Just enough for a safe estimate. You can change any of it later.',
  'We plan with what you actually eat and what you actually pay.',
  'Times, movement and what you are working towards.',
  'Optional, and it only changes the wording we use — never your plan.',
];

export interface OnboardingResult {
  readonly profile: Profile;
  readonly diet: DietPreference;
  readonly health: HealthPreference;
  readonly settings: UserSettings;
}

export function Onboarding({
  onDone,
}: {
  readonly onDone: (result: OnboardingResult) => void;
}): ReactNode {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const toggleAllergy = (keys: readonly FoodKey[]): void => {
    setDraft((prev) => {
      const has = keys.every((k) => prev.allergies.includes(k));
      const next = has
        ? prev.allergies.filter((k) => !keys.includes(k))
        : [...prev.allergies, ...keys];
      return { ...prev, allergies: [...new Set(next)] };
    });
  };

  const toggleCondition = (condition: DeclaredCondition): void => {
    setDraft((prev) => ({
      ...prev,
      conditions: prev.conditions.includes(condition)
        ? prev.conditions.filter((c) => c !== condition)
        : [...prev.conditions, condition],
    }));
  };

  const age = parseNumericText(draft.age);
  const heightCm = parseNumericText(draft.heightCm);
  const weightKg = parseNumericText(draft.weightKg, 1);
  const dailyBudget = parseNumericText(draft.dailyBudget);

  const valid =
    age !== null &&
    age >= 13 &&
    age <= 100 &&
    heightCm !== null &&
    heightCm >= 120 &&
    heightCm <= 230 &&
    weightKg !== null &&
    weightKg >= 30 &&
    weightKg <= 200;

  const finish = (): void => {
    const base = defaultProfile();
    const dietBase = defaultDiet();
    const healthBase = defaultHealth();
    const settingsBase = defaultSettings();
    const wake = parseMinute24(draft.wake) ?? base.schedule.wakeMinute;
    const sleep = parseMinute24(draft.sleep) ?? base.schedule.sleepMinute;
    const exercise = parseMinute24(draft.exerciseMinute) ?? base.schedule.exerciseMinute;
    onDone({
      profile: {
        ...base,
        name: draft.name.trim(),
        age: Math.round(age ?? base.age),
        sex: draft.sex,
        heightCm: Math.round(heightCm ?? base.heightCm),
        weightKg: Math.round((weightKg ?? base.weightKg) * 10) / 10,
        region: draft.region,
        city: draft.city.trim(),
        activityLevel: draft.activityLevel,
        goal: draft.goal,
        fitnessLevel: draft.fitnessLevel,
        exerciseMinutesPerDay: 25,
        hasGymAccess: draft.hasGymAccess,
        schedule: {
          ...base.schedule,
          wakeMinute: wake,
          sleepMinute: sleep,
          exerciseMinute: exercise,
        },
        acceptedSafetyVersion: SAFETY_VERSION,
        onboardingComplete: true,
      },
      diet: { ...dietBase, dietType: draft.dietType, allergies: [...new Set(draft.allergies)] },
      health: { ...healthBase, declaredConditions: draft.conditions },
      settings: { ...settingsBase, dailyBudget: Math.round(dailyBudget ?? settingsBase.dailyBudget) },
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-[max(1.5rem,env(safe-area-inset-top,0px))]">
      <header className="mb-5">
        <div className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <p className="text-sm font-semibold tracking-tight text-ink">Aaj Ka Khana</p>
          <span className="ml-auto nums rounded-full bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-2">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance text-ink">{STEPS[step]}</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{STEP_SUBTITLE[step]}</p>
        <ol className="mt-4 flex gap-1.5" aria-label="Progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
              aria-current={index === step ? 'step' : undefined}
            >
              <span
                className={`block h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-soft)] ${
                  index < step ? 'w-full bg-[image:var(--gradient-accent)]' : index === step ? 'w-1/2 bg-accent' : 'w-0'
                }`}
                style={index === step ? { animation: 'sheen 2.4s linear infinite' } : undefined}
              />
            </li>
          ))}
        </ol>
      </header>

      <div className="stack-8">
        {step === 0 ? (
          <Card className="stack-8">
            <Field label="What should we call you?" hint="A name or a nickname. Nothing else is stored.">
              <input
                className={inputClass}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Optional"
                autoComplete="given-name"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age" hint="Years">
                <input
                  className={inputClass}
                  type="number"
                  inputMode="numeric"
                  min={13}
                  max={100}
                  value={draft.age}
                  onChange={(e) => set('age', sanitizeNumericText(e.target.value))}
                  onBlur={(e) => set('age', normaliseNumericText(e.target.value))}
                />
              </Field>
              <Field label="Sex" hint="Used only for the energy formula">
                <select
                  className={selectClass}
                  value={draft.sex}
                  onChange={(e) => set('sex', e.target.value as Sex)}
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Height" hint="cm">
                <input
                  className={inputClass}
                  type="number"
                  inputMode="decimal"
                  min={120}
                  max={230}
                  value={draft.heightCm}
                  onChange={(e) => set('heightCm', sanitizeNumericText(e.target.value))}
                  onBlur={(e) => set('heightCm', normaliseNumericText(e.target.value))}
                />
              </Field>
              <Field label="Weight" hint="kg">
                <input
                  className={inputClass}
                  type="number"
                  inputMode="decimal"
                  min={30}
                  max={200}
                  step={0.5}
                  value={draft.weightKg}
                  onChange={(e) => set('weightKg', sanitizeNumericText(e.target.value, 1))}
                  onBlur={(e) => set('weightKg', normaliseNumericText(e.target.value, 1))}
                />
              </Field>
            </div>
            <Field label="How active is a normal day for you?">
              <select
                className={inputClass}
                value={draft.activityLevel}
                onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}
              >
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => (
                  <option key={level} value={level}>
                    {ACTIVITY_LABELS[level]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where are you?" hint="Sets the price index and the seasonal produce list.">
              <select
                className={inputClass}
                value={draft.region}
                onChange={(e) => set('region', e.target.value as Profile['region'])}
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="City" hint="Optional">
              <input
                className={inputClass}
                value={draft.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card className="stack-8">
            <Field label="What do you eat?">
              <div className="grid gap-2">
                {(Object.keys(DIET_LABELS) as DietType[]).map((type) => (
                  <Choice
                    key={type}
                    title={DIET_LABELS[type]}
                    description={DIET_DESCRIPTIONS[type]}
                    selected={draft.dietType === type}
                    onClick={() => set('dietType', type)}
                  />
                ))}
              </div>
            </Field>

            <Field label="Allergies or things you must avoid" hint="Tap everything that applies. These are never substituted.">
              <div className="flex flex-wrap gap-2">
                {ALLERGY_OPTIONS.map((option) => (
                  <Chip
                    key={option.label}
                    selected={option.keys.every((k) => draft.allergies.includes(k))}
                    onClick={() => toggleAllergy(option.keys)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="What is your food budget for a day?" hint="Roughly, for everything you eat.">
              <div className="relative">
                <span className="nums pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">
                  &#8377;
                </span>
                <input
                  className={`${inputClass} nums pl-8`}
                  type="number"
                  inputMode="numeric"
                  min={50}
                  max={2000}
                step={10}
                  value={draft.dailyBudget}
                  onChange={(e) => set('dailyBudget', sanitizeNumericText(e.target.value))}
                  onBlur={(e) => set('dailyBudget', normaliseNumericText(e.target.value))}
                />
              </div>
            </Field>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card className="stack-8">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Wake up">
                <input
                  className={inputClass}
                  type="time"
                  value={draft.wake}
                  onChange={(e) => set('wake', e.target.value)}
                />
              </Field>
              <Field label="Sleep">
                <input
                  className={inputClass}
                  type="time"
                  value={draft.sleep}
                  onChange={(e) => set('sleep', e.target.value)}
                />
              </Field>
              <Field label="Exercise">
                <input
                  className={inputClass}
                  type="time"
                  value={draft.exerciseMinute}
                  onChange={(e) => set('exerciseMinute', e.target.value)}
                />
              </Field>
            </div>
            <Field label="What are you working towards?" hint="Pick one. You can change it any time.">
              <div className="grid gap-2">
                {(Object.keys(GOAL_LABELS) as FitnessGoal[]).map((goal) => (
                  <Choice
                    key={goal}
                    title={GOAL_LABELS[goal]}
                    description={GOAL_DESCRIPTIONS[goal]}
                    selected={draft.goal === goal}
                    onClick={() => set('goal', goal)}
                  />
                ))}
              </div>
            </Field>
            <Field label="How much exercise are you used to?" hint="We start here and adjust, never surprise you.">
              <div className="grid gap-2">
                {(Object.keys(LEVEL_LABELS) as FitnessLevel[]).map((level) => (
                  <Choice
                    key={level}
                    title={LEVEL_LABELS[level]}
                    description={LEVEL_DESCRIPTIONS[level]}
                    selected={draft.fitnessLevel === level}
                    onClick={() => set('fitnessLevel', level)}
                  />
                ))}
              </div>
            </Field>
            <label className="press focus-within:ring-accent flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3.5 hover:border-line-strong hover:bg-surface-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                checked={draft.hasGymAccess}
                onChange={(e) => set('hasGymAccess', e.target.checked)}
              />
              <span className="text-sm font-medium text-ink">
                I have access to a gym
                <span className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-3">
                  Everything works at home with no equipment too. This only adds a few extra options.
                </span>
              </span>
            </label>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card className="stack-8">
            <div>
              <SectionTitle title="Anything we should know?" hint="Optional. It changes the wording we use, not your plan." />
              <p className="mt-2 text-sm text-ink-2">
                We are a food planner, not a doctor. If any of these apply, we soften numbers and point you to a
                professional instead of guessing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CONDITION_LABELS) as DeclaredCondition[]).map((condition) => (
                <Chip
                  key={condition}
                  tone="calm"
                  selected={draft.conditions.includes(condition)}
                  onClick={() => toggleCondition(condition)}
                >
                  {CONDITION_LABELS[condition]}
                </Chip>
              ))}
            </div>
            <ul className="grid gap-2 rounded-md border border-line bg-surface-2/60 p-4">
              {[
                { icon: <Lock size={14} />, text: 'No account, no email, no password' },
                { icon: <WifiOff size={14} />, text: 'Works with no internet connection' },
                { icon: <Check size={14} />, text: 'Everything stays on this device' },
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-2.5 text-xs text-ink-2">
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    {item.icon}
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed text-ink-3">{DISCLAIMER_FULL}</p>
          </Card>
        ) : null}
      </div>

      <footer className="glass fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-xl items-center gap-3 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.18)]">
        {step > 0 ? (
          <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} aria-label="Go back a step">
            <ArrowLeft size={17} aria-hidden />
            Back
          </Button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <Button size="lg" onClick={() => setStep(step + 1)} fullWidth>
            Continue
            <ArrowRight size={17} aria-hidden />
          </Button>
        ) : (
          <Button size="lg" onClick={finish} disabled={!valid} fullWidth>
            <Sparkles size={17} aria-hidden />
            {valid ? 'Show me my day' : 'Check age, height and weight'}
          </Button>
        )}
      </footer>
    </div>
  );
}
