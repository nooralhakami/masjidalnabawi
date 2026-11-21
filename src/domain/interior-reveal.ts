import type { XY } from './frames';
import { MOSQUE_MAIN, MOSQUE_SOUTH } from './prayer-layout';

/**
 * Where the Mosque opens to show its interior (owner, 2026-11-18): «by default the Mosque is seen
 * from outside, with its domes, minarets and gates as before; the interior shows only in special
 * cases». Those cases:
 *  - the interior view (the layers button's mode): all of it, the roof and walls faded (`glb-layer`);
 *  - a sliding dome opened from above: the opening under it (the roof has it, `glb-layer` draws the
 *    columns and arches under it while any dome stands open);
 *  - a gate the visitor tapped, once zoomed in: the roof lifts over the bays just inside it;
 *  - a route that walks inside the Mosque, once zoomed in: the roof lifts along it.
 * This module says where the roof lifts, in the models' metres (x east, z south); the map cuts it.
 */

/** The zoom (the live app's Leaflet scale) at which the roof starts to lift, and is fully lifted. */
export const REVEAL_LEGACY_ZOOM: readonly [number, number] = [18.6, 19.3];
/** Over a tapped gate: a disc this wide, its centre this far inside the gate. */
export const DOOR_REVEAL_RADIUS_M = 24;
export const DOOR_REVEAL_INSET_M = 15;
/** Along a route inside the Mosque: a lane this far to each side of the walking line. */
export const LANE_REVEAL_HALF_M = 9;
/** At most this many of the route's stretches (the nearest to the view's centre) are lifted at once. */
export const MAX_REVEAL_LANES = 8;

/** A gate to look in through: its centre and the way out of the Mosque (`MosqueDoorState`). */
export interface RevealDoor {
  x: number;
  z: number;
  outward: readonly [number, number];
}

export interface RevealInput {
  /** The map's zoom on the live app's (Leaflet) scale (`legacyZoom`). */
  legacyZoom: number;
  door: RevealDoor | null;
  /** The routes on the map (the followed one and its sub-route, `مسار فرعي`), in the models' metres. */
  routes: readonly (readonly XY[])[];
  /** The view's centre, in the models' metres: the lanes nearest to it are the ones lifted. */
  centre: XY;
}

export interface InteriorReveal {
  /** 0: the Mosque whole, as seen from outside; up to 1 with the zoom. */
  share: number;
  /** Discs `[x, z, radius]` where the roof is lifted. */
  discs: [number, number, number][];
  /** Lanes `[ax, az, bx, bz]` where the roof is lifted `laneHalf` to each side. */
  lanes: [number, number, number, number][];
  laneHalf: number;
}

export const NO_REVEAL: InteriorReveal = { share: 0, discs: [], lanes: [], laneHalf: 0 };

const inBox = ([x, z]: XY, b: readonly [number, number, number, number]) => Math.abs(x - b[0]) <= b[2] && Math.abs(z - b[1]) <= b[3];

/** Is `p` (models' metres) under the Mosque's roof line: its main block or the old southern one? */
export const insideMosqueMetres = (p: XY): boolean => inBox(p, MOSQUE_MAIN) || inBox(p, MOSQUE_SOUTH);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The part of `a`→`b` under the roof, or null: the crossing found by halving, to a few centimetres. */
function insidePart(a: XY, b: XY): [XY, XY] | null {
  const ia = insideMosqueMetres(a);
  const ib = insideMosqueMetres(b);
  if (ia && ib) return [a, b];
  if (!ia && !ib) return null;
  let [lo, hi] = ia ? [0, 1] : [1, 0];
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const p: XY = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
    if (insideMosqueMetres(p)) lo = mid;
    else hi = mid;
  }
  const edge: XY = [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  return ia ? [a, edge] : [edge, b];
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = dx * dx + dz * dz;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Where the roof lifts for this zoom, tapped gate and route (see the module's note). */
export function interiorReveal(input: RevealInput): InteriorReveal {
  const share = smoothstep(REVEAL_LEGACY_ZOOM[0], REVEAL_LEGACY_ZOOM[1], input.legacyZoom);
  if (share <= 0) return NO_REVEAL;
  // Tapping or zooming to a gate must NEVER punch a hole through the roof (owner, 2026-11-20);
  // visitors look and enter directly through the open 3D doorways instead.
  const discs: [number, number, number][] = [];
  const parts: { seg: [XY, XY]; d: number }[] = [];
  for (const route of input.routes)
    for (let i = 1; i < route.length; i++) {
      const seg = insidePart(route[i - 1], route[i]);
      if (seg) parts.push({ seg, d: distToSegment(input.centre, seg[0], seg[1]) });
    }
  parts.sort((p, q) => p.d - q.d);
  const lanes = parts.slice(0, MAX_REVEAL_LANES).map(({ seg: [a, b] }): [number, number, number, number] => [a[0], a[1], b[0], b[1]]);
  if (!discs.length && !lanes.length) return NO_REVEAL;
  return { share, discs, lanes, laneHalf: LANE_REVEAL_HALF_M * share };
}

/** Is `p` (models' metres) where the roof is lifted? (The shader's test, for the tests and the props.) */
export function revealedAt(r: InteriorReveal, p: XY): boolean {
  for (const [x, z, radius] of r.discs) if (Math.hypot(p[0] - x, p[1] - z) < radius) return true;
  for (const [ax, az, bx, bz] of r.lanes) if (distToSegment(p, [ax, az], [bx, bz]) < r.laneHalf) return true;
  return false;
}
