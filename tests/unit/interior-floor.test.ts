import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import data from '../../data/navq-interior-floor.json';
import type { InteriorFloorData } from '../../src/data-next/interior-floor-data';
import { inCourtyard, interiorColumns, interiorFloorMetres, interiorPropPlacements, interiorRugs } from '../../src/domain/interior-floor';
import { INTERIOR_COL_STEP_M } from '../../src/domain/interior-layout';
import { COLUMN_CLEAR, inside, RUG_D, RUG_W, toLaid } from '../../src/domain/rug-layout';
import { interiorPropMatrices, parseGlbBuffer } from '../../src/map/glb-layer';
import { plazaMesh } from '../../src/map/plaza-layer';
import { materialGlow } from '../../src/map/scene-light';

const FLOOR = interiorFloorMetres(data as unknown as InteriorFloorData);
const COLUMNS = interiorColumns(FLOOR);
const RUGS = interiorRugs(FLOOR, COLUMNS);

describe('the interior floor from navQ’s plan (data/navq-interior-floor.json)', () => {
  it('holds the walking floor, the men’s and women’s carpeted areas and the First Hasawa', () => {
    const d = data as unknown as InteriorFloorData;
    expect(d.source.generatedBy).toBe('scripts/interior-floor-from-navq.py');
    expect(d.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.marble.length).toBe(51);
    expect(d.men.length).toBe(30);
    expect(d.women.length).toBe(15);
    expect(d.courtyard.map((c) => c.name)).toEqual(['الحصوة الأولى']);
  });

  it('names every women’s area as a women’s prayer area, and no men’s area as one', () => {
    const named = (FLOOR.carpets.filter((c) => c.women).flatMap((c) => c.names) as string[]).filter(Boolean);
    expect(named.length).toBeGreaterThanOrEqual(15);
    for (const n of named) expect(n).toMatch(/النساء|Women|women/);
    for (const c of FLOOR.carpets.filter((x) => !x.women)) for (const n of c.names) expect(n).not.toMatch(/النساء/);
  });
});

describe('the interior’s columns (the approved grid, owner 2026-11-18)', () => {
  it('stand inside the Mosque’s floor and never in the open Hasawa', () => {
    expect(COLUMNS.length).toBeGreaterThan(150);
    for (const c of COLUMNS) expect(inCourtyard(FLOOR, c)).toBe(false);
  });
});

describe('the interior’s carpets', () => {
  it('are laid in thousands, each whole inside a prayer area and clear of the columns', () => {
    expect(RUGS.length).toBeGreaterThan(7000);
    const areas = FLOOR.carpets.map((c) => c.ring);
    for (const r of RUGS) {
      expect(areas.some((ring) => inside([r.x, r.z], ring))).toBe(true);
      const [u, v] = toLaid([r.x, r.z]);
      for (const c of COLUMNS) {
        const [cu, cv] = toLaid(c);
        const du = Math.max(Math.abs(cu - u) - RUG_W / 2, 0);
        const dv = Math.max(Math.abs(cv - v) - RUG_D / 2, 0);
        expect(du * du + dv * dv).toBeGreaterThanOrEqual(COLUMN_CLEAR * COLUMN_CLEAR - 1e-6);
      }
    }
  });

  it('never overlap one another', () => {
    const seen = new Map<string, [number, number][]>();
    for (const r of RUGS) {
      const [u, v] = toLaid([r.x, r.z]);
      const k = `${Math.floor(u / RUG_W)}|${Math.floor(v / RUG_D)}`;
      for (let du = -1; du <= 1; du++)
        for (let dv = -1; dv <= 1; dv++)
          for (const [pu, pv] of seen.get(`${Math.floor(u / RUG_W) + du}|${Math.floor(v / RUG_D) + dv}`) ?? []) {
            expect(Math.abs(pu - u) >= RUG_W - 1e-6 || Math.abs(pv - v) >= RUG_D - 1e-6).toBe(true);
          }
      seen.set(k, [...(seen.get(k) ?? []), [u, v]]);
    }
  });
});

describe('the interior’s props', () => {
  const P = interiorPropPlacements(COLUMNS);
  it('span each arch between two columns one grid step apart, and hang a chandelier in each full bay', () => {
    const has = (x: number, z: number) => COLUMNS.some((c) => Math.abs(c[0] - x) < 0.5 && Math.abs(c[1] - z) < 0.5);
    const h = INTERIOR_COL_STEP_M / 2;
    expect(P.archesEastWest.length).toBeGreaterThan(50);
    expect(P.archesNorthSouth.length).toBeGreaterThan(50);
    for (const [x, z] of P.archesEastWest) expect(has(x - h, z) && has(x + h, z)).toBe(true);
    for (const [x, z] of P.archesNorthSouth) expect(has(x, z - h) && has(x, z + h)).toBe(true);
    for (const [x, z] of P.chandeliers) expect(has(x - h, z - h) && has(x + h, z - h) && has(x - h, z + h) && has(x + h, z + h)).toBe(true);
  });

  it('come from one Blender file whose arch fits the column grid’s step', () => {
    const f = readFileSync(resolve(__dirname, '../../public/models/haram-interior-props.glb'));
    const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
    const names = gltf.meshes.map((m) => m.name).sort();
    expect(names).toEqual(['ColumnLanterns', 'InteriorArch', 'InteriorChandelier', 'InteriorColumn']);
    const arch = gltf.nodes.find((n) => n.name === 'InteriorArch') as { extras?: { pitch?: number } } | undefined;
    expect(arch?.extras?.pitch).toBe(INTERIOR_COL_STEP_M);
    const m = interiorPropMatrices(P);
    expect(m.get('InteriorColumn')!.length).toBe(COLUMNS.length * 16);
    expect(m.get('InteriorArch')!.length).toBe((P.archesEastWest.length + P.archesNorthSouth.length) * 16);
  });

  it('light their lanterns warm at night', () => {
    expect(materialGlow('haram-interior-props', 'glassLamp')?.tint).toBe(0);
    expect(materialGlow('haram-interior-props', 'gold')).not.toBeNull();
  });
});

describe('the marble mesh with the interior floor', () => {
  it('adds the interior’s walking floor as its own kind, within 16-bit indices', () => {
    const plain = plazaMesh();
    const withInterior = plazaMesh(FLOOR.marble);
    expect(withInterior.vertices.length).toBeGreaterThan(plain.vertices.length);
    expect(withInterior.vertices.length / 5).toBeLessThan(65536);
    let kind4 = 0;
    for (let i = 2; i < withInterior.vertices.length; i += 5) if (withInterior.vertices[i] === 4) kind4++;
    expect(kind4).toBe(FLOOR.marble.reduce((s, r) => s + r.length, 0));
  });
});
