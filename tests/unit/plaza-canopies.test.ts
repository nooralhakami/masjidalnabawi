import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../../src/data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, prayerBarriers } from '../../src/data-next/alharamain-prayers';
import { CANOPY_MOVE_MS, canopyFoldAt, canopyFolding, foldCanopyVertex, metresFromOrigin, nodeShift, parseGlbBuffer } from '../../src/map/glb-layer';
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
  it("covers every plaza area exactly (sectors, annex, its prayer areas, the courtyards' prayer areas)", () => {
    const plazas = alharamainPlaza().features;
    expect(plazas).toHaveLength(18);
    expect(ALHARAMAIN_PRAYERS).toHaveLength(55);
    const rings = [
      ...plazas.map((f) => f.geometry.coordinates[0].slice(0, -1).map((ll) => metresFromOrigin(ll as [number, number]))),
      ...ALHARAMAIN_PRAYERS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number]))),
    ];
    const { vertices, indices } = plazaMesh();
    expect(vertices.length / 5).toBe(rings.reduce((n, r) => n + r.length, 0));
    const pts: [number, number][] = [];
    for (let i = 0; i < vertices.length; i += 5) pts.push([vertices[i], vertices[i + 1]]);
    // Granite sectors, the concrete western annex, its carpeted prayer areas, the courtyards' ones.
    const kinds = new Set<number>();
    for (let i = 2; i < vertices.length; i += 5) kinds.add(vertices[i]);
    expect([...kinds].sort()).toEqual([0, 1, 2, 3]);
    const total = rings.reduce((s, r) => s + ringArea(r), 0);
    expect(triArea(pts, indices)).toBeCloseTo(total, -1);
    // Each area's carpets start from its own north-west corner.
    for (let i = 0; i < vertices.length; i += 5) {
      expect(vertices[i + 3]).toBeLessThanOrEqual(vertices[i] + 1e-3);
      expect(vertices[i + 4]).toBeLessThanOrEqual(vertices[i + 1] + 1e-3);
    }
  });
});

describe("the courtyards' prayer areas (navQ, owner 2026-11-06)", () => {
  it('lie in the courtyards, inside the Haram, and are ringed by green barriers just outside them', () => {
    for (const ring of ALHARAMAIN_PRAYERS) {
      for (const [lng, lat] of ring) {
        expect(lng).toBeGreaterThan(39.6078);
        expect(lng).toBeLessThan(39.6144);
        expect(lat).toBeGreaterThan(24.4674);
        expect(lat).toBeLessThan(24.4711);
      }
    }
    const barriers = prayerBarriers().features;
    expect(barriers.length).toBeGreaterThan(1000);
    const inside = (x: number, y: number, r: readonly (readonly [number, number])[]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    // Every section stands outside its area (never on the carpets), about 2 m long.
    for (const f of barriers.slice(0, 400)) {
      const [a, b, c] = f.geometry.coordinates[0];
      const mid: [number, number] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      expect(ALHARAMAIN_PRAYERS.some((r) => inside(mid[0], mid[1], r))).toBe(false);
      const len = Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 111_320);
      expect(len).toBeGreaterThan(0.4);
      expect(len).toBeLessThan(2.7);
    }
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

describe('a canopy opens and closes at a tap (owner, 2026-11-06)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

  it('the 243 canopies with fabric can be tapped; the 75 lamp columns of the south courtyard cannot', () => {
    const folding = canopyFolding(gltf)!;
    const nodes = gltf.nodes.filter((n) => n.mesh !== undefined);
    const tappable = nodes.filter((n) => folding.open.has(n.mesh!) || n.mesh === folding.closed);
    expect(tappable).toHaveLength(243);
    const lamps = nodes.filter((n) => !folding.open.has(n.mesh!) && n.mesh !== folding.closed);
    expect(lamps).toHaveLength(75);
    expect(lamps.every((n) => /CanopyOpen/.test(n.name ?? ''))).toBe(true);
  });

  it('moves like a motor: starts gently, ends in place, never past it, in six seconds', () => {
    expect(canopyFoldAt(0, 1, 0)).toBe(0);
    expect(canopyFoldAt(0, 1, CANOPY_MOVE_MS)).toBe(1);
    expect(canopyFoldAt(0, 1, CANOPY_MOVE_MS * 0.1)).toBeLessThan(0.02);
    expect(canopyFoldAt(0, 1, CANOPY_MOVE_MS / 2)).toBeCloseTo(0.5, 5);
    let last = 0;
    for (let ms = 0; ms <= CANOPY_MOVE_MS; ms += 100) {
      const f = canopyFoldAt(0, 1, ms);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f).toBeLessThanOrEqual(1);
      last = f;
    }
    // Closing from half way takes half the time.
    expect(canopyFoldAt(0.5, 0, CANOPY_MOVE_MS / 2)).toBe(0);
  });

  it('folds each arm upright about the column top: open as drawn, folded into a tall narrow bundle, the column itself never moves', () => {
    const axis = [-0.72, -0.72, 9.16] as const;
    const tip: [number, number, number] = [12, 15.5, 0];
    expect(foldCanopyVertex(tip, 1, axis)).toEqual(tip);
    const folded = foldCanopyVertex(tip, 0, axis);
    const r = (p: readonly number[]) => Math.hypot(p[0] - axis[0], p[2] - axis[1]);
    expect(r(folded)).toBeLessThan(2);
    expect(folded[1]).toBeGreaterThan(17);
    expect(folded[1]).toBeLessThan(20.5);
    // Half way the root has opened further than the tip: the fabric unfurls outwards.
    const root: [number, number, number] = [3, 10, 0];
    const slope = (p: readonly number[]) => Math.atan2(p[1] - axis[2], r(p));
    const half = 0.5;
    expect(slope(foldCanopyVertex(root, half, axis)) - slope(root)).toBeLessThan(slope(foldCanopyVertex(tip, half, axis)) - slope(tip));
    // The column and its lantern stay where they are.
    for (const p of [
      [-0.72, 4, -0.72],
      [0.2, 8, -0.5],
    ] as [number, number, number][]) {
      expect(foldCanopyVertex(p, 0, axis)).toEqual(p);
    }
  });
});
