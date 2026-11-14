import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { POIS } from '../data';
import { fromModelMetres, toModelMetres } from './frames';

/**
 * Interactive multi-bay Mosque gates (`gate_inner` POIs 1..42):
 * - Multi-bay main/named gates (`MAJOR_MULTI_BAY_GATES`, 5 bays) open 3 central bays by default.
 * - Multi-bay numbered gates (`NUMBERED_MULTI_BAY_GATES`, 3 bays) open 2 central bays by default.
 * - Single-bay gates (`totalBays = 1`) open 1 bay by default.
 * - `ALWAYS_CLOSED_GATES` (`18, 23, 26, 31, 32`) remain locked (`0` open bays) and cannot be opened.
 * - `NEVER_CLOSED_GATES` (`1` Bab al-Salam, `2` Bab Abi Bakr Al-Siddiq) stay open and cannot be closed.
 */

export const ALWAYS_CLOSED_GATES: ReadonlySet<number> = new Set([18, 23, 26, 31, 32]);
export const NEVER_CLOSED_GATES: ReadonlySet<number> = new Set([1, 2]);

export const MAJOR_MULTI_BAY_GATES: ReadonlySet<number> = new Set([7, 8, 9, 13, 16, 17, 19, 20, 21, 22, 23, 24, 25, 28, 29, 33, 34, 35, 37, 38]);

export const NUMBERED_MULTI_BAY_GATES: ReadonlySet<number> = new Set([6, 10, 12, 14, 15, 18, 26, 27, 30, 31, 36]);

export type WallSide = 'N' | 'S' | 'E' | 'W';

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
}

export interface MosqueDoorState {
  id: number;
  nameAr: string;
  women: boolean;
  wall: WallSide;
  totalBays: 1 | 3 | 5;
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

const BAY_SPACING_M = 3.2;
const BAY_WIDTH_M = 2.4;
const BAY_DEPTH_M = 1.6;

function wallForGate(id: number): { wall: WallSide; tangent: readonly [number, number]; outward: readonly [number, number] } {
  if (id === 1 || id === 2 || (id >= 7 && id <= 14)) {
    return { wall: 'W', tangent: [0, 1], outward: [-1, 0] };
  }
  if ((id >= 28 && id <= 35) || id === 40 || id === 41) {
    return { wall: 'E', tangent: [0, 1], outward: [1, 0] };
  }
  if (id >= 15 && id <= 27) {
    return { wall: 'N', tangent: [1, 0], outward: [0, -1] };
  }
  return { wall: 'S', tangent: [1, 0], outward: [0, 1] };
}

function defaultTotalAndOpen(id: number): { totalBays: 1 | 3 | 5; defaultOpenBays: number; alwaysClosed: boolean; neverClosed: boolean } {
  const alwaysClosed = ALWAYS_CLOSED_GATES.has(id);
  const neverClosed = NEVER_CLOSED_GATES.has(id);
  const totalBays: 1 | 3 | 5 = MAJOR_MULTI_BAY_GATES.has(id) ? 5 : NUMBERED_MULTI_BAY_GATES.has(id) ? 3 : 1;
  const openCountWhenActive = totalBays === 5 ? 3 : totalBays === 3 ? 2 : 1;
  return {
    totalBays,
    defaultOpenBays: alwaysClosed ? 0 : openCountWhenActive,
    alwaysClosed,
    neverClosed,
  };
}

function buildBays(id: number, cx: number, cy: number, tangent: readonly [number, number], totalBays: 1 | 3 | 5, openBays: number): DoorBay[] {
  const bays: DoorBay[] = [];
  const halfSpan = (totalBays - 1) / 2;
  const openStart = openBays > 0 ? Math.floor((totalBays - openBays) / 2) : totalBays;
  const openEnd = openBays > 0 ? openStart + openBays : -1;
  for (let i = 0; i < totalBays; i++) {
    const offset = (i - halfSpan) * BAY_SPACING_M;
    const x = cx + tangent[0] * offset;
    const y = cy + tangent[1] * offset;
    const [lng, lat] = fromModelMetres([x, y]);
    bays.push({
      gateId: id,
      bayIndex: i,
      open: i >= openStart && i < openEnd,
      x,
      y,
      lng,
      lat,
    });
  }
  return bays;
}

const initialGates = (): MosqueDoorState[] =>
  POIS.filter((p) => p.subCategory === 'gate_inner')
    .sort((a, b) => a.id - b.id)
    .map((poi) => {
      const [x, y] = toModelMetres([poi.lng, poi.lat]);
      const { wall, tangent, outward } = wallForGate(poi.id);
      const { totalBays, defaultOpenBays, alwaysClosed, neverClosed } = defaultTotalAndOpen(poi.id);
      const open = !alwaysClosed;
      const openBays = open ? defaultOpenBays : 0;
      return {
        id: poi.id,
        nameAr: poi.name_ar,
        women: Boolean(poi.women),
        wall,
        totalBays,
        defaultOpenBays,
        openBays,
        open,
        alwaysClosed,
        neverClosed,
        canToggle: !alwaysClosed && !neverClosed,
        x,
        y,
        tangent,
        outward,
        bays: buildBays(poi.id, x, y, tangent, totalBays, openBays),
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

export function toggleGateDoor(gateId: number): DoorToggleResult {
  const idx = doorStates.findIndex((g) => g.id === gateId);
  if (idx < 0) return { ok: false, open: false, reason: 'not_found', gate: null };
  const current = doorStates[idx];
  if (current.alwaysClosed) return { ok: false, open: false, reason: 'always_closed', gate: current };
  if (current.neverClosed) return { ok: false, open: true, reason: 'never_closed', gate: current };

  const nextOpen = !current.open;
  const activeCount = current.totalBays === 5 ? 3 : current.totalBays === 3 ? 2 : 1;
  const openBays = nextOpen ? activeCount : 0;
  const updated: MosqueDoorState = {
    ...current,
    open: nextOpen,
    openBays,
    bays: buildBays(current.id, current.x, current.y, current.tangent, current.totalBays, openBays),
  };
  doorStates = doorStates.map((g, i) => (i === idx ? updated : g));
  emitDoorChange();
  return { ok: true, open: nextOpen, gate: updated };
}

export function toggleNearestMosqueDoor(x: number, y: number, maxDistM = 14): DoorToggleResult {
  let best: MosqueDoorState | null = null;
  let bestD2 = maxDistM * maxDistM;
  for (const gate of doorStates) {
    for (const bay of gate.bays) {
      const dx = bay.x - x;
      const dy = bay.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = gate;
      }
    }
  }
  if (!best) return { ok: false, open: false, reason: 'not_found', gate: null };
  return toggleGateDoor(best.id);
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

/**
 * 3D fill-extrusion GeoJSON for all 42 `gate_inner` doorway bays:
 * - Open bays render a low golden brass marble threshold (`height = 0.35 m`, `#d4af37`) and
 *   warm lighted portal lintel posts so visitors clearly see open archways.
 * - Closed bays render teak/brass carved double leaves (`height = 5.4 m`, `#5c381c`).
 * - Always-closed gates (`18, 23, 26, 31, 32`) render darkened sealed teak leaves (`#3d2414`).
 */
export function mosqueDoorBaysGeoJSON(): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const gate of doorStates) {
    const [tx, ty] = gate.tangent;
    const [ox, oy] = gate.outward;
    const hw = BAY_WIDTH_M / 2;
    const hd = BAY_DEPTH_M / 2;

    for (const bay of gate.bays) {
      const p0 = fromModelMetres([bay.x - tx * hw - ox * hd, bay.y - ty * hw - oy * hd]);
      const p1 = fromModelMetres([bay.x + tx * hw - ox * hd, bay.y + ty * hw - oy * hd]);
      const p2 = fromModelMetres([bay.x + tx * hw + ox * hd, bay.y + ty * hw + oy * hd]);
      const p3 = fromModelMetres([bay.x - tx * hw + ox * hd, bay.y - ty * hw + oy * hd]);
      const color = bay.open ? '#d4af37' : gate.alwaysClosed ? '#3d2414' : '#5c381c';
      const height = bay.open ? 0.45 : 5.4;
      features.push({
        type: 'Feature',
        properties: {
          gateId: gate.id,
          bayIndex: bay.bayIndex,
          open: bay.open,
          alwaysClosed: gate.alwaysClosed,
          neverClosed: gate.neverClosed,
          canToggle: gate.canToggle,
          color,
          height,
          base: 0,
          opacity: bay.open ? 0.92 : 0.96,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[p0, p1, p2, p3, p0]],
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
