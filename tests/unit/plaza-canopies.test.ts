import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../../src/data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, PRAYER_CLEARINGS } from '../../src/data-next/alharamain-prayers';
import { restroomFootprints, restroomWalkways } from '../../src/map/prayer-layout';
import { GROUP_GAP, RUG_D, RUG_TURN, RUG_W, rugLayout } from '../../src/map/rug-layout';
import { QIBLA_BEARING } from '../../src/domain/frames';
import { CANOPY_MOVE_MS, canopyFoldAt, canopyFolding, foldCanopyVertex, metresFromOrigin, nodePositions, nodeShift, parseGlbBuffer } from '../../src/map/glb-layer';
import { plazaMesh } from '../../src/map/plaza-layer';
import { triangulate } from '../../src/map/polygon';

/** The canopy and lamp columns (the carpets keep clear of them), as the 3D layer reads them. */
const COLUMNS = (() => {
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  return nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
})();
const LAYOUT = rugLayout(COLUMNS);
const insideRing = (x: number, y: number, r: readonly (readonly [number, number])[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};

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
    expect(ALHARAMAIN_PRAYERS).toHaveLength(57); // navQ's 55 and the 2 the owner added (2026-11-07)
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
    const barriers = LAYOUT.barriers.features;
    expect(barriers.length).toBeGreaterThan(1000);
    // Every section stands off the carpets, about 2 m long.
    const covered = LAYOUT.covered;
    for (const f of barriers.slice(0, 600)) {
      const [a, b, c] = f.geometry.coordinates[0];
      const [x, z] = metresFromOrigin([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
      expect(covered.some((r) => insideRing(x, z, r))).toBe(false);
      const len = Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 111_320);
      expect(len).toBeGreaterThan(0.4);
      expect(len).toBeLessThan(2.8);
    }
  });
});

describe('the prayer carpets, laid whole (owner, 2026-11-07)', () => {
  // The carpets' own frame: rows toward the qibla (D5, 2026-11-12), not the canopies' turn.
  const t = RUG_TURN;
  const corners = (x: number, z: number): [number, number][] =>
    [
      [-RUG_W / 2, -RUG_D / 2],
      [RUG_W / 2, -RUG_D / 2],
      [RUG_W / 2, RUG_D / 2],
      [-RUG_W / 2, RUG_D / 2],
    ].map(([u, v]) => [x + Math.cos(t) * u + Math.sin(t) * v, z - Math.sin(t) * u + Math.cos(t) * v]);
  const areas = ALHARAMAIN_PRAYERS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number])));
  const open = [...restroomWalkways(), ...PRAYER_CLEARINGS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number]))), ...restroomFootprints()];
  const cols = COLUMNS.map((ll) => metresFromOrigin(ll as [number, number]));

  it('thousands of 5 m by 1.2 m carpets, each whole inside its area, none over a walkway, a cleared corridor, a restroom or a column', () => {
    const court = LAYOUT.rugs.filter((r) => r.courtyard);
    expect(court.length).toBeGreaterThan(2000);
    for (const rug of court) {
      const cs = corners(rug.x, rug.z);
      expect(areas.some((a) => cs.every(([x, z]) => insideRing(x, z, a)))).toBe(true);
      for (const [x, z] of [...cs, [rug.x, rug.z] as [number, number]]) expect(open.some((w) => insideRing(x, z, w))).toBe(false);
      for (const [cx, cz] of cols) expect(Math.hypot(cx - rug.x, cz - rug.z)).toBeGreaterThan(0.6);
    }
  });

  it('no two carpets overlap; rows 1.2 m apart in groups of three, 0.8 m of floor between groups', () => {
    const rugs = LAYOUT.rugs;
    const byRow = new Map<number, number>();
    const hash = new Map<string, number[]>();
    rugs.forEach((r, i) => {
      const k = `${Math.floor(r.x / 6)}|${Math.floor(r.z / 6)}`;
      hash.set(k, [...(hash.get(k) ?? []), i]);
    });
    for (let i = 0; i < rugs.length; i++) {
      const hx = Math.floor(rugs[i].x / 6);
      const hz = Math.floor(rugs[i].z / 6);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const j of hash.get(`${hx + a}|${hz + b}`) ?? []) {
            if (j <= i) continue;
            const dx = rugs[i].x - rugs[j].x;
            const dz = rugs[i].z - rugs[j].z;
            // In the carpets' own frame: apart by a whole carpet across, or a whole row deep.
            const u = Math.abs(Math.cos(t) * dx - Math.sin(t) * dz);
            const v = Math.abs(Math.sin(t) * dx + Math.cos(t) * dz);
            expect(u >= RUG_W - 1e-3 || v >= RUG_D - 1e-3).toBe(true);
            if (u < 0.01 && v < 3 * RUG_D + GROUP_GAP + 0.01) byRow.set(Math.round(v * 100), (byRow.get(Math.round(v * 100)) ?? 0) + 1);
          }
        }
      }
    }
    // Neighbours in a column: 1.2 m (in a group) or 2.0 m (across the gap between groups).
    expect(byRow.has(Math.round(RUG_D * 100))).toBe(true);
    expect(byRow.has(Math.round((RUG_D + GROUP_GAP) * 100))).toBe(true);
  });

  it('rows run toward the qibla: bearing 176.24°, within half a degree (D5, 2026-11-12)', () => {
    const rugs = LAYOUT.rugs;
    const hash = new Map<string, number[]>();
    rugs.forEach((r, i) => {
      const k = `${Math.floor(r.x / 6)}|${Math.floor(r.z / 6)}`;
      hash.set(k, [...(hash.get(k) ?? []), i]);
    });
    let checked = 0;
    for (let i = 0; i < rugs.length; i++) {
      const hx = Math.floor(rugs[i].x / 6);
      const hz = Math.floor(rugs[i].z / 6);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const j of hash.get(`${hx + a}|${hz + b}`) ?? []) {
            if (j === i) continue;
            const dx = rugs[j].x - rugs[i].x;
            const dz = rugs[j].z - rugs[i].z;
            if (Math.abs(Math.hypot(dx, dz) - RUG_D) > 0.01) continue; // the next carpet along the row
            // Bearing in the model frame (x east, z south), either way along the row.
            const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
            const off = Math.min(Math.abs(bearing - QIBLA_BEARING), Math.abs(bearing - ((QIBLA_BEARING + 180) % 360)));
            expect(off).toBeLessThan(0.5);
            checked++;
          }
    }
    expect(checked).toBeGreaterThan(1000);
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
    // It opens from the bottom up (owner, 2026-11-06): half way, the part of the arm near the column
    // lies open while the part beyond still stands upright above it.
    const near: [number, number, number] = [5, 11, 0];
    const far: [number, number, number] = [11, 14, 0];
    const mid = 0.35;
    expect(foldCanopyVertex(near, mid, axis)[1]).toBeCloseTo(near[1], 0);
    const f = foldCanopyVertex(far, mid, axis);
    expect(f[1]).toBeGreaterThan(far[1] + 1.5);
    expect(r(f)).toBeLessThan(r(far) - 3);
    // The column and its lantern stay where they are.
    for (const p of [
      [-0.72, 4, -0.72],
      [0.2, 8, -0.5],
    ] as [number, number, number][]) {
      expect(foldCanopyVertex(p, 0, axis)).toEqual(p);
    }
  });
});

describe('a 10 m walkway in front of each restroom, toward the Haram (owner, 2026-11-06)', () => {
  const walks = restroomWalkways();
  const centre = (w: readonly (readonly [number, number])[]) => [w.reduce((s, p) => s + p[0], 0) / 4, w.reduce((s, p) => s + p[1], 0) / 4];

  it('one per block, 10 m deep along its whole face', () => {
    expect(walks).toHaveLength(40); // every restroom block (the 42 placements include the Mosque and the canopies)
    for (const w of walks) {
      expect(Math.hypot(w[2][0] - w[1][0], w[2][1] - w[1][1])).toBeCloseTo(10, 5);
      const face = Math.hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]);
      expect([14, 23.2, 23].some((f) => Math.abs(face - f) < 0.3)).toBe(true);
    }
  });

  it('on the face toward the Mosque: south of the north row (229), west of the east blocks (236), north of the south row (203)', () => {
    const near = (lng: number, lat: number) => {
      const [x, z] = metresFromOrigin([lng, lat]);
      return walks.reduce((best, w) => {
        const [cx, cz] = centre(w);
        return Math.hypot(cx - x, cz - z) < Math.hypot(centre(best)[0] - x, centre(best)[1] - z) ? w : best;
      });
    };
    // Block centres (the restroom markers stand in their middles).
    const [x229, z229] = metresFromOrigin([39.612645, 24.470307]);
    const w229 = near(39.612645, 24.470307 - 0.0001);
    expect(centre(w229)[1] - z229).toBeGreaterThan(11);
    const [x236, z236] = metresFromOrigin([39.614172, 24.468551]);
    const w236 = near(39.614172 - 0.0001, 24.468551);
    expect(centre(w236)[0] - x236).toBeLessThan(-7);
    expect(Math.abs(centre(w236)[1] - z236)).toBeLessThan(3);
    const [, z203] = metresFromOrigin([39.611646, 24.466825]);
    const w203 = near(39.611646, 24.466825 + 0.0001);
    expect(centre(w203)[1] - z203).toBeLessThan(-11);
    expect(Math.abs(x229)).toBeGreaterThan(0);
  });

  it('no barrier stands in a walkway', () => {
    const inside = (x: number, y: number, r: readonly (readonly [number, number])[]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    for (const f of LAYOUT.barriers.features) {
      const [a, , c] = f.geometry.coordinates[0];
      const [x, z] = metresFromOrigin([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
      expect(walks.some((w) => inside(x, z, w))).toBe(false);
    }
  });
});

describe('the north corridor starts at the back of the restrooms (owner, 2026-11-06)', () => {
  it('the northern row of prayer areas reaches half way across navQ corridor, no further', () => {
    const north = ALHARAMAIN_PRAYERS.filter((r) => Math.max(...r.map((p) => p[1])) > 24.4709);
    expect(north).toHaveLength(9);
    for (const r of north) {
      const south = Math.min(...r.map((p) => p[1]));
      // navQ had them end at about 24.47083; the corridor's middle lies near 24.47078-24.47079.
      expect(south).toBeLessThan(24.4708);
      expect(south).toBeGreaterThan(24.47076);
    }
  });
});

describe("the owner's marks on the top view of the prayer areas (2026-11-07)", () => {
  it('16 corridors cleared of carpets, with no barrier across them; 2 prayer areas added', () => {
    expect(PRAYER_CLEARINGS).toHaveLength(16);
    const walks = PRAYER_CLEARINGS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number])));
    const inside = (x: number, z: number, r: readonly (readonly [number, number])[]) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      return c;
    };
    for (const f of LAYOUT.barriers.features) {
      const [a, , c] = f.geometry.coordinates[0];
      const [x, z] = metresFromOrigin([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
      expect(walks.some((w) => inside(x, z, w))).toBe(false);
    }
    // The long corridor across the north, about 590 m by 12 m.
    const [w, n] = metresFromOrigin(PRAYER_CLEARINGS[0][0] as [number, number]);
    const [e, s] = metresFromOrigin(PRAYER_CLEARINGS[0][2] as [number, number]);
    expect(e - w).toBeGreaterThan(560);
    expect(s - n).toBeGreaterThan(10);
    expect(s - n).toBeLessThan(15);
  });
});
