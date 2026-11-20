import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import doors3dRaw from '../../data/mosque-doors-3d.json';
import { DOOR_SWING_MS, RECESSED_PORCH_GATES, buildDoorCutBoxes, buildDoorKitMatrices, doorSwingAt, getMosqueDoors, resetMosqueDoors } from '../../src/domain/mosque-doors';
import { parseGlbBuffer } from '../../src/map/glb-layer';
import { materialGlow } from '../../src/map/scene-light';

const ROOT = join(__dirname, '../..');

afterEach(() => resetMosqueDoors());

describe('Stage 3: Real Swinging 3D Mosque Doors (haram-doors-kit & mosque-doors-3d)', () => {
  it('data/mosque-doors-3d.json has valid provenance, exact gate/bay counts, and zero overlaps (< 2.5 m)', () => {
    expect(doors3dRaw.source.haram3dSha256).toMatch(/^[a-f0-9]{64}$/);
    const gates = getMosqueDoors();
    expect(gates).toHaveLength(42);

    const allBays = gates.flatMap((g) => g.bays);
    expect(allBays).toHaveLength(83);

    const byCount = new Map<number, number>();
    for (const g of gates) byCount.set(g.totalBays, (byCount.get(g.totalBays) ?? 0) + 1);
    expect(byCount.get(5)).toBe(7);
    expect(byCount.get(3)).toBe(3);
    expect(byCount.get(2)).toBe(7);
    expect(byCount.get(1)).toBe(25);

    for (let i = 0; i < allBays.length; i++) {
      for (let j = i + 1; j < allBays.length; j++) {
        const d = Math.hypot(allBays[i].x - allBays[j].x, allBays[i].y - allBays[j].y);
        expect(d, `bay ${allBays[i].gateId}:${allBays[i].bayIndex} vs ${allBays[j].gateId}:${allBays[j].bayIndex}`).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it('haram-doors-kit.glb exposes 4 named open-through meshes, packed texture + UVs, identity nodes, and stays <= 250 KB gzipped', () => {
    const raw = readFileSync(join(ROOT, 'public/models/haram-doors-kit.glb'));
    const gz = gzipSync(raw);
    expect(gz.byteLength).toBeLessThanOrEqual(250_000);

    const { gltf, bin } = parseGlbBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
    const meshNames = gltf.meshes.map((m) => m.name).sort();
    expect(meshNames).toEqual(['DoorLeafLeft', 'DoorLeafRight', 'DoorPortalFrame', 'DoorStarFloor', 'DoorThresholdGlow']);
    expect((gltf as { images?: unknown[] }).images?.length ?? 0).toBeGreaterThanOrEqual(1);

    for (const name of ['DoorLeafLeft', 'DoorLeafRight', 'DoorPortalFrame', 'DoorStarFloor']) {
      const m = gltf.meshes.find((x) => x.name === name)!;
      expect(
        m.primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined),
        `${name} TEXCOORD_0`,
      ).toBe(true);
    }

    // Verify DoorPortalFrame is open through the central passage (no opaque back wall blocking open entry).
    const frameMesh = gltf.meshes.find((m) => m.name === 'DoorPortalFrame')!;
    const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    let blockingBackVerts = 0;
    for (const prim of frameMesh.primitives) {
      const posAcc = gltf.accessors[prim.attributes.POSITION] as { bufferView: number; byteOffset?: number; count: number };
      const bv = gltf.bufferViews[posAcc.bufferView] as { byteOffset?: number; byteStride?: number };
      const base = (bv.byteOffset ?? 0) + (posAcc.byteOffset ?? 0);
      const stride = bv.byteStride ?? 12;
      for (let i = 0; i < posAcc.count; i++) {
        const off = base + i * stride;
        const x = binView.getFloat32(off, true);
        const y = binView.getFloat32(off + 4, true);
        const z = binView.getFloat32(off + 8, true);
        if (Math.abs(x) < 0.35 && y > 0.1 && y < 0.65 && z < -1.5) blockingBackVerts++;
      }
    }
    expect(blockingBackVerts).toBe(0);

    for (const node of gltf.nodes) {
      expect(node.matrix).toBeUndefined();
      expect(node.translation).toBeUndefined();
      expect(node.rotation).toBeUndefined();
      expect(node.scale).toBeUndefined();
    }
  });

  it('doorSwingAt eases smoothly from 0 to 1 over DOOR_SWING_MS', () => {
    expect(doorSwingAt(0, 1, 0)).toBe(0);
    const mid = doorSwingAt(0, 1, DOOR_SWING_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(doorSwingAt(0, 1, DOOR_SWING_MS)).toBe(1);
    expect(doorSwingAt(1, 0, DOOR_SWING_MS)).toBe(0);
  });

  it('buildDoorKitMatrices produces right-handed inward-swinging leaves and open-only threshold glow', () => {
    const gates = getMosqueDoors();
    const shut = buildDoorKitMatrices(gates, () => 0);
    const open = buildDoorKitMatrices(gates, () => 1);

    expect(open.bayKeys).toHaveLength(83);
    expect(open.frames).toHaveLength(83 * 16);
    expect(open.leftLeaves).toHaveLength(83 * 16);
    expect(open.rightLeaves).toHaveLength(83 * 16);
    expect(open.glows).toHaveLength(83 * 16);
    expect(open.starFloors).toHaveLength(RECESSED_PORCH_GATES.size * 16);
    expect(RECESSED_PORCH_GATES.has(7)).toBe(true);
    expect(RECESSED_PORCH_GATES.has(9)).toBe(true);
    expect(RECESSED_PORCH_GATES.has(8)).toBe(false);
    expect(RECESSED_PORCH_GATES.has(4)).toBe(false);

    const detXZ = (arr: Float32Array, off: number) => arr[off + 5] * (arr[off] * arr[off + 10] - arr[off + 2] * arr[off + 8]);
    for (let s = 0; s < RECESSED_PORCH_GATES.size; s++) {
      expect(detXZ(open.starFloors, s * 16), `star floor det ${s}`).toBeGreaterThan(0);
    }

    let bayIdx = 0;
    for (const g of gates) {
      const [ox, oz] = g.outward;
      for (const _bay of g.bays) {
        const off = bayIdx * 16;
        expect(detXZ(open.frames, off), `frame det gate ${g.id}`).toBeGreaterThan(0);
        expect(detXZ(open.leftLeaves, off), `left det gate ${g.id}`).toBeGreaterThan(0);
        expect(detXZ(open.rightLeaves, off), `right det gate ${g.id}`).toBeGreaterThan(0);

        // Open leaves must swing strictly inward (-outward): left leaf extends along +X, right leaf along -X.
        const lx = open.leftLeaves[off];
        const lz = open.leftLeaves[off + 2];
        const lLen = Math.hypot(lx, lz);
        expect((lx * ox + lz * oz) / lLen, `left inward gate ${g.id}`).toBeLessThan(-0.9);

        const rx = -open.rightLeaves[off];
        const rz = -open.rightLeaves[off + 2];
        const rLen = Math.hypot(rx, rz);
        expect((rx * ox + rz * oz) / rLen, `right inward gate ${g.id}`).toBeLessThan(-0.9);

        // Threshold glow is zero-scaled when shut and visible when open (measured across XZ columns 0 & 2).
        expect(Math.hypot(shut.glows[off], shut.glows[off + 2])).toBe(0);
        expect(shut.glows[off + 5]).toBe(0);
        expect(Math.hypot(shut.glows[off + 8], shut.glows[off + 10])).toBe(0);
        expect(Math.hypot(open.glows[off], open.glows[off + 2])).toBeGreaterThan(0);
        expect(open.glows[off + 5]).toBe(1);
        expect(Math.hypot(open.glows[off + 8], open.glows[off + 10])).toBeGreaterThan(0);
        bayIdx++;
      }
    }
  });

  it('buildDoorCutBoxes packs 83 valid doorway boxes matching RGBA32F N x 2 layout', () => {
    const cut = buildDoorCutBoxes(getMosqueDoors());
    expect(cut.count).toBe(83);
    expect(cut.data).toHaveLength(83 * 8);
    for (let i = 0; i < cut.count; i++) {
      const minX = cut.data[i * 4];
      const minZ = cut.data[i * 4 + 1];
      const maxX = cut.data[i * 4 + 2];
      const maxZ = cut.data[i * 4 + 3];
      const maxY = cut.data[(cut.count + i) * 4];
      expect(maxX).toBeGreaterThan(minX);
      expect(maxZ).toBeGreaterThan(minZ);
      expect(maxY).toBeGreaterThan(3.5);
    }
  });

  it('scene-light provides warm glow rules for haram-doors-kit lantern bulbs, transom glass, gold, atlas, and floor spill', () => {
    expect(materialGlow('./models/haram-doors-kit.glb', 'lanternBulb')).toMatchObject({ rise: 0, tint: 0 });
    expect(materialGlow('./models/haram-doors-kit.glb', 'transomGlass')).toMatchObject({ rise: 0, tint: 1 });
    expect(materialGlow('./models/haram-doors-kit.glb', 'doorGold')).toMatchObject({ rise: 0, tint: 1 });
    expect(materialGlow('./models/haram-doors-kit.glb', 'doorAtlas')).toMatchObject({ rise: 1, tint: 1 });
    expect(materialGlow('./models/haram-doors-kit.glb', 'thresholdGlow')).toMatchObject({ rise: 0, tint: 0 });
  });
});
