/**
 * Fitness engine.
 *
 * Hard constraint from the spec: never assume gym access. Every plan has a
 * no-equipment path, and every exercise is scalable with a regression (wall
 * push-ups instead of the floor, fewer reps, shorter holds).
 */

import type {
  CalendarDay,
  ExerciseBlock,
  FitnessLevel,
  FitnessGoal,
  MinuteOfDay,
  Profile,
  Workout,
  WorkoutFocus,
  WorkoutLog,
} from './types/index';

export const LEVEL_LABELS: Record<FitnessLevel, string> = {
  beginner: 'Beginner — starting from scratch',
  intermediate: 'Intermediate — already active some days',
  advanced: 'Advanced — regular structured training',
};

export const LEVEL_DESCRIPTIONS: Record<FitnessLevel, string> = {
  beginner: 'Bodyweight only. Everything can be done at home with no equipment.',
  intermediate: 'Bodyweight plus optional resistance. You should be able to do 15 push-ups comfortably.',
  advanced: 'Longer sessions with progressive volume. Still no gym required.',
};

export const FOCUS_LABELS: Record<WorkoutFocus, string> = {
  'full-body': 'Full body',
  lower: 'Lower body',
  upper: 'Upper body',
  cardio: 'Cardio & walking',
  mobility: 'Mobility & stretching',
  recovery: 'Recovery',
};

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------

interface BlockTemplate {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly instructions: string;
  readonly scalable: boolean;
  readonly regression?: string;
  readonly equipment: 'none' | 'optional';
}

const BLOCKS = {
  warmup: {
    id: 'warmup',
    name: 'Warm-up',
    emoji: '🤸',
    instructions: 'Walk in place, roll your shoulders, and do 10 slow hip circles each way.',
    scalable: false,
    equipment: 'none',
  },
  squats: {
    id: 'squats',
    name: 'Bodyweight squats',
    emoji: '🦵',
    instructions: 'Feet shoulder-width apart. Sit back as if onto a chair, keep your chest up, then stand.',
    scalable: true,
    regression: 'Half-squats to a chair, or hold a wall for balance.',
    equipment: 'none',
  },
  wallPushups: {
    id: 'wall-pushups',
    name: 'Wall or incline push-ups',
    emoji: '💪',
    instructions: 'Hands on a wall or a table edge, body in one line. Bend your elbows, then push away.',
    scalable: true,
    regression: 'Push against a wall from further away.',
    equipment: 'none',
  },
  floorPushups: {
    id: 'floor-pushups',
    name: 'Push-ups',
    emoji: '💪',
    instructions: 'On the floor, hands under your shoulders, body straight. Lower until your chest is close to the floor.',
    scalable: true,
    regression: 'Do them on a bed edge or a low step instead.',
    equipment: 'none',
  },
  inclineWalk: {
    id: 'incline-walk',
    name: 'Brisk walking',
    emoji: '🚶',
    instructions: 'Walk at a pace where you could talk but not sing. Indoors, march on the spot.',
    scalable: true,
    regression: 'Halve the time and build back up over a week.',
    equipment: 'none',
  },
  plank: {
    id: 'plank',
    name: 'Forearm plank',
    emoji: '🧱',
    instructions: 'On your forearms and knees or toes, in a straight line from head to heel. Do not let your hips drop.',
    scalable: true,
    regression: 'Hold the same position on your knees.',
    equipment: 'none',
  },
  gluteBridge: {
    id: 'glute-bridge',
    name: 'Glute bridges',
    emoji: '🦵',
    instructions: 'On your back, knees bent, lift your hips until your body forms a straight line, then lower.',
    scalable: true,
    regression: 'Do 10 only.',
    equipment: 'none',
  },
  lunges: {
    id: 'lunges',
    name: 'Reverse lunges',
    emoji: '🚶',
    instructions: 'Step back with one foot, lower both knees, then push back to standing. Keep your torso upright.',
    scalable: true,
    regression: 'Hold a wall behind you and split the movement in half.',
    equipment: 'none',
  },
  birdDog: {
    id: 'bird-dog',
    name: 'Bird dog',
    emoji: '🐕',
    instructions: 'On hands and knees, extend one arm forward and the opposite leg back until in line with your body.',
    scalable: true,
    regression: 'Lift just the leg.',
    equipment: 'none',
  },
  crunches: {
    id: 'crunches',
    name: 'Crunches',
    emoji: '🧎',
    instructions: 'On your back with knees bent, lift your shoulders a few inches and lower slowly.',
    scalable: true,
    regression: 'Curl up just to feel the movement, not to fatigue.',
    equipment: 'none',
  },
  stretching: {
    id: 'stretching',
    name: 'Full-body stretch',
    emoji: '🧘',
    instructions: 'Hold each stretch for 20–30 seconds: hamstrings, calves, shoulders, chest, neck, sides.',
    scalable: false,
    equipment: 'none',
  },
  cooldown: {
    id: 'cooldown',
    name: 'Cool-down',
    emoji: '😌',
    instructions: 'Walk slowly for two minutes, then breathe deeply for five slow breaths.',
    scalable: false,
    equipment: 'none',
  },
  skip: {
    id: 'rope-skip',
    name: 'Skipping rope (or marching)',
    emoji: '🪢',
    instructions: 'Skip or march on the spot in small, quick steps to raise your heart rate.',
    scalable: true,
    regression: 'March without jumping at all.',
    equipment: 'optional',
  },
  squatsBottle: {
    id: 'squat-bottles',
    name: 'Squats with a water bottle',
    emoji: '🧴',
    instructions: 'Hold a filled 1-litre bottle at your chest and do the same squats. Keep your back straight.',
    scalable: true,
    regression: 'Hold the bottle at your side instead of your chest.',
    equipment: 'optional',
  },
} satisfies Record<string, BlockTemplate>;

// ---------------------------------------------------------------------------
// Plan selection
// ---------------------------------------------------------------------------

/**
 * Focus rotates by day so a week does not look identical. Deterministic on the
 * calendar day so a snapshot always replays the same workout.
 */
export function focusForDate(date: CalendarDay, level: FitnessLevel): WorkoutFocus {
  const [y, m, d] = date.split('-').map(Number);
  const idx = Math.abs((y ?? 2026) * 31 + (m ?? 1) * 7 + (d ?? 1));

  const rotation: readonly WorkoutFocus[] =
    level === 'beginner'
      ? ['full-body', 'cardio', 'mobility', 'full-body', 'recovery', 'cardio', 'full-body']
      : ['full-body', 'upper', 'lower', 'cardio', 'full-body', 'mobility', 'recovery'];

  return rotation[idx % rotation.length] ?? 'full-body';
}

export function buildWorkout(input: {
  readonly profile: Profile;
  readonly date: CalendarDay;
  readonly level: FitnessLevel;
  readonly focus: WorkoutFocus;
  readonly isRestDay: boolean;
}): Workout {
  const { profile, date, focus, isRestDay } = input;

  if (isRestDay) {
    return {
      id: `${date}:recovery`,
      date,
      name: 'Recovery day',
      level: input.level,
      focus: 'recovery',
      blocks: [
        { ...BLOCKS.stretching, id: `${date}:stretch`, minutes: 10 },
        { ...BLOCKS.cooldown, id: `${date}:breathe`, minutes: 5 },
      ],
      totalMinutes: 15,
      equipmentRequired: 'none',
      noGymNote: 'Rest days are part of training. A 10-minute stretch is plenty.',
      whyItMatters:
        'Rest lets your body repair itself. Skipping it is how people end up sore enough to stop.',
    };
  }

  const minutes = clampMinutes(profile.exerciseMinutesPerDay, input.level);
  const blocks = assembleBlocks({ date, focus, level: input.level, minutes, hasGymAccess: profile.hasGymAccess });

  return {
    id: `${date}:${focus}`,
    date,
    name: workoutName(focus, input.level),
    level: input.level,
    focus,
    blocks,
    totalMinutes: blocks.reduce((s, b) => s + b.minutes, 0),
    equipmentRequired: blocks.some((b) => b.equipment === 'optional') ? 'optional' : 'none',
    noGymNote: noGymNote(focus, input.level),
    whyItMatters: workoutWhy(focus),
  };
}

function clampMinutes(requested: number, level: FitnessLevel): number {
  const caps: Record<FitnessLevel, number> = { beginner: 30, intermediate: 45, advanced: 60 };
  return Math.max(12, Math.min(requested, caps[level]));
}

function assembleBlocks(input: {
  date: CalendarDay;
  focus: WorkoutFocus;
  level: FitnessLevel;
  minutes: number;
  hasGymAccess: boolean;
}): ExerciseBlock[] {
  const { date, focus, level, minutes } = input;
  const id = (base: string): string => `${date}:${base}`;

  const reps = level === 'beginner' ? 10 : level === 'intermediate' ? 15 : 20;
  const sets = level === 'beginner' ? 2 : level === 'intermediate' ? 3 : 4;
  const hold = level === 'beginner' ? 20 : level === 'intermediate' ? 30 : 45;

  const warmup: ExerciseBlock = { ...BLOCKS.warmup, id: id('warmup'), minutes: 5 };
  const cooldown: ExerciseBlock = { ...BLOCKS.cooldown, id: id('cooldown'), minutes: 5 };

  const core: ExerciseBlock[] = [];

  switch (focus) {
    case 'full-body':
      core.push(
        { ...BLOCKS.squats, id: id('squats'), sets, reps, minutes: 5 },
        level === 'advanced'
          ? { ...BLOCKS.floorPushups, id: id('pushups'), sets, reps: Math.max(8, reps - 5), minutes: 5 }
          : { ...BLOCKS.wallPushups, id: id('pushups'), sets, reps, minutes: 5 },
        { ...BLOCKS.plank, id: id('plank'), sets: 3, holdSeconds: hold, minutes: 3 },
        { ...BLOCKS.gluteBridge, id: id('bridge'), sets, reps, minutes: 4 },
      );
      break;
    case 'upper':
      core.push(
        level === 'advanced'
          ? { ...BLOCKS.floorPushups, id: id('pushups'), sets, reps: Math.max(8, reps - 5), minutes: 6 }
          : { ...BLOCKS.wallPushups, id: id('pushups'), sets, reps: reps + 5, minutes: 6 },
        { ...BLOCKS.squats, id: id('squats'), sets, reps: reps + 5, minutes: 5 },
        { ...BLOCKS.crunches, id: id('crunches'), sets, reps: Math.max(8, reps - 4), minutes: 4 },
        { ...BLOCKS.birdDog, id: id('birddog'), sets: 3, reps: 8, minutes: 3 },
      );
      break;
    case 'lower':
      core.push(
        { ...BLOCKS.squats, id: id('squats'), sets, reps, minutes: 6 },
        { ...BLOCKS.lunges, id: id('lunges'), sets, reps: Math.max(6, reps - 4), minutes: 5 },
        { ...BLOCKS.gluteBridge, id: id('bridge'), sets, reps: reps + 5, minutes: 5 },
        { ...BLOCKS.plank, id: id('plank'), sets: 3, holdSeconds: hold, minutes: 3 },
      );
      break;
    case 'cardio':
      core.push(
        { ...BLOCKS.inclineWalk, id: id('walk'), minutes: Math.max(10, minutes - 14) },
        { ...BLOCKS.skip, id: id('skip'), sets: 4, minutes: 4, equipment: level === 'beginner' ? 'none' : 'optional' },
        { ...BLOCKS.squats, id: id('squats'), sets: 2, reps: 12, minutes: 4 },
      );
      break;
    case 'mobility':
      core.push(
        { ...BLOCKS.stretching, id: id('stretch'), minutes: 12 },
        { ...BLOCKS.birdDog, id: id('birddog'), sets: 3, reps: 8, minutes: 4 },
        { ...BLOCKS.gluteBridge, id: id('bridge'), sets: 3, reps: 12, minutes: 4 },
      );
      break;
    case 'recovery':
      core.push(
        { ...BLOCKS.stretching, id: id('stretch'), minutes: 8 },
        { ...BLOCKS.inclineWalk, id: id('walk'), minutes: 12 },
      );
      break;
    default:
      break;
  }

  const blocks: ExerciseBlock[] = [warmup, ...core, cooldown];
  // Trim or extend the walking/cardio block to honour the requested time.
  const target = Math.max(12, minutes);
  const current = blocks.reduce((s, b) => s + b.minutes, 0);
  if (current < target - 4) {
    const extra = target - current;
    const walkIdx = blocks.findIndex((b) => b.id.endsWith(':walk') || b.id.endsWith(':skip'));
    if (walkIdx >= 0) {
      const block = blocks[walkIdx];
      if (block) blocks[walkIdx] = { ...block, minutes: block.minutes + extra };
      else blocks.push({ ...BLOCKS.inclineWalk, id: id('walk'), minutes: extra });
    } else {
      blocks.splice(blocks.length - 1, 0, { ...BLOCKS.inclineWalk, id: id('walk'), minutes: extra });
    }
  }
  return blocks;
}

function workoutName(focus: WorkoutFocus, level: FitnessLevel): string {
  const base: Record<WorkoutFocus, string> = {
    'full-body': 'Full body session',
    lower: 'Lower body session',
    upper: 'Upper body session',
    cardio: 'Cardio and walking',
    mobility: 'Mobility and stretching',
    recovery: 'Recovery session',
  };
  return level === 'beginner' ? `${base[focus]} — beginner` : base[focus];
}

function noGymNote(focus: WorkoutFocus, level: FitnessLevel): string {
  if (level === 'advanced') {
    return 'Nothing here needs a gym. If you have one, add weight or extra reps — but do not add complexity you do not need yet.';
  }
  if (focus === 'cardio') {
    return 'A rope is optional. Marching on the spot works exactly as well.';
  }
  return 'Everything here can be done at home with no equipment and no gym membership.';
}

function workoutWhy(focus: WorkoutFocus): string {
  switch (focus) {
    case 'cardio':
      return 'Walking and light cardio support heart health, digestion and mood. It does not have to be intense to count.';
    case 'mobility':
      return 'Stretching and mobility keep joints moving freely and reduce the stiffness that comes from sitting all day.';
    case 'recovery':
      return 'Recovery work still counts as movement, and it is what lets you keep going on the other days.';
    case 'upper':
      return 'Pushing and core work build the upper body and the bracing that protects your back.';
    case 'lower':
      return 'Leg work builds the muscles you use every day — stairs, cycling, carrying water.';
    case 'full-body':
      return 'A short full-body session gives you the benefits of training without needing a gym or a long session.';
    default:
      return 'Regular movement supports circulation, muscle and mood.';
  }
}

// ---------------------------------------------------------------------------
// Logging & progress
// ---------------------------------------------------------------------------

export function blockCompletion(workout: Workout, log: WorkoutLog | null): number {
  if (!log || workout.blocks.length === 0) return 0;
  const done = log.completedBlockIds.length;
  return Math.min(1, done / workout.blocks.length);
}

export function workoutMinutes(workout: Workout, log: WorkoutLog | null): number {
  if (!log) return 0;
  const done = new Set(log.completedBlockIds);
  return workout.blocks.filter((b) => done.has(b.id)).reduce((s, b) => s + b.minutes, 0);
}

export function blockLabel(block: ExerciseBlock): string {
  if (block.holdSeconds !== undefined) return `${block.sets ?? 1} × ${block.holdSeconds}s hold`;
  if (block.reps !== undefined) return `${block.sets ?? 1} × ${block.reps}`;
  return `${block.minutes} min`;
}

/** Scale down for a missed day rather than skipping. */
export function reducedWorkout(workout: Workout): Workout {
  return {
    ...workout,
    id: `${workout.id}:short`,
    name: `${workout.name} — short version`,
    blocks: workout.blocks.map((b) => ({ ...b, sets: b.sets ? Math.max(1, b.sets - 1) : undefined, minutes: Math.max(2, Math.round(b.minutes * 0.7)) })),
    noGymNote: 'Ten minutes still counts. Do the short version rather than nothing.',
  };
}

export function weeklySessionCount(logs: readonly WorkoutLog[], dates: readonly CalendarDay[]): number {
  const set = new Set(dates);
  return new Set(logs.filter((l) => set.has(l.date)).map((l) => l.date)).size;
}

export const MOTIVATION_LINES: readonly string[] = [
  'Ten minutes is still ten minutes.',
  'You do not need a good day to start, just a start.',
  'Consistency beats intensity.',
  'The best workout is the one you actually do.',
  'Showing up on the hard days is the whole trick.',
];

export function motivationFor(date: CalendarDay): string {
  const [y, m, d] = date.split('-').map(Number);
  const idx = Math.abs((y ?? 2026) * 17 + (m ?? 1) * 5 + (d ?? 1));
  return MOTIVATION_LINES[idx % MOTIVATION_LINES.length] ?? MOTIVATION_LINES[0] ?? '';
}

export function goalSuggestsRestDay(goal: FitnessGoal, sessionsThisWeek: number): boolean {
  if (sessionsThisWeek >= 4) return true;
  return goal === 'lose-fat' && sessionsThisWeek >= 5;
}

export function workoutWindow(profile: Profile, minutes: number): readonly [MinuteOfDay, MinuteOfDay] {
  const start = profile.schedule.exerciseMinute;
  return [start, start + Math.min(minutes, 60)];
}
