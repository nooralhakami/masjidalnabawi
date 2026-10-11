import type { LatLng } from '../data/types';
import { toM, type XY } from '../routing/walk';

/**
 * Where the visitor is along a route. Pure.
 * Searches every segment (routes are short), so walking back towards the start is followed too;
 * a small penalty on big jumps along the route keeps the match stable where the path doubles back.
 */
export interface Progress {
  /** Metres from the route start to the visitor's projected point. */
  along: number;
  /** Metres between the visitor and the route. */
  offset: number;
  /** Route length in metres. */
  total: number;
  /** Metres left to the destination. */
  remaining: number;
  /** Projected point on the route. */
  point: LatLng;
  /** Direction of the route at that point (degrees). */
  routeBearing: number;
}

const JUMP_PENALTY = 0.25; // metres of offset per metre of along-route jump

export class RouteTrack {
  private pts: XY[];
  private cum: number[];
  readonly total: number;

  constructor(private path: LatLng[]) {
    this.pts = path.map(toM);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]));
    }
    this.total = this.cum[this.cum.length - 1] ?? 0;
  }

  locate(pos: LatLng, previousAlong: number | null = null): Progress {
    const p = toM(pos);
    let best: { score: number; along: number; offset: number; x: number; y: number; i: number } | null = null;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const [ax, ay] = this.pts[i];
      const [bx, by] = this.pts[i + 1];
      const lx = bx - ax;
      const ly = by - ay;
      const len2 = lx * lx + ly * ly || 1;
      const u = Math.max(0, Math.min(1, ((p[0] - ax) * lx + (p[1] - ay) * ly) / len2));
      const x = ax + lx * u;
      const y = ay + ly * u;
      const offset = Math.hypot(p[0] - x, p[1] - y);
      const along = this.cum[i] + Math.sqrt(len2) * u;
      const score = offset + (previousAlong === null ? 0 : JUMP_PENALTY * Math.abs(along - previousAlong));
      if (!best || score < best.score) best = { score, along, offset, x, y, i };
    }
    if (!best) return { along: 0, offset: 0, total: 0, remaining: 0, point: pos, routeBearing: 0 };
    const [ax, ay] = this.pts[best.i];
    const [bx, by] = this.pts[best.i + 1];
    const routeBearing = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
    // Back to lat/lng by linear interpolation along the original segment.
    const segLen = this.cum[best.i + 1] - this.cum[best.i] || 1;
    const f = (best.along - this.cum[best.i]) / segLen;
    const a = this.path[best.i];
    const b = this.path[best.i + 1];
    const point: LatLng = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    return { along: best.along, offset: best.offset, total: this.total, remaining: Math.max(0, this.total - best.along), point, routeBearing };
  }
}

/**
 * Detects walking away from the destination: remaining distance has grown by more than
 * `threshold` metres compared with its lowest value in the recent window.
 */
export class AwayDetector {
  private history: { t: number; remaining: number }[] = [];
  constructor(
    private windowMs = 20_000,
    private threshold = 15,
  ) {}

  reset(): void {
    this.history = [];
  }

  push(time: number, remaining: number): boolean {
    this.history.push({ t: time, remaining });
    while (this.history.length > 1 && time - this.history[0].t > this.windowMs) this.history.shift();
    const lowest = Math.min(...this.history.map((h) => h.remaining));
    return remaining - lowest > this.threshold;
  }
}

/**
 * Which alternative route (if any) the visitor is walking on: the index of the nearest one they are
 * within `tolerance` metres of, or -1. Used when they have left the chosen route, so a switch to a
 * route already on the map needs no re-planning.
 */
export function onAlternative(tracks: readonly RouteTrack[], pos: LatLng, accuracy: number): number {
  const tolerance = Math.max(12, Math.min(accuracy, 20));
  let best = -1;
  let bestOffset = Infinity;
  tracks.forEach((track, i) => {
    const { offset } = track.locate(pos);
    if (offset <= tolerance && offset < bestOffset) {
      best = i;
      bestOffset = offset;
    }
  });
  return best;
}

/** Smallest angle between two bearings (0–180). */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}
