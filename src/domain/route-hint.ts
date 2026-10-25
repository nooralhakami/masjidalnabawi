import { POIS } from '../data';
import type { LatLng, Poi } from '../data/types';
import { haversine, ll } from './geo';
import { parkingEntrances } from './parking';

/**
 * The place named, faintly, over itself while the visitor goes by it on a route (owner, 2026-10-25),
 * so they can tell they are on the right way: a gate or a restroom block on foot, a car park by car.
 * Pure: the map draws it (src/map/hints.ts), the trip feeds it the position (src/app/trip.ts).
 */

/** Worse than this, no name is shown: a wrong neighbour would mislead more than nothing (as the status line, tracker.ts). */
export const HINT_MAX_ACCURACY_M = 35;
/** A gate or restroom block is named from this close, on foot. */
export const HINT_WALK_M = 25;
/** A car park is named from this close to its area, by car. */
export const HINT_LOT_M = 20;
/** The one named stays named this much farther than it would have been picked up. */
export const HINT_KEEP_EXTRA_M = 8;
/** Another replaces it only if it is this much nearer, and the first has been shown this long (no flicker at a crossing). */
export const HINT_SWITCH_GAIN_M = 6;
export const HINT_HOLD_MS = 3_000;

/** Places named when tapped on a route, with no card (owner, 2026-10-25): every gate and every restroom block. */
export const isTapName = (p: Poi): boolean => p.category === 'gates' || (p.category === 'toilets' && p.subCategory !== 'wheelchair_zone');

const WALK_POIS = POIS.filter(isTapName);
const LOTS = POIS.filter((p) => p.category === 'parking');

const M_PER_DEG = 111_320;

/** Metres from a point to a lot's area (0 inside): the box round its four facilities. */
function lotDistance(from: LatLng, lot: Poi): number {
  const f = parkingEntrances(lot);
  if (f.length < 4) return Infinity;
  const lats = f.map((p) => p.lat);
  const lngs = f.map((p) => p.lng);
  const dLat = Math.max(Math.min(...lats) - from[0], 0, from[0] - Math.max(...lats)) * M_PER_DEG;
  const dLng = Math.max(Math.min(...lngs) - from[1], 0, from[1] - Math.max(...lngs)) * M_PER_DEG * Math.cos((from[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** The candidates for a way of travel with their distance from a position, nearest first. */
function near(from: LatLng, mode: 'walk' | 'drive'): { id: number; m: number; reach: number }[] {
  const list =
    mode === 'drive'
      ? LOTS.map((p) => ({ id: p.id, m: lotDistance(from, p), reach: HINT_LOT_M }))
      : WALK_POIS.map((p) => ({ id: p.id, m: haversine(from, ll(p)), reach: HINT_WALK_M }));
  return list.sort((a, b) => a.m - b.m);
}

/**
 * Which place to name now. Keeps the same one while the visitor is by it, and changes only when
 * another is clearly nearer and the first has had its time (so the label does not jump between two
 * gates that are side by side).
 */
export class HintPicker {
  private current: number | null = null;
  private since = 0;

  /** The place to name, or null (no position, a poor one, or nothing close). */
  pick(from: LatLng | null, accuracy: number, mode: 'walk' | 'drive', now: number): number | null {
    if (!from || !(accuracy <= HINT_MAX_ACCURACY_M)) return this.set(null, now);
    const list = near(from, mode);
    const best = list[0];
    const cur = this.current === null ? undefined : list.find((x) => x.id === this.current);
    if (cur && cur.m <= cur.reach + HINT_KEEP_EXTRA_M) {
      const better = best && best.id !== cur.id && best.m <= best.reach && best.m + HINT_SWITCH_GAIN_M < cur.m && now - this.since >= HINT_HOLD_MS;
      return better ? this.set(best.id, now) : this.current;
    }
    return this.set(best && best.m <= best.reach ? best.id : null, now);
  }

  reset(): void {
    this.current = null;
  }

  private set(id: number | null, now: number): number | null {
    if (id !== this.current) this.since = now;
    this.current = id;
    return id;
  }
}
