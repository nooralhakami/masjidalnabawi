import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID, ROUTING } from '../../src/data';
import { inHaram } from '../../src/routing/plan';
import type { LatLng } from '../../src/data';
import { aroundBuildings, insideRect, network, restroomDoor, pathLength, projectOnRing, segmentHits, toM, walkMinutes, walkPath, walkPaths } from '../../src/routing/walk';
import { MAX_ROUTES, pickRoutes, shared, turnPenalty } from '../../src/routing/alternatives';

const at = (id: number): LatLng => {
  const p = POI_BY_ID.get(id)!;
  return [p.lat, p.lng];
};

// Visitors standing in the south, west and north plazas.
const STARTS: [string, LatLng][] = [
  ['south plaza', [24.4664, 39.611]],
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
    const path = walkPath([24.4664, 39.611], at(205));
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
    const p = walkPath([24.4704, 39.6105], [24.4664, 39.611]);
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
  // Places in the Haram (plaza walkways); places outside it are reached through the streets (streets.test.ts).
  const reachable = POIS.filter((p) => !inObstacle([p.lat, p.lng]) && inHaram([p.lat, p.lng]));

  it('covers the outdoor places (facilities, outer gates, parking, services)', () => {
    expect(reachable.length).toBeGreaterThan(140);
    for (let id = 201; id <= 236; id++)
      expect(
        reachable.some((p) => p.id === id),
        String(id),
      ).toBe(true);
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
    expect(ROUTING.walkways.length).toBe(16);
    for (const w of ROUTING.walkways) {
      const ends = [w.path[0], w.path[w.path.length - 1]].map(toM);
      expect(ends.some(near), w.id).toBe(true);
    }
  });

  it('the south plaza has a walkway along the facilities 201–209, whose doors face the Haram (owner, 2026-10-15)', () => {
    // Before, the walk to such a door left the walkways 90 m away in one straight line.
    for (const id of [201, 203, 205, 207]) {
      const door = restroomDoor(POI_BY_ID.get(id)!)!;
      const path = walkPath([24.4655, 39.6085], door).map(toM);
      const last = Math.hypot(path[path.length - 1][0] - path[path.length - 2][0], path[path.length - 1][1] - path[path.length - 2][1]);
      expect(last, `${id}`).toBeLessThan(30);
      expect(
        path.some(([, y]) => Math.abs(y + 25) < 1),
        `${id} along the south plaza`,
      ).toBe(true);
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

describe('alternative routes (owner, 2026-10-11)', () => {
  // A straight 100 m walk east, and paths around it.
  const A: LatLng = [24.4685, 39.6084];
  const east = (m: number, n = 0): LatLng => [A[0] + n / 111_320, A[1] + m / (111_320 * Math.cos((A[0] * Math.PI) / 180))];
  const straight = [A, east(100)];
  const viaNorth = [A, east(0, 30), east(100, 30), east(100)]; // 160 m: 60% longer
  const shortHook = [A, east(0, 12), east(100, 12), east(100)]; // 124 m, 12 m to the side
  const nearlySame = [A, east(50, 4), east(100)]; // 100.3 m, runs along the straight line

  it('measures how much of a route runs along another', () => {
    expect(shared(straight, straight)).toBe(1);
    expect(shared(nearlySame, straight)).toBe(1);
    expect(shared(viaNorth, straight)).toBeLessThan(0.3);
  });

  it('keeps the shortest first, drops routes more than 30% longer and routes that are mostly the same', () => {
    const picked = pickRoutes([straight, viaNorth, nearlySame, shortHook].map((path, i) => ({ path, item: i })));
    expect(picked[0]).toBe(0); // the straight walk
    expect(picked).not.toContain(1); // 60% longer
    expect(picked).not.toContain(2); // the same way
    expect(picked).toContain(3); // 24% longer and another way
  });

  it('offers at most three routes', () => {
    const fan = [0, 6, 7, 8, 9].map((n) => [A, east(0, n * 2.5), east(100, n * 2.5), east(100)]);
    const many = fan.map((path, i) => ({ path, item: i }));
    expect(pickRoutes(many).length).toBeLessThanOrEqual(MAX_ROUTES);
  });

  it('charges a route that starts by turning the visitor round (on a re-route)', () => {
    expect(turnPenalty(straight, 90)).toBe(0); // heading east, route goes east
    expect(turnPenalty(straight, 270)).toBeGreaterThan(0); // heading west: a U-turn
    expect(turnPenalty(straight, null)).toBe(0);
  });

  it('on the plazas, the walkways give another way round the mosque when there is one', () => {
    const paths = walkPaths(at(1), at(25)); // gate 1 (south-west) to gate 25 (north)
    expect(paths.length).toBeGreaterThan(1);
    expect(pathLength(paths[0])).toBeLessThanOrEqual(Math.min(...paths.map(pathLength)) + 1);
  });
});

describe('restrooms are buildings: routes pass beside them, never over them (owner, 2026-10-11)', () => {
  const box = { x0: -6, x1: 6, y0: -6, y1: 6 };
  const through = (line: [number, number][]) => line.some((p, i) => i > 0 && segmentHits(line[i - 1], p, box));
  it('a walkway through a building is bent round it, by the shorter side', () => {
    const bent = aroundBuildings(
      [
        [-30, 1],
        [30, 1],
      ],
      [box],
    );
    expect(through(bent)).toBe(false);
    expect(bent[0]).toEqual([-30, 1]);
    expect(bent[bent.length - 1]).toEqual([30, 1]);
    // y = 1 is nearer the north wall: it goes round the north side (y > 6), not the south one.
    expect(Math.max(...bent.map((p) => p[1]))).toBeGreaterThan(6);
    expect(Math.min(...bent.map((p) => p[1]))).toBeGreaterThanOrEqual(0.99);
  });
  it('a corner vertex inside the building is bent round too', () => {
    const bent = aroundBuildings(
      [
        [-30, -20],
        [0, 0],
        [30, 20],
      ],
      [box],
    );
    expect(through(bent)).toBe(false);
  });
  it('a spur that ends inside the building (the way to a restroom) is left as drawn', () => {
    const line: [number, number][] = [
      [-30, 0],
      [0, 0],
    ];
    expect(aroundBuildings(line, [box])).toEqual(line);
  });
  it('a line that does not touch the building is unchanged', () => {
    const line: [number, number][] = [
      [-30, 20],
      [30, 20],
    ];
    expect(aroundBuildings(line, [box])).toEqual(line);
  });
  it('the network knows every restroom as a 12 m square building', () => {
    const N = network();
    expect(N.buildings.length).toBe(POIS.filter((p) => p.category === 'toilets').length);
    for (const r of N.buildings) {
      expect(r.x1 - r.x0).toBeCloseTo(12, 6);
      expect(r.y1 - r.y0).toBeCloseTo(12, 6);
    }
  });
  it('no walkway of the network runs through a restroom building', () => {
    const N = network();
    for (const e of N.edges) {
      for (const r of N.buildings) {
        const [a, b] = [N.nodes[e.u], N.nodes[e.v]];
        const n = Math.max(1, Math.ceil(e.l));
        for (let k = 1; k < n; k++) {
          const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          // Inside the building only where the edge is a spur that ends in it (one end inside).
          if (insideRect(p, r) && !insideRect(a, r) && !insideRect(b, r)) throw new Error(`walkway through a restroom at ${p}`);
        }
      }
    }
  });
});

describe('the east side through the narrow neck (owner, 2026-10-25)', () => {
  it('the walkway there is in straight lines inside the plaza: north on the gates line, east at gate 351’s latitude, then north', () => {
    const ring = ROUTING.walkway_ring.map(toM);
    const neck = ring.filter(([x, y]) => x > 200 && y > -60 && y < 120);
    // The two stretches after the north-east leg run along one axis each (no steps, no diagonal).
    const from = ring.findIndex(([x, y]) => Math.abs(x - 292) < 1 && Math.abs(y - 111) < 1);
    expect(from).toBeGreaterThan(0);
    for (let i = from; i < from + 2; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      expect(Math.min(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])), `${a} → ${b}`).toBeLessThan(0.5);
    }
    // None of it on the stepped wall or the diagonal of gates 355–352 (outside the plaza): the farthest north-west of the wall is x = 226 at y = 24-66.
    expect(neck.some(([x, y]) => x > 226.5 && y < 100 && x < 291)).toBe(false);
  });

  it('the north line runs inside the gates 364–355, never outside them (owner: «the route must be inside the gates»)', () => {
    const ring = ROUTING.walkway_ring.map(toM);
    const gates = [364, 362, 361, 360, 359, 358, 357, 355].map((id) => toM(at(id)));
    const side = ring.filter(([x, y]) => x > 200 && x < 240 && y > -55 && y < 115);
    expect(side.length).toBeGreaterThan(0);
    for (const [x] of side) expect(x, 'west of every gate on that side').toBeLessThan(Math.min(...gates.map((g) => g[0])) - 3);
    // And off the mosque's wall (the building is an obstacle; its east wall is at x ≈ 204 m).
    for (const [x] of side) expect(x).toBeGreaterThan(206);
  });

  it('a walk from the north-east to gate 364 goes by the new corners, not by the stepped wall', () => {
    const path = walkPath(at(349), at(364)).map(toM);
    const near = (x: number, y: number) => path.some(([px, py]) => Math.hypot(px - x, py - y) < 8);
    expect(near(292, 111)).toBe(true);
    expect(near(210, 111)).toBe(true);
    // Never within the stepped wall's strip: x between 226 and 292 while y is between 20 and 100.
    expect(path.some(([x, y]) => x > 229 && x < 291 && y > 20 && y < 100)).toBe(false);
  });
});
