import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import { parkingEntrances } from '../../src/domain/parking';
import { ENTRANCES, EXITS, GARAGE, LEVELS, garageExit, garageRoute, lotRect, type GarageRoute } from '../../src/routing/garage';
import { planExit, planRoute } from '../../src/routing/plan';
import { insideRect, network, toM } from '../../src/routing/walk';

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

  it('traffic circulates clockwise: from Sultana (north-west) to lot 1 (south-east) by the north and east sides', () => {
    const way = garageRoute('sultana', P(901))!.path.map(toM);
    // It passes the east side of the car park before turning west along the south side to the lot.
    expect(Math.max(...way.map((p) => p[0]))).toBeGreaterThan(200);
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

  it('the orange openings (to switch between the way in and the way out) are on level B only', () => {
    const shared = new Set(GARAGE.lanes.filter((l) => l.kind === 'shared').map((l) => l.id));
    expect(shared.size).toBeGreaterThan(0);
    for (const l of GARAGE.lanes.filter((x) => shared.has(x.id))) {
      expect(l.levels).toEqual(['B']);
      expect(l.oneway).toBe(false);
    }
    for (const [name, way] of allWays()) for (const r of way.roads) if (shared.has(r.lane)) expect(r.level, name).toBe('B');
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

  it('says so when the way uses the east side, which the owner is not sure of yet', () => {
    // Lots 12 and 13 are on the east side.
    expect(garageRoute('sultana', P(912))!.certain).toBe(false);
    expect(garageRoute('sultana', P(913))!.certain).toBe(false);
    // From Sultana to a north lot, the way stays on the north side.
    expect(garageRoute('sultana', P(909))!.certain).toBe(true);
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
