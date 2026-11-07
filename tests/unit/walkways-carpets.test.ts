import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import routing from '../../data/routing.json';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { rugLayout } from '../../src/map/rug-layout';

const inside = (x: number, z: number, r: readonly (readonly [number, number])[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};

describe('walking routes keep off the prayer carpets (owner, 2026-11-07)', () => {
  it('the walkways the routes follow cross no laid carpet', () => {
    const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
    const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
    const covered = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf)).covered;
    const lines: [string, number[][]][] = [['ring', [...routing.walkway_ring, routing.walkway_ring[0]]], ...routing.walkways.map((w) => [w.id, w.path] as [string, number[][]])];
    const over: Record<string, number> = {};
    for (const [id, path] of lines) {
      for (let i = 0; i + 1 < path.length; i++) {
        const a = metresFromOrigin([path[i][1], path[i][0]]);
        const b = metresFromOrigin([path[i + 1][1], path[i + 1][0]]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t <= len; t += 1) {
          const x = a[0] + ((b[0] - a[0]) * t) / len;
          const z = a[1] + ((b[1] - a[1]) * t) / len;
          if (covered.some((r) => inside(x, z, r))) over[id] = (over[id] ?? 0) + 1;
        }
      }
    }
    expect(over).toEqual({});
  });
});
