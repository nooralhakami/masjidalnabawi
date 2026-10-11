import type { LatLng } from '../data/types';
import { pathLength, toM, type XY } from './walk';

/**
 * Choosing several sensible routes for one trip. Pure.
 *
 * A route is offered beside the best one only when it is
 *  - at most 30% longer (owner, 2026-10-11), and
 *  - really another way: at most 70% of it runs along a route already offered.
 * At most three routes are offered.
 */

export const MAX_EXTRA = 1.3;
export const MAX_SHARED = 0.7;
export const MAX_ROUTES = 3;
/** Two routes "run together" where they are within this many metres. */
const TOGETHER_M = 10;
const SAMPLE_M = 5;

/** Points every few metres along a path (metric), so long and short segments weigh alike. */
function samples(path: LatLng[]): XY[] {
  const pts = path.map(toM);
  const out: XY[] = pts.length ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_M));
    for (let s = 1; s <= n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  return out;
}

function distToPath(p: XY, pts: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - dx * u, p[1] - ay - dy * u));
  }
  return pts.length === 1 ? Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) : best;
}

/** Share of `a` (0–1) that runs along `b`. */
export function shared(a: LatLng[], b: LatLng[]): number {
  const s = samples(a);
  if (!s.length) return 1;
  const B = b.map(toM);
  return s.filter((p) => distToPath(p, B) <= TOGETHER_M).length / s.length;
}

/** Direction (degrees from north) of the first stretch of a path, or null for a very short one. */
export function initialBearing(path: LatLng[], over = 25): number | null {
  const pts = path.map(toM);
  if (pts.length < 2) return null;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    walked += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (walked >= over || i === pts.length - 1) {
      const dx = pts[i][0] - pts[0][0];
      const dy = pts[i][1] - pts[0][1];
      if (Math.hypot(dx, dy) < 3) return null;
      return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    }
  }
  return null;
}

/**
 * Extra metres charged to a route that starts by turning the visitor round: walking on is more
 * natural than a U-turn, so on a re-route a route straight ahead wins unless turning back is
 * clearly shorter.
 */
export const TURN_BACK_M = 30;
export function turnPenalty(path: LatLng[], heading: number | null | undefined): number {
  if (heading == null) return 0;
  const b = initialBearing(path);
  if (b == null) return 0;
  const d = Math.abs(((b - heading) % 360) + 360) % 360;
  return (d > 180 ? 360 - d : d) > 110 ? TURN_BACK_M : 0;
}

export interface Candidate<T> {
  path: LatLng[];
  /** What is being chosen (a plan, a path). */
  item: T;
  /** Optional extra cost in metres (e.g. a turn back), used only for ranking. */
  penalty?: number;
}

/**
 * The best route and up to two alternatives: ranked by length (plus any penalty), each alternative
 * within 30% of the best's length and not mostly the same as one already chosen.
 */
export function pickRoutes<T>(cands: Candidate<T>[], measure: (c: Candidate<T>) => number = (c) => pathLength(c.path)): T[] {
  const ranked = cands
    .filter((c) => c.path.length > 1)
    .map((c) => ({ c, len: measure(c) }))
    .filter((x) => Number.isFinite(x.len))
    .sort((x, y) => x.len + (x.c.penalty ?? 0) - (y.len + (y.c.penalty ?? 0)));
  if (!ranked.length) return [];
  const best = ranked[0];
  const chosen = [best];
  for (const x of ranked.slice(1)) {
    if (chosen.length >= MAX_ROUTES) break;
    if (x.len > best.len * MAX_EXTRA) continue;
    if (chosen.some((y) => shared(x.c.path, y.c.path) > MAX_SHARED)) continue;
    chosen.push(x);
  }
  return chosen.map((x) => x.c.item);
}
