import type { XY } from './frames';
import type { DoorBay, MosqueDoorState } from './mosque-doors';

/**
 * Strict doorway-only camera entry policy (owner, 2026-11-20):
 * - Visitors CANNOT zoom down or clip through the solid Mosque roof or exterior masonry walls.
 * - Close-up entry into the interior (`zoom >= ENTRY_ZOOM_THRESHOLD`) is allowed ONLY by passing
 *   through an open doorway bay (`openFraction >= DOOR_PASS_OPEN_MIN`).
 * - Once inside, visitors can inspect the real 3D interior hall freely; zooming out above the
 *   roof (`zoom < EXIT_ZOOM_THRESHOLD && eyeY > MOSQUE_ROOF_ALT_M`) exits cleanly.
 */

export const ENTRY_ZOOM_THRESHOLD = 19.2;
export const ROOF_CLAMP_ZOOM = 19.15;
export const EXIT_ZOOM_THRESHOLD = 18.8;
export const MOSQUE_ROOF_ALT_M = 13.5;
export const DOOR_PASS_OPEN_MIN = 0.35;

/** Core exterior masonry boundaries in glTF model metres `[minX, minZ, maxX, maxZ]`. */
export const MAIN_WALL_BOX = [-258.2, -348.1, 138.4, -121.4] as const;
export const SOUTH_WALL_BOX = [-106.7, -121.4, -13.0, -57.64] as const;

/** Recessed doorway forecourts that sit outside the door leaf line inside the main bbox. */
const RECESSED_ALCoves: readonly (readonly [number, number, number, number])[] = [
  [-258.3, -228.5, -252.2, -203.5], // Gate 10 west recess
  [-129.0, -348.2, -115.5, -341.0], // Gate 19 north recess
  [-4.5, -348.2, 9.0, -341.0], // Gate 23 north recess
  [132.3, -226.5, 138.5, -207.0], // Gate 32 east recess
  [-234.5, -348.2, -222.0, -343.2], // Gate 15 north-west step
  [98.0, -348.2, 110.5, -343.2], // Gate 27 north-east step
];

/** Projecting southern monumental entrance pavilions (Gates 5 & 37). */
const PROJECTING_PAVILIONS: readonly (readonly [number, number, number, number])[] = [
  [-196.2, -121.4, -173.2, -113.65], // Gate 5 pavilion
  [53.4, -121.4, 76.4, -113.65], // Gate 37 pavilion
];

const inBox = ([x, z]: XY, b: readonly [number, number, number, number]): boolean => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];

export function isInsideMosqueWall(p: XY): boolean {
  if (inBox(p, SOUTH_WALL_BOX)) return true;
  if (PROJECTING_PAVILIONS.some((b) => inBox(p, b))) return true;
  if (!inBox(p, MAIN_WALL_BOX)) return false;
  return !RECESSED_ALCoves.some((b) => inBox(p, b));
}

export interface CameraEntrySample {
  center: XY;
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  zoom: number;
}

export interface CameraEntryPrev extends CameraEntrySample {
  inside: boolean;
}

export interface MosqueEntryResult {
  allowed: boolean;
  inside: boolean;
  blocked: boolean;
  reason?: 'closed_door' | 'solid_wall' | 'roof';
  clampedCenter?: XY;
  clampedZoom?: number;
  enteredGateId?: number;
  enteredBayIndex?: number;
}

function crossesBay(a: XY, b: XY, gate: MosqueDoorState, bay: DoorBay): boolean {
  const [tx, tz] = gate.tangent;
  const [ox, oz] = gate.outward;
  const halfPass = bay.widthM * 0.56;

  // Check distance along tangent & signed depth across wall plane at both endpoints and segment crossing.
  const daN = (a[0] - bay.x) * ox + (a[1] - bay.y) * oz;
  const dbN = (b[0] - bay.x) * ox + (b[1] - bay.y) * oz;
  const daT = (a[0] - bay.x) * tx + (a[1] - bay.y) * tz;
  const dbT = (b[0] - bay.x) * tx + (b[1] - bay.y) * tz;

  // Segment passes across (or lands just inside/at) the open bay portal corridor
  if (Math.min(daN, dbN) <= 4.5 && Math.max(daN, dbN) >= -4.5) {
    // Interpolate tangent offset where the segment crosses n = 0 (or pick closest point inside band)
    const denom = daN - dbN;
    const t = Math.abs(denom) > 1e-4 ? Math.max(0, Math.min(1, daN / denom)) : 0.5;
    const crossT = daT + (dbT - daT) * t;
    if (Math.abs(crossT) <= halfPass || Math.min(Math.abs(daT), Math.abs(dbT)) <= halfPass) {
      return true;
    }
  }
  return false;
}

function findMatchingOpenBay(
  prev: XY,
  next: XY,
  eye: XY,
  doors: readonly MosqueDoorState[],
  openFraction: (gateId: number, bayIndex: number) => number,
): { gate: MosqueDoorState; bay: DoorBay } | null {
  for (const gate of doors) {
    if (!gate.open) continue;
    for (const bay of gate.bays) {
      if (!bay.open || openFraction(gate.id, bay.bayIndex) < DOOR_PASS_OPEN_MIN) continue;
      if (crossesBay(prev, next, gate, bay) || crossesBay(eye, next, gate, bay)) {
        return { gate, bay };
      }
    }
  }
  return null;
}

function nearestBayToPoint(p: XY, doors: readonly MosqueDoorState[]): { gate: MosqueDoorState; bay: DoorBay; dist: number } | null {
  let best: { gate: MosqueDoorState; bay: DoorBay; dist: number } | null = null;
  for (const gate of doors) {
    for (const bay of gate.bays) {
      const dist = Math.hypot(p[0] - bay.x, p[1] - bay.y);
      if (!best || dist < best.dist) best = { gate, bay, dist };
    }
  }
  return best;
}

/** Clamp a blocked target point 0.9 m outside the nearest exterior Mosque wall face. */
function clampOutsideWall(next: XY, prev: XY): XY {
  const px = isInsideMosqueWall(prev) ? prev : next;
  // Project to nearest boundary of the active enclosing box (or push back to `prev` if unambiguous).
  const boxes = [...PROJECTING_PAVILIONS, SOUTH_WALL_BOX, MAIN_WALL_BOX];
  let bestPt: XY = prev;
  let bestD = Infinity;
  for (const b of boxes) {
    if (!inBox(px, b)) continue;
    const candidates: XY[] = [
      [b[0] - 0.9, px[1]],
      [b[2] + 0.9, px[1]],
      [px[0], b[1] - 0.9],
      [px[0], b[3] + 0.9],
    ];
    for (const c of candidates) {
      if (isInsideMosqueWall(c)) continue;
      const d = Math.hypot(c[0] - px[0], c[1] - px[1]);
      if (d < bestD) {
        bestD = d;
        bestPt = c;
      }
    }
  }
  if (!isInsideMosqueWall(bestPt)) return bestPt;
  return isInsideMosqueWall(prev) ? [MAIN_WALL_BOX[0] - 1.2, prev[1]] : prev;
}

export function guardMosqueCameraEntry(
  prev: CameraEntryPrev,
  next: CameraEntrySample,
  doors: readonly MosqueDoorState[],
  openFraction: (gateId: number, bayIndex: number) => number = (_g, _b) => 1,
): MosqueEntryResult {
  const effOpen = (g: number, b: number) => {
    const gate = doors.find((d) => d.id === g);
    const bay = gate?.bays[b];
    if (!gate?.open || !bay?.open) return 0;
    return openFraction(g, b);
  };

  if (prev.inside) {
    if (next.zoom < EXIT_ZOOM_THRESHOLD && next.eyeY > MOSQUE_ROOF_ALT_M) {
      return { allowed: true, inside: false, blocked: false };
    }
    if (isInsideMosqueWall(next.center)) {
      return { allowed: true, inside: true, blocked: false };
    }
    return { allowed: true, inside: false, blocked: false };
  }

  // Outside the Mosque currently (`!prev.inside`): allow free high-altitude flight above the roof.
  if (next.zoom < ENTRY_ZOOM_THRESHOLD && next.eyeY > MOSQUE_ROOF_ALT_M) {
    return { allowed: true, inside: false, blocked: false };
  }

  const prevIn = isInsideMosqueWall(prev.center);
  const nextIn = isInsideMosqueWall(next.center);
  const eyeJustEntered = !isInsideMosqueWall([prev.eyeX, prev.eyeZ]) && isInsideMosqueWall([next.eyeX, next.eyeZ]) && next.eyeY <= MOSQUE_ROOF_ALT_M;

  // 1. Zooming vertically down through the roof over the Mosque (no horizontal door crossing)
  if (prevIn && nextIn) {
    const openHit = findMatchingOpenBay(prev.center, next.center, [next.eyeX, next.eyeZ], doors, effOpen);
    if (openHit) {
      return {
        allowed: true,
        inside: true,
        blocked: false,
        enteredGateId: openHit.gate.id,
        enteredBayIndex: openHit.bay.bayIndex,
      };
    }
    return {
      allowed: false,
      inside: false,
      blocked: true,
      reason: 'roof',
      clampedCenter: prev.center,
      clampedZoom: Math.min(prev.zoom, ROOF_CLAMP_ZOOM),
    };
  }

  // 2. Trying to enter horizontally through a perimeter wall / doorway or swoop low camera through wall
  if ((!prevIn && nextIn) || eyeJustEntered) {
    const openHit = findMatchingOpenBay(prev.center, next.center, [next.eyeX, next.eyeZ], doors, effOpen);
    if (openHit) {
      return {
        allowed: true,
        inside: true,
        blocked: false,
        enteredGateId: openHit.gate.id,
        enteredBayIndex: openHit.bay.bayIndex,
      };
    }
    const near = nearestBayToPoint(nextIn ? next.center : [next.eyeX, next.eyeZ], doors);
    const reason = near && near.dist <= 4.2 ? 'closed_door' : 'solid_wall';
    const clampedCenter = !prevIn && nextIn ? clampOutsideWall(next.center, prev.center) : prev.center;
    const clampedZoom = eyeJustEntered && next.zoom > prev.zoom ? prev.zoom : undefined;
    return {
      allowed: false,
      inside: false,
      blocked: true,
      reason,
      clampedCenter,
      clampedZoom,
    };
  }

  return { allowed: true, inside: false, blocked: false };
}
