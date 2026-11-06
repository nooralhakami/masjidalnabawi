import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, PRAYER_CLEARINGS } from '../../src/data-next/alharamain-prayers';
import { BODY_R, COLUMN_R, Crowd } from '../../src/map/crowd-sim';
import { crowdInput } from '../../src/map/crowd-world';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { restroomFootprints, restroomWalkways } from '../../src/map/prayer-layout';

const inside = (x: number, z: number, r: readonly (readonly [number, number])[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};

describe('people walking in the courtyards (owner, 2026-11-06)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
  const input = crowdInput(columnsLL);
  const crowd = new Crowd(input, 400, 11);
  const start = Array.from({ length: crowd.n }, (_, a) => [crowd.px[a], crowd.pz[a]]);
  for (let t = 0; t < 60; t += 1 / 30) crowd.step(1 / 30);

  const carpets = ALHARAMAIN_PRAYERS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number])));
  const walkways = [...restroomWalkways(), ...PRAYER_CLEARINGS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number])))];
  const blocks = restroomFootprints();

  it('every walker stands on walkable ground: never on a carpet, in a restroom block or in a column', () => {
    let placed = 0;
    for (let a = 0; a < crowd.n; a++) {
      const x = crowd.px[a];
      const z = crowd.pz[a];
      if (Number.isNaN(x)) continue;
      placed++;
      expect(crowd.standable(x, z)).toBe(true);
      // The ground is a 0.5 m grid: a walker may graze an edge by less than half a cell, never more.
      const depth = (r: readonly (readonly [number, number])[]) => {
        let d = Number.POSITIVE_INFINITY;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [ax, az] = r[j];
          const ex = r[i][0] - ax;
          const ez = r[i][1] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
          d = Math.min(d, Math.hypot(ax + t * ex - x, az + t * ez - z));
        }
        return d;
      };
      const onCarpet = carpets.some((r) => inside(x, z, r) && depth(r) > 0.3) && !walkways.some((w) => inside(x, z, w));
      expect(onCarpet).toBe(false);
      expect(blocks.some((b) => inside(x, z, b))).toBe(false);
      for (const [cx, cz] of input.columns) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(COLUMN_R);
    }
    expect(placed).toBe(400);
  });

  it('no two walkers run into each other', () => {
    let closest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < crowd.n; a++) {
      for (let b = a + 1; b < crowd.n; b++) closest = Math.min(closest, Math.hypot(crowd.px[a] - crowd.px[b], crowd.pz[a] - crowd.pz[b]));
    }
    expect(closest).toBeGreaterThan(2 * BODY_R - 0.06);
  });

  it('they gather where the visitor looks: within the view, still clear of one another', () => {
    const near = new Crowd(input, 300, 5);
    const [cx, cz] = metresFromOrigin([39.6097, 24.4663]);
    near.keepNear(cx, cz, 80, 0);
    for (let t = 0; t < 10; t += 1 / 30) {
      near.step(1 / 30);
      near.keepNear(cx, cz, 80);
    }
    let within = 0;
    for (let a = 0; a < near.n; a++) {
      if (Math.hypot(near.px[a] - cx, near.pz[a] - cz) <= 1.3 * 80) within++;
      expect(near.standable(near.px[a], near.pz[a])).toBe(true);
    }
    expect(within).toBe(300);
  });

  it('they walk: at a person’s pace, most of them far from where they started', () => {
    let moved = 0;
    for (let a = 0; a < crowd.n; a++) {
      if (Math.hypot(crowd.px[a] - start[a][0], crowd.pz[a] - start[a][1]) > 20) moved++;
      expect(Math.hypot(crowd.vx[a], crowd.vz[a])).toBeLessThan(1.6);
    }
    expect(moved / crowd.n).toBeGreaterThan(0.6);
  });
});
