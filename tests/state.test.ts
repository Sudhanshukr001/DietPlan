import { describe, expect, it } from 'vitest';
import { blankState, migrate } from '@/lib/domain/state';
import { DEFAULT_SCHEDULE, defaultDiet, defaultHealth, defaultSettings } from '@/lib/domain/defaults';
import { SAFETY_VERSION } from '@/lib/domain/safety';
import { DEFAULT_SETTINGS } from '@/lib/domain/notifications';
import { SCHEMA_VERSION } from '@/lib/domain/types/index';
import { DATE, makeProfile } from './fixtures';

describe('blank state', () => {
  it('produces a complete, valid state with no profile yet', () => {
    const s = blankState(DATE);
    expect(s.profile).toBeNull();
    expect(s.snapshots).toEqual({});
    expect(s.diet).toEqual(defaultDiet());
    expect(s.health).toEqual(defaultHealth());
    expect(s.settings).toEqual(defaultSettings());
    expect(s._today).toBe(DATE);
  });

  it('never records an incomplete safety acknowledgement', () => {
    expect(blankState(DATE).profile).toBeNull();
  });
});

describe('migration', () => {
  it('returns a usable state for nothing at all', () => {
    for (const input of [null, undefined, 0, '', 'nonsense', [], true]) {
      const s = migrate(input);
      expect(s.profile).toBeNull();
      expect(s.diet.dietType).toBe('vegetarian');
    }
  });

  it('round-trips a real profile', () => {
    const profile = makeProfile({ goal: 'build-muscle', region: 'bihar', age: 31 });
    const s = migrate({ profile, diet: defaultDiet(), health: defaultHealth(), settings: defaultSettings() });
    expect(s.profile?.age).toBe(31);
    expect(s.profile?.goal).toBe('build-muscle');
    expect(s.profile?.schedule.wakeMinute).toBe(profile.schedule.wakeMinute);
    expect(s.profile?.onboardingComplete).toBe(true);
  });

  it('clamps impossible numbers instead of trusting them', () => {
    const s = migrate({
      profile: {
        age: 999,
        weightKg: -40,
        heightCm: 9000,
        exerciseMinutesPerDay: 5000,
        schedule: { ...DEFAULT_SCHEDULE, wakeMinute: 99999, sleepMinute: -20 },
      },
    });
    expect(s.profile?.age).toBeLessThanOrEqual(100);
    expect(s.profile?.weightKg).toBeGreaterThan(0);
    expect(s.profile?.heightCm).toBeLessThanOrEqual(230);
    expect(s.profile?.exerciseMinutesPerDay).toBeLessThanOrEqual(180);
    expect(s.profile?.schedule.wakeMinute).toBeLessThanOrEqual(1439);
    expect(s.profile?.schedule.sleepMinute).toBeGreaterThanOrEqual(0);
  });

  it('rejects unknown enum values', () => {
    const s = migrate({
      profile: { ...makeProfile(), goal: 'become-a-model', sex: 'alien', units: 'furlongs' },
      diet: { ...defaultDiet(), dietType: 'carnivore-only' },
      settings: { ...defaultSettings(), theme: 'neon' },
    });
    expect(s.profile?.goal).toBe('build-healthy-lifestyle');
    expect(s.profile?.sex).toBe('prefer-not-to-say');
    expect(s.profile?.units).toBe('metric');
    expect(s.diet.dietType).toBe('vegetarian');
    expect(s.settings.theme).toBe('system');
  });

  it('drops allergy keys that do not exist in the food database', () => {
    const s = migrate({
      diet: { ...defaultDiet(), allergies: ['milk', 'dragon-fruit'], intolerances: ['not-real'] },
    });
    expect(s.diet.allergies).toEqual(['milk']);
    expect(s.diet.intolerances).toEqual([]);
  });

  it('keeps notification preferences but bounds them', () => {
    const s = migrate({
      settings: {
        ...defaultSettings(),
        notifications: {
          ...DEFAULT_SETTINGS,
          meals: false,
          water: true,
          dailyCap: 900,
          snoozeMinutes: 0,
          quietHoursStart: 'late',
          browserPermission: 'definitely',
        },
      },
    });
    expect(s.settings.notifications.meals).toBe(false);
    expect(s.settings.notifications.dailyCap).toBeLessThanOrEqual(30);
    expect(s.settings.notifications.snoozeMinutes).toBeGreaterThanOrEqual(10);
    expect(typeof s.settings.notifications.quietHoursStart).toBe('number');
    expect(s.settings.notifications.browserPermission).toBe('default');
  });

  it('defaults the browser permission to "not yet asked"', () => {
    expect(blankState(DATE).settings.notifications.browserPermission).toBe('default');
  });

  it('keeps the declared conditions the user actually chose', () => {
    const s = migrate({ health: { ...defaultHealth(), declaredConditions: ['diabetes', 'made-up'] } });
    expect(s.health.declaredConditions).toEqual(['diabetes']);
  });

  it('survives a corrupted snapshot store', () => {
    const s = migrate({ snapshots: 'not an object', hydration: 'nope', workouts: 42 });
    expect(s.snapshots).toEqual({});
    expect(Array.isArray(s.hydration)).toBe(true);
    expect(Array.isArray(s.workouts)).toBe(true);
  });

  it('truncates absurd free-text rather than storing it', () => {
    const s = migrate({
      profile: { ...makeProfile(), name: 'x'.repeat(500) },
      health: { ...defaultHealth(), digestionNotes: 12345 },
    });
    expect(s.profile?.name.length).toBeLessThanOrEqual(40);
    expect(s.health.digestionNotes).toBe('');
  });

  it('is idempotent', () => {
    const once = migrate({ profile: makeProfile() });
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe('constants', () => {
  it('exposes a schema version and a safety version that onboarding can pin', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(SAFETY_VERSION).toMatch(/^\d{4}-\d{2}/);
  });

  it('ships notification defaults that are conservative', () => {
    expect(DEFAULT_SETTINGS.motivation).toBe(false);
    expect(DEFAULT_SETTINGS.meals).toBe(true);
    expect(DEFAULT_SETTINGS.dailyCap).toBeLessThanOrEqual(15);
  });
});
