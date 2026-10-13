import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';
import { parkingEntrances } from '../../src/domain/parking';
import { ENTRANCES, GARAGE, KEEP_RIGHT_M, garageRoute, insideLot, keepRight, lotRect } from '../../src/routing/garage';
import { planRoute } from '../../src/routing/plan';
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

  it('never runs under the mosque or Al-Baqi’', () => {
    const N = network();
    for (const lot of LOTS) {
      for (const e of ENTRANCES) {
        const path = garageRoute(e.id, lot)!.path.map(toM);
        for (let i = 1; i < path.length; i++) {
          const n = Math.max(1, Math.ceil(d(path[i - 1], path[i])));
          for (let k = 0; k <= n; k++) {
            const p: [number, number] = [path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / n, path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / n];
            expect(N.obstacles.some((r) => insideRect(p, r)), `${e.id} → P${lot.id - 900}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps to the right of two-way roads', () => {
    // Driving east, the right-hand side is south.
    expect(keepRight([[0, 0], [100, 0]]).every((p) => Math.abs(p[1] + KEEP_RIGHT_M) < 1e-9)).toBe(true);
    // Driving north, it is east.
    expect(keepRight([[0, 0], [0, 100]]).every((p) => Math.abs(p[0] - KEEP_RIGHT_M) < 1e-9)).toBe(true);
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

  it('parks in the bay nearest the stairs the visitor will use, along an aisle beside the middle rows', () => {
    for (const lot of LOTS) {
      const r = lotRect(lot)!;
      for (const f of parkingEntrances(lot)) {
        const way = garageRoute('quba', lot, at(f))!;
        const bay = toM(way.bay);
        expect(insideRect(bay, { x0: r.x0 - 0.01, x1: r.x1 + 0.01, y0: r.y0 - 0.01, y1: r.y1 + 0.01 }), `P${lot.id - 900}`).toBe(true);
        // Closer to these stairs than to any of the lot's other three.
        const others = parkingEntrances(lot).filter((o) => o.id !== f.id);
        expect(d(bay, toM(at(f)))).toBeLessThanOrEqual(Math.min(...others.map((o) => d(bay, toM(at(o))))) + 0.01);
      }
      // The two aisles: a quarter of the lot's width in from each long side.
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const inLot = insideLot(lot, toM(GARAGE.lots.find((l) => l.id === lot.id)!.entry), null)!;
      const bay = inLot.path[inLot.path.length - 1];
      const across = w >= h ? (bay[1] - r.y0) / h : (bay[0] - r.x0) / w;
      expect([0.25, 0.75].some((q) => Math.abs(across - q) < 1e-6), `P${lot.id - 900}`).toBe(true);
    }
  });

  it('says so when the way uses the east side, which the owner is not sure of yet', () => {
    // Lots 12 and 13 are on the east side.
    expect(garageRoute('sultana', P(912))!.certain).toBe(false);
    expect(garageRoute('sultana', P(913))!.certain).toBe(false);
    // From Sultana to a north lot, the way stays on the north side.
    expect(garageRoute('sultana', P(909))!.certain).toBe(true);
  });

  it('a car trip comes in by an entrance, drives the drawn roads to the lot and walks up the nearest stairs', async () => {
    const p = await planRoute([24.476, 39.611], P(223), 'drive'); // from the north (First Ring Road)
    expect(p.legs.map((l) => l.kind)).toEqual(['drive', 'garage', 'walk']);
    expect(p.entrance).toBe('sultana');
    expect(p.gate).toBeDefined();
    // The garage leg ends at the stairs (a facility of the lot), where the walk starts.
    const stairs = p.legs[1].path[p.legs[1].path.length - 1];
    expect(parkingEntrances(p.lot!).some((f) => Math.abs(f.lat - stairs[0]) < 1e-9 && Math.abs(f.lng - stairs[1]) < 1e-9)).toBe(true);
  });
});
