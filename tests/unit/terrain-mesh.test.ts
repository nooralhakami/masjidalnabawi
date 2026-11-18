import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTerrainMesh, CITY_RISE_M, parseTerrain, STRIDE } from '../../src/map/terrain-mesh';

describe('buildTerrainMesh', () => {
  it('draws the terrain only where the ground rises', () => {
    const flat = buildTerrainMesh({ cols: 3, rows: 3, x0: 0, z0: 0, step: 100, heights: new Float32Array(9) });
    expect(flat.indices).toHaveLength(0);
    const hill = buildTerrainMesh({ cols: 3, rows: 3, x0: 0, z0: 0, step: 100, heights: new Float32Array([0, 0, 0, 0, 50 + CITY_RISE_M, 0, 0, 0, 0]) });
    expect(hill.indices).toHaveLength(4 * 6);
    expect(hill.vertices[4 * STRIDE + 1]).toBe(50);
  });

  it('leaves the city’s gentle rises to the imagery: no flat brown plates (owner, 2026-11-18)', () => {
    const rise = buildTerrainMesh({ cols: 3, rows: 3, x0: 0, z0: 0, step: 120, heights: new Float32Array([5, 12, 20, 8, CITY_RISE_M, 30, 3, 9, 14]) });
    expect(rise.indices).toHaveLength(0);
  });

  it('turns the normals away from the slope', () => {
    // Rising to the east: the normal leans west (negative X) and stays up.
    const ramp = buildTerrainMesh({ cols: 3, rows: 1, x0: 0, z0: 0, step: 10, heights: new Float32Array([0, 10, 20].map((h) => h + CITY_RISE_M)) });
    expect(ramp.vertices[STRIDE + 3]).toBeLessThan(0);
    expect(ramp.vertices[STRIDE + 4]).toBeGreaterThan(0);
  });
});

describe('the generated mountains (scripts/terrain-from-srtm.py)', () => {
  const models = resolve(__dirname, '../../public/models');

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

  it('draws nothing within 2.5 km of the Haram, where the brown plates were', () => {
    const buf = readFileSync(resolve(models, 'madinah-terrain.bin'));
    const mesh = buildTerrainMesh(parseTerrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    let near = 0;
    for (const i of mesh.indices) {
      const x = mesh.vertices[i * STRIDE];
      const z = mesh.vertices[i * STRIDE + 2];
      if (Math.hypot(x + 60, z + 200) < 2500) near++;
    }
    expect(near).toBe(0);
    expect(mesh.indices.length).toBeGreaterThan(30_000);
  });

  it('draws no buildings round the Haram (owner, 2026-11-04: until they come with exact positions)', () => {
    expect(existsSync(resolve(models, 'madinah-city.json'))).toBe(false);
  });
});
