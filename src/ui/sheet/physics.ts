/**
 * Bottom-sheet physics (docs/DESIGN.md §4), pure so it can be tested: which detent a release lands
 * on, and a damped spring that carries the finger's speed into the settle.
 * Heights are the visible part of the sheet in px; velocities are px/s, positive = growing.
 */

export type Detent = 'closed' | 'peek' | 'half' | 'full';
export const DETENTS: readonly Detent[] = ['closed', 'peek', 'half', 'full'];

export interface Spring {
  stiffness: number;
  damping: number;
  mass: number;
}
export const SPRINGS = {
  sheet: { stiffness: 380, damping: 34, mass: 1 },
  toggle: { stiffness: 520, damping: 40, mass: 1 },
  card: { stiffness: 300, damping: 30, mass: 1 },
} as const satisfies Record<string, Spring>;

/** How far ahead a release looks: where the sheet would be after this long at the finger's speed. */
export const PROJECT_S = 0.18;
/** A flick faster than this moves one whole detent in its direction, whatever the position. */
export const FLICK_PX_S = 1200;

export type Heights = Record<Detent, number>;

/** The detents a sheet offers, in order, with their visible heights. */
export function detentHeights(viewport: number, opts: { peek?: number; half?: number; extra?: number; topGap?: number } = {}): Heights {
  const full = Math.max(0, viewport - (opts.topGap ?? 12));
  const peek = Math.min(full, opts.peek ?? 112);
  const half = Math.min(full, Math.max(peek, Math.round(viewport * (opts.half ?? 0.55)) + (opts.extra ?? 0)));
  return { closed: 0, peek, half, full };
}

/**
 * The detent a released sheet settles on: a fast flick moves one step from where the drag began;
 * otherwise the detent nearest to where the sheet is heading.
 */
export function releaseDetent(from: Detent, visible: number, velocity: number, heights: Heights, allowed: readonly Detent[] = DETENTS): Detent {
  const order = DETENTS.filter((d) => allowed.includes(d));
  if (Math.abs(velocity) > FLICK_PX_S) {
    const i = order.indexOf(from);
    const at = i >= 0 ? i : nearestIndex(order, visible, heights);
    return order[Math.max(0, Math.min(order.length - 1, at + Math.sign(velocity)))];
  }
  return order[nearestIndex(order, visible + velocity * PROJECT_S, heights)];
}

function nearestIndex(order: readonly Detent[], h: number, heights: Heights): number {
  let best = 0;
  order.forEach((d, i) => {
    if (Math.abs(heights[d] - h) < Math.abs(heights[order[best]] - h)) best = i;
  });
  return best;
}

/** The next detent up or down (keyboard ↑/↓ on the handle). */
export function stepDetent(from: Detent, dir: 1 | -1, allowed: readonly Detent[] = DETENTS): Detent {
  const order = DETENTS.filter((d) => allowed.includes(d));
  const i = Math.max(0, order.indexOf(from));
  return order[Math.max(0, Math.min(order.length - 1, i + dir))];
}

/** Advance a damped spring by `dt` seconds (semi-implicit Euler in ≤ 4 ms sub-steps). */
export function springStep(x: number, v: number, target: number, s: Spring, dt: number): [number, number] {
  const steps = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = (-s.stiffness * (x - target) - s.damping * v) / s.mass;
    v += a * h;
    x += v * h;
  }
  return [x, v];
}

/** Close enough to stop animating (half a pixel, and slower than 5 px/s). */
export const settled = (x: number, v: number, target: number): boolean => Math.abs(x - target) < 0.5 && Math.abs(v) < 5;

/**
 * A spring as a CSS easing: `linear()` points sampled from the same spring the sheet uses, so small
 * CSS transitions (the toggle thumb, a card rising) move with the same feel and need no JS per frame.
 */
export function springEasing(s: Spring, samples = 32): { easing: string; ms: number } {
  const dt = 1 / 240;
  const curve: number[] = [];
  let [x, v] = [0, 0];
  let t = 0;
  while (!settled(x * 1000, v * 1000, 1000) && t < 2) {
    curve.push(x);
    [x, v] = springStep(x, v, 1, s, dt);
    t += dt;
  }
  curve.push(1);
  const step = Math.max(1, Math.floor(curve.length / samples));
  const points = curve.filter((_, i) => i % step === 0 || i === curve.length - 1).map((p) => +p.toFixed(4));
  return { easing: `linear(${points.join(', ')})`, ms: Math.round(t * 1000) };
}
