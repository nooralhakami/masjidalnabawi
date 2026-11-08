import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { POIS } from '../../src/data';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { rugLayout } from '../../src/map/rug-layout';
import { restroomDoor, walkPath } from '../../src/routing/walk';

const inside = (x: number, z: number, r: readonly (readonly [number, number])[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};
it('measure', () => {
  const t0 = Date.now();
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  const covered = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf)).covered.map((r) => {
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    return { r, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const gates = POIS.filter((p) => p.subCategory === 'gate_outer').filter((_, i) => i % 3 === 0);
  const dests = POIS.filter((p) => p.category === 'toilets' || p.subCategory === 'gate_inner');
  const rows: { g: number; d: number; m: number }[] = [];
  let n = 0;
  for (const g of gates) for (const d of dests) {
    n++;
    const to = (d.category === 'toilets' ? restroomDoor(d) : null) ?? ([d.lat, d.lng] as [number, number]);
    const path = walkPath([g.lat, g.lng], to);
    let m = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = metresFromOrigin([path[i][1], path[i][0]]);
      const b = metresFromOrigin([path[i + 1][1], path[i + 1][0]]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t < len; t += 1) {
        const x = a[0] + ((b[0] - a[0]) * t) / len, z = a[1] + ((b[1] - a[1]) * t) / len;
        if (covered.some((c) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && inside(x, z, c.r))) m++;
      }
    }
    if (m) rows.push({ g: g.id, d: d.id, m });
  }
  rows.sort((a, b) => b.m - a.m);
  writeFileSync('/private/tmp/claude-501/-Users-nooraddeen----------AI/d6262fb2-5350-4c7d-af82-406719bdfb56/scratchpad/cross.json', JSON.stringify({ secs: (Date.now() - t0) / 1000, gates: gates.length, dests: dests.length, n, crossing: rows.length, metres: rows.reduce((s, r) => s + r.m, 0), top: rows.slice(0, 12), byDest: Object.entries(rows.reduce((s: Record<number, number>, r) => ((s[r.d] = (s[r.d] ?? 0) + 1), s), {})).sort((a, b) => b[1] - a[1]).slice(0, 12) }));
}, 1_500_000);
