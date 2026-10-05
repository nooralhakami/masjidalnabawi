import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import { insideRect, network, pathLength, toM, walkMinutes, walkPath } from '../../src/routing/walk';

const at = (id: number): LatLng => {
  const p = POI_BY_ID.get(id)!;
  return [p.lat, p.lng];
};

// Visitors standing in the south, west and north plazas.
const STARTS: [string, LatLng][] = [
  ['south plaza', [24.4664, 39.6110]],
  ['west plaza', [24.4685, 39.6084]],
  ['north plaza', [24.4704, 39.6105]],
];

// Varied destinations around the Haram: restrooms on every side, outer gates, parking, services.
const DESTS = [201, 204, 209, 215, 221, 229, 232, 236, 301, 321, 332, 344, 358, 905, 513];

const inObstacle = (ll: LatLng) => network().obstacles.some((r) => insideRect(toM(ll), r));

/** Every point and every ~1 m step of the path, outside all obstacles. */
function enters(path: LatLng[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [toM(path[i - 1]), toM(path[i])];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k <= n; k++) {
      const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (network().obstacles.some((r) => insideRect(p, r))) return true;
    }
  }
  return false;
}

describe('walking routes', () => {
  it('destinations and starts used in the tests are outside obstacles', () => {
    for (const [, s] of STARTS) expect(inObstacle(s)).toBe(false);
    for (const id of DESTS) expect(inObstacle(at(id)), String(id)).toBe(false);
  });

  for (const [name, start] of STARTS) {
    it(`from the ${name}: no route enters the mosque or Al-Baqi'`, () => {
      for (const id of DESTS) {
        const path = walkPath(start, at(id));
        expect(enters(path), `${name} → ${id}`).toBe(false);
        expect(path[0][0]).toBeCloseTo(start[0], 6);
        expect(path[path.length - 1][0]).toBeCloseTo(at(id)[0], 6);
      }
    });
  }

  it('short trips take a direct right-angle route', () => {
    const path = walkPath([24.4664, 39.6110], at(205));
    expect(pathLength(path)).toBeLessThan(150);
  });

  it('west plaza → elderly restrooms 204 goes round by the south (≈615 m, 8 min)', () => {
    const path = walkPath([24.4685, 39.6084], at(204));
    const m = pathLength(path);
    expect(m).toBeGreaterThan(560);
    expect(m).toBeLessThan(660);
    expect(walkMinutes(m)).toBe(8);
  });

  it('north ↔ south takes the shorter way round the ring', () => {
    const p = walkPath([24.4704, 39.6105], [24.4664, 39.6110]);
    // Either side is roughly half the ring; never the long way.
    expect(pathLength(p)).toBeLessThan(network().P / 2 + 120);
  });

  it('walking time is distance ÷ 80 m/min, at least 1', () => {
    expect(walkMinutes(10)).toBe(1);
    expect(walkMinutes(160)).toBe(2);
    expect(walkMinutes(161)).toBe(3);
  });
});

describe('walkway ring', () => {
  it('no ring segment passes through the mosque or Al-Baqi’', async () => {
    const { segmentHits } = await import('../../src/routing/walk');
    const N = network();
    for (const s of N.seg) {
      for (const r of N.obstacles) expect(segmentHits(s.a, s.b, r), `segment starting at ${s.a}`).toBe(false);
    }
  });
});
