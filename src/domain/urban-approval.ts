import { approvedBy, buildings, tier } from '../../data/urban-approved.json';
import type { LatLng, Poi } from '../data/types';
import { fromWalkMetres, toWalkMetres, type XY } from './frames';

export interface ApprovedBuilding {
  buildingId: string;
  poiId: number;
  name_ar: string;
  osm: string | null;
  areaM2: number;
  center: LatLng;
  entranceSide: 'west';
  /** Western facade street door (`الواجهة الغربية على الشارع`). */
  entrance: LatLng;
  /** Adjacent western street kerb / dropoff for driving routes. */
  dropoff: LatLng;
  /** Floor count deferred pending owner input; flat footprint when `null`. */
  levels: null;
  heightM: number;
  heightSource: 'flat_pending_owner_floors';
  /** Closed GeoJSON ring (`[lng, lat][]`). */
  polygon: readonly (readonly [number, number])[];
}

const VERIFIED = tier === 'verified' && approvedBy === 'owner';

export const APPROVED_BUILDINGS: readonly ApprovedBuilding[] = VERIFIED ? (buildings as unknown as ApprovedBuilding[]) : [];

export const APPROVED_BY_POI_ID: ReadonlyMap<number, ApprovedBuilding> = new Map(APPROVED_BUILDINGS.map((b) => [b.poiId, b]));

export const APPROVED_HOTEL_IDS: ReadonlySet<number> = new Set(APPROVED_BUILDINGS.map((b) => b.poiId));

/** Whether a POI ID is approved by the owner for Stage 5 visibility and 3D reveal (gate A7). */
export function isApprovedHotel(poiId: number): boolean {
  return APPROVED_HOTEL_IDS.has(poiId);
}

/** Approved Stage 5 metadata for a POI ID, or `undefined` if unapproved. */
export function approvedHotelInfo(poiId: number): ApprovedBuilding | undefined {
  return APPROVED_BY_POI_ID.get(poiId);
}

/**
 * Target coordinate for routing to a POI: approved hotels resolve to their western facade
 * `entrance` (walk) or adjacent western street `dropoff` (drive) rather than building centroid.
 */
export function approvedHotelTarget(poi: Poi, mode: 'walk' | 'drive' = 'walk'): LatLng {
  const b = APPROVED_BY_POI_ID.get(poi.id);
  if (!b) return [poi.lat, poi.lng];
  return mode === 'drive' ? b.dropoff : b.entrance;
}

interface PolyMetres {
  building: ApprovedBuilding;
  ring: XY[];
  hull: XY[];
  bounds: [number, number, number, number];
}

function convexHull2D(pts: readonly XY[]): XY[] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const POLYS_M: readonly PolyMetres[] = APPROVED_BUILDINGS.map((building) => {
  const open = building.polygon.slice(0, -1).map(([lng, lat]) => toWalkMetres([lat, lng]));
  const xs = open.map((p) => p[0]);
  const ys = open.map((p) => p[1]);
  return {
    building,
    ring: open,
    hull: convexHull2D(open),
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
});

function pointInRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsCrossProperly(a: XY, b: XY, c: XY, d: XY): boolean {
  const cross = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentCrossesRing(a: XY, b: XY, poly: PolyMetres): boolean {
  const [minX, minY, maxX, maxY] = poly.bounds;
  if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX || Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) {
    return false;
  }
  if (pointInRing([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], poly.ring)) return true;
  const samples = 16;
  for (let s = 1; s < samples; s++) {
    const u = s / samples;
    if (pointInRing([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], poly.ring)) return true;
  }
  const n = poly.ring.length;
  for (let i = 0; i < n; i++) {
    const c = poly.ring[i];
    const d = poly.ring[(i + 1) % n];
    if (segmentsCrossProperly(a, b, c, d)) return true;
  }
  return false;
}

function centroidOf(ring: readonly XY[]): XY {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

function expandRing(ring: readonly XY[], margin: number): XY[] {
  const [cx, cy] = centroidOf(ring);
  return ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * margin, y + (dy / d) * margin];
  });
}

function polyPerimeterLen(pts: readonly XY[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function detourOnePoly(a: XY, b: XY, poly: PolyMetres, margin: number): XY[] | null {
  const ring = expandRing(poly.hull, margin);
  const n = ring.length;
  const nearestIdx = (p: XY) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(ring[i][0] - p[0], ring[i][1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const ia = nearestIdx(a);
  const ib = nearestIdx(b);
  const cw: XY[] = [a];
  for (let k = ia; ; k = (k + 1) % n) {
    cw.push(ring[k]);
    if (k === ib) break;
  }
  cw.push(b);
  const ccw: XY[] = [a];
  for (let k = ia; ; k = (k - 1 + n) % n) {
    ccw.push(ring[k]);
    if (k === ib) break;
  }
  ccw.push(b);
  const candidates = [cw, ccw].filter((cand) => cand.every((pt, idx) => idx === 0 || !segmentCrossesRing(cand[idx - 1], pt, poly)));
  if (!candidates.length) return null;
  candidates.sort((x, y) => polyPerimeterLen(x) - polyPerimeterLen(y));
  return candidates[0];
}

/** Whether a point lies inside any Stage 5 approved hotel footprint. */
export function pointInApprovedBuilding(ll: LatLng): ApprovedBuilding | null {
  const p = toWalkMetres(ll);
  for (const poly of POLYS_M) {
    if (pointInRing(p, poly.ring)) return poly.building;
  }
  return null;
}

/** Whether a polyline crosses inside any Stage 5 approved hotel footprint. */
export function pathHitsApprovedBuilding(path: readonly LatLng[]): boolean {
  if (path.length < 2) return false;
  const pts = path.map(toWalkMetres);
  for (let i = 1; i < pts.length; i++) {
    for (const poly of POLYS_M) {
      if (segmentCrossesRing(pts[i - 1], pts[i], poly)) return true;
    }
  }
  return false;
}

/**
 * Deflect any segments of a path that would cross an approved Stage 5 hotel footprint cleanly
 * round its exterior outline so walk and last-mile kerb legs never intersect a building polygon.
 */
export function clearApprovedBuildings(path: readonly LatLng[], clearanceM = 1.2): LatLng[] {
  if (path.length < 2 || POLYS_M.length === 0) return [...path];
  let pts = path.map(toWalkMetres);
  for (const poly of POLYS_M) {
    if (pointInRing(pts[0], poly.ring) || pointInRing(pts[pts.length - 1], poly.ring)) continue;
    const out: XY[] = [pts[0]];
    let i = 1;
    while (i < pts.length) {
      if (i < pts.length - 1 && pointInRing(pts[i], poly.ring)) {
        let j = i;
        while (j < pts.length - 1 && pointInRing(pts[j], poly.ring)) j++;
        const prev = out[out.length - 1];
        const after = pts[j];
        const detour = detourOnePoly(prev, after, poly, clearanceM);
        if (detour) out.push(...detour.slice(1));
        else out.push(after);
        i = j + 1;
        continue;
      }
      const prev = out[out.length - 1];
      const next = pts[i];
      if (!segmentCrossesRing(prev, next, poly)) {
        out.push(next);
        i++;
        continue;
      }
      const detour = detourOnePoly(prev, next, poly, clearanceM);
      if (detour) out.push(...detour.slice(1));
      else out.push(next);
      i++;
    }
    pts = out;
  }
  return pts.map(fromWalkMetres);
}

/**
 * Obstruction-fade opacity (A8) for Stage 5 Southern Plaza buildings when looking across them
 * northward toward Al-Masjid an-Nabawi in tilted 3D view (`0.25–0.35`), else `1`.
 */
export function urbanOpacityForCamera(bearingDeg: number, pitchDeg: number): number {
  if (pitchDeg < 30) return 1;
  const b = ((((bearingDeg + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(b) > 55) return 1;
  return Math.abs(b) <= 35 && pitchDeg >= 45 ? 0.28 : 0.32;
}
