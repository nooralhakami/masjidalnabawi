import { POIS, ROUTING } from '../data';
import type { LatLng, Poi } from '../data/types';
import { haversine } from '../domain/geo';

/**
 * Walking routes on the plaza walkway network: the main ring round the mosque plus the owner's
 * branches (spurs to the north wall, cross links in the west plaza, paths to the women's prayer
 * areas). Shortest path on that graph; never crosses the mosque building or Al-Baqi' (outside the Haram).
 */

// Local metric projection around the reference anchor (same as the reference app).
const LAT0 = 24.4673;
const LNG0 = 39.6111;
const KY = 111_320;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

export type XY = [number, number];
export const toM = (ll: LatLng): XY => [(ll[1] - LNG0) * KX, (ll[0] - LAT0) * KY];
export const fromM = (m: XY): LatLng => [LAT0 + m[1] / KY, LNG0 + m[0] / KX];

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function rectOf(poly: LatLng[], pad: number): Rect {
  const pts = poly.map(toM);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs) + pad, x1: Math.max(...xs) - pad, y0: Math.min(...ys) + pad, y1: Math.max(...ys) - pad };
}

interface Segment {
  a: XY;
  b: XY;
  l: number;
  /** Distance along the ring where this segment starts. */
  t0: number;
}

/** One walkable piece of the graph between two nodes. */
interface Edge {
  u: number;
  v: number;
  l: number;
}

export interface Network {
  /** The main ring (kept for reports and tests). */
  ring: XY[];
  seg: Segment[];
  /** Ring perimeter in metres. */
  P: number;
  obstacles: Rect[];
  /** The restroom buildings (one same-size square each): a route may end at one, never cross another. */
  buildings: Rect[];
  /** Everything a route must not cross: the obstacles and the buildings. */
  blocks: Rect[];
  /** Walkway graph: ring + branches, split where they meet. */
  nodes: XY[];
  edges: Edge[];
}

let net: Network | null = null;

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Closest point on segment a–b to p, with its parameter (0…1) and distance. */
function project(p: XY, a: XY, b: XY): { q: XY; u: number; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const q: XY = [a[0] + dx * u, a[1] + dy * u];
  return { q, u, d: dist(p, q) };
}

/** A branch end this close to another walkway joins it there. */
const JOIN_M = 4;
/** Points closer than this are one node. */
const MERGE_M = 1;

function buildGraph(lines: XY[][]): { nodes: XY[]; edges: Edge[] } {
  const segs = lines.flatMap((pts, li) => pts.slice(1).map((b, i) => ({ li, a: pts[i], b, cuts: [] as { u: number; p: XY }[] })));
  // Branch ends that stop at (or just short of) another walkway join it there.
  lines.forEach((pts, li) => {
    for (const end of [0, pts.length - 1]) {
      let best: { s: (typeof segs)[number]; u: number; q: XY; d: number } | null = null;
      for (const s of segs) {
        if (s.li === li) continue;
        const pr = project(pts[end], s.a, s.b);
        if (pr.d <= JOIN_M && (!best || pr.d < best.d)) best = { s, ...pr };
      }
      if (best) {
        best.s.cuts.push({ u: best.u, p: best.q });
        const own = segs.filter((s) => s.li === li);
        const mine = end === 0 ? own[0] : own[own.length - 1];
        mine.cuts.push({ u: end === 0 ? 0 : 1, p: best.q });
      }
    }
  });
  // Walkways that cross each other meet at the crossing.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.li === t.li) continue;
      const r: XY = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
      const q: XY = [t.b[0] - t.a[0], t.b[1] - t.a[1]];
      const den = r[0] * q[1] - r[1] * q[0];
      if (Math.abs(den) < 1e-9) continue;
      const w: XY = [t.a[0] - s.a[0], t.a[1] - s.a[1]];
      const u = (w[0] * q[1] - w[1] * q[0]) / den;
      const v = (w[0] * r[1] - w[1] * r[0]) / den;
      if (u > 0 && u < 1 && v > 0 && v < 1) {
        const p: XY = [s.a[0] + r[0] * u, s.a[1] + r[1] * u];
        s.cuts.push({ u, p });
        t.cuts.push({ u: v, p });
      }
    }
  }
  const nodes: XY[] = [];
  const node = (p: XY) => {
    const k = nodes.findIndex((n) => dist(n, p) < MERGE_M);
    if (k >= 0) return k;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  for (const s of segs) {
    const pts = [{ u: 0, p: s.a }, ...s.cuts, { u: 1, p: s.b }].sort((x, y) => x.u - y.u);
    // A joined end replaces the segment's own end point.
    const first = s.cuts.find((c) => c.u === 0)?.p ?? s.a;
    const last = s.cuts.find((c) => c.u === 1)?.p ?? s.b;
    const seq = pts.map((c) => (c.u === 0 ? first : c.u === 1 ? last : c.p)).map(node);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1]) continue;
      edges.push({ u: seq[i - 1], v: seq[i], l: dist(nodes[seq[i - 1]], nodes[seq[i]]) });
    }
  }
  return { nodes, edges };
}

// ---------- restroom buildings ----------

/** Walkways pass this far (m) from a restroom's wall, so the rounded corners of a detour stay clear of it. */
const BUILDING_MARGIN_M = 3;

/**
 * Every restroom inside the Haram is a square building of the same size (owner, 2026-10-11), centred
 * on its marker: a route may end at one, never cross another. Restrooms standing inside the mosque
 * or Al-Baqi' rectangles are covered by those already.
 */
function toiletBuildings(obstacles: Rect[]): Rect[] {
  const h = ROUTING.rules.toilet_building_m / 2;
  return POIS.filter((p) => p.category === 'toilets')
    .map((p) => toM([p.lat, p.lng]))
    .filter((c) => !obstacles.some((r) => insideRect(c, r)))
    .map((c) => ({ x0: c[0] - h, x1: c[0] + h, y0: c[1] - h, y1: c[1] + h }));
}

/** Restrooms farther than this from both the mosque and an outer gate keep no door side (the far west ones). */
const DOOR_RULE_M = 150;
/** The end of a route this far out from a restroom's wall, in front of its door. */
const DOOR_OUT_M = 1.5;
/** A way to a door passes this close to the building's other walls on its way round. */
const DOOR_CLEAR_M = 1;

/**
 * The door of a restroom building (owner, 2026-10-14): one nearer the mosque than an outer gate opens
 * towards the mosque; one nearer an outer gate opens away from it, towards the outer gates. Taken on
 * the building's side that faces that way (north, east, south or west). Null for anything else, or a
 * restroom far from both.
 */
export function restroomDoor(p: Poi): LatLng | null {
  if (p.category !== 'toilets') return null;
  const N = network();
  const c = toM([p.lat, p.lng]);
  if (!N.buildings.some((r) => insideRect(c, r))) return null;
  const m = N.obstacles[0];
  const q: XY = [Math.max(m.x0, Math.min(m.x1, c[0])), Math.max(m.y0, Math.min(m.y1, c[1]))];
  const toMosque = dist(q, c);
  const toGate = Math.min(...POIS.filter((g) => g.subCategory === 'gate_outer').map((g) => dist(toM([g.lat, g.lng]), c)));
  if (Math.min(toMosque, toGate) > DOOR_RULE_M) return null;
  const sign = toMosque < toGate ? 1 : -1; // towards the mosque, or away from it
  const v: XY = [(q[0] - c[0]) * sign, (q[1] - c[1]) * sign];
  const out = ROUTING.rules.toilet_building_m / 2 + DOOR_OUT_M;
  const d: XY = Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]) * out, 0] : [0, Math.sign(v[1]) * out];
  return fromM([c[0] + d[0], c[1] + d[1]]);
}

/** Where the segment a→b is inside the rectangle: parameters [t0, t1] along it, or null (Liang–Barsky). */
function clipSegment(a: XY, b: XY, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [
    [-d[0], a[0] - r.x0],
    [d[0], r.x1 - a[0]],
    [-d[1], a[1] - r.y0],
    [d[1], r.y1 - a[1]],
  ] as [number, number][]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** The way from boundary point e to boundary point x round a rectangle, by its corners (the shorter way). */
function aroundRect(e: XY, x: XY, r: Rect): XY[] {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const P = 2 * (w + h);
  // Position along the perimeter, going clockwise from the top-left corner (y grows northwards).
  const at = (p: XY): number => {
    const dl = Math.abs(p[0] - r.x0);
    const dr = Math.abs(p[0] - r.x1);
    const dt = Math.abs(p[1] - r.y1);
    const db = Math.abs(p[1] - r.y0);
    const m = Math.min(dl, dr, dt, db);
    if (m === dt) return p[0] - r.x0;
    if (m === dr) return w + (r.y1 - p[1]);
    if (m === db) return w + h + (r.x1 - p[0]);
    return 2 * w + h + (p[1] - r.y0);
  };
  const corners: [number, XY][] = [
    [0, [r.x0, r.y1]],
    [w, [r.x1, r.y1]],
    [w + h, [r.x1, r.y0]],
    [2 * w + h, [r.x0, r.y0]],
  ];
  const s = at(e);
  const f = at(x);
  const forward = (((f - s) % P) + P) % P;
  const out: XY[] = [];
  if (forward <= P - forward) {
    for (const [c, p] of corners) if ((((c - s) % P) + P) % P < forward && (((c - s) % P) + P) % P > 0) out.push(p);
    out.sort((a, b) => ((((at(a) - s) % P) + P) % P) - ((((at(b) - s) % P) + P) % P));
  } else {
    const back = P - forward;
    for (const [c, p] of corners) if ((((s - c) % P) + P) % P < back && (((s - c) % P) + P) % P > 0) out.push(p);
    out.sort((a, b) => ((((s - at(a)) % P) + P) % P) - ((((s - at(b)) % P) + P) % P));
  }
  return out;
}

/**
 * Bends a walkway round the buildings it would cross: where a line enters a building's area (its
 * wall plus a margin) it follows that outline to where it leaves, by the shorter side. A line that
 * starts or ends inside the area (a spur to a restroom) is left as drawn.
 */
export function aroundBuildings(line: XY[], buildings: Rect[], margin = BUILDING_MARGIN_M): XY[] {
  const along = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let pts = line;
  for (const wall of buildings) {
    const area: Rect = { x0: wall.x0 - margin, x1: wall.x1 + margin, y0: wall.y0 - margin, y1: wall.y1 + margin };
    const out: XY[] = [];
    let i = 0;
    while (i < pts.length) {
      if (insideRect(pts[i], area)) {
        // A run of vertices inside the area: bend round it if the line really goes through the wall.
        let j = i;
        while (j < pts.length && insideRect(pts[j], area)) j++;
        const before = i > 0 ? pts[i - 1] : null;
        const after = j < pts.length ? pts[j] : null;
        const chain = [...(before ? [before] : []), ...pts.slice(i, j), ...(after ? [after] : [])];
        const through = chain.some((q, k) => k > 0 && clipSegment(chain[k - 1], q, wall) !== null);
        const enter = before ? clipSegment(before, pts[i], area) : null;
        const leave = after ? clipSegment(pts[j - 1], after, area) : null;
        if (through && before && after && enter && leave) {
          const e = along(before, pts[i], enter[0]);
          const x = along(pts[j - 1], after, leave[1]);
          out.push(e, ...aroundRect(e, x, area), x);
        } else {
          out.push(...pts.slice(i, j));
        }
        i = j;
        continue;
      }
      // Both ends outside the area, but the segment crosses it.
      if (i > 0 && !insideRect(pts[i - 1], area) && clipSegment(pts[i - 1], pts[i], wall)) {
        const c = clipSegment(pts[i - 1], pts[i], area)!;
        const e = along(pts[i - 1], pts[i], c[0]);
        const x = along(pts[i - 1], pts[i], c[1]);
        out.push(e, ...aroundRect(e, x, area), x);
      }
      out.push(pts[i]);
      i++;
    }
    pts = out;
  }
  return pts;
}

const pathLen = (pts: XY[]): number => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

/**
 * Whether the segment a→b passes through the rectangle, except a stretch that is the trip's own end
 * (an end point standing inside it: a restroom reached from outside).
 */
function crossesInterior(a: XY, b: XY, r: Rect, ends: XY[]): boolean {
  if (ends.some((e) => insideRect(e, r))) return false;
  return clipSegment(a, b, r) !== null;
}

export function network(): Network {
  if (net) return net;
  const ring = ROUTING.walkway_ring.map(toM);
  const seg: Segment[] = [];
  let P = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push({ a, b, l, t0: P });
    P += l;
  });
  // The mosque is shrunk 3 m so paths may hug its walls, as in the reference.
  const big = Object.entries(ROUTING.obstacles).map(([name, poly]) => rectOf(poly, name === 'mosque_building' ? 3 : 0));
  const buildings = toiletBuildings(big);
  const lines = [[...ring, ring[0]], ...(ROUTING.walkways ?? []).map((w) => w.path.map(toM))].map((l) => aroundBuildings(l, buildings));
  return (net = { ring, seg, P, obstacles: big, buildings, blocks: [...big, ...buildings], ...buildGraph(lines) });
}

export const insideRect = (p: XY, r: Rect): boolean => p[0] > r.x0 && p[0] < r.x1 && p[1] > r.y0 && p[1] < r.y1;

/** Whether the straight segment a→b passes through rectangle r (sampled every ~2 m). */
export function segmentHits(a: XY, b: XY, r: Rect): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
  for (let i = 0; i <= n; i++) {
    const p: XY = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    if (insideRect(p, r)) return true;
  }
  return false;
}

const hitsAny = (a: XY, b: XY, N: Network) => N.blocks.some((r) => segmentHits(a, b, r));

/** Nearest point on the ring, with its distance along the ring. */
export function projectOnRing(p: XY, N: Network): { d: number; p: XY; t: number } {
  let best: { d: number; p: XY; t: number } | null = null;
  for (const sg of N.seg) {
    const dx = sg.b[0] - sg.a[0];
    const dy = sg.b[1] - sg.a[1];
    let u = ((p[0] - sg.a[0]) * dx + (p[1] - sg.a[1]) * dy) / (sg.l * sg.l);
    u = Math.max(0, Math.min(1, u));
    const q: XY = [sg.a[0] + dx * u, sg.a[1] + dy * u];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { d, p: q, t: sg.t0 + u * sg.l };
  }
  return best!;
}

/** Replace each corner with a quadratic curve of radius r (metres). */
export function roundCorners(P: XY[], r: number): XY[] {
  if (P.length < 3) return P;
  const out: XY[] = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const v = P[i];
    const a = P[i - 1];
    const b = P[i + 1];
    const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]);
    const l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
    if (!l1 || !l2) {
      out.push(v);
      continue;
    }
    const d1 = Math.min(r, l1 / 2);
    const d2 = Math.min(r, l2 / 2);
    const s: XY = [v[0] + ((a[0] - v[0]) * d1) / l1, v[1] + ((a[1] - v[1]) * d1) / l1];
    const e: XY = [v[0] + ((b[0] - v[0]) * d2) / l2, v[1] + ((b[1] - v[1]) * d2) / l2];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      out.push([(1 - u) * (1 - u) * s[0] + 2 * u * (1 - u) * v[0] + u * u * e[0], (1 - u) * (1 - u) * s[1] + 2 * u * (1 - u) * v[1] + u * u * e[1]]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

function inPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let openAreas: XY[][] | null = null;
/** Both points on the same open area (no set paths there). */
export function openTogether(a: XY, b: XY): boolean {
  openAreas ??= (ROUTING.open_areas ?? []).map((o) => o.polygon.map(toM));
  return openAreas.some((poly) => inPolygon(a, poly) && inPolygon(b, poly));
}

interface Hook {
  /** Where the visitor joins the walkway, and the walk to it. */
  q: XY;
  d: number;
  /** The edge it joins and how far along it. */
  e: Edge;
  along: number;
}

/**
 * Where a point may join the network: the nearest point of every edge it can reach in a straight
 * line without crossing an obstacle (one it stands inside does not count), up to 40 m further than
 * the nearest such edge, so the shortest path can pick the best one.
 */
function hooks(p: XY, N: Network): Hook[] {
  const blocking = N.blocks.filter((r) => !insideRect(p, r));
  const all = N.edges.map((e) => {
    const pr = project(p, N.nodes[e.u], N.nodes[e.v]);
    return { q: pr.q, d: pr.d, e, along: pr.u * e.l, clear: !blocking.some((r) => segmentHits(p, pr.q, r)) };
  });
  const ok = all.filter((h) => h.clear);
  const pool = ok.length ? ok : all;
  const best = Math.min(...pool.map((h) => h.d));
  return pool.filter((h) => h.d <= best + 40);
}

/**
 * Shortest walk a → network → b, as points (without corner rounding), or null. With `avoid`,
 * walkways between two avoided nodes cost more (to find another way for an alternative route);
 * `length` is then the real length, and `nodes` the network nodes the walk passes.
 */
function graphRoute(A: XY, B: XY, N: Network, avoid?: Uint8Array): { pts: XY[]; length: number; nodes: number[] } | null {
  const n = N.nodes.length;
  const S = n;
  const T = n + 1;
  const adj: [number, number][][] = Array.from({ length: n + 2 }, () => []);
  for (const e of N.edges) {
    const w = avoid && avoid[e.u] && avoid[e.v] ? e.l * AVOID_FACTOR : e.l;
    adj[e.u].push([e.v, w]);
    adj[e.v].push([e.u, w]);
  }
  const hs = hooks(A, N);
  const ht = hooks(B, N);
  // Joining through a hook: S → q → edge end, edge end → q → T.
  const via = new Map<string, XY>();
  for (const h of hs) {
    adj[S].push([h.e.u, h.d + h.along], [h.e.v, h.d + h.e.l - h.along]);
    via.set(`S${h.e.u}`, via.get(`S${h.e.u}`) ?? h.q);
    via.set(`S${h.e.v}`, via.get(`S${h.e.v}`) ?? h.q);
  }
  for (const h of ht) {
    adj[h.e.u].push([T, h.d + h.along]);
    adj[h.e.v].push([T, h.d + h.e.l - h.along]);
  }
  // Dijkstra (the graph is a few dozen nodes).
  const D = new Array(n + 2).fill(Infinity);
  const prev = new Array(n + 2).fill(-1);
  const done = new Array(n + 2).fill(false);
  D[S] = 0;
  for (;;) {
    let k = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && D[i] < Infinity && (k < 0 || D[i] < D[k])) k = i;
    if (k < 0 || k === T) break;
    done[k] = true;
    for (const [j, w] of adj[k]) {
      if (D[k] + w < D[j]) {
        D[j] = D[k] + w;
        prev[j] = k;
      }
    }
  }
  let best: { pts: XY[]; length: number; nodes: number[] } | null = null;
  // Both ends on the same edge: walk along it directly.
  for (const s of hs) {
    for (const t of ht) {
      if (s.e !== t.e) continue;
      const length = s.d + Math.abs(s.along - t.along) + t.d;
      if (!best || length < best.length) best = { pts: [A, s.q, t.q, B], length, nodes: [] };
    }
  }
  if (D[T] < Infinity && (!best || D[T] < best.length)) {
    const chain: number[] = [];
    for (let k = prev[T]; k !== S && k >= 0; k = prev[k]) chain.unshift(k);
    const first = chain[0];
    const last = chain[chain.length - 1];
    // The hooks used at each end: the ones that give the costs Dijkstra settled on.
    const hS = hs.reduce(
      (m, h) => {
        const c = h.e.u === first ? h.d + h.along : h.e.v === first ? h.d + h.e.l - h.along : Infinity;
        return c < m.c ? { h, c } : m;
      },
      { h: hs[0], c: Infinity },
    ).h;
    const hT = ht.reduce(
      (m, h) => {
        const c = h.e.u === last ? h.d + h.along : h.e.v === last ? h.d + h.e.l - h.along : Infinity;
        return c < m.c ? { h, c } : m;
      },
      { h: ht[0], c: Infinity },
    ).h;
    const pts: XY[] = [A, hS.q, ...chain.map((k) => N.nodes[k]), hT.q, B];
    best = { pts, length: avoid ? lengthOf(pts) : D[T], nodes: chain };
  }
  return best;
}

/** Walkways shared with a route already found cost this much more when looking for another way. */
const AVOID_FACTOR = 1.8;
const lengthOf = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

/**
 * Route from a to b along the walkway network (shortest path). A short trip (< 150 m) may instead
 * take a right-angle "L" that clears every obstacle, but only when the walkways would be much longer.
 */
export function walkPath(a: LatLng, b: LatLng): LatLng[] {
  const N = network();
  const { short_L_route_max_m, corner_radius_m } = ROUTING.rules;
  const A = toM(a);
  const B = toM(b);
  let pts: XY[] | null = null;
  const graph = graphRoute(A, B, N);

  // Open ground (the west plaza): with both ends on it, walk straight across — beside any restroom
  // building in the way, never over it (the mosque and Al-Baqi' are not on the open ground).
  if (openTogether(A, B) && !N.obstacles.some((r) => segmentHits(A, B, r))) {
    const open = aroundBuildings([A, B], N.buildings);
    if (!open.some((p, i) => i > 0 && N.blocks.some((r) => crossesInterior(open[i - 1], p, r, [A, B]))) && (!graph || pathLen(open) < graph.length)) pts = open;
  }

  if (!pts && dist(A, B) < short_L_route_max_m) {
    for (const c of [
      [B[0], A[1]],
      [A[0], B[1]],
    ] as XY[]) {
      const L = dist(A, c) + dist(c, B);
      if (!hitsAny(A, c, N) && !hitsAny(c, B, N) && (!graph || L < graph.length / 1.5)) {
        pts = [A, c, B];
        break;
      }
    }
  }
  pts ??= graph?.pts ?? [A, B];
  // The stretch from the walkways to a restroom's door may meet the building first (the door on its
  // far side): round it, close to the wall (the door itself is 1.5 m out, outside this margin).
  pts = aroundBuildings(
    pts,
    N.buildings.filter((r) => !insideRect(A, r) && !insideRect(B, r)),
    DOOR_CLEAR_M,
  );

  // Drop near-duplicate points before rounding.
  const clean: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const l = clean[clean.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) > 0.5) clean.push(pts[i]);
  }
  return roundCorners(clean, corner_radius_m).map(fromM);
}

/**
 * Along the main ring only, the shorter way round, from a to b (each joined to the ring by a straight
 * line). The underground car park runs round the Haram in this shape (owner, 2026-10-08).
 */
/**
 * The walkway route from a to b (walkPath) and up to two other ways along the walkways, each found
 * by making the walkways of the routes already found dearer. The caller keeps only the sensible ones
 * (routing/alternatives.ts: at most 30% longer, mostly different).
 */
export function walkPaths(a: LatLng, b: LatLng): LatLng[][] {
  const out = [walkPath(a, b)];
  const N = network();
  const A = toM(a);
  const B = toM(b);
  const avoid = new Uint8Array(N.nodes.length);
  let route = graphRoute(A, B, N);
  for (let i = 0; i < 2 && route?.nodes.length; i++) {
    route.nodes.forEach((k) => (avoid[k] = 1));
    route = graphRoute(A, B, N, avoid);
    if (route) out.push(roundCorners(route.pts, ROUTING.rules.corner_radius_m).map(fromM));
  }
  return out;
}

export function ringPath(a: LatLng, b: LatLng): LatLng[] {
  const N = network();
  const A = toM(a);
  const B = toM(b);
  const qa = projectOnRing(A, N);
  const qb = projectOnRing(B, N);
  const P = N.P;
  let df = (((qb.t - qa.t) % P) + P) % P;
  const fwd = df <= P / 2;
  if (!fwd) df = P - df;
  const mid: [number, XY][] = [];
  N.seg.forEach((sg, i) => {
    const d = fwd ? (((sg.t0 - qa.t) % P) + P) % P : (((qa.t - sg.t0) % P) + P) % P;
    if (d > 0.5 && d < df - 0.5) mid.push([d, N.ring[i]]);
  });
  const pts: XY[] = [A, qa.p, ...mid.sort((x, y) => x[0] - y[0]).map((m) => m[1]), qb.p, B];
  const clean: XY[] = [pts[0]];
  for (const p of pts.slice(1)) if (dist(p, clean[clean.length - 1]) > 0.5) clean.push(p);
  return roundCorners(clean, ROUTING.rules.corner_radius_m).map(fromM);
}

/** Path length in metres. */
export function pathLength(path: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversine(path[i - 1], path[i]);
  return m;
}

/** Walking minutes at the configured pace (80 m/min), at least 1. */
export const walkMinutes = (meters: number): number => Math.max(1, Math.ceil(meters / ROUTING.rules.walk_speed_m_per_min));
