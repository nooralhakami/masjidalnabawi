import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fence from '../../data/haram-fence.json';
import { POIS } from '../../src/data';
import { parseGlbBuffer } from '../../src/map/glb-layer';

// The outer fence of the courtyards and its gates (owner, 2026-11-08): the Authority's line,
// matched with the owner's PDF before use. These pin what the PDF fixes: every gate 301-370 on an
// opening of the fence, in the PDF's order round it.

const KX = 111_320 * Math.cos((24.4685 * Math.PI) / 180);
const m = ([lng, lat]: readonly number[]): [number, number] => [lng * KX, lat * 111_320];
const ring = fence.runs.flatMap((r) => r.path.slice(1)).map(m);
const length = (p: [number, number][]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/** Distance from a point to the fence line, and how far round the ring its nearest point is. */
function onRing(q: [number, number]): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = L ? Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (L * L))) : 0;
    const d = Math.hypot(a[0] + (b[0] - a[0]) * t - q[0], a[1] + (b[1] - a[1]) * t - q[1]);
    if (d < best.d) best = { d, s: s + t * L };
    s += L;
  }
  return best;
}

describe('the outer fence of the courtyards (owner, 2026-11-08)', () => {
  it('one closed line, about 2.4 km, fence and gate openings in turn', () => {
    const first = m(fence.runs[0].path[0]);
    const last = m(fence.runs.at(-1)!.path.at(-1)!);
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(0.01);
    expect(length([...ring, ring[0]])).toBeGreaterThan(2300);
    expect(length([...ring, ring[0]])).toBeLessThan(2600);
    for (let i = 1; i < fence.runs.length; i++) expect(fence.runs[i].kind).not.toBe(fence.runs[i - 1].kind);
  });

  it('the seventy outer gates of the map, each on an opening of the fence', () => {
    const outer = POIS.filter((p) => p.subCategory === 'gate_outer').map((p) => p.id);
    expect(fence.gates.map((g) => g.id).sort()).toEqual(outer.sort());
    for (const g of fence.gates) {
      expect(fence.runs[g.opening].kind, `gate ${g.id}`).toBe('gate');
      expect(onRing(m(g.at)).d, `gate ${g.id}`).toBeLessThan(0.05);
    }
    // Every opening has its gate.
    const used = new Set(fence.gates.map((g) => g.opening));
    expect(fence.runs.filter((r, i) => r.kind === 'gate' && !used.has(i))).toEqual([]);
  });

  it('round the fence in the order of the PDF: 301 to 370', () => {
    const order = [...fence.gates].sort((a, b) => onRing(m(a.at)).s - onRing(m(b.at)).s).map((g) => g.id);
    const from = order.indexOf(301);
    const turned = [...order.slice(from), ...order.slice(0, from)];
    const ascending = turned[1] === 302 ? turned : [301, ...turned.slice(1).reverse()];
    expect(ascending).toEqual(Array.from({ length: 70 }, (_, i) => 301 + i));
  });
});

describe('the fence model (scripts/fence-model.mjs)', () => {
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-fence.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  const byMesh = (name: string) => gltf.nodes.filter((n) => n.mesh !== undefined && gltf.meshes[n.mesh].name === name).length;

  it('panels along the whole line, two pillars at every opening, a board for every gate', () => {
    expect(byMesh('Panel') * 2.4).toBeGreaterThan(1700);
    const openings = fence.runs.filter((r) => r.kind === 'gate').length;
    expect(byMesh('GatePillar')).toBeGreaterThanOrEqual(openings * 2);
    const signs = gltf.meshes.find((x) => x.name === 'Signs')!;
    const board = signs.primitives.find((p) => gltf.materials![p.material!].name === 'sign')!;
    expect(gltf.accessors[board.attributes.POSITION].count).toBe(fence.gates.length * 4);
  });

  it('the lattice and the spikes are cut out, not blended', () => {
    for (const name of ['lattice', 'spikes']) expect(gltf.materials!.find((x) => x.name === name)).toMatchObject({ alphaMode: 'MASK' });
  });
});
