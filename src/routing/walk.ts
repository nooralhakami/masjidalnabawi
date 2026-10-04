import { ROUTING } from '../data';
import type { LatLng } from '../data/types';
import { haversine } from '../domain/geo';

/**
 * Walking routes along the plaza walkway ring, ported from the reference app.
 * Never crosses the mosque building or Al-Baqi' (outside the Haram).
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

export interface Network {
  ring: XY[];
  seg: Segment[];
  /** Ring perimeter in metres. */
  P: number;
  obstacles: Rect[];
}

let net: Network | null = null;

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
  const obstacles = [rectOf(ROUTING.obstacles.mosque_building, 3), rectOf(ROUTING.obstacles.baqi_outside_haram, 0)];
  return (net = { ring, seg, P, obstacles });
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

const hitsAny = (a: XY, b: XY, N: Network) => N.obstacles.some((r) => segmentHits(a, b, r));

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
      out.push([
        (1 - u) * (1 - u) * s[0] + 2 * u * (1 - u) * v[0] + u * u * e[0],
        (1 - u) * (1 - u) * s[1] + 2 * u * (1 - u) * v[1] + u * u * e[1],
      ]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

/**
 * Route from a to b. Short trips (< 150 m) take a right-angle "L" if it clears every obstacle;
 * otherwise both ends snap to the ring and the route follows it the shorter way round.
 */
export function walkPath(a: LatLng, b: LatLng): LatLng[] {
  const N = network();
  const { short_L_route_max_m, corner_radius_m } = ROUTING.rules;
  const A = toM(a);
  const B = toM(b);
  let pts: XY[] | null = null;

  if (Math.hypot(A[0] - B[0], A[1] - B[1]) < short_L_route_max_m) {
    for (const c of [
      [B[0], A[1]],
      [A[0], B[1]],
    ] as XY[]) {
      if (!hitsAny(A, c, N) && !hitsAny(c, B, N)) {
        pts = [A, c, B];
        break;
      }
    }
  }

  if (!pts) {
    const qa = projectOnRing(A, N);
    const qb = projectOnRing(B, N);
    const P = N.P;
    let df = (((qb.t - qa.t) % P) + P) % P;
    const fwd = df <= P / 2;
    if (!fwd) df = P - df;
    pts = [A, qa.p];
    const mid: [number, XY][] = [];
    N.seg.forEach((sg, i) => {
      const d = fwd ? (((sg.t0 - qa.t) % P) + P) % P : (((qa.t - sg.t0) % P) + P) % P;
      if (d > 0.5 && d < df - 0.5) mid.push([d, N.ring[i]]);
    });
    mid.sort((x, y) => x[0] - y[0]).forEach((m) => pts!.push(m[1]));
    pts.push(qb.p, B);
  }

  // Drop near-duplicate points before rounding.
  const clean: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const l = clean[clean.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) > 0.5) clean.push(pts[i]);
  }
  return roundCorners(clean, corner_radius_m).map(fromM);
}

/** Path length in metres. */
export function pathLength(path: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversine(path[i - 1], path[i]);
  return m;
}

/** Walking minutes at the configured pace (80 m/min), at least 1. */
export const walkMinutes = (meters: number): number => Math.max(1, Math.ceil(meters / ROUTING.rules.walk_speed_m_per_min));
