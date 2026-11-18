import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { motorEase } from '../../src/domain/easing';
import { buildSlidingDomes, DOME_SLIDE_M, DOME_SLIDE_MS, domeSlideAt, isDomeOpen, resetDomes, subscribeDomes, toggleDome } from '../../src/domain/sliding-domes';
import { domeInstanceCentres, domeMeshIndex, parseGlbBuffer } from '../../src/map/glb-layer';

/** navQ's Mosque file, as the 3D layer reads it. */
const MOSQUE = (() => {
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-3d.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  const model = ALHARAMAIN_MODELS.find((m) => m.url.includes('haram-3d'))!;
  return { gltf, model };
})();
const CENTRES = domeInstanceCentres(MOSQUE.model, MOSQUE.gltf);
const DOMES = buildSlidingDomes(CENTRES);
/** The unit's width (its drum's base), from the file's own bounds. */
const UNIT_W = (() => {
  const mesh = MOSQUE.gltf.meshes[domeMeshIndex(MOSQUE.gltf)];
  let w = 0;
  for (const p of mesh.primitives) {
    const acc = MOSQUE.gltf.accessors[p.attributes.POSITION];
    w = Math.max(w, (acc.max?.[0] ?? 0) - (acc.min?.[0] ?? 0), (acc.max?.[2] ?? 0) - (acc.min?.[2] ?? 0));
  }
  return w;
})();

afterEach(() => resetDomes());

describe('the sliding domes in navQ’s Mosque file', () => {
  it('are 27 units of one mesh, in four rows (50 / 55 / 50 m apart, as navQ’s roof plan)', () => {
    expect(domeMeshIndex(MOSQUE.gltf)).toBeGreaterThanOrEqual(0);
    expect(CENTRES).toHaveLength(27);
    const rows: number[] = [];
    for (const s of CENTRES.map((c) => c[1]).sort((a, b) => a - b)) if (!rows.length || s - rows[rows.length - 1] > 6) rows.push(s);
    expect(rows).toHaveLength(4);
    const gaps = rows.slice(1).map((r, i) => r - rows[i]);
    expect(Math.abs(gaps[0] - 50.4)).toBeLessThan(0.2);
    expect(Math.abs(gaps[1] - 55.2)).toBeLessThan(0.2);
    expect(Math.abs(gaps[2] - 50.4)).toBeLessThan(0.2);
    expect(UNIT_W).toBeCloseTo(19.2, 1);
  });

  it('are numbered 1..27, rows south to north and west to east (the owner’s review board)', () => {
    expect(DOMES.map((d) => d.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    const byN = new Map(DOMES.map((d) => [d.n, d]));
    const southRow = Math.max(...DOMES.map((d) => d.south));
    const northRow = Math.min(...DOMES.map((d) => d.south));
    // 1..6 the southern row, west to east; 19..27 the northern row, with 22..24 its middle group.
    for (let n = 1; n <= 6; n++) expect(byN.get(n)!.south).toBeCloseTo(southRow, 0);
    for (let n = 19; n <= 27; n++) expect(byN.get(n)!.south).toBeCloseTo(northRow, 0);
    for (let n = 1; n < 6; n++) expect(byN.get(n)!.east).toBeLessThan(byN.get(n + 1)!.east);
    for (let n = 19; n < 27; n++) expect(byN.get(n)!.east).toBeLessThan(byN.get(n + 1)!.east);
  });

  it('slide as the owner set: 13..27 (north) south, 1..12 (south) north, by the dome’s size', () => {
    expect(DOME_SLIDE_M).toBe(18);
    for (const d of DOMES) {
      if (d.n >= 13) {
        expect(d.half).toBe('north');
        expect(d.slideSouth).toBe(DOME_SLIDE_M);
      } else {
        expect(d.half).toBe('south');
        expect(d.slideSouth).toBe(-DOME_SLIDE_M);
      }
    }
    expect(DOMES.filter((d) => d.half === 'north')).toHaveLength(15);
    expect(DOMES.filter((d) => d.half === 'south')).toHaveLength(12);
  });

  it('never run into each other, all open or any mix of open and closed', () => {
    const at = (d: (typeof DOMES)[number], f: number) => [d.east, d.south + d.slideSouth * f] as const;
    for (const a of DOMES) {
      for (const b of DOMES) {
        if (a.n >= b.n) continue;
        for (const fa of [0, 1]) {
          for (const fb of [0, 1]) {
            const [ax, ay] = at(a, fa);
            const [bx, by] = at(b, fb);
            const overlap = Math.abs(ax - bx) < UNIT_W - 1e-3 && Math.abs(ay - by) < UNIT_W - 1e-3;
            expect(overlap, `dome ${a.n} (${fa ? 'open' : 'closed'}) and ${b.n} (${fb ? 'open' : 'closed'})`).toBe(false);
          }
        }
      }
    }
  });
});

describe('domeSlideAt (slowly, like a heavy unit on rails)', () => {
  it('starts gently, runs, and slows into place over DOME_SLIDE_MS', () => {
    expect(DOME_SLIDE_MS).toBeGreaterThanOrEqual(10000);
    expect(domeSlideAt(0, 1, 0)).toBe(0);
    expect(domeSlideAt(0, 1, DOME_SLIDE_MS)).toBe(1);
    expect(domeSlideAt(0, 1, DOME_SLIDE_MS / 2)).toBeCloseTo(0.5);
    expect(domeSlideAt(0, 1, DOME_SLIDE_MS * 0.05)).toBeLessThan(0.01);
    expect(domeSlideAt(1, 0, DOME_SLIDE_MS)).toBe(0);
    let last = 0;
    for (let t = 0; t <= DOME_SLIDE_MS; t += 500) {
      const f = domeSlideAt(0, 1, t);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });

  it('jumps when asked for no motion (reduced motion)', () => {
    expect(domeSlideAt(1, 1, 0)).toBe(1);
    expect(domeSlideAt(0, 1, 0, 0)).toBe(1);
  });

  it('shares the canopies’ motor curve', () => {
    expect(motorEase(0)).toBe(0);
    expect(motorEase(1)).toBe(1);
    expect(motorEase(0.5)).toBeCloseTo(0.5);
    expect(motorEase(-1)).toBe(0);
    expect(motorEase(2)).toBe(1);
  });
});

describe('opening and closing a dome', () => {
  it('a tap opens a closed dome and closes an open one, and tells who listens', () => {
    let heard = 0;
    const stop = subscribeDomes(() => heard++);
    expect(isDomeOpen(5)).toBe(false);
    expect(toggleDome(5)).toBe(true);
    expect(isDomeOpen(5)).toBe(true);
    expect(toggleDome(5)).toBe(false);
    expect(isDomeOpen(5)).toBe(false);
    stop();
    toggleDome(5);
    expect(heard).toBe(2);
  });
});
