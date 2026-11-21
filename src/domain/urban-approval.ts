import { approvedBy, buildings, tier } from '../../data/urban-approved.json';
import type { LatLng, Poi } from '../data/types';
import { fromWalkMetres, toModelMetres, toWalkMetres, type XY } from './frames';

export interface ApprovedBuilding {
  buildingId: string;
  poiId: number;
  guideNumber: number | null;
  zone: string;
  name_ar: string;
  osm: string | null;
  areaM2: number;
  center: LatLng;
  entranceSide: 'north' | 'south' | 'east' | 'west';
  /** Street-facing facade entrance (`الواجهة على الشارع`). */
  entrance: LatLng;
  /** Adjacent drivable street kerb / dropoff for driving routes. */
  dropoff: LatLng;
  hasFootprint: boolean;
  footprintSplit: 'single' | 'provisional_pin_partition' | 'none';
  /** Verified OSM/owner floor count when known; `null` when only display-estimated or pin-only. */
  levels: number | null;
  /** Display-only 3D height tiers (`10..14` for unmeasured Markaziyah towers); never shown as verified facts. */
  displayFloors: number | null;
  heightM: number;
  heightSource: 'osm_levels' | 'estimated_display_only' | 'owner_verified' | 'none';
  confidence: 'osm' | 'display_only' | 'owner' | 'none';
  styleId: number;
  seed: number;
  tint: number;
  /** Closed GeoJSON ring (`[lng, lat][]`), empty for pin-only hotels (`hasFootprint === false`). */
  polygon: readonly (readonly [number, number])[];
}

const VERIFIED = tier === 'verified' && approvedBy === 'owner';

export const APPROVED_BUILDINGS: readonly ApprovedBuilding[] = VERIFIED ? (buildings as unknown as ApprovedBuilding[]) : [];

export const APPROVED_FOOTPRINT_BUILDINGS: readonly ApprovedBuilding[] = APPROVED_BUILDINGS.filter((b) => b.hasFootprint && b.polygon.length >= 4);

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

const POLYS_M: readonly PolyMetres[] = APPROVED_FOOTPRINT_BUILDINGS.map((building) => {
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
  for (const m of [margin, 0.35, 0.15]) {
    const ring = expandRing(poly.hull, m);
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
    if (!candidates.length) continue;
    candidates.sort((x, y) => polyPerimeterLen(x) - polyPerimeterLen(y));
    const cleanAll = candidates.find((cand) => cand.every((pt, idx) => idx === 0 || POLYS_M.every((other) => !segmentCrossesRing(cand[idx - 1], pt, other))));
    if (cleanAll) return cleanAll;
    if (m === 0.15) return candidates[0];
  }
  return null;
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
  if (path.length < 2 || POLYS_M.length === 0 || !pathHitsApprovedBuilding(path)) return [...path];
  let pts = path.map(toWalkMetres);
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
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
          if (detour) {
            out.push(...detour.slice(1));
            changed = true;
          } else {
            out.push(after);
          }
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
        if (detour) {
          out.push(...detour.slice(1));
          changed = true;
        } else {
          out.push(next);
        }
        i++;
      }
      pts = out;
    }
    if (!changed) break;
  }
  return pts.map(fromWalkMetres);
}

export function approvedFootprintBuildingsForZone(zone: string): readonly ApprovedBuilding[] {
  return APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.zone === zone);
}

interface PrismModel {
  building: ApprovedBuilding;
  xzRing: XY[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PRISMS_MODEL: readonly PrismModel[] = APPROVED_FOOTPRINT_BUILDINGS.map((building) => {
  const ringPts = building.polygon.slice(0, -1);
  const xzRing = ringPts.map((pt) => toModelMetres(pt));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of xzRing) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { building, xzRing, minX, maxX, minZ, maxZ };
});

/**
 * Ray-vs-prism intersection in model metres (`+X` east, `+Y` up, `+Z` south) so tapping any
 * approved 3D hotel facade or roof picks that building cleanly without GPU readback.
 */
export function pickApprovedBuildingRay(origin: readonly [number, number, number], dir: readonly [number, number, number]): ApprovedBuilding | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  let bestT = Number.POSITIVE_INFINITY;
  let best: ApprovedBuilding | null = null;

  for (const prism of PRISMS_MODEL) {
    const h = prism.building.heightM;
    if (h <= 0) continue;

    // 1. Fast 3D AABB slab reject
    let tMin = 0;
    let tMax = bestT;
    const slabs: readonly [number, number, number, number][] = [
      [ox, dx, prism.minX, prism.maxX],
      [oy, dy, 0, h],
      [oz, dz, prism.minZ, prism.maxZ],
    ];
    let hitBox = true;
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) {
          hitBox = false;
          break;
        }
      } else {
        let t0 = (lo - o) / d;
        let t1 = (hi - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        if (t0 > tMin) tMin = t0;
        if (t1 < tMax) tMax = t1;
        if (tMin > tMax) {
          hitBox = false;
          break;
        }
      }
    }
    if (!hitBox) continue;

    // 2. Roof cap (y = h)
    if (Math.abs(dy) > 1e-6) {
      const tRoof = (h - oy) / dy;
      if (tRoof > 0 && tRoof < bestT) {
        const hx = ox + tRoof * dx;
        const hz = oz + tRoof * dz;
        if (pointInRing([hx, hz], prism.xzRing)) {
          bestT = tRoof;
          best = prism.building;
        }
      }
    }

    // 3. Vertical extruded wall quads
    const ring = prism.xzRing;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % n];
      const ex = bx - ax;
      const ez = bz - az;
      const det = dz * ex - dx * ez;
      if (Math.abs(det) < 1e-8) continue;
      const rx = ax - ox;
      const rz = az - oz;
      const t = (rz * ex - rx * ez) / det;
      if (t <= 0 || t >= bestT) continue;
      const s = (dx * rz - dz * rx) / det;
      if (s < -1e-4 || s > 1 + 1e-4) continue;
      const hy = oy + t * dy;
      if (hy >= 0 && hy <= h) {
        bestT = t;
        best = prism.building;
      }
    }
  }

  return best;
}

export type UrbanZone = 'south' | 'west' | 'north' | 'sw';

/**
 * Obstruction-fade opacity (A8) for Stage 6 Plaza buildings when looking across them
 * toward Al-Masjid an-Nabawi in tilted 3D view (`0.25–0.35`), else `1`:
 *   - `'south'` faces North (`0°`) across Southern Plaza buildings.
 *   - `'west'` faces East (`90°`) across Western Plaza buildings.
 *   - `'north'` faces South (`180°`) across Northern Plaza buildings.
 *   - `'sw'` faces Northeast (`45°`) across Southwestern Plaza buildings.
 */
export function urbanOpacityForCamera(bearingDeg: number, pitchDeg: number, zone: UrbanZone = 'south'): number {
  if (pitchDeg < 30) return 1;
  const targetDeg = zone === 'west' ? 90 : zone === 'north' ? 180 : zone === 'sw' ? 45 : 0;
  const diff = Math.abs(((((bearingDeg - targetDeg + 180) % 360) + 360) % 360) - 180);
  if (diff > 55) return 1;
  return diff <= 35 && pitchDeg >= 45 ? 0.28 : 0.32;
}
