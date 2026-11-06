import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../../src/data-next/alharamain-3d';
import { canopyFolding, metresFromOrigin, nodeShift, parseGlbBuffer } from '../../src/map/glb-layer';
import { plazaMesh } from '../../src/map/plaza-layer';
import { triangulate } from '../../src/map/polygon';

const triArea = (pts: [number, number][], tri: ArrayLike<number>, base = 0) => {
  let sum = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [pts[tri[i] - base], pts[tri[i + 1] - base], pts[tri[i + 2] - base]];
    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return sum;
};
const ringArea = (pts: [number, number][]) => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;

describe('triangulate', () => {
  it('covers an L-shaped outline exactly, in either winding', () => {
    const l: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ];
    for (const ring of [l, [...l].reverse()]) expect(triArea(ring, triangulate(ring))).toBeCloseTo(400);
  });
});

describe('plazaMesh (the marble)', () => {
  it('covers every plaza area exactly (sectors, annex, prayer areas)', () => {
    const plazas = alharamainPlaza().features;
    expect(plazas).toHaveLength(18);
    const rings = plazas.map((f) => f.geometry.coordinates[0].slice(0, -1).map((ll) => metresFromOrigin(ll as [number, number])));
    const { vertices, indices } = plazaMesh();
    expect(vertices.length / 3).toBe(rings.reduce((n, r) => n + r.length, 0));
    const pts: [number, number][] = [];
    for (let i = 0; i < vertices.length; i += 3) pts.push([vertices[i], vertices[i + 1]]);
    // Granite sectors, the concrete western annex, and its carpeted prayer areas.
    const kinds = new Set<number>();
    for (let i = 2; i < vertices.length; i += 3) kinds.add(vertices[i]);
    expect([...kinds].sort()).toEqual([0, 1, 2]);
    const total = rings.reduce((s, r) => s + ringArea(r), 0);
    expect(triArea(pts, indices)).toBeCloseTo(total, -1);
  });
});

describe('canopyFolding (canopies fold at night)', () => {
  const buf = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  it("folds only navQ's open canopies (with their fabric), into the file's own folded canopy", () => {
    const folding = canopyFolding(gltf)!;
    expect(folding.closed).toBe(1);
    expect([...folding.open].sort()).toEqual([0, 3]);
    // 30 open canopies; the 75 lamp posts (named open, without fabric) stay as they are.
    expect(gltf.nodes.filter((n) => n.mesh !== undefined && folding.open.has(n.mesh))).toHaveLength(30);
  });

  it('leaves the Mosque and the service blocks alone', () => {
    const mosque = readFileSync(resolve(__dirname, '../../public/models/haram-3d.glb'));
    expect(canopyFolding(parseGlbBuffer(mosque.buffer.slice(mosque.byteOffset, mosque.byteOffset + mosque.byteLength)).gltf)).toBeNull();
  });
});

describe('the west canopies by restrooms 213-218 (owner, 2026-11-06)', () => {
  it('stand 7 m south of navQ, clear of the restroom blocks: 44 of them, 5 columns by 9 rows, and no other moves', () => {
    const model = ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!;
    const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
    const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    const [east0, south0] = metresFromOrigin(model.anchors[0]);
    const turn = (model.rotation * Math.PI) / 180;
    const moved: [number, number][] = [];
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue;
      const [x, , z] = node.matrix ? [node.matrix[12], node.matrix[13], node.matrix[14]] : (node.translation ?? [0, 0, 0]);
      const east = east0 + x * Math.cos(turn) - z * Math.sin(turn);
      const south = south0 + x * Math.sin(turn) + z * Math.cos(turn);
      const d = nodeShift(model, east, south);
      if (d[0] === 0 && d[1] === 0) continue;
      expect(d).toEqual([0, 7]);
      moved.push([east, south]);
    }
    expect(moved).toHaveLength(44);
    // Columns and rows 24 m apart; navQ's places wander a metre or two.
    const lines = (v: number[]) => v.sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1] > 5).length;
    expect(lines(moved.map(([e]) => e))).toBe(5);
    expect(lines(moved.map(([, s]) => s))).toBe(9);
  });
});
