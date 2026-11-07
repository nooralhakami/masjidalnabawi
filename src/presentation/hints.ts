/**
 * First-visit hints (UI plan phase 5, owner 2026-11-07): no welcome screens. Three small bubbles,
 * each beside the real thing it is about, one after another, on the first visit only: «search
 * here», «the categories», «tap any marker». Any touch moves to the next; after the third they never
 * come back on this device.
 */
export const HINTS = ['search', 'filters', 'marker'] as const;
export type HintId = (typeof HINTS)[number];

/** The bubble is on screen for at most this long if the visitor does not touch anything. */
export const HINT_MS = 6000;
/** Wait this long after the map is ready, so the first bubble does not come with the page's own movement. */
export const HINT_DELAY_MS = 700;
/** The bubble's arrow is this far from the bubble's corners, at least. */
const ARROW_EDGE = 20;

/** The next hint after this one, or null when they are done. */
export function nextHint(h: HintId): HintId | null {
  const i = HINTS.indexOf(h);
  return i >= 0 && i < HINTS.length - 1 ? HINTS[i + 1] : null;
}

/**
 * Only on a plain first visit: not after a shared link opens a place, a story or the library, and
 * not when the visitor has seen them before.
 */
export function showHints(o: { seen: boolean; deepLink: boolean }): boolean {
  return !o.seen && !o.deepLink;
}

export interface HintBox {
  /** Bubble's left edge and top edge (px, in the page). */
  left: number;
  top: number;
  /** Where the arrow points from, across the bubble (px from its left edge). */
  arrowX: number;
  /** The bubble is under its target (the arrow on top), or over it (the arrow below). */
  side: 'below' | 'above';
}

/**
 * Where the bubble goes: centred on the point it is about, kept inside the screen's gutters, with
 * its arrow still pointing at the point.
 */
export function placeHint(at: { x: number; y: number }, side: 'below' | 'above', bubble: { w: number; h: number }, vw: number, gutter = 16, gap = 10): HintBox {
  const w = Math.min(bubble.w, vw - 2 * gutter);
  const left = Math.round(Math.min(Math.max(at.x - w / 2, gutter), vw - gutter - w));
  const arrowX = Math.round(Math.min(Math.max(at.x - left, ARROW_EDGE), w - ARROW_EDGE));
  const top = Math.round(side === 'below' ? at.y + gap : at.y - gap - bubble.h);
  return { left, top, arrowX, side };
}
