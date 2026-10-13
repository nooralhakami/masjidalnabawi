import { POIS, RULES } from '../data';
import type { LatLng, Poi } from '../data/types';
import { parkingAccess, parkingEntrances } from '../domain/parking';
import { loadStreets, type Reach, type Streets } from './streets';
import { pickRoutes, turnPenalty } from './alternatives';
import { ENTRANCES, EXITS, garageExit, garageRoute, type EntranceId, type Level, type GarageStep, type RampOnWay, type Stretch } from './garage';
import { fromM, insideRect, network, openTogether, pathLength, ringPath, segmentHits, toM, walkPath, walkPaths, type XY } from './walk';

/**
 * Plans a trip as legs:
 *  - walk:   on the plaza walkways inside the Haram, and on streets and footways outside it;
 *  - drive:  on the street network (one-way streets, road tunnels), into the underground car park;
 *  - garage: inside the car park, from its ramp to the lot's entrance (the visitor parks inside, then
 *    walks up the lot's stairs nearest the destination).
 * Walking is the default; driving ends at a car park under the Haram (lots 1–13).
 */

export type Mode = 'walk' | 'drive';
export interface Leg {
  kind: 'walk' | 'drive' | 'garage';
  path: LatLng[];
  /** In the car park: the stretches by level and ramp, so level A can be drawn differently. */
  parts?: { on: Stretch; path: LatLng[] }[];
  /** In the car park: step-by-step directions. */
  steps?: GarageStep[];
}
export interface Plan {
  mode: Mode;
  legs: Leg[];
  walkM: number;
  driveM: number;
  minutes: number;
  /** Driving: the lot parked in, and the car park entrance used. */
  lot?: Poi;
  entrance?: EntranceId;
  /** Driving: where the car turns into the lot. */
  gate?: LatLng;
  /** Driving: the level parked on (B below, A above) and the ramps taken between them. */
  level?: Level;
  ramps?: RampOnWay[];
  /** The way out of the car park: the exit taken (otherwise the plan is the way in). */
  exit?: EntranceId;
  /** Driving to a place outside the Haram: whether the car is left at a public car park (else on a public road). */
  carPark?: boolean;
  /** Driving: false when the way inside the car park uses roads the owner is not sure of yet (the east side). */
  garageCertain?: boolean;
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
/** Driving to a place outside the Haram: public car parks this close to it are used, reached from a public road this close. */
const CAR_PARK_M = 300;
const CAR_PARK_ACCESS_M = 80;
/** The last points of a drawn approach (by the car park mouth) where a car may not join it. */
const APPROACH_TAIL = 6;
/** Direction from a to b in degrees from north. */
const bearingOf = (a: LatLng, b: LatLng): number => {
  const [ax, ay] = toM(a);
  const [bx, by] = toM(b);
  return ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
};
const ll = (pts: XY[]) => pts.map(fromM);
const len = (path: LatLng[]) => (path.length > 1 ? pathLength(path) : 0);

/** Street path from the start of `r` to node k (forward), or from node k to the start (reverse). */
function streetPath(S: Streets, r: Reach, k: number, start: LatLng, reverse: boolean): LatLng[] {
  const c = ll(S.chain(r, k));
  const p = [start, ...c];
  return reverse ? p.reverse() : p;
}

/**
 * Inside its own obstacle a trip may only cover the stretch to (or from) its inner gate: as far from
 * the gate as the gate lies inside the obstacle's rectangle (the building is not a perfect
 * rectangle, so a gate can sit well inside it), plus 40 m.
 */
const DOOR_STRETCH_M = 40;

/**
 * Whether a path crosses the mosque building or Al-Baqi' (street data has footways there too).
 * The trip's own start or end may lie inside an obstacle (an inner gate on the mosque wall): then
 * only the stretch within 40 m of that gate may run inside it — never across the building.
 */
function crossesObstacle(path: LatLng[]): boolean {
  const N = network();
  const ends = [toM(path[0]), toM(path[path.length - 1])];
  const own = N.blocks.map((r) => ends.filter((e) => insideRect(e, r)));
  for (let i = 1; i < path.length; i++) {
    const p = toM(path[i - 1]);
    const q = toM(path[i]);
    for (let o = 0; o < N.blocks.length; o++) {
      const r = N.blocks[o];
      if (!segmentHits(p, q, r)) continue;
      if (!own[o].length) return true;
      // Its own obstacle: every metre of the segment inside it must be near the inner gate.
      const reach = own[o].map((e) => ({ e, m: Math.min(e[0] - r.x0, r.x1 - e[0], e[1] - r.y0, r.y1 - e[1]) + DOOR_STRETCH_M }));
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
      for (let s = 0; s <= n; s++) {
        const x: XY = [p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n];
        if (insideRect(x, r) && !reach.some(({ e, m }) => Math.hypot(x[0] - e[0], x[1] - e[1]) <= m)) return true;
      }
    }
  }
  return false;
}

/**
 * Where to leave the streets for a place: of the usable nodes within 150 m of it, the one that makes
 * the trip shortest (the street distance plus the last stretch, counted 1.5× as it is off-street).
 * The nearest node alone can be on the wrong street — Quba Avenue ends ~100 m from Quba Mosque's
 * marker, on its plaza, while a back street passes closer.
 */
function bestNear(S: Streets, r: Reach, p: LatLng, t: 'walk' | 'drive'): number {
  const P = toM(p);
  let best = S.nearestNode(P, t);
  let cost = r.dist[best] + 1.5 * Math.hypot(S.xy[best][0] - P[0], S.xy[best][1] - P[1]);
  for (let k = 0; k < S.size; k++) {
    if (!Number.isFinite(r.dist[k])) continue;
    const d = Math.hypot(S.xy[k][0] - P[0], S.xy[k][1] - P[1]);
    if (d > 150) continue;
    const c = r.dist[k] + 1.5 * d;
    if (c < cost) {
      cost = c;
      best = k;
    }
  }
  return best;
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
 * Ways to walk a → b (each a full path), for choosing the best and the alternatives:
 *  - both in the Haram: the plaza walkways, and up to two other ways along them;
 *  - otherwise: streets all the way (not every trip needs to pass through the Haram — a hotel behind
 *    it, a garden on its edge) and another way on the streets; or streets to an outer gate and the
 *    walkways from it, through each of the best few gates; or (both outside) a short cut across the
 *    plazas, in at one gate and out at another, for the best few pairs of gates.
 * None may cross the mosque building or Al-Baqi'.
 */
async function walkOptions(a: LatLng, b: LatLng): Promise<LatLng[][]> {
  const ia = inHaram(a);
  const ib = inHaram(b);
  if (ia && ib) {
    // The walkway route always stands; another way along the walkways only if it stays clear too.
    const [first, ...others] = walkPaths(a, b);
    return [first, ...others.filter((p) => !crossesObstacle(p))];
  }
  const S = await loadStreets();
  if (!S) return [walkPath(a, b)]; // no street data (offline before first load): the old straight approach
  const options: LatLng[][] = [];
  const ra = S.reach(a, 'walk')!;

  // 1) Streets all the way, and another way on the streets (its streets made dearer).
  const kb = bestNear(S, ra, b, 'walk');
  if (Number.isFinite(ra.dist[kb])) {
    options.push([...streetPath(S, ra, kb, a, false), b]);
    const avoid = new Uint8Array(S.size);
    S.nodesTo(ra, kb).forEach((k) => (avoid[k] = 1));
    const ra2 = S.reach(a, 'walk', false, avoid);
    if (ra2) {
      const k2 = bestNear(S, ra2, b, 'walk');
      if (Number.isFinite(ra2.dist[k2])) options.push([...streetPath(S, ra2, k2, a, false), b]);
    }
  }

  if (ia !== ib) {
    // 2) Streets on the outside end, through a gate, walkways on the inside end: the best few gates.
    const outside = ia ? b : a;
    const inside = ia ? a : b;
    const r = ia ? S.reach(outside, 'walk')! : ra;
    const gates = gateCosts(S, r)
      .slice(0, 16)
      .map((g) => ({ ...g, total: g.cost + len(walkPath(at(g.gate), inside)) }))
      .sort((x, y) => x.total - y.total)
      .slice(0, GATE_OPTIONS);
    for (const g of gates) {
      const street = [...streetPath(S, r, g.k, outside, false), at(g.gate)];
      options.push(ia ? [...walkPath(inside, at(g.gate)), ...street.reverse().slice(1)] : [...street, ...walkPath(at(g.gate), inside).slice(1)]);
    }
  } else {
    // 3) Both outside: maybe a short cut across the plazas, in at one gate and out at another.
    const rb = S.reach(b, 'walk')!;
    const ins = gateCosts(S, ra).slice(0, 8);
    const outs = gateCosts(S, rb).slice(0, 8);
    const pairs: { total: number; gi: (typeof ins)[number]; go: (typeof outs)[number]; plaza: LatLng[] }[] = [];
    for (const gi of ins) {
      for (const go of outs) {
        const plaza = gi.gate === go.gate ? [at(gi.gate)] : walkPath(at(gi.gate), at(go.gate));
        pairs.push({ total: gi.cost + len(plaza) + go.cost, gi, go, plaza });
      }
    }
    for (const best of pairs.sort((x, y) => x.total - y.total).slice(0, GATE_OPTIONS)) {
      const toGate = [...streetPath(S, ra, best.gi.k, a, false), at(best.gi.gate)];
      const fromGate = [...streetPath(S, rb, best.go.k, b, false), at(best.go.gate)].reverse();
      options.push([...toGate, ...best.plaza.slice(1), ...fromGate.slice(1)]);
    }
  }
  return options.filter((p) => !crossesObstacle(p));
}

/** How many gates (or pairs of gates) are tried as alternatives. */
const GATE_OPTIONS = 4;

/** Walk a → b, the shortest sensible way. */
async function walkLegs(a: LatLng, b: LatLng): Promise<LatLng[]> {
  return pickRoutes((await walkOptions(a, b)).map((path) => ({ path, item: path })))[0] ?? walkPath(a, b);
}

/** The public lot (not subscribers-only) whose stairs are nearest a place on foot. */
function nearestLot(to: Poi): Poi | null {
  let best: { lot: Poi; m: number } | null = null;
  for (const lot of LOTS) {
    if (parkingAccess(lot) !== 'public') continue;
    for (const e of parkingEntrances(lot)) {
      const m = len(walkPath(at(e), at(to)));
      if (!best || m < best.m) best = { lot, m };
    }
  }
  return best?.lot ?? null;
}

/** Of a lot's four entrances (the facilities round it), the one nearest on foot. */
export function nearestEntrance(from: LatLng, p: Poi): { entrance: Poi; path: LatLng[] } {
  const candidates = parkingEntrances(p).map((entrance) => {
    const path = walkPath(from, at(entrance));
    return { entrance, path, length: len(path) };
  });
  if (!candidates.length) return { entrance: p, path: walkPath(from, at(p)) };
  return candidates.reduce((best, c) => (c.length < best.length ? c : best));
}

/**
 * Walking: the best route and its sensible alternatives (routing/alternatives.ts). To a lot, the
 * route ends at the nearest of its four entrances. With the visitor's heading (on a re-route), a
 * route that starts by turning them round ranks lower.
 */
async function planWalks(from: LatLng, to: Poi, heading?: number | null): Promise<Plan[]> {
  let target = to;
  let extra: Partial<Plan> = {};
  if (to.category === 'parking') {
    const n = nearestEntrance(from, to);
    target = n.entrance;
    extra = { entrances: parkingEntrances(to), nearest: n.entrance };
  }
  const options = await walkOptions(from, at(target));
  const paths = pickRoutes((options.length ? options : [walkPath(from, at(target))]).map((path) => ({ path, item: path, penalty: turnPenalty(path, heading) })));
  return paths.map((path) => {
    const walkM = len(path);
    return { mode: 'walk', legs: [{ kind: 'walk', path }], walkM, driveM: 0, minutes: Math.max(1, Math.ceil(walkM / WALK_M_PER_MIN)), ...extra };
  });
}

/**
 * Driving: to the underground car park through the nearest suitable ramp, park in the lot that
 * makes the whole trip quickest (public lots, unless the destination is itself a lot), then walk up
 * through the lot's nearest entrance to the destination.
 */
async function planDrive(from: LatLng, to: Poi, level: Level = 'B'): Promise<Plan[]> {
  const S = await loadStreets();
  if (!S || !S.garageNodes.length) return [];
  const r = S.reach(from, 'drive');
  if (!r) return [];
  // A place outside the Haram (a historic site, a hotel, a restaurant): drive on public roads to the
  // nearest public car park by it (within 300 m), or else to the public road at its door, and walk.
  if (to.category !== 'parking' && !inHaram(at(to))) {
    const T = toM(at(to));
    let k = -1;
    let carPark = false;
    let bestCost = Infinity;
    // Historic sites and landmarks: the public car park by it (a hotel or a shop: its door).
    const site = to.category === 'landmarks';
    for (const pk of site ? S.parkings : []) {
      const walk = Math.hypot(pk[0] - T[0], pk[1] - T[1]);
      if (walk > CAR_PARK_M) continue;
      const kk = S.nearestNode(pk, 'drive');
      const access = Math.hypot(S.xy[kk][0] - pk[0], S.xy[kk][1] - pk[1]);
      if (access > CAR_PARK_ACCESS_M || !Number.isFinite(r.dist[kk])) continue;
      const c = r.dist[kk] + 1.5 * (walk + access);
      if (c < bestCost) {
        bestCost = c;
        k = kk;
        carPark = true;
      }
    }
    if (k < 0) k = bestNear(S, r, at(to), 'drive');
    if (!Number.isFinite(r.dist[k])) return [];
    const drive = streetPath(S, r, k, from, false);
    const kerb = fromM(S.xy[k]);
    const walk = len([kerb, at(to)]) > 2 ? await walkLegs(kerb, at(to)) : [];
    const driveM = len(drive);
    const walkM = len(walk);
    return [
      {
        mode: 'drive',
        legs: [{ kind: 'drive', path: drive }, ...(walk.length > 1 ? [{ kind: 'walk' as const, path: walk }] : [])],
        walkM,
        driveM,
        minutes: Math.max(1, Math.ceil(driveM / DRIVE_M_PER_MIN + walkM / WALK_M_PER_MIN)),
        carPark,
      },
    ];
  }
  // The lot: the destination itself; or the owner's choice for this place (rules.json drive_lot: the
  // Rawdah at gate 37 → lot 1, gate 21 → lot 9); or else the public lot nearest the place on foot
  // (owner, 2026-10-13: the nearest lot, never a subscribers-only one).
  const choice = LOTS.find((p) => p.id === Number(RULES.rules.drive_lot?.[String(to.id)]) && parkingAccess(p) === 'public');
  const lot = to.category === 'parking' ? to : (choice ?? nearestLot(to));
  const lots = lot ? [lot] : [];
  // The car park's two entrances (Quba, Sultana) as street nodes the car can reach. Where the owner
  // drew the way to an entrance (an approach), the streets lead to its start, on the carriageway that
  // goes its way, and the car then follows it.
  const gates = ENTRANCES.map((e) => {
    if (!e.approach?.length) return { e, k: S.nearestNode(toM(e.street), 'drive'), approach: [] as LatLng[] };
    // Join the approach where it is cheapest: at any of its points, on a road going its way — but not
    // in its last stretch by the car park mouth, where a side street also passes (the owner's drawing
    // brings every car down the ramp).
    const a = e.approach;
    let best = { k: -1, i: 0, cost: Infinity };
    for (let i = 0; i < a.length - APPROACH_TAIL; i++) {
      const k = S.nearestNodeHeading(toM(a[i]), bearingOf(a[i], a[i + 1]), 15);
      const rest = len(a.slice(i));
      if (k >= 0 && r.dist[k] + rest < best.cost) best = { k, i, cost: r.dist[k] + rest };
    }
    return { e, k: best.k, approach: a.slice(best.i) };
  }).filter((g) => g.k >= 0 && Number.isFinite(r.dist[g.k]));
  const plans: Plan[] = [];
  for (const lot of lots) {
    // Up through the lot's nearest entrance (one of its four surrounding facilities) to the destination.
    const up = to.category === 'parking' ? null : parkingEntrances(lot).reduce<{ e: Poi; path: LatLng[]; m: number } | null>((m, e) => {
      const path = walkPath(at(e), at(to));
      const pm = len(path);
      return !m || pm < m.m ? { e, path, m: pm } : m;
    }, null);
    // In by each entrance (owner's drawing, routing/garage.ts): streets to the ramp, the car park's
    // roads to the lot's entrance. The walk starts at those stairs.
    const ways = gates
      .map((g) => ({ g, way: garageRoute(g.e.id, lot, level) }))
      .filter((x): x is { g: (typeof gates)[number]; way: NonNullable<ReturnType<typeof garageRoute>> } => x.way !== null);
    for (const { g, way } of ways) {
      const drive = g.approach.length ? [...streetPath(S, r, g.k, from, false), ...g.approach] : [...streetPath(S, r, g.k, from, false), g.e.street];
      const driveM = len(drive) + way.meters;
      const walkM = up ? up.m : 0;
      const minutes = Math.ceil(driveM / DRIVE_M_PER_MIN + walkM / WALK_M_PER_MIN);
      const legs: Leg[] = [
        { kind: 'drive', path: drive },
        { kind: 'garage', path: way.path, parts: way.parts, steps: way.steps },
        ...(up ? [{ kind: 'walk' as const, path: up.path }] : []),
      ];
      plans.push({ mode: 'drive', legs, walkM, driveM, minutes: Math.max(1, minutes), lot, entrance: g.e.id, gate: way.gate, garageCertain: way.certain, level, ramps: way.ramps });
    }
    if (ways.length) continue;
    // A lot missing from the drawing: the nearest ramp, then aisles along the ring round the Haram.
    const L = toM(at(lot));
    let ramp = -1;
    let rampCost = Infinity;
    let aisle: LatLng[] = [];
    const byNear = S.garageNodes
      .filter((k) => Number.isFinite(r.dist[k]))
      .map((k) => ({ k, d: Math.hypot(S.xy[k][0] - L[0], S.xy[k][1] - L[1]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 12);
    for (const { k } of byNear) {
      const inside = ringPath(fromM(S.xy[k]), at(lot));
      const c = r.dist[k] + 1.5 * len(inside);
      if (c < rampCost) {
        rampCost = c;
        ramp = k;
        aisle = inside;
      }
    }
    if (ramp < 0) continue;
    const drive = streetPath(S, r, ramp, from, false);
    const stairs: LatLng[] = up ? [at(lot), at(up.e)] : [];
    const driveM = len(drive) + len(aisle);
    const walkM = up ? len(stairs) + up.m : 0;
    const legs: Leg[] = [
      { kind: 'drive', path: drive },
      { kind: 'garage', path: [...aisle, ...stairs.slice(1)] },
      ...(up ? [{ kind: 'walk' as const, path: up.path }] : []),
    ];
    plans.push({ mode: 'drive', legs, walkM, driveM, minutes: Math.max(1, Math.ceil(driveM / DRIVE_M_PER_MIN + walkM / WALK_M_PER_MIN)), lot });
  }
  // The quickest lot, and other lots (or the other entrance) within 30% of its time. Two plans are
  // compared on what follows the streets: all cars come in by one of only two entrances, so the
  // street part is often the same while the lot, and the way to it underground, is not.
  return pickRoutes(
    plans.map((plan) => ({ path: plan.legs.length > 1 ? plan.legs.slice(1).flatMap((l) => l.path) : plan.legs[0].path, item: plan })),
    (c) => c.item.driveM / DRIVE_M_PER_MIN + c.item.walkM / WALK_M_PER_MIN,
  );
}

/**
 * The trip from a point to a place: the best route first, then up to two sensible alternatives.
 * Driving falls back to walking when no car route is found. `heading` (degrees, on a re-route)
 * favours routes that carry on ahead of the visitor.
 */
export async function planRoutes(from: LatLng, to: Poi, mode: Mode = 'walk', opts: { heading?: number | null; level?: Level } = {}): Promise<Plan[]> {
  if (mode === 'drive') {
    const p = await planDrive(from, to, opts.level ?? 'B');
    if (p.length) return p;
  }
  return planWalks(from, to, opts.heading);
}

/**
 * The way out of the car park from a lot: from the lot's exit to each exit of the car park — Quba
 * (the main one) and Sultana — then on to the streets where the owner drew it. Quickest first; the
 * other within 30% is offered too.
 */
export function planExit(lot: Poi, level: Level = 'B'): Plan[] {
  const plans: Plan[] = [];
  for (const x of EXITS) {
    const way = garageExit(lot, x.id, level);
    if (!way) continue;
    const onward = x.departure ?? [x.mouth, x.street];
    const driveM = way.meters + len(onward);
    plans.push({
      mode: 'drive',
      legs: [
        { kind: 'garage', path: way.path, parts: way.parts, steps: way.steps },
        { kind: 'drive', path: onward },
      ],
      walkM: 0,
      driveM,
      minutes: Math.max(1, Math.ceil(driveM / DRIVE_M_PER_MIN)),
      lot,
      exit: x.id,
      gate: way.gate,
      level,
      ramps: way.ramps,
      garageCertain: way.certain,
    });
  }
  return pickRoutes(
    plans.map((plan) => ({ path: plan.legs[0].path, item: plan })),
    (c) => c.item.driveM,
  );
}

/** The best trip from a point to a place. */
export async function planRoute(from: LatLng, to: Poi, mode: Mode = 'walk'): Promise<Plan> {
  return (await planRoutes(from, to, mode))[0];
}

/**
 * All legs as one path (for live navigation and fitting the map). A leg that starts where the last
 * one ended does not repeat that point; by car, the walk starts at the lot's stairs, apart from
 * where the drive ended (the lot's entrance): the visitor parks inside.
 */
export const fullPath = (p: Plan): LatLng[] =>
  p.legs.flatMap((l, i) => {
    const prev = i ? p.legs[i - 1].path[p.legs[i - 1].path.length - 1] : null;
    return prev && l.path.length && prev[0] === l.path[0][0] && prev[1] === l.path[0][1] ? l.path.slice(1) : l.path;
  });
