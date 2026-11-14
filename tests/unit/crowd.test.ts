import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { PRAYER_CLEARINGS } from '../../src/data-next/alharamain-prayers';
import { Flows } from '../../src/map/crowd-flows';
import { BODY_R, CELL, COLUMN_R, Crowd, FIXED, FREE, HIDDEN, POSTURE_CODE, Worshippers, worshipperPose } from '../../src/map/crowd-sim';
import { crowdInput } from '../../src/map/crowd-world';
import { generateWorshipperPlacements, parsePrayerDemoOverride, resolvePrayerSession } from '../../src/domain/prayer-session';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { restroomFootprints, restroomWalkways } from '../../src/map/prayer-layout';
import { GREETING_BARRIERS, QUEUE_LANES, QUEUE_MOUTH_Z, QUEUE_RAILS } from '../../src/map/rawdah-layout';
import { rugLayout } from '../../src/map/rug-layout';

const inside = (x: number, z: number, r: readonly (readonly [number, number])[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};

describe('people walking in the courtyards (owner, 2026-11-06)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
  const input = crowdInput(columnsLL);
  const crowd = new Crowd(input, 400, 11);
  const start = Array.from({ length: crowd.n }, (_, a) => [crowd.px[a], crowd.pz[a]]);
  for (let t = 0; t < 60; t += 1 / 30) crowd.step(1 / 30);

  // The carpets as laid (whole ones only).
  const carpets = rugLayout(columnsLL).covered;
  const walkways = [...restroomWalkways(), ...PRAYER_CLEARINGS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number])))];
  const blocks = restroomFootprints();

  it('every walker stands on walkable ground: never on a carpet, in a restroom block or in a column', () => {
    let placed = 0;
    for (let a = 0; a < crowd.n; a++) {
      const x = crowd.px[a];
      const z = crowd.pz[a];
      if (Number.isNaN(x)) continue;
      placed++;
      expect(crowd.standable(x, z)).toBe(true);
      // The ground is a 0.5 m grid: a walker may graze an edge by less than half a cell, never more.
      const depth = (r: readonly (readonly [number, number])[]) => {
        let d = Number.POSITIVE_INFINITY;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [ax, az] = r[j];
          const ex = r[i][0] - ax;
          const ez = r[i][1] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
          d = Math.min(d, Math.hypot(ax + t * ex - x, az + t * ez - z));
        }
        return d;
      };
      const onCarpet = carpets.some((r) => inside(x, z, r) && depth(r) > 0.3) && !walkways.some((w) => inside(x, z, w));
      expect(onCarpet).toBe(false);
      expect(blocks.some((b) => inside(x, z, b))).toBe(false);
      for (const [cx, cz] of input.columns) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(COLUMN_R);
    }
    expect(placed).toBe(400);
  });

  it('no two walkers run into each other', () => {
    let closest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < crowd.n; a++) {
      for (let b = a + 1; b < crowd.n; b++) closest = Math.min(closest, Math.hypot(crowd.px[a] - crowd.px[b], crowd.pz[a] - crowd.pz[b]));
    }
    expect(closest).toBeGreaterThan(2 * BODY_R - 0.06);
  });

  it('they gather where the visitor looks: within the view, still clear of one another', () => {
    const near = new Crowd(input, 300, 5);
    const [cx, cz] = metresFromOrigin([39.6097, 24.4663]);
    near.keepNear(cx, cz, 80, 0);
    for (let t = 0; t < 10; t += 1 / 30) {
      near.step(1 / 30);
      near.keepNear(cx, cz, 80);
    }
    let within = 0;
    for (let a = 0; a < near.n; a++) {
      if (Math.hypot(near.px[a] - cx, near.pz[a] - cz) <= 1.3 * 80) within++;
      expect(near.standable(near.px[a], near.pz[a])).toBe(true);
    }
    expect(within).toBe(300);
  });

  it('they walk: at a person’s pace, most of them far from where they started', () => {
    let moved = 0;
    for (let a = 0; a < crowd.n; a++) {
      if (Math.hypot(crowd.px[a] - start[a][0], crowd.pz[a] - start[a][1]) > 20) moved++;
      expect(Math.hypot(crowd.vx[a], crowd.vz[a])).toBeLessThan(1.6);
    }
    expect(moved / crowd.n).toBeGreaterThan(0.6);
  });
});

describe('the women’s areas (owner, 2026-11-07)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
  const input = crowdInput(columnsLL);
  const n = 300;
  const women = Uint8Array.from({ length: n }, (_, a) => (a % 2 ? 1 : 0));
  const crowd = new Crowd(input, n, 3, women);
  const zones = input.womenOnly!;
  const fences = input.fences!;
  // About the north-west area, where the visitor looks.
  const [cx, cz] = metresFromOrigin([39.6093, 24.4699]);
  const crosses = (ax: number, az: number, bx: number, bz: number) =>
    fences.some((line) =>
      line.slice(1).some(([qx, qz], k) => {
        const [px, pz] = line[k];
        const d = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) => (x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1);
        return d(px, pz, qx, qz, ax, az) * d(px, pz, qx, qz, bx, bz) < 0 && d(ax, az, bx, bz, px, pz) * d(ax, az, bx, bz, qx, qz) < 0;
      }),
    );
  let menInside = 0;
  let crossed = 0;
  crowd.keepNear(cx, cz, 90, 0);
  for (let t = 0; t < 40; t += 1 / 30) {
    const before = Array.from({ length: n }, (_, a) => [crowd.px[a], crowd.pz[a]]);
    crowd.step(1 / 30);
    crowd.keepNear(cx, cz, 90);
    for (let a = 0; a < n; a++) {
      if (Number.isNaN(crowd.px[a])) continue;
      if (!women[a] && zones.some((z) => inside(crowd.px[a], crowd.pz[a], z))) menInside++;
      // A step (not a walker placed again by keepNear) never goes through a barrier.
      if (Math.hypot(crowd.px[a] - before[a][0], crowd.pz[a] - before[a][1]) < 1 && crosses(before[a][0], before[a][1], crowd.px[a], crowd.pz[a])) crossed++;
    }
  }

  it('the two areas and their barriers are read in: north-west and north-east', () => {
    expect(zones).toHaveLength(2);
    // 13 for the women's areas, the 11 rails of the Rawdah's queues and the greeting's barriers (owner, 2026-11-08).
    expect(fences.length).toBe(13 + QUEUE_RAILS.length + GREETING_BARRIERS.length);
    expect(QUEUE_RAILS).toHaveLength(11);
  });

  it('no man ever stands inside a women’s area, and no one walks through a barrier', () => {
    expect(menInside).toBe(0);
    expect(crossed).toBe(0);
  });

  it('women gather in their area; fewer men about it than women in it', () => {
    let womenIn = 0;
    let menNear = 0;
    for (let a = 0; a < n; a++) {
      const x = crowd.px[a];
      const z = crowd.pz[a];
      if (Number.isNaN(x)) continue;
      const inZone = zones.some((r) => inside(x, z, r));
      if (women[a] && inZone) womenIn++;
      if (!women[a] && Math.hypot(x - cx, z - cz) < 60) menNear++;
    }
    expect(womenIn).toBeGreaterThan(40);
    expect(womenIn).toBeGreaterThan(menNear);
  });

  it('the barriers close the areas: one goes in only through the gates the owner left (four), none by block 215 or along the Mosque wall', () => {
    const grid = new Crowd(input, 1, 1);
    const { w, h, walk, x0, z0 } = grid;
    // Where women-only ground meets ground anyone may stand on: the ways in.
    const edge = new Uint8Array(w * h);
    for (let j = 1; j < h - 1; j++)
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        if (walk[k] === 2 && [k - 1, k + 1, k - w, k + w].some((q) => walk[q] === 1)) edge[k] = 1;
      }
    const ways: { x: number; z: number; long: number }[] = [];
    const seen = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) {
      if (!edge[k] || seen[k]) continue;
      const stack = [k];
      seen[k] = 1;
      const cells: number[] = [];
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        // Joined across a column standing in a gate (up to 2 m).
        for (let dj = -4; dj <= 4; dj++)
          for (let di = -4; di <= 4; di++) {
            const q = c + dj * w + di;
            if (q >= 0 && q < w * h && edge[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
      }
      const xs = cells.map((c) => x0 + ((c % w) + 0.5) * CELL);
      const zs = cells.map((c) => z0 + (Math.floor(c / w) + 0.5) * CELL);
      ways.push({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        z: (Math.min(...zs) + Math.max(...zs)) / 2,
        long: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
      });
    }
    // The gates: the north-west area's north and west gaps, the north-east area's north and east.
    expect(ways).toHaveLength(4);
    for (const g of ways) expect(g.long).toBeGreaterThan(6);
    const [bx, bz] = metresFromOrigin([39.608657, 24.469027]); // block 215
    for (const g of ways) {
      expect(Math.hypot(g.x - bx, g.z - bz)).toBeGreaterThan(40);
      // Along the Mosque's west wall, beside the north-west area.
      expect(g.x > -275 && g.x < -255 && g.z > -345 && g.z < -235).toBe(false);
    }
  });
});

describe('the flows round the Rawdah (owner, 2026-11-08)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
  const input = crowdInput(columnsLL);
  // 08:00 in Madinah: the women's turn at the Rawdah.
  const womenTime = new Date('2026-11-08T05:00:00Z');
  // Half men and half women, as the crowd's looks have them.
  const crowd = new Crowd(
    input,
    500,
    7,
    Uint8Array.from({ length: 500 }, (_, a) => (a % 2 ? 1 : 0)),
  );
  const flows = new Flows(crowd);
  crowd.keepNear(-20, -50, 130, 0);
  // Men seen going in for the greeting (hidden inside the Mosque), and where.
  const wentIn = new Map<number, [number, number]>();
  const last = new Float64Array(crowd.n * 2);
  for (let t = 0; t < 120; t += 0.05) {
    crowd.keepNear(-20, -50, 130);
    for (let a = 0; a < crowd.n; a++) last.set([crowd.px[a], crowd.pz[a]], a * 2);
    flows.update(0.05, womenTime, true);
    crowd.step(0.05);
    for (const a of flows.census().salam) if (crowd.mode[a] === HIDDEN && !wentIn.has(a) && !Number.isNaN(last[a * 2])) wentIn.set(a, [last[a * 2], last[a * 2 + 1]]);
  }
  const who = flows.census();

  it('those queuing, waiting before Gate 37 and organising are of the turn (women now); those greeting are men', () => {
    expect(who.queue.length).toBeGreaterThan(36);
    for (const a of [...who.queue, ...who.hold, ...who.organisers]) expect(crowd.woman[a]).toBe(1);
    expect(who.salam.length).toBeGreaterThan(10);
    for (const a of who.salam) expect(crowd.woman[a]).toBe(0);
  });

  it('men greeting go in at Gate 1 (Bab al-Salam), through the way the barriers make', () => {
    expect(wentIn.size).toBeGreaterThan(2);
    for (const [x, z] of wentIn.values()) expect(Math.hypot(x - -115.2, z - -78.9)).toBeLessThan(6);
  });

  it('those in a lane keep between its rails', () => {
    const lanes = (flows as unknown as { lanes: number[][] }).lanes;
    lanes.forEach((lane, l) => {
      const [w, e] = QUEUE_LANES[l];
      for (const a of lane) {
        if (crowd.pz[a] > QUEUE_MOUTH_Z) continue; // still at the mouth
        expect(crowd.px[a]).toBeGreaterThan(w);
        expect(crowd.px[a]).toBeLessThan(e);
      }
    });
  });

  it('no one stands where they may not (carpets, blocks, rails, the lanes for those not queuing)', () => {
    for (let a = 0; a < crowd.n; a++) {
      if (Number.isNaN(crowd.px[a]) || crowd.mode[a] === FIXED) continue;
      expect(crowd.standable(crowd.px[a], crowd.pz[a], !crowd.woman[a], crowd.mode[a] === FREE)).toBe(true);
    }
  });

  it('with the view elsewhere, every walker goes back to the crowd', () => {
    flows.update(0.05, womenTime, false);
    for (let a = 0; a < crowd.n; a++) expect(crowd.mode[a]).toBe(FREE);
  });
});

describe('funerals come now and then, not all the time (owner, 2026-11-08)', () => {
  it('none in the first minute; two to ten in half an hour; never more than two at once', () => {
    const crowd = new Crowd(crowdInput([]), 500, 5);
    const flows = new Flows(crowd, 9);
    crowd.keepNear(-20, -50, 130, 0);
    const menTime = new Date('2026-11-08T09:00:00Z');
    let most = 0;
    const firstAt: [number, number][] = [];
    let seen = 0;
    for (let t = 0; t < 1800; t += 0.5) {
      flows.update(0.5, menTime, true);
      const biers = flows.biers();
      if (flows.funeralsStarted > seen && biers.length) firstAt.push([biers[biers.length - 1].x, biers[biers.length - 1].z]);
      seen = flows.funeralsStarted;
      if (t < 60) expect(flows.funeralsStarted).toBe(0);
      most = Math.max(most, flows.census().funerals);
    }
    expect(flows.funeralsStarted).toBeGreaterThanOrEqual(2);
    expect(flows.funeralsStarted).toBeLessThanOrEqual(10);
    expect(most).toBeLessThanOrEqual(2);
    // Each comes out of the door of block 203, on its north side (owner, 2026-11-08).
    for (const [x, z] of firstAt) expect(Math.hypot(x - -6, z - -16)).toBeLessThan(5);
  });
});

describe('the worshippers at prayer (owner, 2026-11-09)', () => {
  const file = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);
  // 08:00 in Madinah.
  const at = new Date('2026-11-08T05:00:00Z');

  it('the four postures are the four codes the shader draws, and a row follows the session', () => {
    expect(POSTURE_CODE).toEqual({ standing: 0, ruku: 1, sujud: 2, juloos: 3 });
    const rows = generateWorshipperPlacements(resolvePrayerSession(at, undefined, 'asr'), { columns: columnsLL });
    const inRow = rows.filter((p) => p.activity === 'congregational_prayer');
    expect(inRow.length).toBeGreaterThan(100);
    for (const p of inRow) expect(worshipperPose(p)).toBe(0);
    // Between the prayers: a reader sits with its own pose, which no uniform moves.
    const quiet = generateWorshipperPlacements(resolvePrayerSession(at, undefined, 'off_prayer'), { columns: columnsLL });
    const readers = quiet.filter((p) => p.activity === 'quran_reading');
    expect(readers.length).toBeGreaterThan(0);
    for (const p of readers) expect(worshipperPose(p)).toBe(1 + POSTURE_CODE[p.posture]);
    expect(readers.every((p) => p.posture === 'juloos')).toBe(true);
  });

  it('a child is drawn at 0.62 of a grown figure, and a reader has a rehal before it', () => {
    const places = generateWorshipperPlacements(resolvePrayerSession(at, undefined, 'off_prayer'), { columns: columnsLL });
    const children = places.filter((p) => p.isChild);
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) expect(c.scale).toBe(0.62);
    expect(places.some((p) => p.hasRehal && p.posture === 'juloos')).toBe(true);
  });

  it('the places are laid out once for a scene, and kept until the scene changes', () => {
    const w = new Worshippers();
    expect(w.sync(at, 'dhuhr', { columns: columnsLL })).toBe(true);
    const kept = w.placements;
    expect(kept.length).toBeGreaterThan(100);
    // A bow, a prostration, another rak'ah: the rows stay as they are, the posture is a uniform.
    expect(w.sync(new Date(at.getTime() + 60_000), 'dhuhr', { columns: columnsLL })).toBe(false);
    expect(w.placements).toBe(kept);
    // Another scene (the khutbah) is laid out again.
    expect(w.sync(new Date(at.getTime() + 120_000), 'jummah_khutbah', { columns: columnsLL })).toBe(true);
    expect(w.placements).not.toBe(kept);
    expect(w.session?.phase).toBe('friday_khutbah');
  });

  it('a preview link names the scene, and nothing else does', () => {
    expect(parsePrayerDemoOverride('?prayerDemo=fajr')).toBe('fajr');
    expect(parsePrayerDemoOverride('?prayerDemo=jummah_prayer')).toBe('jummah_prayer');
    expect(parsePrayerDemoOverride('?prayerDemo=off_prayer')).toBe('off_prayer');
    expect(parsePrayerDemoOverride('?prayerDemo=noon')).toBeNull();
    expect(parsePrayerDemoOverride('')).toBeNull();
  });
});
