import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import streetsJson from '../../data/streets.json';
import { fullPath, inHaram, planRoute, planRoutes } from '../../src/routing/plan';
import { initialBearing, shared, turnPenalty } from '../../src/routing/alternatives';
import { ENTRANCES, GARAGE } from '../../src/routing/garage';
import { Streets, loadStreets } from '../../src/routing/streets';
import { insideRect, network, pathLength, restroomDoor, toM } from '../../src/routing/walk';

const P = (id: number) => POI_BY_ID.get(id)!;
const at = (id: number): LatLng => [P(id).lat, P(id).lng];
const enters = (path: LatLng[]) => {
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [toM(path[i - 1]), toM(path[i])];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k <= n; k++) {
      const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (network().obstacles.some((r) => insideRect(p, r))) return true;
    }
  }
  return false;
};

// Real places round the Haram (OpenStreetMap extract 2026-10-08).
const WEST_STREET: LatLng = [24.4718, 39.6035]; // street north-west of the west plaza
const SOUTH_WEST: LatLng = [24.456, 39.6]; // Quba road side, ~1.5 km away
const NORTH_RING: LatLng = [24.476, 39.611]; // First Ring Road (King Faisal Road), north
const EAST_STREET: LatLng = [24.4686, 39.6165]; // east of Al-Baqi'

describe('street data (OpenStreetMap)', () => {
  it('is attributed, and has walkers’ and drivers’ streets and the car-park entrances', () => {
    expect(streetsJson.source).toMatch(/OpenStreetMap/);
    expect(streetsJson.nodes.length).toBeGreaterThan(5000);
    expect(streetsJson.parking_entrances).toHaveLength(8);
  });

  it('the main car network reaches the underground car-park ramps', async () => {
    const S = (await loadStreets())!;
    expect(S.garageNodes.length).toBeGreaterThan(20);
    const r = S.reach(NORTH_RING, 'drive')!;
    expect(S.garageNodes.filter((k) => Number.isFinite(r.dist[k])).length).toBeGreaterThan(20);
  });
});

describe('walking beyond the plazas', () => {
  it('knows the Haram from the streets', () => {
    expect(inHaram(at(215))).toBe(true);
    expect(inHaram(WEST_STREET)).toBe(false);
    expect(inHaram(SOUTH_WEST)).toBe(false);
    expect(inHaram(at(253))).toBe(true); // the open west plaza belongs to the Haram
  });

  for (const [name, from, to] of [
    ['west street → 215', WEST_STREET, 215],
    ['east of Al-Baqi’ → 233', EAST_STREET, 233],
  ] as [string, LatLng, number][]) {
    it(`${name}: on streets, then through a gate and the plaza; never through the mosque or Al-Baqi’`, async () => {
      const p = await planRoute(from, P(to), 'walk');
      expect(p.mode).toBe('walk');
      const path = p.legs[0].path;
      expect(path[0]).toEqual(from);
      expect(path[path.length - 1][0]).toBeCloseTo(P(to).lat, 6);
      expect(enters(path)).toBe(false);
      // Realistic: at most ~1.6× the straight-line distance.
      const straight = pathLength([from, at(to)]);
      expect(p.walkM).toBeLessThan(straight * 1.6 + 100);
    });
  }

  // Not every trip needs to pass through the Haram (owner, 2026-10-08): a garden on its edge, a hotel
  // behind it. The walk takes the shortest sensible way — streets, a gate, or a short cut across.
  for (const [name, from, to] of [
    ['south-west → Saqifa Bani Sa’ida (515) by the streets, not round through gate 316', [24.4606, 39.6012], 515],
    ['east of Al-Baqi’ → a hotel south of the Haram (713, ZamZam Pullman)', EAST_STREET, 713],
    ['west street → a hotel north of the Haram (706)', WEST_STREET, 706],
  ] as [string, LatLng, number][]) {
    it(name, async () => {
      const p = await planRoute(from, P(to), 'walk');
      const path = p.legs[0].path;
      expect(enters(path)).toBe(false);
      // Streets are preferred to passages through hotel blocks, so a little over the shortest.
      expect(p.walkM / pathLength([from, at(to)])).toBeLessThan(1.55);
    });
  }

  it('a short cut through the Haram is taken when it is shorter (west street → east of Al-Baqi’)', async () => {
    const from: LatLng = [24.4686, 39.6045];
    const east = { ...P(705), lat: EAST_STREET[0], lng: EAST_STREET[1], category: 'hotels' as const };
    const p = await planRoute(from, east, 'walk');
    const path = p.legs[0].path;
    expect(path.filter((q) => inHaram(q)).length).toBeGreaterThan(path.length / 2);
    expect(p.walkM / pathLength([from, EAST_STREET])).toBeLessThan(1.35); // round Al-Baqi’, not through it
    expect(enters(path)).toBe(false);
  });

  it('to Arabesque restaurant north of the Haram (809): out by a north gate near it, then up the streets', async () => {
    const p = await planRoute([24.4606, 39.6012], P(809), 'walk');
    const path = p.legs[0].path;
    const exit = path.findIndex((q, i) => i > 0 && inHaram(path[i - 1]) && !inHaram(q));
    expect(exit).toBeGreaterThan(0);
    const [x, y] = toM(path[exit]);
    const [dx] = toM(at(809));
    expect(y).toBeGreaterThan(380); // the north side
    expect(Math.abs(x - dx)).toBeLessThan(200); // a gate near the restaurant, not one far along
    expect(enters(path)).toBe(false);
  });

  it('the west plaza is open ground: across it, the walk is straight', async () => {
    const from: LatLng = [24.469, 39.606]; // in the middle of the west plaza
    const p = await planRoute(from, P(253), 'walk');
    expect(p.walkM).toBeLessThan(pathLength([from, at(253)]) + 1);
  });
});

describe('driving to the car park under the Haram', () => {
  it('drives on the streets to a ramp, along the car park to a public lot, then walks up to the place', async () => {
    const p = await planRoute(SOUTH_WEST, P(223), 'drive');
    expect(p.mode).toBe('drive');
    expect(p.legs.map((l) => l.kind)).toEqual(['drive', 'garage', 'walk']);
    expect(p.legs[0].path[0]).toEqual(SOUTH_WEST);
    expect(p.lot?.access).toBe('public');
    const last = p.legs[2].path;
    // It ends at the restroom's door, not at the middle of the building (owner, 2026-10-14).
    expect(last[last.length - 1]).toEqual(restroomDoor(P(223)));
    expect(p.driveM).toBeGreaterThan(1000);
    expect(p.walkM).toBeLessThan(400);
    // The car-park stretch starts at one of the two entrances and follows the roads the owner
    // drew (data/garage.json), on their centre line (every road is one-way), until it turns into the lot.
    expect(['quba', 'sultana']).toContain(p.entrance);
    const roads = GARAGE.lanes.filter((l) => l.kind === 'entry' || l.kind === 'shared').map((l) => l.path.map(toM));
    const offRoad = (ll: LatLng) => {
      const q = toM(ll);
      return Math.min(
        ...roads.flatMap((pts) =>
          pts.slice(1).map((b, i) => {
            const a = pts[i];
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(q[0] - a[0] - dx * u, q[1] - a[1] - dy * u);
          }),
        ),
      );
    };
    const onRoads = p.legs[1].path.slice(1, -1); // between the ramp and the turn into the lot's entrance
    expect(onRoads.length).toBeGreaterThan(3);
    for (const pt of onRoads) expect(offRoad(pt)).toBeLessThan(1);
  });

  it('never parks in a subscribers-only lot unless that lot is the destination', async () => {
    for (const to of [204, 213, 223, 233]) {
      const p = await planRoute(NORTH_RING, P(to), 'drive');
      expect(p.lot?.access, String(to)).toBe('public');
    }
    expect((await planRoute(NORTH_RING, P(906), 'drive')).lot?.id).toBe(906);
  });

  it('every lot 1–13 can be reached by car', async () => {
    for (let id = 901; id <= 913; id++) {
      const p = await planRoute(NORTH_RING, P(id), 'drive');
      expect(p.mode, `P${id - 900}`).toBe('drive');
      expect(p.lot?.id).toBe(id);
    }
  });
});

describe('driving to a hotel outside the Haram', () => {
  it('drives to the street at its door and walks the last steps — no car park under the Haram', async () => {
    const p = await planRoute(SOUTH_WEST, P(705), 'drive'); // a hotel north of the Haram
    expect(p.mode).toBe('drive');
    expect(p.lot).toBeUndefined();
    expect(p.legs[0].kind).toBe('drive');
    expect(p.walkM).toBeLessThan(150);
    const last = p.legs[p.legs.length - 1].path;
    expect(last[last.length - 1][0]).toBeCloseTo(P(705).lat, 6);
  });
});

describe('to the historic sites round Madinah', () => {
  const SOUTH_PLAZA: LatLng = [24.4664, 39.611];

  it('walks to Quba Mosque the short way, into Quba along Quba Avenue, not round by the roads', async () => {
    const p = await planRoute(SOUTH_PLAZA, P(542), 'walk');
    // The avenue makes it barely longer than the straight line (~3.4 km); round the roads it was ~4.3 km.
    expect(p.walkM / pathLength([SOUTH_PLAZA, at(542)])).toBeLessThan(1.2);
    // and takes the avenue's southern stretch into Quba (24.446, 39.6142)
    const onAvenue = p.legs[0].path.some((q) => Math.hypot((q[0] - 24.446) * 111_320, (q[1] - 39.6142) * 101_330) < 40);
    expect(onAvenue).toBe(true);
  });

  for (const id of [543, 544, 547, 548, 549]) {
    it(`walk and drive to ${id} follow the streets (realistic length, no obstacle)`, async () => {
      for (const mode of ['walk', 'drive'] as const) {
        const p = await planRoute(SOUTH_PLAZA, P(id), mode);
        expect(p.mode).toBe(mode);
        const all = p.legs.flatMap((l) => l.path);
        expect(enters(all), `${id} ${mode}`).toBe(false);
        expect((p.walkM + p.driveM) / pathLength([SOUTH_PLAZA, at(id)]), `${id} ${mode}`).toBeLessThan(mode === 'walk' ? 1.5 : 2.2);
      }
    });
  }
});

/**
 * Whether a path goes through an obstacle: inside one, only the stretch to its own inner gate is
 * allowed (as deep as that gate lies inside the rectangle, plus 40 m).
 */
const acrossTheMosque = (path: LatLng[]) => {
  const end = toM(path[path.length - 1]);
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [toM(path[i - 1]), toM(path[i])];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k <= n; k++) {
      const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      for (const r of network().obstacles) {
        if (!insideRect(p, r)) continue;
        if (!insideRect(end, r)) return true;
        const depth = Math.min(end[0] - r.x0, r.x1 - end[0], end[1] - r.y0, r.y1 - end[1]);
        if (Math.hypot(p[0] - end[0], p[1] - end[1]) > depth + 40) return true;
      }
    }
  }
  return false;
};

describe('the best route and its alternatives (owner, 2026-10-11)', () => {
  const trips: [string, LatLng, number, 'walk' | 'drive'][] = [
    ['hotel south-west of the Haram → Gate 37', [24.4655, 39.6085], 37, 'walk'],
    ['east street → a west restroom', [24.4685, 39.615], 233, 'walk'],
    ['far south-west, by car → Gate 21', SOUTH_WEST, 21, 'drive'],
  ];
  it.each(trips)('%s: the best first, up to two others within 30% and really another way', async (_, from, to, mode) => {
    const plans = await planRoutes(from, P(to), mode);
    expect(plans.length).toBeGreaterThan(1);
    expect(plans.length).toBeLessThanOrEqual(3);
    expect(plans[0]).toEqual(await planRoute(from, P(to), mode));
    const cost = (p: (typeof plans)[number]) => (mode === 'drive' ? p.driveM / 300 + p.walkM / 80 : pathLength(fullPath(p)));
    for (const p of plans.slice(1)) {
      expect(cost(p)).toBeLessThanOrEqual(cost(plans[0]) * 1.3 + 1e-6);
      expect(acrossTheMosque(fullPath(p))).toBe(false); // never through the mosque or Al-Baqi'
    }
    // By car, plans are compared on what follows the streets (every car comes in by one of two entrances).
    const way = (p: (typeof plans)[number]) => (mode === 'drive' ? p.legs.slice(1).flatMap((l) => l.path) : fullPath(p));
    for (let i = 1; i < plans.length; i++) for (let j = 0; j < i; j++) expect(shared(way(plans[i]), way(plans[j]))).toBeLessThanOrEqual(0.7);
  });

  it('on a re-route, a route carrying on ahead is preferred to a U-turn of similar length', async () => {
    const from: LatLng = [24.4655, 39.6085];
    const plans = await planRoutes(from, P(37), 'walk');
    const second = plans[1];
    const heading = initialBearing(fullPath(second))!; // walking the way the second route starts
    const again = await planRoutes(from, P(37), 'walk', { heading });
    expect(turnPenalty(fullPath(again[0]), heading)).toBe(0);
  });
});

describe('no route through the mosque building (found while adding alternatives, 2026-10-11)', () => {
  // Before, a trip to an inner gate exempted the whole building from the obstacle check, and routes
  // from the north ring road to gates 5, 38 and 39 cut ~230 m through it. The mosque rectangle is
  // ~400 × 280 m, so a route crossing it passes points well over 200 m from its gate.
  const deepest = (path: LatLng[]) => {
    const end = toM(path[path.length - 1]);
    let m = 0;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [toM(path[i - 1]), toM(path[i])];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let k = 0; k <= n; k++) {
        const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (network().obstacles.some((r) => insideRect(p, r))) m = Math.max(m, Math.hypot(p[0] - end[0], p[1] - end[1]));
      }
    }
    return m;
  };
  it('from three sides of the Haram to every inner gate, no offered route crosses the building', async () => {
    const gates = [1, 5, 13, 21, 25, 29, 34, 37, 38, 39, 41, 42];
    for (const from of [NORTH_RING, EAST_STREET, WEST_STREET]) {
      for (const id of gates) {
        for (const p of await planRoutes(from, P(id), 'walk')) expect(deepest(fullPath(p)), `${from} → ${id}`).toBeLessThan(200);
      }
    }
  });
});

describe('routes pass beside restroom buildings, never over them (owner, 2026-10-11)', () => {
  const origins: LatLng[] = [[24.4668, 39.6111], [24.4718, 39.6035], [24.476, 39.611], [24.4686, 39.6165], [24.4655, 39.6085], [24.4685, 39.607]];
  it('no offered route crosses a restroom building, except one holding its own start or end', async () => {
    const dests = Object.values(Object.fromEntries([...POI_BY_ID].map(([id, p]) => [id, p]))).filter(
      (p) => p.subCategory === 'gate_inner' || p.subCategory === 'gate_outer' || p.category === 'toilets' || p.category === 'women' || p.category === 'emergency' || p.category === 'parking',
    );
    const buildings = network().buildings;
    const bad: string[] = [];
    let routes = 0;
    for (const from of origins) {
      for (const to of dests) {
        for (const plan of await planRoutes(from, to, 'walk')) {
          routes++;
          const path = fullPath(plan).map(toM);
          const ends = [path[0], path[path.length - 1]];
          for (const r of buildings) {
            if (ends.some((e) => insideRect(e, r))) continue;
            for (let i = 1; i < path.length; i++) {
              const [a, b] = [path[i - 1], path[i]];
              const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
              // Rounded corners may graze a wall by well under a metre; the middle of the building is never crossed.
              const inner = { x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 1, y1: r.y1 - 1 };
              for (let k = 0; k <= n; k++) {
                const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
                if (insideRect(p, inner)) bad.push(`${from} → ${to.id}`);
              }
            }
          }
        }
      }
    }
    expect(routes).toBeGreaterThan(500);
    expect([...new Set(bad)].slice(0, 8)).toEqual([]);
  }, 180_000);
});

describe('driving on public roads only, by the rules (owner, 2026-10-13)', () => {
  // A small made-up network, 100 m blocks, to check each rule on its own.
  const ll = (x: number, y: number): LatLng => [24.4673 + y / 111_320, 39.6111 + x / (111_320 * Math.cos((24.4673 * Math.PI) / 180))];
  const net = (ways: number[][], nodes: [number, number][], restrictions: number[][] = []) =>
    new Streets({ nodes: nodes.map(([x, y]) => ll(x, y)), ways, parking_entrances: [], restrictions });
  const RES = 1 | (5 << 6); // a car way, residential
  const PRI = 1 | (1 << 6); // a car way, primary
  const nodeAt = (S: Streets, x: number, y: number) => S.nearestNode(toM(ll(x, y)), 'drive');
  const pathOf = (S: Streets, from: [number, number], to: [number, number]) => {
    const r = S.reach(ll(...from), 'drive')!;
    return S.nodesTo(r, nodeAt(S, ...to));
  };

  it('never turns back on itself (no U-turn) except where the road ends', () => {
    // A two-way street 0—1—2 with a side street 1—3; starting just east of 1 heading… either way is fine,
    // but a route from the middle of 0–1 to 0 must not go to 1 and come back.
    const S = net([[RES, 0, 0, 1, 2], [RES, 0, 1, 3]], [[0, 0], [100, 0], [200, 0], [100, 100]]);
    const r = S.reach(ll(60, 0), 'drive')!;
    const p = S.nodesTo(r, nodeAt(S, 0, 0));
    expect(p).toEqual([0]); // straight on to 0 — not via 1 and back
  });

  it('obeys "no turn" and "only this turn" restrictions from OpenStreetMap', () => {
    // A cross at node 1: west arm 0, east arm 2, north arm 3, south arm 4, and a road 3—5—2 round the
    // north-east block; the car starts on the west arm heading east.
    const nodes: [number, number][] = [[0, 0], [100, 0], [200, 0], [100, 100], [100, -100], [200, 100]];
    const ways = [[RES, 0, 0, 1], [RES, 0, 1, 2], [RES, 0, 1, 3], [RES, 0, 1, 4], [RES, 0, 3, 5], [RES, 0, 5, 2]];
    // Without a restriction, west → north turns left at 1.
    expect(pathOf(net(ways, nodes), [20, 0], [100, 100])).toEqual([1, 3]);
    // "No left turn" 0→1→3: it must go another way round (on to 2, then up and back west).
    const noLeft = pathOf(net(ways, nodes, [[0, 1, 3, 0]]), [20, 0], [100, 100]);
    expect(noLeft.slice(0, 2)).not.toEqual([1, 3]);
    expect(noLeft).toContain(2);
    // "Only straight on" 0→1→2: neither north nor south at 1.
    const only = pathOf(net(ways, nodes, [[0, 1, 2, 1]]), [20, 0], [100, -100]);
    expect(only[1]).toBe(2);
  });

  it('prefers a main road to a slightly shorter way through a neighbourhood', () => {
    // From 0 to 3: through the neighbourhood 0—1—3 (≈ 283 m) or on the main road 0—2—3 (300 m).
    const nodes: [number, number][] = [[0, 0], [100, 100], [150, -10], [200, 0]];
    const S = net([[RES, 0, 0, 1, 3], [PRI, 0, 0, 2, 3]], nodes);
    expect(pathOf(S, [1, 0], [200, 0])).toContain(2);
  });

  it('uses no unnamed surface service road (a car-park aisle, a hotel driveway) except the way into the Haram car park', () => {
    const data = streetsJson as unknown as { nodes: LatLng[]; ways: number[][]; parking_entrances: LatLng[] };
    const m = (p: LatLng) => toM(p);
    for (const [mode, , ...ids] of data.ways) {
      if (!(mode & 1) || ((mode >> 6) & 7) !== 6 || mode & 4 || mode & 32) continue;
      const near = ids.some((i) => data.parking_entrances.some((e) => Math.hypot(m(data.nodes[i])[0] - m(e)[0], m(data.nodes[i])[1] - m(e)[1]) < 300));
      expect(near).toBe(true);
    }
  });

  it('reaches the Quba car-park entrance from every side, on public roads', async () => {
    const S = (await loadStreets())!;
    const quba = ENTRANCES.find((e) => e.id === 'quba')!;
    const k = S.nearestNode(toM(quba.street), 'drive');
    expect(Math.hypot(S.xy[k][0] - toM(quba.street)[0], S.xy[k][1] - toM(quba.street)[1])).toBeLessThan(1);
    for (const from of [[24.4393, 39.6173], [24.456, 39.6], [24.476, 39.611], [24.4686, 39.6165], [24.4846, 39.5791]] as LatLng[]) {
      expect(Number.isFinite(S.reach(from, 'drive')!.dist[k]), String(from)).toBe(true);
    }
  });

  it('no car route to a historic site turns back on itself', async () => {
    for (const id of [542, 543, 544, 547, 548]) {
      const p = await planRoute([24.4668, 39.6111], P(id), 'drive');
      const d = p.legs[0].path.map((q) => q.join(','));
      for (let i = 2; i < d.length; i++) expect(d[i] === d[i - 2] && d[i - 1] !== d[i], `${id} at ${d[i - 1]}`).toBe(false);
    }
  });

  it('drives to the public car park by a historic site when there is one within 300 m', async () => {
    for (const id of [542, 543, 548]) {
      const p = await planRoute([24.4668, 39.6111], P(id), 'drive');
      expect(p.carPark, `${id}`).toBe(true);
      expect(p.walkM).toBeLessThan(400);
    }
  });
});
