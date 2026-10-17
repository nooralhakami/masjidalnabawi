import { describe, expect, it } from 'vitest';
import { FLICK_PX_S, SPRINGS, detentHeights, releaseDetent, settled, springStep, stepDetent } from '../../src/ui/sheet/physics';

// The bottom sheet (SPEC N4, DESIGN §4): slow drags land on the nearest detent ahead, fast flicks
// move one whole detent, and the spring settles without overshooting past reason.

const H = detentHeights(812);

describe('sheet detents', () => {
  it('peek 112 px, half 55% of the screen, full up to 12 px from the top', () => {
    expect(H).toEqual({ closed: 0, peek: 112, half: 447, full: 800 });
    expect(detentHeights(812, { extra: 120 }).half).toBe(567);
  });
  it('never taller than the screen allows', () => {
    const tiny = detentHeights(300, { extra: 400 });
    expect(tiny.half).toBe(tiny.full);
    expect(tiny.peek).toBeLessThanOrEqual(tiny.full);
  });
});

describe('releasing the sheet', () => {
  it('a slow drag stops at the nearest detent to where it is heading', () => {
    expect(releaseDetent('half', 470, 0, H)).toBe('half');
    expect(releaseDetent('half', 650, 0, H)).toBe('full');
    expect(releaseDetent('half', 250, 0, H)).toBe('peek');
    // Moving up at 900 px/s from 560: projected to 722, nearer full.
    expect(releaseDetent('half', 560, 900, H)).toBe('full');
  });
  it('a fast flick moves one detent from where the drag began, whatever the distance', () => {
    expect(releaseDetent('half', 455, FLICK_PX_S + 1, H)).toBe('full');
    expect(releaseDetent('half', 440, -(FLICK_PX_S + 1), H)).toBe('peek');
    expect(releaseDetent('full', 790, -3000, H)).toBe('half');
    expect(releaseDetent('full', 800, 3000, H)).toBe('full');
  });
  it('only to the detents this sheet offers (a route sheet cannot be dragged closed)', () => {
    expect(releaseDetent('peek', 20, -400, H, ['peek', 'half', 'full'])).toBe('peek');
    expect(releaseDetent('peek', 100, -2000, H, ['peek', 'half', 'full'])).toBe('peek');
    expect(releaseDetent('peek', 20, -400, H)).toBe('closed');
  });
  it('keyboard: ↑ and ↓ step through the detents', () => {
    expect(stepDetent('peek', 1)).toBe('half');
    expect(stepDetent('half', 1)).toBe('full');
    expect(stepDetent('full', 1)).toBe('full');
    expect(stepDetent('half', -1, ['peek', 'half', 'full'])).toBe('peek');
    expect(stepDetent('peek', -1, ['peek', 'half', 'full'])).toBe('peek');
  });
});

describe('the spring', () => {
  const run = (from: number, v: number, to: number) => {
    let [x, vel] = [from, v];
    let max = from;
    let frames = 0;
    while (!settled(x, vel, to) && frames < 600) {
      [x, vel] = springStep(x, vel, to, SPRINGS.sheet, 1 / 60);
      max = Math.max(max, x);
      frames++;
    }
    return { x, frames, overshoot: max - to };
  };
  it('settles on the target within half a second, from rest', () => {
    const r = run(112, 0, 447);
    expect(Math.abs(r.x - 447)).toBeLessThan(0.5);
    expect(r.frames).toBeLessThanOrEqual(36);
  });
  it('carries the finger’s speed: a flick overshoots a little and comes back, never wildly', () => {
    const r = run(447, 2500, 800);
    expect(r.overshoot).toBeGreaterThan(0);
    expect(r.overshoot).toBeLessThan(40);
    expect(Math.abs(r.x - 800)).toBeLessThan(0.5);
  });
  it('is frame-rate independent (30 or 120 fps end in the same place)', () => {
    const at = (fps: number) => {
      let s: [number, number] = [112, 0];
      for (let i = 0; i < fps * 0.2; i++) s = springStep(s[0], s[1], 447, SPRINGS.sheet, 1 / fps);
      return s[0];
    };
    expect(Math.abs(at(30) - at(120))).toBeLessThan(1);
  });
});

describe('the spring as a CSS easing', () => {
  it('starts at 0, ends at 1, and lasts as long as the spring takes to settle', async () => {
    const { springEasing } = await import('../../src/ui/sheet/physics');
    const e = springEasing(SPRINGS.toggle);
    const pts = e.easing.slice(7, -1).split(', ').map(Number);
    expect(pts[0]).toBe(0);
    expect(pts.at(-1)).toBe(1);
    expect(Math.max(...pts)).toBeLessThan(1.1);
    expect(e.ms).toBeGreaterThan(150);
    expect(e.ms).toBeLessThan(700);
  });
});
