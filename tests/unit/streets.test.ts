import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import streetsJson from '../../data/streets.json';
import { inHaram, planRoute } from '../../src/routing/plan';
import { loadStreets } from '../../src/routing/streets';
import { insideRect, network, pathLength, toM } from '../../src/routing/walk';

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
    expect(last[last.length - 1][0]).toBeCloseTo(P(223).lat, 6);
    expect(p.driveM).toBeGreaterThan(1000);
    expect(p.walkM).toBeLessThan(400);
    // The car-park stretch runs under the plazas, never under the mosque or Al-Baqi’, and follows
    // the ring round the Haram (one connected garage in that shape).
    expect(enters(p.legs[1].path)).toBe(false);
    const N = network();
    const offRing = (ll: LatLng) => {
      const q = toM(ll);
      return Math.min(
        ...N.seg.map((s) => {
          const dx = s.b[0] - s.a[0];
          const dy = s.b[1] - s.a[1];
          const u = Math.max(0, Math.min(1, ((q[0] - s.a[0]) * dx + (q[1] - s.a[1]) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(q[0] - s.a[0] - dx * u, q[1] - s.a[1] - dy * u);
        }),
      );
    };
    const aisle = p.legs[1].path.slice(2, -3); // between the ramp/lot links and the stairs up
    for (const pt of aisle) expect(offRing(pt)).toBeLessThan(7);
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
