import { describe, expect, it } from 'vitest';
import { HINTS, nextHint, placeHint, showHints } from '../../src/presentation/hints';

describe('first-visit hints (UI plan phase 5)', () => {
  it('three, in order: search, categories, any marker; then none', () => {
    expect(HINTS).toEqual(['search', 'filters', 'marker']);
    expect(nextHint('search')).toBe('filters');
    expect(nextHint('filters')).toBe('marker');
    expect(nextHint('marker')).toBeNull();
  });

  it('only on a plain first visit: not once seen, not when a shared link opens something', () => {
    expect(showHints({ seen: false, deepLink: false })).toBe(true);
    expect(showHints({ seen: true, deepLink: false })).toBe(false);
    expect(showHints({ seen: false, deepLink: true })).toBe(false);
  });

  it('the bubble is centred on its point, under it or over it', () => {
    const b = placeHint({ x: 187, y: 100 }, 'below', { w: 200, h: 40 }, 375);
    expect(b).toEqual({ left: 87, top: 110, arrowX: 100, side: 'below' });
    expect(placeHint({ x: 187, y: 300 }, 'above', { w: 200, h: 40 }, 375, 16, 16).top).toBe(244);
  });

  it('kept inside the 16 px gutters on a 320 screen, the arrow still at its point', () => {
    const right = placeHint({ x: 280, y: 50 }, 'below', { w: 200, h: 40 }, 320);
    expect(right.left).toBe(320 - 16 - 200);
    expect(right.left + right.arrowX).toBe(280);
    const left = placeHint({ x: 10, y: 50 }, 'below', { w: 200, h: 40 }, 320);
    expect(left.left).toBe(16);
    // The arrow never leaves the bubble's rounded corner.
    expect(left.arrowX).toBe(20);
  });

  it('a bubble wider than the screen is cut to it', () => {
    const b = placeHint({ x: 160, y: 50 }, 'below', { w: 400, h: 40 }, 320);
    expect(b.left).toBe(16);
  });
});
