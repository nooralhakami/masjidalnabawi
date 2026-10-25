import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import { lotLevels, parkingAccess, parkingEntrances } from '../../src/domain/parking';
import { ENTRANCES, EXITS, GARAGE, LEVELS, garageExit, setEntranceOpen, garageRoute, garageRouteFrom, inGarage, lotRect, type GarageRoute } from '../../src/routing/garage';
import { lotsToAsk, planExit, planRoute, planRoutes } from '../../src/routing/plan';
import { fromM, insideRect, network, pathLength, toM, walkPath } from '../../src/routing/walk';

const P = (id: number) => POI_BY_ID.get(id)!;
const LOTS = Array.from({ length: 13 }, (_, i) => P(901 + i));
const at = (p: { lat: number; lng: number }): LatLng => [p.lat, p.lng];
const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('the car park roads from the owner’s drawing (2026-10-13)', () => {
  it('has the three entrances, the three exits and all 13 lots', () => {
    expect(ENTRANCES.map((e) => e.id).sort()).toEqual(['omar', 'qurban', 'sultana']);
    expect(GARAGE.exits.map((e) => e.id).sort()).toEqual(['omar', 'qurban', 'sultana']);
    // Qurban (owner, 2026-10-23) joins level A only, at the south-east.
    expect(ENTRANCES.find((e) => e.id === 'qurban')!.level).toBe('A');
    expect(GARAGE.exits.find((e) => e.id === 'qurban')!.level).toBe('A');
    expect(ENTRANCES.find((e) => e.id === 'qurban')!.street[0]).toBeLessThan(24.4655);
    expect(ENTRANCES.find((e) => e.id === 'qurban')!.street[1]).toBeGreaterThan(39.612);
    expect(GARAGE.lots.map((l) => l.id).sort()).toEqual(LOTS.map((l) => l.id));
    // The entrances are the car park entrances mapped in OpenStreetMap on the Quba and Sultana sides.
    expect(ENTRANCES.find((e) => e.id === 'omar')!.street[0]).toBeLessThan(24.4665); // south-west
    expect(ENTRANCES.find((e) => e.id === 'sultana')!.street[0]).toBeGreaterThan(24.4705); // north-west
  });

  /** The south lots and lot 13 are reached only from Omar ibn al-Khattab street: there is no way back at its exit (owner, 2026-10-14). */
  const SOUTH = [901, 902, 903, 904, 913];
  /** An entrance a lot can be reached from inside the car park. */
  const inBy = (lot: { id: number }) => (SOUTH.includes(lot.id) ? 'omar' : 'sultana');

  it('every lot, on each level, can be reached by Omar and by Qurban and left by Omar and Sultana; the south lots and lot 13 are never reached from Sultana, and are the ones left by Qurban', () => {
    for (const lot of LOTS) {
      for (const level of LEVELS) {
        expect(garageRoute('omar', lot, level), `omar → P${lot.id - 900}${level}`).not.toBeNull();
        expect(garageRoute('qurban', lot, level), `qurban → P${lot.id - 900}${level}`).not.toBeNull();
        expect(garageRoute('sultana', lot, level) === null, `sultana → P${lot.id - 900}${level}`).toBe(SOUTH.includes(lot.id));
        for (const x of ['omar', 'sultana'] as const) expect(garageExit(lot, x, level), `P${lot.id - 900}${level} → ${x}`).not.toBeNull();
        // The one-way roads lead to the Qurban exit only from the south-east lots (1-4 and 13).
        expect(garageExit(lot, 'qurban', level) === null, `P${lot.id - 900}${level} → qurban`).toBe(!SOUTH.includes(lot.id));
      }
    }
  });

  /** Every way in and out there is: each lot, each level, each entrance and exit. */
  const allWays = (): [string, GarageRoute][] =>
    LOTS.flatMap((lot) =>
      LEVELS.flatMap((level) => [
        ...ENTRANCES.map((e) => [`in ${e.id} → P${lot.id - 900}${level}`, garageRoute(e.id, lot, level)] as [string, GarageRoute | null]),
        ...EXITS.map((x) => [`out P${lot.id - 900}${level} → ${x.id}`, garageExit(lot, x.id, level)] as [string, GarageRoute | null]),
      ]),
    ).filter((w): w is [string, GarageRoute] => w[1] !== null);

  it('never runs under the mosque or Al-Baqi’', () => {
    const N = network();
    for (const [name, way] of allWays()) {
      const path = way.path.map(toM);
      for (let i = 1; i < path.length; i++) {
        const n = Math.max(1, Math.ceil(d(path[i - 1], path[i])));
        for (let k = 0; k <= n; k++) {
          const p: [number, number] = [path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / n, path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / n];
          expect(
            N.obstacles.some((r) => insideRect(p, r)),
            name,
          ).toBe(false);
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

  it('from the streets to a south lot: in by Omar ibn al-Khattab street or, since the south-east ramps (owner, 2026-10-23), by Qurban; never by Sultana', async () => {
    const p = await planRoute([24.476, 39.611], P(901), 'drive'); // from the north
    expect(['omar', 'qurban']).toContain(p.entrance);
  });

  it('a closed Qurban entrance is left out of the way in and of the way out (the supervisor’s button)', async () => {
    setEntranceOpen('qurban', false);
    try {
      const p = await planRoute([24.476, 39.611], P(901), 'drive');
      expect(p.entrance).toBe('omar');
      expect(planExit(P(901), 'B').every((x) => x.exit !== 'qurban')).toBe(true);
    } finally {
      setEntranceOpen('qurban', true);
    }
    expect(planExit(P(901), 'B').some((x) => x.exit === 'qurban')).toBe(true);
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
      // Lots 12 and 13 have no level A (owner, 2026-10-25): their ways are checked below.
      if (!lotLevels(lot).includes('A')) continue;
      // Omar and Sultana join level B. From Omar the south lots on B (1-4) now use the south-east ramps
      // (owner, 2026-10-23): up the yellow one and down the green one, shorter than the lap round the east.
      for (const e of ENTRANCES.filter((e) => !e.level)) {
        if (!garageRoute(e.id, lot, 'B')) continue;
        const shortcut = e.id === 'omar' && [901, 902, 903, 904].includes(lot.id);
        expect(
          garageRoute(e.id, lot, 'B')!.ramps.map((r) => r.to),
          `in to P${lot.id - 900}B`,
        ).toEqual(shortcut ? ['A', 'B'] : []);
        expect(
          garageRoute(e.id, lot, 'A')!.ramps.map((r) => r.to),
          `in to P${lot.id - 900}A`,
        ).toEqual(['A']);
      }
      // Qurban joins level A: no ramp to a lot on A; down the green ramp to a lot on B.
      expect(garageRoute('qurban', lot, 'A')!.ramps, `qurban in to P${lot.id - 900}A`).toEqual([]);
      expect(
        garageRoute('qurban', lot, 'B')!.ramps.map((r) => r.to),
        `qurban in to P${lot.id - 900}B`,
      ).toEqual(['B']);
      for (const x of EXITS.filter((x) => !x.level)) {
        expect(
          garageExit(lot, x.id, 'A')!.ramps.map((r) => r.to),
          `out of P${lot.id - 900}A`,
        ).toEqual(['B']);
      }
    }
  });

  it('the south-east corner on level A (owner, 2026-10-25): no east side; in from Qurban up beside the green ramp, then west', () => {
    for (const id of ['east-lane', 'east-link', 'p13-in', 'p13-exit', 'se-shared', 'outer-south-east']) {
      expect(GARAGE.lanes.find((l) => l.id === id)!.levels, id).toEqual(['B']);
    }
    expect(GARAGE.lanes.some((l) => l.id === 'a-qurban-to-east-up')).toBe(false);
    for (const [name, way] of allWays())
      for (const r of way.roads) if (r.lane === 'outer-south-east' || r.lane.startsWith('east-') || r.lane.startsWith('p13-')) expect(r.level, name).toBe('B');
    for (const id of [901, 902, 903, 904]) {
      expect(
        garageRoute('qurban', P(id), 'A')!.roads.map((r) => r.lane),
        `P${id - 900}A`,
      ).toEqual(['qurban-road-in-A', 'a-qurban-east-up', 'a-qurban-arc', 'south-lane']);
      // To B: down the green ramp beside which the way in climbed.
      expect(
        garageRoute('qurban', P(id), 'B')!.roads.map((r) => r.lane),
        `P${id - 900}B`,
      ).toContain('ramp-down-qurban');
      // Out by Qurban: road 6, then the exit curve; no lap round the corner.
      expect(
        garageExit(P(id), 'qurban', 'A')!.roads.map((r) => r.lane),
        `P${id - 900}A out`,
      ).toEqual(['outer-south', 'a-qurban-exit-curve', 'qurban-road-out-A']);
    }
  });

  it('there is no lot 12A or 13A (owner, 2026-10-25): a way asked for on level A goes to level B', async () => {
    for (const id of [912, 913]) {
      const lot = P(id);
      expect(lotLevels(lot)).toEqual(['B']);
      for (const e of ENTRANCES) {
        const a = garageRoute(e.id, lot, 'A');
        expect(a?.level ?? 'B', `in ${e.id} → P${id - 900}`).toBe('B');
        expect(a, `in ${e.id} → P${id - 900}`).toEqual(garageRoute(e.id, lot, 'B'));
      }
      for (const x of EXITS) expect(garageExit(lot, x.id, 'A'), `out P${id - 900} → ${x.id}`).toEqual(garageExit(lot, x.id, 'B'));
      const [plan] = await planRoutes([24.476, 39.611], lot, 'drive', { level: 'A' });
      expect(plan.level, `P${id - 900}`).toBe('B');
      expect(planExit(lot, 'A').every((p) => p.level === 'B')).toBe(true);
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
    // The others on A: up the north-west yellow ramp (owner, 2026-10-14), then through the opening
    // south to the west exit road for the west and south lots.
    const lanes = (id: number) => garageRoute('sultana', P(id), 'A')!.roads.map((r) => r.lane);
    expect(lanes(905)).toEqual(expect.arrayContaining(['ramp-up-A-nw', 'a-nw-opening']));
    // The south lots on A: north beside road 13, then up the south-west yellow ramp (owner, 2026-10-15).
    expect(garageRoute('omar', P(905), 'A')!.roads.map((r) => r.lane)).toEqual(expect.arrayContaining(['sw-north', 'ramp-up-A-sw']));
    // The south-east lots on A (owner, 2026-10-23): up the yellow ramp at the south-east corner instead.
    expect(garageRoute('omar', P(901), 'A')!.roads.map((r) => r.lane)).toEqual(expect.arrayContaining(['qurban-ramp-link', 'ramp-up-qurban']));
  });

  it('the north-west yellow ramp (owner, 2026-10-14): from the exit road to Sultana, beside the green ramp, up to the inner road on A', () => {
    const up = GARAGE.lanes.find((l) => l.id === 'ramp-up-A-nw')!;
    const green = GARAGE.lanes.find((l) => l.id === 'ramp-down-B')!;
    const link = GARAGE.lanes.find((l) => l.id === 'exit-link-810')!;
    expect([up.from_level, up.to_level]).toEqual(['B', 'A']);
    const [a, b] = [toM(up.path[0]), toM(up.path[up.path.length - 1])];
    expect(a[1]).toBeGreaterThan(b[1] + 80); // heading south
    // Between the red link (east) and the green ramp (west).
    expect(a[0]).toBeLessThan(toM(link.path[0])[0]);
    expect(a[0]).toBeGreaterThan(toM(green.path[0])[0]);
    // The opening on A is on level A only.
    expect(GARAGE.lanes.find((l) => l.id === 'a-nw-opening')!.levels).toEqual(['A']);
    // Owner, 2026-10-15: the green goes straight down, then east under the yellow (not joining it) to
    // the red road 10, which leads back to the exit road.
    const g = green.path.map(toM);
    expect(Math.abs(g[0][0] - g[1][0])).toBeLessThan(0.5);
    const end = g[g.length - 1];
    expect(Math.abs(end[0] - toM(link.path[0])[0])).toBeLessThan(1);
    expect(end[1]).toBeGreaterThan(toM(link.path[0])[1] + 10);
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
      const way = garageRoute(inBy(lot), lot)!;
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
        const way = garageRoute(inBy(lot), lot, level)!;
        const end = toM(way.path[way.path.length - 1]);
        expect(end).toEqual(toM(way.gate));
        const onEdge = Math.min(Math.abs(end[0] - r.x0), Math.abs(end[0] - r.x1), Math.abs(end[1] - r.y0), Math.abs(end[1] - r.y1));
        expect(onEdge, `P${lot.id - 900}${level}`).toBeLessThan(0.01);
        // Nothing of the way is inside the lot.
        const inner = { x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 1, y1: r.y1 - 1 };
        expect(
          way.path.some((q) => insideRect(toM(q), inner)),
          `P${lot.id - 900}${level}`,
        ).toBe(false);
        const out = garageExit(lot, 'omar', level)!;
        expect(toM(out.path[0])).toEqual(toM(out.gate));
        expect(
          out.path.some((q) => insideRect(toM(q), inner)),
          `out of P${lot.id - 900}${level}`,
        ).toBe(false);
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

    // (From the south-west, the Omar ibn al-Khattab entrance is the nearer one now.)
    for (const [name, from] of [
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
    const out = garageExit(POI_BY_ID.get(905)!, 'omar', 'A')!.parts.map((p) => p.on);
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
    for (const [place, lot] of [
      [37, 901],
      [603, 901],
      [21, 909],
      [604, 909],
    ] as const) {
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
      expect(
        garageRoute('sultana', P(id), 'B')!.roads.some((r) => r.lane === 'nw-shared-2'),
        `P${id - 900}`,
      ).toBe(false);
    }
  });
});

describe('the owner’s corrections on the east and south-west sides (2026-10-14)', () => {
  const lane = (id: string) => GARAGE.lanes.find((l) => l.id === id)!;
  const nearLane = (p: LatLng, id: string) => {
    const pts = lane(id).path.map(toM);
    const q = toM(p);
    return Math.min(
      ...pts.slice(1).map((b, i) => {
        const a = pts[i];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return d(q, [a[0] + dx * u, a[1] + dy * u]);
      }),
    );
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
    const way = garageRoute('omar', P(913))!;
    // Road 6 is split by the green ramp (owner, 2026-10-25): its east part is on level B only.
    expect(way.roads.map((x) => x.lane)).toEqual(['omar-in', 'outer-south', 'outer-south-east', 'p13-in']);
    expect(Math.abs(toM(way.gate)[0] - r.x1)).toBeLessThan(0.01);
    const out = garageExit(P(913), 'omar')!;
    expect(out.roads.map((x) => x.lane).slice(0, 3)).toEqual(['p13-exit', 'east-link', 'east-lane']);
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

  it('the south-west corner (owner, 2026-10-14): in and out by Omar ibn al-Khattab street on level B, west then south; the lower road west to the exit; a yellow and a green ramp to A', () => {
    const lane = (id: string) => GARAGE.lanes.find((l) => l.id === id)!;
    for (const id of ['omar-in', 'exit-omar', 'sw-mid']) expect(lane(id).levels, id).toEqual(['B']);
    // The exit leaves the car park westwards, then turns south to the street.
    const out = lane('exit-omar').path.map(toM);
    expect(out[out.length - 1][0]).toBeLessThan(out[0][0] - 100);
    expect(out[out.length - 1][1]).toBeLessThan(out[0][1] - 40);
    // Out of a south lot to Omar ibn al-Khattab street: the south-east ramps (owner, 2026-10-23) lead up
    // to A, west along the inner road, then down the south-west green ramp to the exit road.
    expect(
      garageExit(P(904), 'omar')!
        .roads.map((r) => r.lane)
        .slice(-3),
    ).toEqual(['ramp-down-B-sw', 'sw-mid', 'exit-omar']);
    // Owner, 2026-10-15: in from Omar, east to road 6 or north beside road 13; at its top north-east to
    // the west link, or west to the yellow ramp, which runs south up to A and east onto road 6 there.
    expect(garageRoute('omar', P(905), 'B')!.roads.map((r) => r.lane)).toEqual(['omar-in', 'outer-south', 'sw-north', 'west-link', 'west-lane']);
    const up = lane('ramp-up-A-sw').path.map(toM);
    expect(up[up.length - 1][1]).toBeLessThan(up[0][1] - 80); // heading south
    expect(nearLane(lane('ramp-up-A-sw').path.at(-1)!, 'outer-south')).toBeLessThan(1);
    expect(garageRoute('omar', P(905), 'A')!.roads.map((r) => r.lane)).toEqual(expect.arrayContaining(['sw-north', 'ramp-up-A-sw']));
    // Level A to the green ramp: down road 13, west, north on the new road, west to the green (here
    // from lot 1 on B, up the south-east yellow ramp first).
    expect(garageExit(P(901), 'omar', 'B')!.roads.map((r) => r.lane)).toEqual(
      expect.arrayContaining(['exit-south-west', 'a-sw-west', 'sw-north', 'a-sw-to-green', 'ramp-down-B-sw', 'sw-mid']),
    );
    // From lot 1 on A, road 6 turns straight into the south-east green ramp (owner, 2026-10-25).
    expect(
      garageExit(P(901), 'omar', 'A')!
        .roads.map((r) => r.lane)
        .slice(0, 3),
    ).toEqual(['outer-south', 'a-qurban-road6-green', 'ramp-down-qurban']);
    // The road beside 209/210 ends on the outer south road.
    const b = lane('exit-south-west').path;
    expect(nearLane(b[b.length - 1], 'outer-south')).toBeLessThan(1);
    // No way back at the exit (owner: «exit only»); the old roads round the block are gone.
    for (const id of ['sw-uturn', 'sw-turn', 'sw-back-in', 'quba-in', 'a-sw-loop'])
      expect(
        GARAGE.lanes.some((l) => l.id === id),
        id,
      ).toBe(false);
  });

  it('the east side (owner, 2026-10-15): road 6 loops back to lot 13’s entrance or down to road 4; lot 13’s own exit runs south to road 4', () => {
    const lane = (id: string) => GARAGE.lanes.find((l) => l.id === id)!;
    expect(lane('p13-exit').kind).toBe('exit');
    expect(garageExit(P(913), 'omar')!.roads[0].lane).toBe('p13-exit');
    // From road 6 round the loop and down the short link to road 4 (the south lots on B).
    // (Lots 1-4 on B from Omar use the south-east ramps since 2026-10-23: up, west on A, down.)
    expect(garageRoute('omar', P(901), 'B')!.roads.map((r) => r.lane)).toEqual([
      'omar-in',
      'outer-south',
      'qurban-ramp-link',
      'ramp-up-qurban',
      'south-lane',
      'a-qurban-west-down',
      'a-qurban-west-east',
      'ramp-down-qurban',
      'south-lane',
    ]);
    expect(garageRoute('omar', P(913), 'B')!.roads.map((r) => r.lane)).toContain('p13-in');
    // The orange still joins lot 13's exit to its entrance.
    const o = lane('se-shared').path;
    expect(nearLane(o[0], 'p13-exit')).toBeLessThan(1);
    expect(nearLane(o[o.length - 1], 'p13-in')).toBeLessThan(1);
  });
});

describe('a car already in the car park carries on from where it is (owner, 2026-10-14)', () => {
  // On the inner north road on level B, just before the yellow ramp (where the owner was).
  const byRamp = fromM([170, 317.5]);

  it('to lot 11A: up a yellow ramp inside the car park, not out to the streets and back in', async () => {
    expect(inGarage(byRamp)).toBe(true);
    const way = garageRouteFrom(byRamp, P(911), 'A')!;
    const lanes = way.roads.map((r) => r.lane);
    expect(lanes[0]).toBe('north-lane');
    expect(lanes.some((l) => l.startsWith('ramp-up-A'))).toBe(true);
    expect(lanes).not.toContain('sultana-in');
    expect(d(toM(way.path[0]), toM(byRamp))).toBeLessThan(20);
    const [plan] = await planRoutes(byRamp, P(911), 'drive', { level: 'A' });
    expect(plan.legs.map((l) => l.kind)).toEqual(['garage']);
    expect(plan.lot?.id).toBe(911);
  });

  it('to a place in the Haram: on to its lot, then the walk up', async () => {
    const [plan] = await planRoutes(byRamp, P(223), 'drive');
    expect(plan.legs.map((l) => l.kind)).toEqual(['garage', 'walk']);
  });

  it('where the way in and the way out run side by side, the car’s heading picks the road', () => {
    const between = fromM([224.2, 40]);
    for (const id of [901, 913]) {
      expect(garageRouteFrom(between, P(id), 'B', 0)!.roads[0].lane, `P${id - 900}`).toBe('outer-south-east'); // heading north
      expect(garageRouteFrom(between, P(id), 'B', 180)!.roads[0].lane, `P${id - 900}`).toBe('east-lane'); // heading south
    }
  });

  it('from the streets, nothing changes: in by an entrance', async () => {
    expect(inGarage([24.476, 39.611])).toBe(false);
    const [plan] = await planRoutes([24.476, 39.611], P(912), 'drive');
    expect(plan.legs[0].kind).toBe('drive');
  });
});

describe('in or by the car park, the visitor says where the car is: which lot, which level (owner, 2026-10-14)', () => {
  const byRamp = fromM([170, 317.5]);

  it('asks only in or by the car park, offering the nearest lots first', () => {
    const lots = lotsToAsk(byRamp).map((l) => l.id);
    expect(lots).toHaveLength(2);
    expect(lots).toContain(911);
    expect(lotsToAsk([24.476, 39.611])).toEqual([]); // the First Ring Road: outside
  });

  it('in a lot: out by its own exit on that level, then on to the other lot', async () => {
    const [plan] = await planRoutes(byRamp, P(910), 'drive', { level: 'A', start: { lot: P(911), level: 'B' } });
    const garage = plan.legs[0];
    expect(garage.kind).toBe('garage');
    expect(garage.steps![0].kind).toBe('lot_out');
    expect(plan.ramps!.map((r) => r.to)).toEqual(['A']);
  });

  it('in the very lot asked for, on its level: only the walk up is left', async () => {
    // Gate 21 → lot 9 (the owner's choice).
    const [plan] = await planRoutes(byRamp, P(21), 'drive', { start: { lot: P(909), level: 'B' } });
    expect(plan.lot?.id).toBe(909);
    expect(plan.legs.map((l) => l.kind)).toEqual(['walk']);
  });

  it('on the road on level A: no ramp up to reach a lot on A', async () => {
    const [plan] = await planRoutes(byRamp, P(909), 'drive', { level: 'A', start: { lot: null, level: 'A' } });
    expect(plan.legs[0].kind).toBe('garage');
    expect(plan.ramps ?? []).toEqual([]);
  });

  it('outside the car park: in from the streets by an entrance, as before', async () => {
    const [plan] = await planRoutes(byRamp, P(912), 'drive', { start: 'outside' });
    expect(plan.legs[0].kind).toBe('drive');
  });
});

describe('the walk up from the lot (owner, 2026-10-15)', () => {
  it('to a facility the lot opens into: up its own stairs and out of its door, not up another and back', async () => {
    const [plan] = await planRoutes([24.456, 39.6], P(205), 'drive', { level: 'A' });
    expect(plan.lot?.id).toBe(903);
    const walk = plan.legs[plan.legs.length - 1];
    expect(walk.kind).toBe('walk');
    expect(d(toM(walk.path[0]), toM([P(205).lat, P(205).lng]))).toBeLessThan(1);
    expect(pathLength(walk.path)).toBeLessThan(20);
  });
});
