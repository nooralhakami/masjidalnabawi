import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERIOR_POIS, POI_BY_ID } from '../../src/data';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import type { LatLng } from '../../src/data/types';
import { toModelMetres, type XY } from '../../src/domain/frames';
import { interiorCarpetBlocks, interiorCorridors, isPointOnInteriorWalkway } from '../../src/domain/interior-layout';
import { pointInPoly, safetyWorld, segmentsCross } from '../../src/domain/route-safety';
import { rugLayout } from '../../src/domain/rug-layout';
import { nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { walkShortcutPath } from '../../src/routing/walk';

/**
 * Part 2 (owner, 2026-11-15): the secondary sub-corridors (`مسار فرعي`) must follow the Mosque's
 * interior plan (the marble walkway grid), never cut across laid prayer carpets (plaza or interior),
 * never cross a documented barrier, and never route women through men's interior halls.
 */

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function bboxOf(ring: readonly XY[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

const inBox = (p: XY, b: Box) => p[0] > b.minX && p[0] < b.maxX && p[1] > b.minZ && p[1] < b.maxZ;

function auditShortcuts() {
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  const covered = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf)).covered.map((r) => {
    const ring = r.map(([x, z]) => [x, z] as XY);
    return { ring, box: bboxOf(ring) };
  });
  const interiorRects = interiorCarpetBlocks();
  const w = safetyWorld();

  const plazaStarts: LatLng[] = [
    [24.4664, 39.611],
    [24.4685, 39.6084],
    [24.4704, 39.6105],
    [24.4688, 39.614],
  ];
  const startGates = [1, 15, 25, 37].map((id) => POI_BY_ID.get(id)!);
  const starts: LatLng[] = [...plazaStarts, ...startGates.map((g) => [g.lat, g.lng] as LatLng)];
  const menInteriorDests = INTERIOR_POIS.filter((p) => p.floor === 'GF' && p.kind === 'prayer' && p.gender === 'men').slice(0, 12);
  const destGates = [6, 17, 37].map((id) => POI_BY_ID.get(id)!);
  const dests: LatLng[] = [...menInteriorDests.map((p) => [p.lat, p.lng] as LatLng), ...destGates.map((g) => [g.lat, g.lng] as LatLng)];

  let offered = 0;
  let clean = 0;
  const counts = { carpet: 0, interiorCarpet: 0, barrier: 0, womenTransit: 0, womenInteriorKind: 0 };
  const findings: { from: LatLng; to: LatLng; kinds: string[] }[] = [];

  for (const a of starts) {
    for (const b of dests) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const s = walkShortcutPath(a, b, { isWomen: false, allowWomenRawdahCorridor: false });
      if (!s) continue;
      offered++;
      const A = toModelMetres([a[1], a[0]]);
      const B = toModelMetres([b[1], b[0]]);
      const pts = s.path.map(([lat, lng]) => toModelMetres([lng, lat]));
      const kinds = new Set<string>();
      const endCarpetRings = covered.filter((c) => pointInPoly(A, c.ring) || pointInPoly(B, c.ring));
      const endInterior = interiorRects.filter((r) => inBox(A, { minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 }) || inBox(B, { minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 }));

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const steps = Math.max(1, Math.ceil(len / 0.75));
        const segBox: Box = { minX: Math.min(p0[0], p1[0]), maxX: Math.max(p0[0], p1[0]), minZ: Math.min(p0[1], p1[1]), maxZ: Math.max(p0[1], p1[1]) };
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const p: XY = [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u];
          if (!kinds.has('carpet')) {
            for (const c of covered) {
              if (endCarpetRings.includes(c)) continue;
              if (inBox(p, c.box) && pointInPoly(p, c.ring)) {
                kinds.add('carpet');
                break;
              }
            }
          }
          if (!kinds.has('interiorCarpet')) {
            for (const r of interiorRects) {
              if (endInterior.includes(r)) continue;
              if (p[0] > r.x0 && p[0] < r.x1 && p[1] > r.z0 && p[1] < r.z1) {
                kinds.add('interiorCarpet');
                break;
              }
            }
          }
          if (!kinds.has('womenTransit')) {
            for (const z of w.womenZones) {
              if (p[0] > z.minX && p[0] < z.maxX && p[1] > z.minY && p[1] < z.maxY && pointInPoly(p, z.poly)) {
                kinds.add('womenTransit');
                break;
              }
            }
          }
        }
        if (!kinds.has('barrier')) {
          for (const br of w.barriers) {
            if (br.source === 'women_fence') continue;
            if (segBox.maxX < br.minX || segBox.minX > br.maxX || segBox.maxZ < br.minY || segBox.minZ > br.maxY) continue;
            if (segmentsCross(p0, p1, br.a, br.b)) {
              kinds.add('barrier');
              break;
            }
          }
        }
      }

      if (kinds.size === 0) clean++;
      else {
        for (const k of kinds) counts[k as keyof typeof counts]++;
        findings.push({ from: a, to: b, kinds: [...kinds] });
      }
    }
  }

  for (const a of plazaStarts) {
    for (const g of startGates) {
      const s = walkShortcutPath(a, [g.lat, g.lng], { isWomen: true, allowWomenRawdahCorridor: false });
      if (s?.kind === 'interior') counts.womenInteriorKind++;
    }
  }

  return { offered, clean, violating: findings.length, counts, findings };
}

describe('Part 2 — sub-corridor safety (interior plan + carpets + barriers)', () => {
  it('interior corridors follow the marble walkway grid and never cross interior carpets', () => {
    const rects = interiorCarpetBlocks();
    for (const f of interiorCorridors().features) {
      if (f.properties.kind !== 'men_interior') continue;
      for (const [lng, lat] of f.geometry.coordinates) {
        const [x, z] = toModelMetres([lng, lat]);
        expect(isPointOnInteriorWalkway(x, z, 0.5), `corridor ${f.properties.id} vertex off walkway at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(true);
        expect(
          rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1),
          `corridor ${f.properties.id} vertex on carpet`,
        ).toBe(false);
      }
    }
  });

  it('offered sub-routes never cross carpets, barriers, or women zones (men and women)', () => {
    const audit = auditShortcuts();
    const summary = `offered=${audit.offered} clean=${audit.clean} violating=${audit.violating} counts=${JSON.stringify(audit.counts)} findings=${JSON.stringify(audit.findings.slice(0, 6))}`;
    expect(audit.counts.womenInteriorKind, summary).toBe(0);
    expect(audit.counts.carpet, summary).toBe(0);
    expect(audit.counts.interiorCarpet, summary).toBe(0);
    expect(audit.counts.barrier, summary).toBe(0);
    expect(audit.counts.womenTransit, summary).toBe(0);
    expect(audit.violating, summary).toBe(0);
  }, 120_000);
});
