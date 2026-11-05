import { describe, expect, it } from 'vitest';
import { CANOPIES } from '../../src/data-next/alharamain-3d';
import { rowBetween, toFile } from '../../src/tools/canopy-points';

const metres = ([lng1, lat1]: readonly [number, number], [lng2, lat2]: readonly [number, number]) =>
  Math.hypot((lng2 - lng1) * 111_320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110_574);

describe('data/canopies.json (where the 3D view stands each canopy and lamp post)', () => {
  const all = [...CANOPIES.umbrellas, ...CANOPIES.lamps];

  it('lies on the Haram and its plazas', () => {
    expect(CANOPIES.umbrellas.length).toBeGreaterThan(0);
    for (const [lng, lat] of all) {
      expect(lng).toBeGreaterThan(39.603);
      expect(lng).toBeLessThan(39.617);
      expect(lat).toBeGreaterThan(24.463);
      expect(lat).toBeLessThan(24.4725);
    }
  });

  it('has no two points on the same spot (a canopy is about 24 m from the next)', () => {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(metres(all[i], all[j]), `${i} ${j}`).toBeGreaterThan(3);
    }
  });
});

describe('the canopy editor (canopies.html)', () => {
  it('spaces a row of canopies evenly, both ends included', () => {
    const row = rowBetween([39.61, 24.466], [39.6105, 24.466], 6);
    expect(row).toHaveLength(6);
    expect(row[0]).toEqual([39.61, 24.466]);
    expect(row[5][0]).toBeCloseTo(39.6105, 10);
    const gaps = row.slice(1).map((p, i) => metres(row[i], p));
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
  });

  it('writes a file the app reads back unchanged', () => {
    const text = toFile({ umbrellas: [[39.6112345, 24.4671234]], lamps: [[39.61, 24.466]] });
    expect(JSON.parse(text)).toEqual({ umbrellas: [[39.6112345, 24.4671234]], lamps: [[39.61, 24.466]] });
  });
});
