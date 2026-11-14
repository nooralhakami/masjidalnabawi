import { WOMEN_AREAS } from '../data-next/women-areas';
import { modelToWalkMetres, toWalkMetres, type XY } from './frames';
import { GREETING_BARRIERS, QUEUE_RAILS } from './rawdah-layout';
import { currentRugLayout, type RugLayout } from './rug-layout';

export type BarrierSource = 'prayer_barrier' | 'greeting_barrier' | 'queue_rail' | 'women_fence';

export interface CarpetQuad {
  poly: XY[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BarrierSeg {
  a: XY;
  b: XY;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  source: BarrierSource;
  areaId?: string;
}

export interface WomenZonePoly {
  id: string;
  poly: XY[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PatchBox {
  corners: XY[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SafetyWorld {
  carpets: CarpetQuad[];
  carpetGrid: Map<string, CarpetQuad[]>;
  barriers: BarrierSeg[];
  barrierGrid: Map<string, BarrierSeg[]>;
  womenZones: WomenZonePoly[];
  patchBoxes: PatchBox[];
  detourAnchors: XY[];
}

const CELL_M = 12;

export function pointInPoly(p: XY, ring: readonly XY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function orient(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

export function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9))) return true;
  if (Math.abs(o1) <= 1e-9 && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= 1e-9 && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= 1e-9 && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= 1e-9 && onSegment(c, d, b)) return true;
  return false;
}

function bboxOf(pts: readonly XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function addToGrid<T>(grid: Map<string, T[]>, box: { minX: number; maxX: number; minY: number; maxY: number }, item: T) {
  const ix0 = Math.floor(box.minX / CELL_M);
  const ix1 = Math.floor(box.maxX / CELL_M);
  const iy0 = Math.floor(box.minY / CELL_M);
  const iy1 = Math.floor(box.maxY / CELL_M);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const k = `${ix}|${iy}`;
      const arr = grid.get(k);
      if (arr) arr.push(item);
      else grid.set(k, [item]);
    }
  }
}

function queryGridSegment<T>(grid: Map<string, T[]>, a: XY, b: XY): Set<T> {
  const ix0 = Math.floor(Math.min(a[0], b[0]) / CELL_M);
  const ix1 = Math.floor(Math.max(a[0], b[0]) / CELL_M);
  const iy0 = Math.floor(Math.min(a[1], b[1]) / CELL_M);
  const iy1 = Math.floor(Math.max(a[1], b[1]) / CELL_M);
  const out = new Set<T>();
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const arr = grid.get(`${ix}|${iy}`);
      if (arr) for (const item of arr) out.add(item);
    }
  }
  return out;
}

let cachedWorld: SafetyWorld | null = null;
let cachedLayout: RugLayout | null = null;

/** Build and cache the plaza safety geometry (carpets, prayer/greeting/queue barriers, women zones) in walk metres. */
export function safetyWorld(): SafetyWorld {
  const layout = currentRugLayout();
  if (cachedWorld && cachedLayout === layout) return cachedWorld;
  cachedLayout = layout;

  const carpets: CarpetQuad[] = [];
  const carpetGrid = new Map<string, CarpetQuad[]>();
  for (const r of layout.covered) {
    const poly = r.map((pt) => modelToWalkMetres(pt));
    const quad: CarpetQuad = { poly, ...bboxOf(poly) };
    carpets.push(quad);
    addToGrid(carpetGrid, quad, quad);
  }

  const barriers: BarrierSeg[] = [];
  const barrierGrid = new Map<string, BarrierSeg[]>();
  const addBarrier = (a: XY, b: XY, source: BarrierSource, areaId?: string) => {
    const seg: BarrierSeg = { a, b, ...bboxOf([a, b]), source, areaId };
    barriers.push(seg);
    addToGrid(barrierGrid, seg, seg);
  };

  for (const feat of layout.barriers.features) {
    const ring = feat.geometry.coordinates[0].map(([lng, lat]) => toWalkMetres([lat, lng]));
    for (let i = 1; i < ring.length; i++) addBarrier(ring[i - 1], ring[i], 'prayer_barrier');
  }
  for (const run of QUEUE_RAILS) {
    const pts = run.map((pt) => modelToWalkMetres(pt));
    for (let i = 1; i < pts.length; i++) addBarrier(pts[i - 1], pts[i], 'queue_rail');
  }
  for (const run of GREETING_BARRIERS) {
    const pts = run.map((pt) => modelToWalkMetres(pt));
    for (let i = 1; i < pts.length; i++) addBarrier(pts[i - 1], pts[i], 'greeting_barrier');
  }

  const womenZones: WomenZonePoly[] = WOMEN_AREAS.map((area) => {
    const poly = area.zone.map((pt) => toWalkMetres([pt[0], pt[1]]));
    for (const run of area.barriers) {
      const pts = run.map((pt) => toWalkMetres([pt[0], pt[1]]));
      for (let i = 1; i < pts.length; i++) addBarrier(pts[i - 1], pts[i], 'women_fence', area.id);
    }
    return { id: area.id, poly, ...bboxOf(poly) };
  });

  const patchBoxes: PatchBox[] = [];
  const detourAnchors: XY[] = [];
  const pushAnchor = (p: XY) => {
    if (!detourAnchors.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2)) detourAnchors.push(p);
  };

  for (const patch of layout.patches) {
    const corners = patch.padded.map((pt) => modelToWalkMetres(pt));
    patchBoxes.push({ corners, ...bboxOf(corners) });
    const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length;
    const cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
    for (const [x, y] of corners) {
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      pushAnchor([x + (dx / len) * 1.1, y + (dy / len) * 1.1]);
    }
  }

  // Gate gap midpoints & barrier end clearances (women fences, greeting barriers, queue rails).
  for (const area of WOMEN_AREAS) {
    const ends = area.barriers.flatMap((run) => [toWalkMetres([run[0][0], run[0][1]]), toWalkMetres([run[run.length - 1][0], run[run.length - 1][1]])]);
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const d = Math.hypot(ends[j][0] - ends[i][0], ends[j][1] - ends[i][1]);
        if (d > 2 && d < 22) {
          const mid: XY = [(ends[i][0] + ends[j][0]) / 2, (ends[i][1] + ends[j][1]) / 2];
          // Add midpoint plus +/- 2 m perpendicular clearance anchors on both sides of the opening.
          const ux = (ends[j][0] - ends[i][0]) / d;
          const uy = (ends[j][1] - ends[i][1]) / d;
          pushAnchor(mid);
          pushAnchor([mid[0] - uy * 2.5, mid[1] + ux * 2.5]);
          pushAnchor([mid[0] + uy * 2.5, mid[1] - ux * 2.5]);
        }
      }
    }
  }
  for (const run of [...GREETING_BARRIERS, ...QUEUE_RAILS]) {
    const pts = run.map((pt) => modelToWalkMetres(pt));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0 && pts.length > 1) {
        const dx = pts[0][0] - pts[1][0];
        const dy = pts[0][1] - pts[1][1];
        const len = Math.hypot(dx, dy) || 1;
        pushAnchor([p[0] + (dx / len) * 2.2, p[1] + (dy / len) * 2.2]);
      } else if (i === pts.length - 1 && pts.length > 1) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        const len = Math.hypot(dx, dy) || 1;
        pushAnchor([p[0] + (dx / len) * 2.2, p[1] + (dy / len) * 2.2]);
      } else {
        pushAnchor([p[0] + 1.5, p[1] + 1.5]);
        pushAnchor([p[0] - 1.5, p[1] - 1.5]);
      }
    }
  }

  cachedWorld = { carpets, carpetGrid, barriers, barrierGrid, womenZones, patchBoxes, detourAnchors };
  return cachedWorld;
}

export function womenZonesContaining(p: XY, w = safetyWorld()): Set<string> {
  const out = new Set<string>();
  for (const z of w.womenZones) {
    if (p[0] >= z.minX && p[0] <= z.maxX && p[1] >= z.minY && p[1] <= z.maxY && pointInPoly(p, z.poly)) out.add(z.id);
  }
  return out;
}

export function pointInCarpet(p: XY, w = safetyWorld()): boolean {
  const arr = w.carpetGrid.get(`${Math.floor(p[0] / CELL_M)}|${Math.floor(p[1] / CELL_M)}`);
  if (!arr) return false;
  return arr.some((c) => p[0] > c.minX && p[0] < c.maxX && p[1] > c.minY && p[1] < c.maxY && pointInPoly(p, c.poly));
}

/** Check whether straight segment `a -> b` crosses a laid prayer carpet. */
export function segmentHitsCarpet(a: XY, b: XY, allowedEndpts: readonly XY[] = [], w = safetyWorld()): boolean {
  const set = queryGridSegment(w.carpetGrid, a, b);
  if (!set.size) return false;
  const allowedBoxes = allowedEndpts.length
    ? w.patchBoxes.filter((box) => allowedEndpts.some((e) => e[0] >= box.minX && e[0] <= box.maxX && e[1] >= box.minY && e[1] <= box.maxY))
    : [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / 0.75));
  const candidates = [...set];
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const p: XY = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    for (const c of candidates) {
      if (p[0] > c.minX && p[0] < c.maxX && p[1] > c.minY && p[1] < c.maxY && pointInPoly(p, c.poly)) {
        if (allowedEndpts.some((e) => e[0] > c.minX && e[0] < c.maxX && e[1] > c.minY && e[1] < c.maxY && pointInPoly(e, c.poly))) continue;
        if (allowedBoxes.some((box) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY)) continue;
        return true;
      }
    }
  }
  return false;
}

/** Check whether straight segment `a -> b` crosses any documented barrier (`prayer_barrier`, `greeting_barrier`, `queue_rail`, `women_fence`). */
export function segmentHitsBarrier(a: XY, b: XY, w = safetyWorld(), allowedSources?: Set<BarrierSource>): boolean {
  const set = queryGridSegment(w.barrierGrid, a, b);
  if (!set.size) return false;
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  for (const br of set) {
    if (allowedSources?.has(br.source)) continue;
    if (maxX < br.minX || minX > br.maxX || maxY < br.minY || minY > br.maxY) continue;
    if (segmentsCross(a, b, br.a, br.b)) return true;
  }
  return false;
}

/** Check whether straight segment `a -> b` crosses through any women's courtyard area not in `allowedZoneIds`. */
export function segmentTransitsWomen(a: XY, b: XY, allowedZoneIds: Set<string>, w = safetyWorld()): boolean {
  const dis = w.womenZones.filter((z) => !allowedZoneIds.has(z.id));
  if (!dis.length) return false;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / 1.5));
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const p: XY = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    for (const z of dis) {
      if (p[0] > z.minX && p[0] < z.maxX && p[1] > z.minY && p[1] < z.maxY && pointInPoly(p, z.poly)) return true;
    }
  }
  return false;
}

export function segmentHasViolation(
  a: XY,
  b: XY,
  allowedWomenZones: Set<string>,
  allowedCarpetEndpts: readonly XY[] = [],
  w = safetyWorld(),
  allowedBarrierSources?: Set<BarrierSource>,
): boolean {
  if (segmentHitsBarrier(a, b, w, allowedBarrierSources)) return true;
  if (segmentHitsCarpet(a, b, allowedCarpetEndpts, w)) return true;
  if (segmentTransitsWomen(a, b, allowedWomenZones, w)) return true;
  return false;
}
