import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCityMesh, KIND_ROOF, KIND_TERRAIN, KIND_WALL, parseTerrain, STRIDE, triangulate } from '../../src/map/city-mesh';

const area = (pts: [number, number][], tri: number[]) => {
  let sum = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [pts[tri[i]], pts[tri[i + 1]], pts[tri[i + 2]]];
    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return sum;
};

describe('triangulate (flat roofs)', () => {
  it('covers an L-shaped footprint exactly, in either winding', () => {
    const l: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    for (const ring of [l, [...l].reverse()]) {
      const tri = triangulate(ring);
      expect(tri).toHaveLength(12);
      expect(area(ring, tri)).toBeCloseTo(400);
    }
  });
});

describe('buildCityMesh', () => {
  it('gives each building four corners per wall and its roof', () => {
    const mesh = buildCityMesh([[30, 50, 0, 0, 10, 0, 10, 10, 0, 10]], null);
    const kinds = [];
    for (let i = 0; i < mesh.vertices.length; i += STRIDE) kinds.push(mesh.vertices[i + 10]);
    expect(kinds.filter((k) => k === KIND_WALL)).toHaveLength(16);
    expect(kinds.filter((k) => k === KIND_ROOF)).toHaveLength(4);
    expect(mesh.indices).toHaveLength(4 * 6 + 2 * 3);
  });

  it('turns every wall outward', () => {
    const mesh = buildCityMesh([[10, 0, 0, 0, 0, 10, 10, 10, 10, 0]], null);
    for (let i = 0; i < 16; i++) {
      const o = i * STRIDE;
      const [x, z, nx, nz] = [mesh.vertices[o], mesh.vertices[o + 2], mesh.vertices[o + 3], mesh.vertices[o + 5]];
      // The edge's middle sits away from (5, 5) in the direction of its normal.
      expect(nx * (x - 5) + nz * (z - 5)).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws the terrain only where the ground rises', () => {
    const flat = buildCityMesh([], { cols: 3, rows: 3, x0: 0, z0: 0, step: 100, heights: new Float32Array(9) });
    expect(flat.indices).toHaveLength(0);
    const hill = buildCityMesh([], { cols: 3, rows: 3, x0: 0, z0: 0, step: 100, heights: new Float32Array([0, 0, 0, 0, 50, 0, 0, 0, 0]) });
    expect(hill.indices).toHaveLength(4 * 6);
    expect(hill.vertices[4 * STRIDE + 1]).toBe(50);
    expect(hill.vertices[4 * STRIDE + 10]).toBe(KIND_TERRAIN);
  });
});

describe('the generated surroundings (scripts/city-from-osm.py)', () => {
  const models = resolve(__dirname, '../../public/models');

  it('keeps the buildings out of the Haram, at believable heights', () => {
    const { buildings } = JSON.parse(readFileSync(resolve(models, 'madinah-city.json'), 'utf8')) as { buildings: number[][] };
    expect(buildings.length).toBeGreaterThan(400);
    for (const b of buildings) {
      expect(b[0]).toBeGreaterThan(2);
      expect(b[0]).toBeLessThan(250);
      expect(b.length % 2).toBe(0);
      expect(b.length).toBeGreaterThanOrEqual(8);
      // The Haram the script leaves out (plazas included), a few metres inside its edge: no centre in it.
      const xs = b.slice(2).filter((_, i) => i % 2 === 0);
      const zs = b.slice(2).filter((_, i) => i % 2 === 1);
      const cx = xs.reduce((s, x) => s + x, 0) / xs.length;
      const cz = zs.reduce((s, z) => s + z, 0) / zs.length;
      const inHaram = cx > -740 && cx < 285 && cz > -495 && cz < 185;
      expect(inHaram).toBe(false);
    }
  });

  it('raises Uhud about 470 m over the Haram, north of it, and leaves the centre flat', () => {
    const buf = readFileSync(resolve(models, 'madinah-terrain.bin'));
    const t = parseTerrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let top = 0;
    let topZ = 0;
    for (let i = 0; i < t.heights.length; i++) {
      if (t.heights[i] > top) {
        top = t.heights[i];
        topZ = t.z0 + Math.floor(i / t.cols) * t.step;
      }
    }
    expect(top).toBeGreaterThan(400);
    expect(top).toBeLessThan(520);
    expect(topZ).toBeLessThan(-3000);
    const c = Math.round(-t.x0 / t.step);
    const r = Math.round(-t.z0 / t.step);
    expect(t.heights[r * t.cols + c]).toBe(0);
  });
});
