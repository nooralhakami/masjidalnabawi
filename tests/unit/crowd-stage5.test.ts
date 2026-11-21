import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import {
  ARCHETYPE_COUNT,
  assignCrowdProfiles,
  CROWD_ARCHETYPES,
  CrowdPerfGuard,
  capsForTier,
  parseCrowdQualityOverride,
  parseCrowdSeasonOverride,
  resolveInitialCrowdTier,
} from '../../src/domain/crowd-profiles';
import { BONE_COUNT, buildBoneAnimationTexture, CLIP_COUNT, CROWD_CLIP, FRAMES_PER_CLIP, sampleBonePosition } from '../../src/domain/crowd-rig';
import { ALWAYS_CLOSED_GATES, allDoorwayBayPortals, resetMosqueDoors, toggleGateBay } from '../../src/domain/mosque-doors';
import { Crowd } from '../../src/map/crowd-sim';
import { crowdInput } from '../../src/map/crowd-world';
import { nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';

describe('Stage 5 crowd profiles & adaptive performance', () => {
  it('generates all 7 cultural archetypes while strictly respecting men/women segregation', () => {
    const batch = assignCrowdProfiles(700, 1234);
    const seen = new Set(batch.archetype);
    for (let i = 0; i < ARCHETYPE_COUNT; i++) expect(seen.has(i)).toBe(true);

    // Explicit segregation array: women[a] === 1 must ONLY get female archetypes (5, 6); 0 ONLY (0..4)
    const womenMask = Uint8Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    const seg = assignCrowdProfiles(400, 4321, { women: womenMask });
    for (let a = 0; a < 400; a++) {
      const arch = seg.archetype[a];
      expect(seg.women[a]).toBe(womenMask[a]);
      if (womenMask[a] === 1) expect(arch).toBeGreaterThanOrEqual(5);
      else expect(arch).toBeLessThan(5);
    }
  });

  it('supports configurable season presets and explicit mix overrides without hardcoded limits', () => {
    expect(parseCrowdSeasonOverride('?crowdSeason=hajj')).toBe('hajj');
    expect(parseCrowdSeasonOverride('?crowdSeason=unknown')).toBe('regular');

    const regular = assignCrowdProfiles(500, 77, { season: 'regular' });
    const hajj = assignCrowdProfiles(500, 77, { season: 'hajj' });
    const ihramIdx = CROWD_ARCHETYPES.indexOf('ihram_man');
    const regCount = regular.archetype.filter((a) => a === ihramIdx).length;
    const hajjCount = hajj.archetype.filter((a) => a === ihramIdx).length;
    expect(hajjCount).toBeGreaterThan(regCount);

    const onlySeAsia = assignCrowdProfiles(60, 19, {
      women: new Uint8Array(60),
      mix: { men: { gulf_man: 0, south_asian_man: 0, se_asian_man: 1, ihram_man: 0, kaftan_man: 0 } },
    });
    expect(onlySeAsia.archetype.every((a) => a === CROWD_ARCHETYPES.indexOf('se_asian_man'))).toBe(true);
  });

  it('downgrades Full -> Lite after 20 consecutive slow frames (>66.7ms) and respects reduced-motion Static', () => {
    expect(resolveInitialCrowdTier(true, 'full')).toBe('static');
    expect(parseCrowdQualityOverride('?crowdQuality=lite')).toBe('lite');
    expect(capsForTier('lite')).toEqual({ walkers: 260, worshippers: 600, allowLod0: false, animate: true });

    const guard = new CrowdPerfGuard('full');
    for (let i = 0; i < 19; i++) expect(guard.recordFrame(75)).toBe('full');
    guard.recordFrame(32); // fast frame resets streak
    for (let i = 0; i < 19; i++) expect(guard.recordFrame(75)).toBe('full');
    expect(guard.recordFrame(75)).toBe('lite');
  });
});

describe('Stage 5 shared 12-bone rig & 9 baked animation clips', () => {
  const tex = buildBoneAnimationTexture();

  it('packs valid 36x144 RGBA32F transforms with zero NaNs', () => {
    expect(tex.width).toBe(BONE_COUNT * 3);
    expect(tex.height).toBe(CLIP_COUNT * FRAMES_PER_CLIP);
    expect(tex.data.length).toBe(36 * 144 * 4);
    for (let i = 0; i < tex.data.length; i++) expect(Number.isFinite(tex.data[i])).toBe(true);
  });

  it('places head and arms anatomically across stand, takbir, ruku, sujud, juloos and dua', () => {
    const crown: [number, number, number] = [0, 1.72, 0];
    const rHand: [number, number, number] = [0, 0.85, 0.22];

    const standHead = sampleBonePosition(tex, CROWD_CLIP.stand, 0, 3, crown);
    expect(standHead[1]).toBeGreaterThan(1.65);

    const takbirHand = sampleBonePosition(tex, CROWD_CLIP.takbir, 8, 7, rHand);
    expect(takbirHand[1]).toBeGreaterThan(1.4);

    const rukuHead = sampleBonePosition(tex, CROWD_CLIP.ruku, 0, 3, crown);
    expect(rukuHead[0]).toBeGreaterThan(0.55);
    expect(rukuHead[1]).toBeGreaterThan(0.8);
    expect(rukuHead[1]).toBeLessThan(1.25);

    const sujudHead = sampleBonePosition(tex, CROWD_CLIP.sujud, 0, 3, crown);
    expect(sujudHead[0]).toBeGreaterThan(0.45);
    expect(sujudHead[1]).toBeGreaterThan(0.02);
    expect(sujudHead[1]).toBeLessThan(0.35);

    const juloosHead = sampleBonePosition(tex, CROWD_CLIP.juloos, 0, 3, crown);
    expect(juloosHead[1]).toBeGreaterThan(1.0);
    expect(juloosHead[1]).toBeLessThan(1.3);

    const duaHand = sampleBonePosition(tex, CROWD_CLIP.dua, 4, 7, rHand);
    expect(duaHand[0]).toBeGreaterThan(0.2);
    expect(duaHand[1]).toBeGreaterThan(1.15);
  });
});

describe('Stage 5 haram-crowd-kit.glb asset & PERF budget gate', () => {
  const glbPath = resolve(__dirname, '../../public/models/haram-crowd-kit.glb');
  const raw = readFileSync(glbPath);
  const { gltf, bin } = parseGlbBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

  it('stays well below the 350 KB gzipped network budget', () => {
    const gzBytes = gzipSync(raw, { level: 9 }).byteLength;
    expect(gzBytes).toBeLessThanOrEqual(350 * 1024);
  });

  it('contains all 15 indexed skinned LOD meshes, valid JPEG atlas and valid joint weights', () => {
    expect(gltf.meshes).toHaveLength(15);
    const names = new Set(gltf.meshes.map((m) => m.name));
    for (let arch = 0; arch < ARCHETYPE_COUNT; arch++) {
      expect(names.has(`Archetype_${arch}_LOD0`)).toBe(true);
      expect(names.has(`Archetype_${arch}_LOD1`)).toBe(true);
    }
    expect(names.has('Crowd_LOD2')).toBe(true);

    // JPEG magic bytes FF D8
    const img = gltf.images?.[0];
    expect(img?.mimeType).toBe('image/jpeg');
    const bv = gltf.bufferViews[img!.bufferView];
    const imgStart = bv.byteOffset ?? 0;
    expect(bin[imgStart]).toBe(0xff);
    expect(bin[imgStart + 1]).toBe(0xd8);

    // Every primitive carries skinning attributes with upright Y in 0..1.85 m and weight sum ≈ 255
    for (const mesh of gltf.meshes) {
      const attrs = mesh.primitives[0].attributes as Record<string, number>;
      for (const req of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) {
        expect(attrs[req]).toBeDefined();
      }
      const posAcc = gltf.accessors[attrs.POSITION];
      expect(posAcc.min![1]).toBeGreaterThanOrEqual(-0.02);
      expect(posAcc.max![1]).toBeLessThanOrEqual(1.85);

      const jAcc = gltf.accessors[attrs.JOINTS_0];
      const wAcc = gltf.accessors[attrs.WEIGHTS_0];
      const jBv = gltf.bufferViews[jAcc.bufferView];
      const wBv = gltf.bufferViews[wAcc.bufferView];
      const jOff = jBv.byteOffset ?? 0;
      const wOff = wBv.byteOffset ?? 0;
      for (let v = 0; v < jAcc.count; v++) {
        let wSum = 0;
        for (let k = 0; k < 4; k++) {
          expect(bin[jOff + v * 4 + k]).toBeLessThan(BONE_COUNT);
          wSum += bin[wOff + v * 4 + k];
        }
        expect(wSum).toBe(255);
      }
    }
  });
});

describe('Stage 5 live open-bay doorway crowd interaction', () => {
  const canopiesFile = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(canopiesFile.buffer.slice(canopiesFile.byteOffset, canopiesFile.byteOffset + canopiesFile.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);

  it('routes crowd strictly toward open doorway bays (e.g. bays 1 & 2 of Gate 8) and updates dynamically on toggle', () => {
    resetMosqueDoors();
    try {
      const crowd = new Crowd(crowdInput(columnsLL), 320, 9);
      const active = crowd.getActiveDoorPortals();
      expect(active.length).toBeGreaterThan(20);

      // Gate 8 has 5 bays: only central bays 1 & 2 are open by default, never closed bays 0, 3, 4
      const g8Bays = active
        .filter((p) => p.gateId === 8)
        .map((p) => p.bayIndex)
        .sort((a, b) => a - b);
      expect(g8Bays).toEqual([1, 2]);

      // Always-closed inner gates never appear as open portals
      for (const closedGateId of ALWAYS_CLOSED_GATES) {
        expect(active.some((p) => p.gateId === closedGateId)).toBe(false);
      }

      // Close Gate 8 bay 1 dynamically and sync crowd
      toggleGateBay(8, 1);
      crowd.syncOpenDoors(allDoorwayBayPortals());
      const afterClose = crowd
        .getActiveDoorPortals()
        .filter((p) => p.gateId === 8)
        .map((p) => p.bayIndex);
      expect(afterClose).toEqual([2]);

      for (let t = 0; t < 5; t += 1 / 30) crowd.step(1 / 30);
      for (let a = 0; a < crowd.n; a++) {
        if (Number.isNaN(crowd.px[a])) continue;
        expect(crowd.standable(crowd.px[a], crowd.pz[a], !crowd.woman[a], true)).toBe(true);
      }
    } finally {
      resetMosqueDoors();
    }
  });
});
