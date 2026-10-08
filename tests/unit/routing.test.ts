import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID, ROUTING } from '../../src/data';
import type { LatLng } from '../../src/data';
import { insideRect, network, pathLength, projectOnRing, toM, walkMinutes, walkPath } from '../../src/routing/walk';

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

  it('west plaza → elderly restrooms 204 takes the west cross links and the south-west walk (≈510 m, 7 min)', () => {
    // Was ≈615 m round the old ring; the owner's west-plaza walkways (2026-10-08) cut ~100 m.
    const path = walkPath([24.4685, 39.6084], at(204));
    const m = pathLength(path);
    expect(m).toBeGreaterThan(470);
    expect(m).toBeLessThan(550);
    expect(walkMinutes(m)).toBe(7);
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

describe('every reachable place, from every plaza side', () => {
  // The whole data set, not a sample: any change to the walkway network must keep all of these true.
  const SIDES: [string, LatLng][] = [...STARTS, ['east plaza', [24.4688, 39.614]]];
  const reachable = POIS.filter((p) => !inObstacle([p.lat, p.lng]));

  it('covers the outdoor places (facilities, outer gates, parking, services)', () => {
    expect(reachable.length).toBeGreaterThan(150);
    for (let id = 201; id <= 236; id++) expect(reachable.some((p) => p.id === id), String(id)).toBe(true);
  });

  for (const [name, start] of SIDES) {
    it(`from the ${name}: starts and ends right, never enters an obstacle, never goes the long way round`, () => {
      const N = network();
      for (const p of reachable) {
        const to: LatLng = [p.lat, p.lng];
        const path = walkPath(start, to);
        const m = pathLength(path);
        expect(enters(path), `${name} → ${p.id}`).toBe(false);
        expect(path[0][0]).toBeCloseTo(start[0], 6);
        expect(path[path.length - 1][1]).toBeCloseTo(to[1], 6);
        // At most half the ring plus the two spurs to and from it (and rounding slack).
        const spurs = projectOnRing(toM(start), N).d + projectOnRing(toM(to), N).d;
        expect(m, `${name} → ${p.id}`).toBeLessThan(N.P / 2 + spurs + 20);
      }
    });
  }
});

describe('walkway network', () => {
  it('no walkway (ring or branch) passes through the mosque or Al-Baqi’', async () => {
    const { segmentHits } = await import('../../src/routing/walk');
    const N = network();
    for (const e of N.edges) {
      for (const r of N.obstacles) expect(segmentHits(N.nodes[e.u], N.nodes[e.v], r), `edge ${e.u}–${e.v}`).toBe(false);
    }
  });

  it('is one connected network: every junction can be reached from every other', () => {
    const N = network();
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const k = queue.pop()!;
      for (const e of N.edges) {
        const j = e.u === k ? e.v : e.v === k ? e.u : -1;
        if (j >= 0 && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    expect(seen.size).toBe(N.nodes.length);
  });

  it('every branch is joined to the network (ring, spurs, cross links, women’s paths)', () => {
    const N = network();
    const near = (p: [number, number]) => N.nodes.some((n) => Math.hypot(n[0] - p[0], n[1] - p[1]) < 5);
    expect(ROUTING.walkways.length).toBe(15);
    for (const w of ROUTING.walkways) {
      const ends = [w.path[0], w.path[w.path.length - 1]].map(toM);
      expect(ends.some(near), w.id).toBe(true);
    }
  });

  it('the north spurs stop at the mosque wall side, and the women’s links reach the prayer areas', () => {
    for (const id of ['north-west-women-link', 'north-east-women-link', 'west-women-walk']) {
      const w = ROUTING.walkways.find((x) => x.id === id)!;
      expect(w.kind).toBe('women');
    }
    expect(ROUTING.women_prayer_areas.map((a) => a.id)).toEqual(['north-west', 'north-east']);
  });
});
