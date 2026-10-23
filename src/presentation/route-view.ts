import type { LatLng } from '../data/types';
import { haversine } from '../domain/geo';
import type { Plan } from '../routing/plan';

/**
 * What the route card and the map show about a trip (the live app's RouteInfo / RouteSummary from
 * map/route-layer.ts and ui/sheet.ts), as data: no Leaflet, no MapLibre, no DOM.
 */
export interface RouteSummary {
  meters: number;
  minutes: number;
  /** Walking to a car park: the number of its nearest entrance. */
  nearestEntrance?: number;
  /** By car: the drive, the lot, and the walk from it. */
  drive?: { meters: number; lot?: number; walkMeters: number; entrance?: 'omar' | 'sultana' | 'qurban'; unsure?: boolean; level?: 'A' | 'B'; exit?: 'omar' | 'sultana' | 'qurban'; carPark?: boolean };
  /** Every route offered (the chosen one included), and which one is chosen. */
  options: { minutes: number; meters: number }[];
  chosen: number;
}

/** The live app's summary of `plans[chosen]` (RouteLayer.show's return value, bounds aside). */
export function routeSummary(plans: readonly Plan[], chosen: number): RouteSummary {
  const plan = plans[chosen];
  return {
    meters: plan.walkM + plan.driveM,
    minutes: plan.minutes,
    ...(plan.entrances && plan.nearest ? { nearestEntrance: plan.nearest.id } : {}),
    ...(plan.mode === 'drive'
      ? {
          drive: {
            meters: plan.driveM,
            lot: plan.lot ? plan.lot.id - 900 : undefined,
            walkMeters: plan.walkM,
            entrance: plan.entrance,
            exit: plan.exit,
            level: plan.level,
            carPark: plan.carPark,
            unsure: plan.garageCertain === false,
          },
        }
      : {}),
    options: plans.map((p) => ({ minutes: p.minutes, meters: p.walkM + p.driveM })),
    chosen,
  };
}

/** South-west and north-east corners around every path, as [lng, lat] pairs (for the camera). */
export function boundsOf(paths: readonly (readonly LatLng[])[]): [[number, number], [number, number]] {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const path of paths)
    for (const [lat, lng] of path) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lng);
      e = Math.max(e, lng);
    }
  return [
    [w, s],
    [e, n],
  ];
}

/** The route's length in metres. */
export function lengthOf(path: readonly LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversine(path[i - 1], path[i]);
  return m;
}

/** The point at a share (0–1) of a path's length, for a label on it (the live app's pointAlong). */
export function pointAlong(path: readonly LatLng[], share: number): LatLng {
  let left = lengthOf(path) * share;
  for (let i = 1; i < path.length; i++) {
    const seg = haversine(path[i - 1], path[i]);
    if (left <= seg && seg > 0) {
      const f = left / seg;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
    }
    left -= seg;
  }
  return path[path.length - 1];
}

/** Light chevrons along the route, as the live app: one every 55 m, the first half-way into that. */
export const ARROW_EVERY_M = 55;

/** Compass bearing from a to b in degrees (0 = north, clockwise), on a flat local projection. */
export function bearing(a: LatLng, b: LatLng): number {
  const dy = b[0] - a[0];
  const dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Where the arrows go, and which way each points. They follow each leg (never the gap between
 * parking and the stairs), the spacing carried from one leg to the next (the live app's drawArrows).
 * Computed once per route, in metres: a zoom does not move them, so nothing is redone per frame.
 */
export function arrowsAlong(legs: readonly (readonly LatLng[])[], every = ARROW_EVERY_M): { at: LatLng; bearing: number }[] {
  const out: { at: LatLng; bearing: number }[] = [];
  let carry = every / 2;
  for (const leg of legs)
    for (let k = 1; k < leg.length; k++) {
      const a = leg[k - 1];
      const b = leg[k];
      const seg = haversine(a, b);
      let s = carry;
      while (s < seg) {
        const f = s / seg;
        out.push({ at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearing(a, b) });
        s += every;
      }
      carry = s - seg;
    }
  return out;
}

// ---------- live navigation, as the bar shows it ----------

export type NavigationState = 'locating' | 'updated' | 'low-accuracy' | 'away' | 'signal-lost' | 'off-route' | 'error' | 'stopped' | 'arrived';
export type StepKind = 'n' | 'e' | 's' | 'w' | 'up' | 'down' | 'lot_in' | 'lot_out';

/** The car park instruction to show: the step now with the metres left in it, and the one after. */
export interface StepView {
  now: { kind: StepKind; meters: number } | null;
  next: { kind: StepKind; meters: number | null } | null;
  lot: number | null;
}

/** i18n key for each state's status line (as in the live app's panel). */
export const STATE_LABEL: Record<NavigationState, string> = {
  'off-route': 'nav_off',
  'low-accuracy': 'nav_low',
  away: 'nav_away',
  locating: 'nav_locating',
  'signal-lost': 'nav_lost',
  error: 'nav_error',
  updated: 'nav_ok',
  stopped: 'nav_ok',
  arrived: 'nav_arrived',
};

/** What the navigation bar needs from the tracker's snapshot. */
export interface NavView {
  state: NavigationState;
  accuracy: number;
  remainingMeters: number;
  remainingMinutes: number;
  follow: boolean;
  progress: number;
  step: StepView | null;
}

/** The bar shows the minutes and metres once known (the live app's «known»). */
export const navKnown = (s: Pick<NavView, 'remainingMeters' | 'state'>): boolean => s.remainingMeters > 0 || s.state === 'updated';
