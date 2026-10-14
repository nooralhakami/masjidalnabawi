import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import { parkingAccess, parkingEntrances } from '../../src/domain/parking';
import { ENTRANCES, EXITS, GARAGE, LEVELS, garageExit, garageRoute, garageRouteFrom, inGarage, lotRect, type GarageRoute } from '../../src/routing/garage';
import { planExit, planRoute, planRoutes } from '../../src/routing/plan';
import { fromM, insideRect, network, pathLength, toM, walkPath } from '../../src/routing/walk';

const P = (id: number) => POI_BY_ID.get(id)!;
const LOTS = Array.from({ length: 13 }, (_, i) => P(901 + i));
const at = (p: { lat: number; lng: number }): LatLng => [p.lat, p.lng];
const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('the car park roads from the owner’s drawing (2026-10-13)', () => {
  it('has the two entrances, the two exits and all 13 lots', () => {
    expect(ENTRANCES.map((e) => e.id).sort()).toEqual(['quba', 'sultana']);
    expect(GARAGE.exits.map((e) => e.id).sort()).toEqual(['quba', 'sultana']);
    expect(GARAGE.lots.map((l) => l.id).sort()).toEqual(LOTS.map((l) => l.id));
    // The entrances are the car park entrances mapped in OpenStreetMap on the Quba and Sultana sides.
    expect(ENTRANCES.find((e) => e.id === 'quba')!.street[0]).toBeLessThan(24.4665); // south-west
    expect(ENTRANCES.find((e) => e.id === 'sultana')!.street[0]).toBeGreaterThan(24.4705); // north-west
  });

  it('every lot can be reached from both entrances', () => {
    for (const lot of LOTS) for (const e of ENTRANCES) expect(garageRoute(e.id, lot), `${e.id} → P${lot.id - 900}`).not.toBeNull();
  });

  /** Every way in and out: each lot, each level, each entrance and exit. */
  const allWays = (): [string, GarageRoute][] =>
    LOTS.flatMap((lot) =>
      LEVELS.flatMap((level) => [
        ...ENTRANCES.map((e) => [`in ${e.id} → P${lot.id - 900}${level}`, garageRoute(e.id, lot, level)!] as [string, GarageRoute]),
        ...EXITS.map((x) => [`out P${lot.id - 900}${level} → ${x.id}`, garageExit(lot, x.id, level)!] as [string, GarageRoute]),
      ]),
    );

  it('never runs under the mosque or Al-Baqi’', () => {
    const N = network();
    for (const [name, way] of allWays()) {
      const path = way.path.map(toM);
      for (let i = 1; i < path.length; i++) {
        const n = Math.max(1, Math.ceil(d(path[i - 1], path[i])));
        for (let k = 0; k <= n; k++) {
          const p: [number, number] = [path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / n, path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / n];
          expect(N.obstacles.some((r) => insideRect(p, r)), name).toBe(false);
        }
      }
    }
  });

  it('every road is one-way: no way in or out ever drives a road against its direction', () => {
    // The orange openings are crossed either way; every other road one way only.
    const roads = GARAGE.lanes.filter((l) => l.oneway !== false).map((l) => l.path.map(toM));
    for (const [name, way] of allWays()) {
      expect(way, name).toBeTruthy();
      const pts = way.path.map(toM);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const len = d(a, b);
        if (len < 1) continue;
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        for (const road of roads) {
          for (let k = 1; k < road.length; k++) {
            const [p, q] = [road[k - 1], road[k]];
            const l2 = d(p, q);
            if (l2 < 1) continue;
            const u = ((mid[0] - p[0]) * (q[0] - p[0]) + (mid[1] - p[1]) * (q[1] - p[1])) / (l2 * l2);
            if (u < 0 || u > 1) continue;
            const off = Math.abs((q[0] - p[0]) * (p[1] - mid[1]) - (p[0] - mid[0]) * (q[1] - p[1])) / l2;
            if (off > 0.5) continue;
            // On this road: the way must go the road's direction.
            const dot = ((b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1])) / (len * l2);
            if (Math.abs(dot) > 0.9) expect(dot, `${name}, at ${mid.map((v) => v.toFixed(0))}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('from Sultana to the south lots: straight down the west side, left at the Quba exit, then round by lot 13 (owner, 2026-10-14)', () => {
    for (const id of [901, 902, 903, 904]) {
      const lanes = garageRoute('sultana', P(id))!.roads.map((r) => r.lane);
      expect(lanes.slice(0, 4), `P${id - 900}`).toEqual(['sultana-in', 'nw-straight', 'exit-west', 'sw-turn']);
      expect(lanes, `P${id - 900}`).not.toContain('north-lane');
    }
  });

  it('level A is reached by the yellow ramp (after lot 11) and left by the green one (between facilities 220 and 222)', () => {
    const up = GARAGE.lanes.find((l) => l.kind === 'ramp_up')!;
    const down = GARAGE.lanes.find((l) => l.kind === 'ramp_down')!;
    // Yellow: east of lot 11; green: between facilities 220 and 222.
    expect(toM(up.path[0])[0]).toBeGreaterThan(toM(at(P(911)))[0]);
    const x220 = toM(at(P(220)))[0];
    const x222 = toM(at(P(222)))[0];
    expect(toM(down.path[0])[0]).toBeGreaterThan(Math.min(x220, x222));
    expect(toM(down.path[0])[0]).toBeLessThan(Math.max(x220, x222));
    for (const lot of LOTS) {
      for (const e of ENTRANCES) {
        expect(garageRoute(e.id, lot, 'B')!.ramps, `in to P${lot.id - 900}B`).toEqual([]);
        expect(garageRoute(e.id, lot, 'A')!.ramps.map((r) => r.to), `in to P${lot.id - 900}A`).toEqual(['A']);
      }
      for (const x of EXITS) {
        expect(garageExit(lot, x.id, 'B')!.ramps, `out of P${lot.id - 900}B`).toEqual([]);
        expect(garageExit(lot, x.id, 'A')!.ramps.map((r) => r.to), `out of P${lot.id - 900}A`).toEqual(['B']);
      }
    }
  });

  it('the orange openings (to switch between the way in and the way out) are crossed either way; on the north-west corner on level B only', () => {
    const shared = GARAGE.lanes.filter((l) => l.kind === 'shared');
    expect(shared.length).toBeGreaterThan(0);
    for (const l of shared) expect(l.oneway, l.id).toBe(false);
    const nw = new Set(shared.filter((l) => l.id.startsWith('nw-')).map((l) => l.id));
    for (const l of shared.filter((x) => nw.has(x.id))) expect(l.levels).toEqual(['B']);
    for (const [name, way] of allWays()) for (const r of way.roads) if (nw.has(r.lane)) expect(r.level, name).toBe('B');
  });

  it('on level A, the north lots are entered from the north road (after the yellow ramp, heading west); on B from the inner road', () => {
    for (const id of [908, 909, 910, 911]) {
      const r = lotRect(P(id))!;
      const a = toM(garageRoute('sultana', P(id), 'A')!.gate);
      const b = toM(garageRoute('sultana', P(id), 'B')!.gate);
      expect(Math.abs(a[1] - r.y1), `P${id - 900}A at the north edge`).toBeLessThan(0.01);
      expect(Math.abs(b[1] - r.y0), `P${id - 900}B at the south edge`).toBeLessThan(0.01);
    }
    // The others on A: almost a full lap, longer than on B.
    for (const id of [901, 905, 912]) expect(garageRoute('sultana', P(id), 'A')!.meters).toBeGreaterThan(garageRoute('sultana', P(id), 'B')!.meters + 800);
  });

  it('the way out ends where the exit road leaves the car park (level B), then goes on to the streets', () => {
    for (const lot of LOTS) {
      const plans = planExit(lot, 'B');
      expect(plans.length, `P${lot.id - 900}`).toBeGreaterThan(0);
      for (const p of plans) {
        const garage = p.legs[0].path;
        const mouth = EXITS.find((x) => x.id === p.exit)!.mouth;
        expect(d(toM(garage[garage.length - 1]), toM(mouth))).toBeLessThan(1);
        expect(p.legs[1].kind).toBe('drive');
      }
    }
    // Sultana: on to Sultana road northwards, as the owner drew it.
    const sultana = planExit(P(909), 'B').find((p) => p.exit === 'sultana')!;
    const onward = sultana.legs[1].path;
    expect(onward[onward.length - 1][0]).toBeGreaterThan(onward[0][0]);
  });

  it('turns into each lot at its edge, right after its first facility, as the arrows in the drawing show', () => {
    for (const lot of LOTS) {
      const r = lotRect(lot)!;
      const way = garageRoute('sultana', lot)!;
      const g = toM(way.gate);
      const onEdge = Math.min(Math.abs(g[0] - r.x0), Math.abs(g[0] - r.x1), Math.abs(g[1] - r.y0), Math.abs(g[1] - r.y1));
      expect(onEdge, `P${lot.id - 900}`).toBeLessThan(0.01);
      // Near one end of the lot (by its first facility), not in the middle of its side.
      const nearestFacility = Math.min(...parkingEntrances(lot).map((f) => d(toM(at(f)), g)));
      const length = Math.max(r.x1 - r.x0, r.y1 - r.y0);
      expect(nearestFacility, `P${lot.id - 900}`).toBeLessThan(length / 3);
    }
  });

  it('ends at the lot’s entrance, not inside the lot (the visitor parks where they like); the way out starts at its exit', () => {
    for (const lot of LOTS) {
      const r = lotRect(lot)!;
      for (const level of LEVELS) {
        const way = garageRoute('sultana', lot, level)!;
        const end = toM(way.path[way.path.length - 1]);
        expect(end).toEqual(toM(way.gate));
        const onEdge = Math.min(Math.abs(end[0] - r.x0), Math.abs(end[0] - r.x1), Math.abs(end[1] - r.y0), Math.abs(end[1] - r.y1));
        expect(onEdge, `P${lot.id - 900}${level}`).toBeLessThan(0.01);
        // Nothing of the way is inside the lot.
        const inner = { x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 1, y1: r.y1 - 1 };
        expect(way.path.some((q) => insideRect(toM(q), inner)), `P${lot.id - 900}${level}`).toBe(false);
        const out = garageExit(lot, 'quba', level)!;
        expect(toM(out.path[0])).toEqual(toM(out.gate));
        expect(out.path.some((q) => insideRect(toM(q), inner)), `out of P${lot.id - 900}${level}`).toBe(false);
      }
    }
  });

  it('the east side is confirmed by the owner (2026-10-14): no way is marked approximate', () => {
    for (const [name, way] of allWays()) expect(way.certain, name).toBe(true);
  });

  it('a car trip comes in by an entrance, drives the drawn roads to the lot’s entrance, and walks from its nearest stairs', async () => {
    const p = await planRoute([24.476, 39.611], P(223), 'drive'); // from the north (First Ring Road)
    expect(p.legs.map((l) => l.kind)).toEqual(['drive', 'garage', 'walk']);
    expect(p.entrance).toBe('sultana');
    expect(p.gate).toBeDefined();
    // The drive ends at the lot's entrance; the walk starts at one of the lot's stairs (its facilities).
    const garage = p.legs[1].path;
    expect(garage[garage.length - 1]).toEqual(p.gate);
    const stairs = p.legs[2].path[0];
    expect(parkingEntrances(p.lot!).some((f) => Math.abs(f.lat - stairs[0]) < 1e-9 && Math.abs(f.lng - stairs[1]) < 1e-9)).toBe(true);
  });

  describe('the Sultana side (owner’s drawing, 2026-10-13)', () => {
    const sultana = ENTRANCES.find((e) => e.id === 'sultana')!;
    const loopTop = sultana.approach![15]; // the top of the loop at the junction
    const mouth = sultana.street;
    const near = (path: LatLng[], p: LatLng, m: number) => path.some((q) => d(toM(q), toM(p)) < m);

    it('the way in ends at the car park mouth, where the underground road begins', () => {
      expect(sultana.approach!.length).toBeGreaterThan(20);
      expect(sultana.approach![sultana.approach!.length - 1]).toEqual(mouth);
      // The way out is in the data too (up the exit ramp, then north on Sultana road).
      const out = GARAGE.exits.find((x) => x.id === 'sultana')!.departure!;
      expect(out[out.length - 1][0]).toBeGreaterThan(out[0][0]);
    });

    for (const [name, from] of [
      ['from the south-west', [24.456, 39.6]],
      ['from the north (First Ring Road)', [24.476, 39.611]],
      ['from right by the junction', [24.4718, 39.6035]],
    ] as [string, LatLng][]) {
      it(`${name}: round the loop and down the ramp, never in by the side street`, async () => {
        const p = await planRoute(from, P(909), 'drive');
        expect(p.entrance).toBe('sultana');
        const drive = p.legs[0].path;
        expect(near(drive, loopTop, 20)).toBe(true);
        // The last 150 m above ground come down the ramp from the north, not along the street from the west.
        const m = toM(mouth);
        const before = drive.map(toM).filter((q) => d(q, m) > 100 && d(q, m) < 150);
        expect(before.length).toBeGreaterThan(0);
        for (const q of before) expect(q[1]).toBeGreaterThan(m[1] + 50);
      });
    }
  });
});


describe('the way on level A is drawn apart (owner, 2026-10-13)', () => {
  it('splits a way into stretches: level B, the ramp up, level A — joined end to end', () => {
    const way = garageRoute('sultana', POI_BY_ID.get(905)!, 'A')!;
    const kinds = way.parts.map((p) => p.on);
    expect(kinds[0]).toBe('B');
    expect(kinds).toContain('up');
    expect(kinds[kinds.length - 1]).toBe('A');
    for (let i = 1; i < way.parts.length; i++) expect(way.parts[i].path[0]).toEqual(way.parts[i - 1].path[way.parts[i - 1].path.length - 1]);
    // On level B, one stretch only.
    expect(garageRoute('sultana', POI_BY_ID.get(905)!, 'B')!.parts.map((p) => p.on)).toEqual(['B']);
    // The way out from A: A, the ramp down, then B.
    const out = garageExit(POI_BY_ID.get(905)!, 'quba', 'A')!.parts.map((p) => p.on);
    expect(out[0]).toBe('A');
    expect(out).toContain('down');
    expect(out[out.length - 1]).toBe('B');
  });
});

describe('the car park roads run beside the facilities, not the mosque (owner, 2026-10-13)', () => {
  const lane = (id: string) => GARAGE.lanes.find((l) => l.id === id)!.path.map(toM);
  const mosque = network().obstacles[0];
  it('the east road: nearer the east facilities than the mosque wall', () => {
    const eastFacilities = toM([POI_BY_ID.get(233)!.lat, POI_BY_ID.get(233)!.lng])[0];
    for (const [x, y] of lane('east-lane')) {
      if (y < mosque.y0 || y > mosque.y1) continue; // only alongside the mosque
      expect(eastFacilities - x, `at y=${y.toFixed(0)}`).toBeLessThan(x - mosque.x1);
    }
  });
  it('the south road: nearer the south facilities than the mosque wall', () => {
    const southFacilities = toM([POI_BY_ID.get(201)!.lat, POI_BY_ID.get(201)!.lng])[1];
    for (const [x, y] of lane('south-lane')) {
      if (x < mosque.x0 || x > mosque.x1) continue;
      expect(y - southFacilities, `at x=${x.toFixed(0)}`).toBeLessThan(mosque.y0 - y);
    }
  });
});

describe('which lot a car is taken to (owner, 2026-10-13)', () => {
  const FROM: LatLng = [24.4718, 39.6035];
  it('the Rawdah at gate 37 → lot 1; gate 21 and the women’s entrance behind the Rawdah → lot 9 (the owner’s choice)', async () => {
    for (const [place, lot] of [[37, 901], [603, 901], [21, 909], [604, 909]] as const) {
      for (const p of await planRoutes(FROM, P(place), 'drive')) expect(p.lot?.id, `${place}`).toBe(lot);
    }
  });
  it('any other place: the public lot nearest it on foot, never a subscribers-only lot', async () => {
    const publicLots = LOTS.filter((l) => parkingAccess(l) === 'public');
    for (const place of [1, 13, 25, 29, 33, 41, 223, 213]) {
      const plans = await planRoutes(FROM, P(place), 'drive');
      const lot = plans[0].lot!;
      expect(parkingAccess(lot), `${place}`).toBe('public');
      const walk = (l: (typeof LOTS)[number]) => Math.min(...parkingEntrances(l).map((e) => pathLength(walkPath(at(e), at(P(place))))));
      expect(walk(lot), `${place}`).toBeLessThanOrEqual(Math.min(...publicLots.map(walk)) + 0.01);
      for (const p of plans) expect(p.lot?.id, `${place}: one lot, by either entrance`).toBe(lot.id);
    }
  });
});

describe('the north-west corner on level B (owner, 2026-10-13)', () => {
  it('coming down from the Sultana entrance, the way carries straight on south — no jog east and back west', () => {
    for (const id of [905, 906, 907]) {
      const kinds = garageRoute('sultana', P(id), 'B')!.steps.map((s) => s.kind);
      expect(kinds.slice(0, 2), `P${id - 900}`).toEqual(['e', 's']);
      expect(garageRoute('sultana', P(id), 'B')!.roads.some((r) => r.lane === 'nw-shared-2'), `P${id - 900}`).toBe(false);
    }
  });
});

describe('the owner’s corrections on the east and south-west sides (2026-10-14)', () => {
  const lane = (id: string) => GARAGE.lanes.find((l) => l.id === id)!;
  const nearLane = (p: LatLng, id: string) => {
    const pts = lane(id).path.map(toM);
    const q = toM(p);
    return Math.min(...pts.slice(1).map((b, i) => {
      const a = pts[i];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return d(q, [a[0] + dx * u, a[1] + dy * u]);
    }));
  };

  it('the east side is cut between lots 12 and 13: no road runs between them', () => {
    const y12 = lotRect(P(912))!.y0;
    const x13 = lotRect(P(913))!.x0;
    for (const l of GARAGE.lanes) for (const [x, y] of l.path.map(toM)) expect(x > x13 - 40 && y > y12 - 10 && y < y12 + 60, l.id).toBe(false);
  });

  it('lot 12: in from the inner north road, out north onto the exit road heading west', () => {
    for (const level of LEVELS) {
      expect(garageRoute('sultana', P(912), level)!.roads.at(-1)!.lane).toBe('north-lane');
      expect(garageExit(P(912), 'sultana', level)!.roads[0].lane).toBe('exit-north');
    }
  });

  it('lot 13: in from the south on its east side, out on its west side heading south', () => {
    const r = lotRect(P(913))!;
    const way = garageRoute('quba', P(913))!;
    expect(way.roads.map((x) => x.lane)).toEqual(['quba-in']);
    expect(Math.abs(toM(way.gate)[0] - r.x1)).toBeLessThan(0.01);
    const out = garageExit(P(913), 'quba')!;
    expect(out.roads[0].lane).toBe('east-lane');
    expect(Math.abs(toM(out.gate)[0] - r.x0)).toBeLessThan(0.01);
  });

  it('a second green ramp beside the yellow one: from the inner road on A north down to the exit road on B', () => {
    const up = toM(lane('ramp-up-A').path[0]);
    const down = lane('ramp-down-B-east');
    expect(down.from_level).toBe('A');
    expect(down.to_level).toBe('B');
    const [a, b] = [toM(down.path[0]), toM(down.path[down.path.length - 1])];
    expect(b[1]).toBeGreaterThan(a[1] + 50); // north
    expect(Math.abs(a[0] - up[0])).toBeLessThan(20); // beside the yellow ramp
    // Out of a north lot on A to Sultana: down this ramp, not round by the north-west.
    expect(garageExit(P(909), 'sultana', 'A')!.roads.map((r) => r.lane)).toContain('ramp-down-B-east');
  });

  it('the way out to Quba from the south side goes round the block between lots 4 and 5, and can turn back to the way in', () => {
    const out = garageExit(P(904), 'quba')!.roads.map((r) => r.lane);
    expect(out.slice(-2)).toEqual(['exit-south-west', 'exit-west']);
    const back = lane('sw-back-in');
    expect(nearLane(back.path[0], 'exit-south-west')).toBeLessThan(1);
    expect(nearLane(back.path[back.path.length - 1], 'quba-in')).toBeLessThan(1);
  });
});

describe('a car already in the car park carries on from where it is (owner, 2026-10-14)', () => {
  // On the inner north road on level B, just before the yellow ramp (where the owner was).
  const byRamp = fromM([170, 319.5]);

  it('to lot 12A: straight up the yellow ramp, not out to the streets and back in', async () => {
    expect(inGarage(byRamp)).toBe(true);
    const way = garageRouteFrom(byRamp, P(912), 'A')!;
    const lanes = way.roads.map((r) => r.lane);
    expect(lanes[0]).toBe('north-lane');
    expect(lanes).toContain('ramp-up-A');
    expect(lanes).not.toContain('sultana-in');
    expect(d(toM(way.path[0]), toM(byRamp))).toBeLessThan(20);
    const [plan] = await planRoutes(byRamp, P(912), 'drive', { level: 'A' });
    expect(plan.legs.map((l) => l.kind)).toEqual(['garage']);
    expect(plan.lot?.id).toBe(912);
    expect(plan.driveM).toBeLessThan(garageRoute('sultana', P(912), 'A')!.meters);
  });

  it('to a place in the Haram: on to its lot, then the walk up', async () => {
    const [plan] = await planRoutes(byRamp, P(223), 'drive');
    expect(plan.legs.map((l) => l.kind)).toEqual(['garage', 'walk']);
  });

  it('where the way in and the way out run side by side, the car’s heading picks the road', () => {
    const between = fromM([224.2, 40]);
    for (const id of [901, 913]) {
      expect(garageRouteFrom(between, P(id), 'B', 0)!.roads[0].lane, `P${id - 900}`).toBe('quba-in'); // heading north
      expect(garageRouteFrom(between, P(id), 'B', 180)!.roads[0].lane, `P${id - 900}`).toBe('east-lane'); // heading south
    }
  });

  it('from the streets, nothing changes: in by an entrance', async () => {
    expect(inGarage([24.476, 39.611])).toBe(false);
    const [plan] = await planRoutes([24.476, 39.611], P(912), 'drive');
    expect(plan.legs[0].kind).toBe('drive');
  });
});
