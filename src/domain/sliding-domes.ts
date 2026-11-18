/**
 * The Mosque's 27 sliding domes (owner, 2026-11-18).
 *
 * Where they stand: navQ's roof plan (floor 24: 27 circles of 18 m over 27 openings of 19 m, a
 * 25.2 m grid in nine groups of three), which matches the 27 instances of the dome unit in navQ's
 * `haram-3d.glb` exactly. The 3D layer reads the instances' positions and hands them here.
 *
 * How they move (owner): "north and south, towards their larger space: the northern ones move
 * south and the southern ones north, by the dome's own size". The rows split at the middle of the
 * dome rows: the two northern rows slide south, the two southern rows north, by `DOME_SLIDE_M`.
 * They open slowly and close again at a tap.
 *
 * Numbering (as the owner's review board): rows from south to north, and west to east in a row.
 */

import { motorEase } from './easing';

/** The dome's own size: navQ's dome is 18 m across, and the two middle rows (55.2 m apart in the
 * model, whose unit is 19.2 m wide) then meet without overlapping when all are open. */
export const DOME_SLIDE_M = 18;
/** Opening or closing takes this long: slowly, as the owner asked. */
export const DOME_SLIDE_MS = 15000;
/** Domes within this many metres along the north–south axis share a row. */
const ROW_TOLERANCE_M = 6;

export interface SlidingDome {
  /** 1..27, rows south to north, west to east within a row. */
  n: number;
  /** Which model instance this is (its order in the 3D layer's instance list). */
  instance: number;
  /** Centre when closed, glTF model metres `[east, south]`. */
  east: number;
  south: number;
  half: 'north' | 'south';
  /** Metres along the model's south axis when fully open: + slides south, − slides north. */
  slideSouth: number;
}

/** The domes from their instances' `[east, south]` centres (model metres), in instance order. */
export function buildSlidingDomes(centres: readonly (readonly [number, number])[]): SlidingDome[] {
  if (!centres.length) return [];
  const rows: number[] = [];
  for (const [, south] of [...centres].sort((a, b) => a[1] - b[1])) {
    if (!rows.length || south - rows[rows.length - 1] > ROW_TOLERANCE_M) rows.push(south);
  }
  // `south` grows southwards: the first row is the northernmost.
  const middle = (rows[0] + rows[rows.length - 1]) / 2;
  const rowOf = (south: number) => rows.findIndex((r) => Math.abs(r - south) <= ROW_TOLERANCE_M);
  const order = centres
    .map((c, instance) => ({ instance, east: c[0], south: c[1], row: rowOf(c[1]) }))
    // South to north (row descending), then west to east.
    .sort((a, b) => b.row - a.row || a.east - b.east);
  return order
    .map((d, i) => {
      const north = d.south < middle;
      return {
        n: i + 1,
        instance: d.instance,
        east: d.east,
        south: d.south,
        half: north ? ('north' as const) : ('south' as const),
        slideSouth: north ? DOME_SLIDE_M : -DOME_SLIDE_M,
      };
    })
    .sort((a, b) => a.instance - b.instance);
}

/**
 * How open a dome is at `ms` into a move from `from` to `to` (0 closed, 1 open). It is heavy and
 * rides on rails: it starts gently, rolls, and slows into place. `duration` 0 jumps (reduced motion).
 */
export function domeSlideAt(from: number, to: number, ms: number, duration = DOME_SLIDE_MS * Math.abs(to - from)): number {
  return from + (to - from) * motorEase(duration <= 0 ? 1 : ms / duration);
}

// ---------- which domes the visitor opened ----------

const openDomes = new Set<number>();
const listeners = new Set<() => void>();

/** Whether the visitor has opened dome `n` (they start closed). */
export function isDomeOpen(n: number): boolean {
  return openDomes.has(n);
}

/** Opens dome `n` if closed, closes it if open; returns whether it is now open. */
export function toggleDome(n: number): boolean {
  if (openDomes.has(n)) openDomes.delete(n);
  else openDomes.add(n);
  for (const fn of listeners) fn();
  return openDomes.has(n);
}

/** Closes every dome (tests, and a fresh scene). */
export function resetDomes(): void {
  openDomes.clear();
  for (const fn of listeners) fn();
}

export function subscribeDomes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
