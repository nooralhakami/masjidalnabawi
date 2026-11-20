import doors3dRaw from '../../data/mosque-doors-3d.json';
import { POIS } from '../data';
import { motorEase } from './easing';

/**
 * Interactive multi-bay Mosque gates (`gate_inner` POIs 1..42), backed by exact 3D doorway bay
 * placements extracted from `haram-3d.glb` (`data/mosque-doors-3d.json`) with the owner's
 * bay counts and realistic partial-open defaults [2026-11-20]:
 * - Monumental 5-bay gateways (`8, 13, 17, 21, 25, 29, 34`): 5 bays, 2 open by default.
 * - Triple-bay gateways (`2, 5, 37`): 3 bays, 2 open by default.
 * - Double-bay gateways (`3, 4, 10, 11, 32, 38, 39`): 2 bays, 1 open by default (`32` always shut).
 * - Single-bay archways (remaining 25 gates): 1 bay, 1 open by default (`18, 23, 26, 31` shut).
 * - `ALWAYS_CLOSED_GATES` (`18, 23, 26, 31, 32`) remain locked (`0` open bays).
 * - `NEVER_CLOSED_GATES` (`1` Bab al-Salam, `2` Bab Abi Bakr Al-Siddiq) can never be closed to 0 bays.
 */

export const ALWAYS_CLOSED_GATES: ReadonlySet<number> = new Set([18, 23, 26, 31, 32]);
export const NEVER_CLOSED_GATES: ReadonlySet<number> = new Set([1, 2]);

export const MAJOR_MULTI_BAY_GATES: ReadonlySet<number> = new Set([8, 13, 17, 21, 25, 29, 34]);
export const TRIPLE_BAY_GATES: ReadonlySet<number> = new Set([2, 5, 37]);
export const DOUBLE_BAY_GATES: ReadonlySet<number> = new Set([3, 4, 10, 11, 32, 38, 39]);
/** Recessed inward-set archway portals (e.g. Gates 7 & 9) whose vaulted forecourt has an 8-point star marble floor. */
export const RECESSED_PORCH_GATES: ReadonlySet<number> = new Set([7, 9, 12, 14, 16, 18, 19, 20, 22, 23, 24, 26, 28, 30, 33, 35]);

export type WallSide = 'N' | 'S' | 'E' | 'W';
export type DoorStyle = 'monumental' | 'old_mosque' | 'arch';

export interface DoorBay {
  gateId: number;
  bayIndex: number;
  open: boolean;
  /** Center in glTF model metres `[east, south]`. */
  x: number;
  y: number;
  /** Center in `[lng, lat]`. */
  lng: number;
  lat: number;
  widthM: number;
  heightM: number;
}

export interface MosqueDoorState {
  id: number;
  nameAr: string;
  women: boolean;
  wall: WallSide;
  style: DoorStyle;
  totalBays: 1 | 2 | 3 | 5;
  defaultOpenBays: number;
  openBays: number;
  open: boolean;
  alwaysClosed: boolean;
  neverClosed: boolean;
  canToggle: boolean;
  /** Center in glTF model metres `[east, south]`. */
  x: number;
  y: number;
  tangent: readonly [number, number];
  outward: readonly [number, number];
  bays: DoorBay[];
}

export interface DoorToggleResult {
  ok: boolean;
  open: boolean;
  reason?: 'always_closed' | 'never_closed' | 'not_found';
  gate: MosqueDoorState | null;
}

interface RawDoorBay {
  bayIndex: number;
  x: number;
  z: number;
  lng: number;
  lat: number;
  widthM: number;
  heightM: number;
}

interface RawDoorGate {
  id: number;
  style: DoorStyle;
  totalBays: 1 | 2 | 3 | 5;
  defaultOpenBays: number;
  x: number;
  z: number;
  lng: number;
  lat: number;
  outward: [number, number];
  tangent: [number, number];
  bays: RawDoorBay[];
}

const RAW_GATES = new Map<number, RawDoorGate>((doors3dRaw as unknown as { gates: RawDoorGate[] }).gates.map((g) => [g.id, g]));

/** Smooth duration for swinging leaves (6-8 s per master plan §5.2). */
export const DOOR_SWING_MS = 7_000;
/** Full inward open angle (~95 deg into the Mosque vestibule). */
export const DOOR_OPEN_ANGLE_RAD = (95 * Math.PI) / 180;

function wallFromOutward([ox, oz]: readonly [number, number]): WallSide {
  if (ox < -0.5) return 'W';
  if (ox > 0.5) return 'E';
  if (oz < -0.5) return 'N';
  return 'S';
}

function defaultOpenForTotal(totalBays: 1 | 2 | 3 | 5, alwaysClosed: boolean): number {
  if (alwaysClosed) return 0;
  if (totalBays === 5 || totalBays === 3) return 2;
  return 1;
}

function defaultOpenIndices(totalBays: number, openCount: number): Set<number> {
  const out = new Set<number>();
  if (openCount <= 0) return out;
  const start = Math.floor((totalBays - openCount) / 2);
  for (let i = 0; i < openCount; i++) out.add(start + i);
  return out;
}

const initialGates = (): MosqueDoorState[] =>
  POIS.filter((p) => p.subCategory === 'gate_inner')
    .sort((a, b) => a.id - b.id)
    .map((poi) => {
      const raw = RAW_GATES.get(poi.id)!;
      const alwaysClosed = ALWAYS_CLOSED_GATES.has(poi.id);
      const neverClosed = NEVER_CLOSED_GATES.has(poi.id);
      const totalBays = raw.totalBays;
      const defaultOpenBays = defaultOpenForTotal(totalBays, alwaysClosed);
      const openSet = defaultOpenIndices(totalBays, defaultOpenBays);
      const openBays = openSet.size;
      // Right-handed tangent T such that T x (+Y) = outward: T = [oz, -ox]
      const outward: readonly [number, number] = [raw.outward[0], raw.outward[1]];
      const tangent: readonly [number, number] = [outward[1], -outward[0]];
      const bays: DoorBay[] = raw.bays.map((b) => ({
        gateId: poi.id,
        bayIndex: b.bayIndex,
        open: openSet.has(b.bayIndex),
        x: b.x,
        y: b.z,
        lng: b.lng,
        lat: b.lat,
        widthM: b.widthM,
        heightM: b.heightM,
      }));
      return {
        id: poi.id,
        nameAr: poi.name_ar,
        women: Boolean(poi.women),
        wall: wallFromOutward(outward),
        style: raw.style,
        totalBays,
        defaultOpenBays,
        openBays,
        open: openBays > 0,
        alwaysClosed,
        neverClosed,
        canToggle: !alwaysClosed && (!neverClosed || totalBays > 1),
        x: raw.x,
        y: raw.z,
        tangent,
        outward,
        bays,
      };
    });

let doorStates: MosqueDoorState[] = initialGates();
const listeners = new Set<() => void>();

function emitDoorChange(): void {
  for (const fn of listeners) fn();
}

export function getMosqueDoors(): readonly MosqueDoorState[] {
  return doorStates;
}

export function getGateDoorState(gateId: number): MosqueDoorState | undefined {
  return doorStates.find((g) => g.id === gateId);
}

export function isGateOpen(gateId: number): boolean {
  return getGateDoorState(gateId)?.open ?? false;
}

export function isBayOpen(gateId: number, bayIndex: number): boolean {
  return getGateDoorState(gateId)?.bays[bayIndex]?.open ?? false;
}

export function toggleGateDoor(gateId: number): DoorToggleResult {
  const idx = doorStates.findIndex((g) => g.id === gateId);
  if (idx < 0) return { ok: false, open: false, reason: 'not_found', gate: null };
  const current = doorStates[idx];
  if (current.alwaysClosed) return { ok: false, open: false, reason: 'always_closed', gate: current };
  if (current.neverClosed) return { ok: false, open: true, reason: 'never_closed', gate: current };

  const nextOpen = !current.open;
  const openSet = defaultOpenIndices(current.totalBays, nextOpen ? current.defaultOpenBays : 0);
  const updatedBays = current.bays.map((b) => ({ ...b, open: openSet.has(b.bayIndex) }));
  const openBays = updatedBays.filter((b) => b.open).length;
  const updated: MosqueDoorState = {
    ...current,
    open: openBays > 0,
    openBays,
    bays: updatedBays,
  };
  doorStates = doorStates.map((g, i) => (i === idx ? updated : g));
  emitDoorChange();
  return { ok: true, open: nextOpen, gate: updated };
}

/** Toggle a single doorway bay on a gate; protects `always_closed` and keeps >= 1 open bay on `never_closed` gates. */
export function toggleGateBay(gateId: number, bayIndex: number): DoorToggleResult {
  const idx = doorStates.findIndex((g) => g.id === gateId);
  if (idx < 0) return { ok: false, open: false, reason: 'not_found', gate: null };
  const current = doorStates[idx];
  const bay = current.bays[bayIndex];
  if (!bay) return { ok: false, open: current.open, reason: 'not_found', gate: current };
  if (current.alwaysClosed) return { ok: false, open: false, reason: 'always_closed', gate: current };
  if (current.neverClosed && bay.open && current.openBays <= 1) {
    return { ok: false, open: true, reason: 'never_closed', gate: current };
  }

  const nextBayOpen = !bay.open;
  const updatedBays = current.bays.map((b) => (b.bayIndex === bayIndex ? { ...b, open: nextBayOpen } : b));
  const openBays = updatedBays.filter((b) => b.open).length;
  const updated: MosqueDoorState = {
    ...current,
    open: openBays > 0,
    openBays,
    bays: updatedBays,
  };
  doorStates = doorStates.map((g, i) => (i === idx ? updated : g));
  emitDoorChange();
  return { ok: true, open: nextBayOpen, gate: updated };
}

/** The individual doorway bay nearest to `[x, y]` (model metres) within `maxDistM`, or null. */
export function nearestDoorBay(x: number, y: number, maxDistM = 14): { gate: MosqueDoorState; bay: DoorBay } | null {
  let best: { gate: MosqueDoorState; bay: DoorBay } | null = null;
  let bestD2 = maxDistM * maxDistM;
  for (const gate of doorStates) {
    for (const bay of gate.bays) {
      const dx = bay.x - x;
      const dy = bay.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = { gate, bay };
      }
    }
  }
  return best;
}

/** The gate whose doorway bay is nearest to `[x, y]` (model metres) within `maxDistM`, or null. */
export function nearestMosqueDoor(x: number, y: number, maxDistM = 14): MosqueDoorState | null {
  return nearestDoorBay(x, y, maxDistM)?.gate ?? null;
}

export function toggleNearestMosqueDoor(x: number, y: number, maxDistM = 14): DoorToggleResult {
  const best = nearestMosqueDoor(x, y, maxDistM);
  if (!best) return { ok: false, open: false, reason: 'not_found', gate: null };
  return toggleGateDoor(best.id);
}

export function toggleNearestDoorBay(x: number, y: number, maxDistM = 14): DoorToggleResult {
  const hit = nearestDoorBay(x, y, maxDistM);
  if (!hit) return { ok: false, open: false, reason: 'not_found', gate: null };
  return toggleGateBay(hit.gate.id, hit.bay.bayIndex);
}

export function resetMosqueDoors(): void {
  doorStates = initialGates();
  emitDoorChange();
}

export function subscribeMosqueDoors(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function openDoorwayBayCentres(): Array<{
  gateId: number;
  bayIndex: number;
  x: number;
  y: number;
  lng: number;
  lat: number;
  outward: readonly [number, number];
}> {
  const out: Array<{
    gateId: number;
    bayIndex: number;
    x: number;
    y: number;
    lng: number;
    lat: number;
    outward: readonly [number, number];
  }> = [];
  for (const gate of doorStates) {
    if (!gate.open) continue;
    for (const bay of gate.bays) {
      if (!bay.open) continue;
      out.push({
        gateId: gate.id,
        bayIndex: bay.bayIndex,
        x: bay.x,
        y: bay.y,
        lng: bay.lng,
        lat: bay.lat,
        outward: gate.outward,
      });
    }
  }
  return out;
}

export function doorBayKey(gateId: number, bayIndex: number): string {
  return `${gateId}:${bayIndex}`;
}

/** The door leaf's open fraction (0 shut .. 1 open) `elapsedMs` after a swing from `from` to `to`. */
export function doorSwingAt(from: number, to: number, elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / DOOR_SWING_MS));
  return from + (to - from) * motorEase(t);
}

export interface DoorKitMatrices {
  frames: Float32Array;
  leftLeaves: Float32Array;
  rightLeaves: Float32Array;
  glows: Float32Array;
  starFloors: Float32Array;
  bayKeys: string[];
}

/**
 * Column-major 4x4 WebGL instance matrices for every bay's frame, hinged left/right leaves
 * (rotating strictly inward along `-outward` by `DOOR_OPEN_ANGLE_RAD`), open floor light spill,
 * and recessed-porch star marble medallions (strictly on inward-set archway portals).
 */
export function buildDoorKitMatrices(doors: readonly MosqueDoorState[], openFraction: (gateId: number, bayIndex: number) => number): DoorKitMatrices {
  const total = doors.reduce((s, d) => s + d.bays.length, 0);
  const frames = new Float32Array(total * 16);
  const leftLeaves = new Float32Array(total * 16);
  const rightLeaves = new Float32Array(total * 16);
  const glows = new Float32Array(total * 16);
  const starList: number[] = [];
  const bayKeys: string[] = [];

  let i = 0;
  for (const gate of doors) {
    const [tx, tz] = gate.tangent;
    const [ox, oz] = gate.outward;
    const hasStarPorch = RECESSED_PORCH_GATES.has(gate.id);
    for (const bay of gate.bays) {
      const f = Math.max(0, Math.min(1, openFraction(gate.id, bay.bayIndex)));
      const key = doorBayKey(gate.id, bay.bayIndex);
      bayKeys.push(key);
      const off = i * 16;
      const w = bay.widthM;
      const h = bay.heightM;
      const halfW = w / 2;

      // Frame: placed at center + outward * 0.14 so its open portal aligns cleanly inside the wall cut
      frames.set([tx * w, 0, tz * w, 0, 0, h, 0, 0, ox, 0, oz, 0, bay.x + ox * 0.14, 0, bay.y + oz * 0.14, 1], off);

      if (hasStarPorch) {
        const sw = w * 1.15;
        const sd = 2.8;
        starList.push(tx * sw, 0, tz * sw, 0, 0, h, 0, 0, ox * sd, 0, oz * sd, 0, bay.x + ox * 0.14, 0, bay.y + oz * 0.14, 1);
      }

      // Hinge line at center + outward * 0.22; leaves swing strictly inward (toward -outward)
      const hx = bay.x + ox * 0.22;
      const hz = bay.y + oz * 0.22;
      const theta = f * DOOR_OPEN_ANGLE_RAD;
      const c = Math.cos(theta);
      const s = Math.sin(theta);

      // Left hinge at -T * halfW
      const lx = hx - tx * halfW;
      const lz = hz - tz * halfW;
      leftLeaves.set([(c * tx - s * ox) * halfW, 0, (c * tz - s * oz) * halfW, 0, 0, h, 0, 0, s * tx + c * ox, 0, s * tz + c * oz, 0, lx, 0, lz, 1], off);

      // Right hinge at +T * halfW
      const rx = hx + tx * halfW;
      const rz = hz + tz * halfW;
      rightLeaves.set([(c * tx + s * ox) * halfW, 0, (c * tz + s * oz) * halfW, 0, 0, h, 0, 0, -s * tx + c * ox, 0, -s * tz + c * oz, 0, rx, 0, rz, 1], off);

      // Threshold light spill outside open bays (zero-scaled when closed)
      const gW = f > 0.02 ? w * 0.92 * (0.45 + 0.55 * f) : 0;
      const gD = f > 0.02 ? 2.4 * f : 0;
      glows.set([tx * gW, 0, tz * gW, 0, 0, f > 0.02 ? 1 : 0, 0, 0, ox * gD, 0, oz * gD, 0, bay.x + ox * 0.26, 0, bay.y + oz * 0.26, 1], off);

      i++;
    }
  }

  return { frames, leftLeaves, rightLeaves, glows, starFloors: new Float32Array(starList), bayKeys };
}

/**
 * Pack doorway cut boxes into an `N x 2` RGBA32F array (`N * 8` floats) so `glb-layer.ts`
 * discards the opaque `haram-3d.glb` doorway wall inside `[0 .. heightM * 0.99]`.
 */
export function buildDoorCutBoxes(doors: readonly MosqueDoorState[]): { count: number; data: Float32Array } {
  const bays: { minX: number; minZ: number; maxX: number; maxZ: number; maxY: number }[] = [];
  for (const gate of doors) {
    const [tx, tz] = gate.tangent;
    const [ox, oz] = gate.outward;
    for (const bay of gate.bays) {
      const halfT = bay.widthM * 0.46;
      const inExt = -2.4;
      const outExt = 0.55;
      const corners = [
        [bay.x - tx * halfT + ox * inExt, bay.y - tz * halfT + oz * inExt],
        [bay.x + tx * halfT + ox * inExt, bay.y + tz * halfT + oz * inExt],
        [bay.x - tx * halfT + ox * outExt, bay.y - tz * halfT + oz * outExt],
        [bay.x + tx * halfT + ox * outExt, bay.y + tz * halfT + oz * outExt],
      ];
      const xs = corners.map((p) => p[0]);
      const zs = corners.map((p) => p[1]);
      bays.push({
        minX: Math.min(...xs),
        minZ: Math.min(...zs),
        maxX: Math.max(...xs),
        maxZ: Math.max(...zs),
        maxY: bay.heightM * 0.99,
      });
    }
  }
  const count = bays.length;
  const data = new Float32Array(count * 2 * 4);
  bays.forEach((b, idx) => {
    data.set([b.minX, b.minZ, b.maxX, b.maxZ], idx * 4);
    data.set([b.maxY, 0, 0, 0], (count + idx) * 4);
  });
  return { count, data };
}
