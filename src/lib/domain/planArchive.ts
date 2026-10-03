/**
 * Deciding what to archive, separately from doing it.
 *
 * This exists because the equivalent logic living inside the store's `useEffect`
 * was untestable and, more importantly, wrong: on a profile edit it dispatched a
 * revision, which changed state, which rebuilt the pipeline inputs, which re-ran
 * the effect with the snapshot still holding the old profile hash — so it
 * dispatched again. Forever. The tab froze the first time someone edited their
 * profile.
 *
 * As a pure function it can be asked the only question that matters: *is this
 * call idempotent?* `archiveDay` given its own output must return `write: false`.
 * If that ever stops being true, the store loop comes back and this test fails.
 */

import type { CalendarDay, DaySnapshot, PlanRevision } from './types/index';

export type SnapshotMap = Readonly<Record<CalendarDay, DaySnapshot>>;
export type RevisionMap = Readonly<Record<CalendarDay, PlanRevision>>;

export interface ArchiveInput {
  /** The date the user is currently looking at. */
  readonly today: CalendarDay;
  readonly snapshot: DaySnapshot;
  readonly snapshots: SnapshotMap;
  readonly revisions: RevisionMap;
  /** How many days to keep. */
  readonly retentionDays: number;
}

export interface ArchiveDecision {
  /** False means "nothing changed, do not dispatch". */
  readonly write: boolean;
  readonly snapshots: SnapshotMap;
  /** Non-null when this write also supersedes a plan the user had already seen. */
  readonly revision: PlanRevision | null;
}

/**
 * Keep the most recent `keep` snapshots.
 *
 * Keys are ISO dates, so lexical order is chronological order and nothing has to
 * be parsed. Local storage is a few megabytes and a snapshot is a few kilobytes;
 * an unbounded map would make every save slower and eventually fail outright.
 */
export function trimSnapshots(snapshots: SnapshotMap, keep: number): SnapshotMap {
  const keys = Object.keys(snapshots).sort();
  if (keys.length <= keep) return snapshots;
  const keepFrom = keys.length - keep;
  const out: Record<CalendarDay, DaySnapshot> = {};
  for (const [date, snapshot] of Object.entries(snapshots)) {
    if (keys.indexOf(date) >= keepFrom) out[date as CalendarDay] = snapshot;
  }
  return out;
}

export function archiveDay(input: ArchiveInput): ArchiveDecision {
  const { today, snapshot, snapshots, revisions, retentionDays } = input;

  // A snapshot of a day other than today is not a record of anything the user has
  // lived through. Writing the seven upcoming days on every tick would fill local
  // storage with plans that are still provisional.
  if (snapshot.date !== today) {
    return { write: false, snapshots, revision: null };
  }

  const existing = snapshots[today];
  if (existing && existing.profileHash === snapshot.profileHash) {
    // Already recorded. This early return is what makes the call idempotent.
    return { write: false, snapshots, revision: null };
  }

  // A profile or diet edit after the day was already planned replaces today's
  // plan — the user is looking at the app and expects it to follow their new
  // inputs — but the fact that it changed is recorded so the trail is not lost.
  const superseded = existing !== undefined && existing.profileHash !== snapshot.profileHash;
  const alreadyRecorded = revisions[today]?.profileHash === snapshot.profileHash;

  const revision: PlanRevision | null =
    superseded && !alreadyRecorded
      ? {
          date: today,
          version: (revisions[today]?.version ?? 0) + 1,
          reason: 'profile-changed',
          profileHash: snapshot.profileHash,
          previousProfileHash: existing.profileHash,
          at: snapshot.writtenAt,
        }
      : null;

  return {
    write: true,
    snapshots: trimSnapshots({ ...snapshots, [today]: snapshot }, retentionDays),
    revision,
  };
}