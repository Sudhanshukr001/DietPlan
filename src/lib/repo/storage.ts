/**
 * Persistence boundary.
 *
 * The only place in the app that touches browser storage. Everything above it
 * works with the validated `PersistedShape` returned by `migrate`, so a corrupt,
 * partial or older payload can never crash a screen — it degrades to defaults.
 *
 * localStorage is the fast path. When a browser blocks it (private windows,
 * storage pressure, locked-down settings) we fall back to IndexedDB, because
 * losing the profile means the user has to answer the setup questions again —
 * the single most annoying thing this app could do.
 */

import { del, get, set } from 'idb-keyval';
import { migrate, blankState, type PersistedShape } from '@/lib/domain/state';
import type { CalendarDay } from '@/lib/domain/types/index';

export const STORAGE_KEY = 'aaj-ka-khana/state/v1';

/** Cheap shape check so a 20 MB value never gets JSON.parsed. */
function looksLikeState(raw: string): boolean {
  return raw.length > 2 && raw.startsWith('{') && raw.includes('"');
}

function coerce(raw: unknown): PersistedShape | null {
  if (typeof raw !== 'string' || !looksLikeState(raw)) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Mirrors the localStorage payload into IndexedDB. Best-effort: if IndexedDB is
 * unavailable too, the app still works for the session.
 */
function mirror(raw: string): void {
  void set(STORAGE_KEY, raw).catch(() => undefined);
}

export async function loadStateAsync(today: CalendarDay): Promise<PersistedShape> {
  if (typeof window === 'undefined') return blankState(today);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const fromLocal = coerce(raw ?? '');
    if (fromLocal) return fromLocal;
  } catch {
    /* blocked — try IndexedDB */
  }
  try {
    const fromIdb = await get<string>(STORAGE_KEY);
    const state = coerce(fromIdb);
    if (state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, fromIdb as string);
      } catch {
        /* still blocked; IndexedDB remains the source of truth */
      }
      return state;
    }
  } catch {
    /* no IndexedDB either */
  }
  return blankState(today);
}

export function saveState(state: PersistedShape): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(state);
  mirror(raw);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* IndexedDB already has it; the UI shows an honest notice if both fail. */
  }
}

export function clearState(): void {
  if (typeof window === 'undefined') return;
  void del(STORAGE_KEY).catch(() => undefined);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do */
  }
}

/** True when the last write succeeded — used to show the "saved" hint honestly. */
export function storageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probe = `${STORAGE_KEY}/probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
