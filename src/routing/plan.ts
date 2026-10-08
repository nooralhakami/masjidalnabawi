import { POIS } from '../data';
import type { LatLng, Poi } from '../data/types';
import { nearestEntrance, parkingAccess, parkingEntrances } from '../domain/parking';
import { loadStreets, type Reach, type Streets } from './streets';
import { fromM, insideRect, network, openTogether, pathLength, ringPath, segmentHits, toM, walkPath, type XY } from './walk';

/**
 * Plans a trip as legs:
 *  - walk:   on the plaza walkways inside the Haram, and on streets and footways outside it;
 *  - drive:  on the street network (one-way streets, road tunnels), into the underground car park;
 *  - garage: inside the car park, from its ramp to the lot, then up the lot's stairs to the plaza.
 * Walking is the default; driving ends at a car park under the Haram (lots 1–13).
 */

export type Mode = 'walk' | 'drive';
export interface Leg {
  kind: 'walk' | 'drive' | 'garage';
  path: LatLng[];
}
export interface Plan {
  mode: Mode;
  legs: Leg[];
  walkM: number;
  driveM: number;
  minutes: number;
  /** Driving: the lot parked in. */
  lot?: Poi;
  /** Walking to a lot: its four entrances and the nearest one. */
  entrances?: Poi[];
  nearest?: Poi;
}

export const WALK_M_PER_MIN = 80;
/** Old-town traffic near the Haram, ramps and queues included (~18 km/h). */
export const DRIVE_M_PER_MIN = 300;

const GATES = POIS.filter((p) => p.subCategory === 'gate_outer');
const LOTS = POIS.filter((p) => p.category === 'parking');

// ---------- the Haram boundary: the ring of outer gates ----------
function hull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: XY[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const HARAM = hull(GATES.map((g) => toM([g.lat, g.lng])));

/** Inside the ring of outer gates (with a 15 m margin for the gate line itself), or on the open west plaza. */
export function inHaram(ll: LatLng): boolean {
  const p = toM(ll);
  if (openTogether(p, p)) return true;
  let inside = false;
  for (let i = 0, j = HARAM.length - 1; i < HARAM.length; j = i++) {
    const [xi, yi] = HARAM[i];
    const [xj, yj] = HARAM[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return true;
  // Within 15 m of the boundary counts as inside: the gates stand on it.
  for (let i = 0, j = HARAM.length - 1; i < HARAM.length; j = i++) {
    const a = HARAM[j];
    const b = HARAM[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dy * u) < 15) return true;
  }
  return false;
}

const at = (p: Poi): LatLng => [p.lat, p.lng];
const ll = (pts: XY[]) => pts.map(fromM);
const len = (path: LatLng[]) => (path.length > 1 ? pathLength(path) : 0);

/** Street path from the start of `r` to node k (forward), or from node k to the start (reverse). */
function streetPath(S: Streets, r: Reach, k: number, start: LatLng, reverse: boolean): LatLng[] {
  const c = ll(S.chain(r, k));
  const p = [start, ...c];
  return reverse ? p.reverse() : p;
}

/** Whether a path crosses the mosque building or Al-Baqi' (street data has footways there too). */
function crossesObstacle(path: LatLng[]): boolean {
  const N = network();
  // The trip's own start or end may lie inside an obstacle (an inner gate); any other point may not.
  const ends = [toM(path[0]), toM(path[path.length - 1])];
  const own = N.obstacles.filter((r) => ends.some((e) => insideRect(e, r)));
  for (let i = 1; i < path.length; i++) {
    const p = toM(path[i - 1]);
    const q = toM(path[i]);
    if (N.obstacles.some((r) => !own.includes(r) && segmentHits(p, q, r))) return true;
  }
  return false;
}

/** Street distances from a point to every outer gate (walking is two-way). */
function gateCosts(S: Streets, r: Reach): { gate: Poi; k: number; cost: number }[] {
  return GATES.map((gate) => {
    const g = toM(at(gate));
    const k = S.nearestNode(g, 'walk');
    return { gate, k, cost: r.dist[k] + Math.hypot(S.xy[k][0] - g[0], S.xy[k][1] - g[1]) };
  })
    .filter((x) => Number.isFinite(x.cost))
    .sort((x, y) => x.cost - y.cost);
}

/**
 * Walk a → b, the shortest sensible way:
 *  - both in the Haram: the plaza walkways;
 *  - otherwise the best of: streets all the way (not every trip needs to pass through the Haram —
 *    a hotel behind it, a garden on its edge), or streets to an outer gate and the walkways from it,
 *    or (both outside) a short cut across the plazas from one gate to another.
 * No candidate may cross the mosque building or Al-Baqi'.
 */
async function walkLegs(a: LatLng, b: LatLng): Promise<LatLng[]> {
  const ia = inHaram(a);
  const ib = inHaram(b);
  if (ia && ib) return walkPath(a, b);
  const S = await loadStreets();
  if (!S) return walkPath(a, b); // no street data (offline before first load): the old straight approach
  const options: LatLng[][] = [];
  const ra = S.reach(a, 'walk')!;

  // 1) Streets all the way.
  const kb = S.nearestNode(toM(b), 'walk');
  if (Number.isFinite(ra.dist[kb])) options.push([...streetPath(S, ra, kb, a, false), b]);

  if (ia !== ib) {
    // 2) Streets on the outside end, through the best gate, walkways on the inside end.
    const outside = ia ? b : a;
    const inside = ia ? a : b;
    const r = ia ? S.reach(outside, 'walk')! : ra;
    const best = gateCosts(S, r)
      .slice(0, 16)
      .map((g) => ({ ...g, total: g.cost + len(walkPath(at(g.gate), inside)) }))
      .sort((x, y) => x.total - y.total)[0];
    if (best) {
      const street = [...streetPath(S, r, best.k, outside, false), at(best.gate)];
      options.push(ia ? [...walkPath(inside, at(best.gate)), ...street.reverse().slice(1)] : [...street, ...walkPath(at(best.gate), inside).slice(1)]);
    }
  } else {
    // 3) Both outside: maybe a short cut across the plazas, in at one gate and out at another.
    const rb = S.reach(b, 'walk')!;
    const ins = gateCosts(S, ra).slice(0, 8);
    const outs = gateCosts(S, rb).slice(0, 8);
    let best: { total: number; gi: (typeof ins)[number]; go: (typeof outs)[number]; plaza: LatLng[] } | null = null;
    for (const gi of ins) {
      for (const go of outs) {
        const plaza = gi.gate === go.gate ? [at(gi.gate)] : walkPath(at(gi.gate), at(go.gate));
        const total = gi.cost + len(plaza) + go.cost;
        if (!best || total < best.total) best = { total, gi, go, plaza };
      }
    }
    if (best) {
      const toGate = [...streetPath(S, ra, best.gi.k, a, false), at(best.gi.gate)];
      const fromGate = [...streetPath(S, rb, best.go.k, b, false), at(best.go.gate)].reverse();
      options.push([...toGate, ...best.plaza.slice(1), ...fromGate.slice(1)]);
    }
  }
  const ok = options.filter((p) => !crossesObstacle(p)).sort((x, y) => len(x) - len(y));
  return ok[0] ?? walkPath(a, b);
}

/** Walking: to a lot, the route ends at the nearest of its four entrances. */
async function planWalk(from: LatLng, to: Poi): Promise<Plan> {
  let target = to;
  let extra: Partial<Plan> = {};
  if (to.category === 'parking') {
    const n = nearestEntrance(from, to);
    target = n.entrance;
    extra = { entrances: parkingEntrances(to), nearest: n.entrance };
  }
  const path = await walkLegs(from, at(target));
  const walkM = len(path);
  return { mode: 'walk', legs: [{ kind: 'walk', path }], walkM, driveM: 0, minutes: Math.max(1, Math.ceil(walkM / WALK_M_PER_MIN)), ...extra };
}

/**
 * Driving: to the underground car park through the nearest suitable ramp, park in the lot that
 * makes the whole trip quickest (public lots, unless the destination is itself a lot), then walk up
 * through the lot's nearest entrance to the destination.
 */
async function planDrive(from: LatLng, to: Poi): Promise<Plan | null> {
  const S = await loadStreets();
  if (!S || !S.garageNodes.length) return null;
  const r = S.reach(from, 'drive');
  if (!r) return null;
  const lots = to.category === 'parking' ? [to] : LOTS.filter((p) => parkingAccess(p) === 'public');
  let best: { cost: number; plan: Plan } | null = null;
  for (const lot of lots) {
    const L = toM(at(lot));
    // The ramp that gets there quickest: driving to it, then along the car park, which is one
    // connected garage running round the Haram under the plazas (owner, 2026-10-08) — so its
    // aisles follow the shape of the main walkway ring and never cross the mosque.
    // Aisles are slow (×1.5); a ramp's straight-line distance to the lot rules out far ones early.
    let ramp = -1;
    let rampCost = Infinity;
    let aisle: LatLng[] = [];
    const byNear = S.garageNodes
      .filter((k) => Number.isFinite(r.dist[k]))
      .map((k) => ({ k, d: Math.hypot(S.xy[k][0] - L[0], S.xy[k][1] - L[1]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 12);
    for (const { k } of byNear) {
      const rampAt = fromM(S.xy[k]);
      const inside = ringPath(rampAt, at(lot));
      const c = r.dist[k] + 1.5 * len(inside);
      if (c < rampCost) {
        rampCost = c;
        ramp = k;
        aisle = inside;
      }
    }
    const drive = streetPath(S, r, ramp, from, false);
    // Up through the lot's nearest entrance (one of its four surrounding facilities) to the destination.
    const up = to.category === 'parking' ? null : parkingEntrances(lot).reduce<{ e: Poi; path: LatLng[]; m: number } | null>((m, e) => {
      const path = walkPath(at(e), at(to));
      const pm = len(path);
      return !m || pm < m.m ? { e, path, m: pm } : m;
    }, null);
    const stairs: LatLng[] = up ? [at(lot), at(up.e)] : [];
    const garage: LatLng[] = [...aisle, ...stairs.slice(1)];
    const driveM = len(drive) + len(aisle);
    const walkM = up ? len(stairs) + up.m : 0;
    const minutes = Math.ceil(driveM / DRIVE_M_PER_MIN + walkM / WALK_M_PER_MIN);
    const legs: Leg[] = [
      { kind: 'drive', path: drive },
      { kind: 'garage', path: garage },
      ...(up ? [{ kind: 'walk' as const, path: up.path }] : []),
    ];
    if (!best || minutes < best.cost) best = { cost: minutes, plan: { mode: 'drive', legs, walkM, driveM, minutes: Math.max(1, minutes), lot } };
  }
  return best?.plan ?? null;
}

/** The trip from a point to a place. Driving falls back to walking when no car route is found. */
export async function planRoute(from: LatLng, to: Poi, mode: Mode = 'walk'): Promise<Plan> {
  if (mode === 'drive') {
    const p = await planDrive(from, to);
    if (p) return p;
  }
  return planWalk(from, to);
}

/** All legs as one path (for live navigation and fitting the map). */
export const fullPath = (p: Plan): LatLng[] => p.legs.flatMap((l, i) => (i ? l.path.slice(1) : l.path));
