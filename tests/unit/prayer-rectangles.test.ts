import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { WOMEN_AREAS } from '../../src/data-next/women-areas';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { MIN_RUGS, RUG_TURN, RUG_W, largestRectangle, rugLayout } from '../../src/map/rug-layout';
import { PANEL, womenBarriers } from '../../src/map/women-barriers';

describe('prayer areas only as squares and rectangles (owner, 2026-11-07)', () => {
  it('the largest rectangle starts and ends on whole groups of rows', () => {
    const on = [
      [true, true, false, false],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
    ];
    // Any rows: the bottom three, all four columns.
    expect(
      largestRectangle(
        on,
        () => true,
        () => true,
      ),
    ).toEqual({ r0: 1, r1: 3, c0: 0, c1: 3 });
    // From row 0 only: two columns, four rows.
    expect(
      largestRectangle(
        on,
        (r) => r === 0,
        () => true,
      ),
    ).toEqual({ r0: 0, r1: 3, c0: 0, c1: 1 });
    expect(
      largestRectangle(
        [[false]],
        () => true,
        () => true,
      ),
    ).toBeNull();
  });

  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const layout = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf));

  it(`no small patch of carpets: every laid patch (carpets, the columns' spots, the gaps between groups) holds at least ${MIN_RUGS}`, () => {
    // In the carpets' own laid frame, so the check does not depend on the qibla turn (D5).
    const laid = (p: readonly [number, number]): [number, number] => [Math.cos(RUG_TURN) * p[0] - Math.sin(RUG_TURN) * p[1], Math.sin(RUG_TURN) * p[0] + Math.cos(RUG_TURN) * p[1]];
    // The laid cells: centre, and depth (a carpet's row or a group's gap).
    const cells = layout.covered.map((r) => {
      const pts = r.map(laid);
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, d: Math.max(...zs) - Math.min(...zs) - 0.09 };
    });
    const touch = (a: number, b: number) => {
      const dx = Math.abs(cells[a].x - cells[b].x);
      const dz = Math.abs(cells[a].z - cells[b].z);
      return (dx < RUG_W + 0.3 && dz < 0.3) || (dx < 0.3 && dz < (cells[a].d + cells[b].d) / 2 + 0.3);
    };
    const key = (x: number, z: number) => `${Math.floor(x / 6)}|${Math.floor(z / 6)}`;
    const hash = new Map<string, number[]>();
    cells.forEach((c, k) => hash.set(key(c.x, c.z), [...(hash.get(key(c.x, c.z)) ?? []), k]));
    const rugAt = new Set(
      layout.rugs.map((r) => {
        const [x, z] = laid([r.x, r.z]);
        return key(x, z) + '|' + Math.round(x * 2) + '|' + Math.round(z * 2);
      }),
    );
    const isRug = (c: (typeof cells)[number]) => rugAt.has(key(c.x, c.z) + '|' + Math.round(c.x * 2) + '|' + Math.round(c.z * 2));
    const seen = new Uint8Array(cells.length);
    let smallest = Number.POSITIVE_INFINITY;
    for (let s = 0; s < cells.length; s++) {
      if (seen[s]) continue;
      const stack = [s];
      seen[s] = 1;
      let rugs = 0;
      while (stack.length) {
        const a = stack.pop()!;
        if (isRug(cells[a])) rugs++;
        const ci = Math.floor(cells[a].x / 6);
        const cj = Math.floor(cells[a].z / 6);
        for (let i = ci - 1; i <= ci + 1; i++)
          for (let j = cj - 1; j <= cj + 1; j++)
            for (const b of hash.get(`${i}|${j}`) ?? [])
              if (!seen[b] && touch(a, b)) {
                seen[b] = 1;
                stack.push(b);
              }
      }
      smallest = Math.min(smallest, rugs);
    }
    expect(smallest).toBeGreaterThanOrEqual(MIN_RUGS);
  });
});

describe('the beige barriers round the women’s areas (owner, 2026-11-07)', () => {
  const panels = womenBarriers().features;
  it('panels of 2 m, 1.1 m high, along every run, leaving the entrances open', () => {
    expect(panels.length).toBeGreaterThan(100);
    for (const p of panels) {
      expect(p.properties.height).toBe(PANEL.height);
      const ring = p.geometry.coordinates[0].map((ll) => metresFromOrigin(ll as [number, number]));
      const long = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
      expect(long).toBeGreaterThan(1.4);
      expect(long).toBeLessThan(2.8);
    }
    // Every run is covered end to end (to within a panel's gap).
    let total = 0;
    for (const a of WOMEN_AREAS)
      for (const run of a.barriers) {
        const [ax, az] = metresFromOrigin([run[0][1], run[0][0]]);
        const [bx, bz] = metresFromOrigin([run[1][1], run[1][0]]);
        total += Math.hypot(bx - ax, bz - az);
      }
    const panelled = panels.reduce((s, p) => {
      const r = p.geometry.coordinates[0].map((ll) => metresFromOrigin(ll as [number, number]));
      return s + Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) + PANEL.gap;
    }, 0);
    expect(Math.abs(panelled - total)).toBeLessThan(1);
  });
});
