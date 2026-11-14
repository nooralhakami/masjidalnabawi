import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID, ROUTING } from '../../src/data';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { WOMEN_AREAS } from '../../src/data-next/women-areas';
import type { LatLng, Poi } from '../../src/data/types';
import { toModelMetres, type XY } from '../../src/domain/frames';
import { GREETING_BARRIERS, QUEUE_RAILS } from '../../src/domain/rawdah-layout';
import { rugLayout } from '../../src/domain/rug-layout';
import { metresFromOrigin, nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';
import { inHaram } from '../../src/routing/plan';
import { insideRect, isWomenPoi, network, pathLength, restroomDoor, toM, walkPath, walkShortcutPath } from '../../src/routing/walk';

interface AuditEndpoint {
  key: string;
  label: string;
  category: string;
  coord: LatLng;
  coordM: XY;
  isWomen: boolean;
  womenZoneIds: string[];
}

type ViolationKind = 'carpet' | 'barrier' | 'women_transit' | 'women_barrier_cross';

interface AuditFinding {
  from: string;
  to: string;
  kinds: ViolationKind[];
  details: string[];
  lengthM: number;
}

const CELL_M = 12;

function insidePolygon(p: readonly [number, number], ring: readonly (readonly [number, number])[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function orient(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9))) return true;
  if (Math.abs(o1) <= 1e-9 && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= 1e-9 && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= 1e-9 && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= 1e-9 && onSegment(c, d, b)) return true;
  return false;
}

function bboxOf(pts: readonly XY[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function addToGrid<T>(grid: Map<string, T[]>, box: { minX: number; maxX: number; minZ: number; maxZ: number }, item: T) {
  const ix0 = Math.floor(box.minX / CELL_M);
  const ix1 = Math.floor(box.maxX / CELL_M);
  const iz0 = Math.floor(box.minZ / CELL_M);
  const iz1 = Math.floor(box.maxZ / CELL_M);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const k = `${ix}|${iz}`;
      const arr = grid.get(k);
      if (arr) arr.push(item);
      else grid.set(k, [item]);
    }
  }
}

function queryGridSegment<T>(grid: Map<string, T[]>, a: XY, b: XY): Set<T> {
  const ix0 = Math.floor(Math.min(a[0], b[0]) / CELL_M);
  const ix1 = Math.floor(Math.max(a[0], b[0]) / CELL_M);
  const iz0 = Math.floor(Math.min(a[1], b[1]) / CELL_M);
  const iz1 = Math.floor(Math.max(a[1], b[1]) / CELL_M);
  const out = new Set<T>();
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const arr = grid.get(`${ix}|${iz}`);
      if (arr) for (const item of arr) out.add(item);
    }
  }
  return out;
}

function runRouteSafetyAudit() {
  const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
  const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  const layout = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf));

  const coveredGrid = new Map<string, { ring: XY[]; minX: number; maxX: number; minZ: number; maxZ: number }[]>();
  for (const r of layout.covered) {
    const ring = r.map(([x, z]) => [x, z] as XY);
    const box = bboxOf(ring);
    addToGrid(coveredGrid, box, { ring, ...box });
  }

  interface SegBarrier {
    a: XY;
    b: XY;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    source: 'prayer_barrier' | 'queue_rail' | 'greeting_barrier' | 'women_fence';
    areaId?: string;
  }
  const barrierGrid = new Map<string, SegBarrier[]>();
  const addBarrierSeg = (a: XY, b: XY, source: SegBarrier['source'], areaId?: string) => {
    const box = bboxOf([a, b]);
    addToGrid(barrierGrid, box, { a, b, ...box, source, areaId });
  };

  for (const feat of layout.barriers.features) {
    const ring = feat.geometry.coordinates[0].map(([lng, lat]) => toModelMetres([lng, lat]));
    for (let i = 1; i < ring.length; i++) addBarrierSeg(ring[i - 1], ring[i], 'prayer_barrier');
  }
  for (const run of QUEUE_RAILS) {
    for (let i = 1; i < run.length; i++) addBarrierSeg(run[i - 1], run[i], 'queue_rail');
  }
  for (const run of GREETING_BARRIERS) {
    for (let i = 1; i < run.length; i++) addBarrierSeg(run[i - 1], run[i], 'greeting_barrier');
  }
  const womenZones = WOMEN_AREAS.map((area) => {
    const poly = area.zone.map(([lat, lng]) => toModelMetres([lng, lat]));
    const box = bboxOf(poly);
    for (const run of area.barriers) {
      const pts = run.map(([lat, lng]) => toModelMetres([lng, lat]));
      for (let i = 1; i < pts.length; i++) addBarrierSeg(pts[i - 1], pts[i], 'women_fence', area.id);
    }
    return { id: area.id, poly, ...box };
  });

  const N = network();
  const inObstacle = (ll: LatLng) => N.obstacles.some((r) => insideRect(toM(ll), r));

  const endpointOfPoi = (p: Poi): AuditEndpoint => {
    const coord = p.category === 'toilets' ? (restroomDoor(p) ?? ([p.lat, p.lng] as LatLng)) : ([p.lat, p.lng] as LatLng);
    const coordM = toModelMetres([coord[1], coord[0]]);
    const poiM = toModelMetres([p.lng, p.lat]);
    const womenZoneIds = womenZones.filter((z) => insidePolygon(coordM, z.poly) || insidePolygon(poiM, z.poly)).map((z) => z.id);
    return {
      key: `poi-${p.id}`,
      label: `${p.name_ar} (#${p.id})`,
      category: p.subCategory ?? p.category,
      coord,
      coordM,
      isWomen: isWomenPoi(p) || womenZoneIds.length > 0,
      womenZoneIds,
    };
  };

  const plazaStarts: AuditEndpoint[] = (
    [
      ['plaza-south', 'الساحة الجنوبية', [24.4664, 39.611]],
      ['plaza-west', 'الساحة الغربية', [24.4685, 39.6084]],
      ['plaza-north', 'الساحة الشمالية', [24.4704, 39.6105]],
      ['plaza-east', 'الساحة الشرقية', [24.4688, 39.614]],
    ] as [string, string, LatLng][]
  ).map(([key, label, coord]) => {
    const coordM = toModelMetres([coord[1], coord[0]]);
    const womenZoneIds = womenZones.filter((z) => insidePolygon(coordM, z.poly)).map((z) => z.id);
    return { key, label, category: 'plaza_side', coord, coordM, isWomen: womenZoneIds.length > 0, womenZoneIds };
  });

  const reachablePois = POIS.filter((p) => p.category !== 'parking' && p.subCategory !== 'wheelchair_zone' && !inObstacle([p.lat, p.lng]) && inHaram([p.lat, p.lng])).map(
    endpointOfPoi,
  );

  // Deduplicate start coordinates while covering all 4 plaza sides + outer gates + inner gates/restrooms/services inside Haram.
  const starts: AuditEndpoint[] = [...plazaStarts, ...reachablePois];
  const dests: AuditEndpoint[] = reachablePois;

  const findings: AuditFinding[] = [];
  let totalRoutes = 0;
  let cleanRoutes = 0;
  const counts: Record<ViolationKind, number> = {
    carpet: 0,
    barrier: 0,
    women_transit: 0,
    women_barrier_cross: 0,
  };
  const detailCounts: Record<string, number> = {};

  for (const s of starts) {
    for (const t of dests) {
      if (s.key === t.key) continue;
      totalRoutes++;
      const path = walkPath(s.coord, t.coord);
      const pts = path.map(([lat, lng]) => toModelMetres([lng, lat]));
      const lengthM = Math.round(pathLength(path));

      let hitCarpet = false;
      const barrierSources = new Set<string>();
      const womenTransitIds = new Set<string>();
      const womenBarrierCrossIds = new Set<string>();
      const neitherWomen = !s.isWomen && !t.isWomen;

      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(segLen / 0.75));
        const segMinX = Math.min(a[0], b[0]);
        const segMaxX = Math.max(a[0], b[0]);
        const segMinZ = Math.min(a[1], b[1]);
        const segMaxZ = Math.max(a[1], b[1]);

        const covCandidates = !hitCarpet ? coveredGrid.get(`${Math.floor(a[0] / CELL_M)}|${Math.floor(a[1] / CELL_M)}`) : undefined;
        const covSet = !hitCarpet ? (segLen > 0 ? queryGridSegment(coveredGrid, a, b) : new Set(covCandidates ?? [])) : null;

        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const p: XY = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

          if (!hitCarpet && covSet) {
            for (const c of covSet) {
              if (p[0] > c.minX && p[0] < c.maxX && p[1] > c.minZ && p[1] < c.maxZ && insidePolygon(p, c.ring)) {
                hitCarpet = true;
                break;
              }
            }
          }

          if (neitherWomen) {
            for (const z of womenZones) {
              if (!womenTransitIds.has(z.id) && p[0] > z.minX && p[0] < z.maxX && p[1] > z.minZ && p[1] < z.maxZ && insidePolygon(p, z.poly)) {
                womenTransitIds.add(z.id);
              }
            }
          }
        }

        const barSet = queryGridSegment(barrierGrid, a, b);
        for (const br of barSet) {
          if (segMaxX < br.minX || segMinX > br.maxX || segMaxZ < br.minZ || segMinZ > br.maxZ) continue;
          if (!segmentsCross(a, b, br.a, br.b)) continue;
          if (br.source === 'women_fence' && br.areaId) {
            const endpointInThisZone = s.womenZoneIds.includes(br.areaId) || t.womenZoneIds.includes(br.areaId);
            if (endpointInThisZone) {
              womenBarrierCrossIds.add(br.areaId);
            } else {
              barrierSources.add(`women_fence:${br.areaId}`);
            }
          } else {
            barrierSources.add(br.source);
          }
        }
      }

      const kinds: ViolationKind[] = [];
      const details: string[] = [];
      if (hitCarpet) {
        kinds.push('carpet');
        details.push('قطع سجادة مصلى مفروشة');
        counts.carpet++;
        detailCounts.carpet = (detailCounts.carpet ?? 0) + 1;
      }
      if (barrierSources.size > 0) {
        kinds.push('barrier');
        for (const src of barrierSources) {
          detailCounts[src] = (detailCounts[src] ?? 0) + 1;
        }
        details.push(`قطع حاجز (${[...barrierSources].join(', ')})`);
        counts.barrier++;
      }
      if (womenTransitIds.size > 0) {
        kinds.push('women_transit');
        details.push(`عبور عابر لمنطقة النساء (${[...womenTransitIds].join(', ')})`);
        counts.women_transit++;
        detailCounts.women_transit = (detailCounts.women_transit ?? 0) + 1;
      }
      if (womenBarrierCrossIds.size > 0) {
        kinds.push('women_barrier_cross');
        details.push(`اختراق سور منطقة النساء خارج البوابة (${[...womenBarrierCrossIds].join(', ')})`);
        counts.women_barrier_cross++;
        detailCounts.women_barrier_cross = (detailCounts.women_barrier_cross ?? 0) + 1;
      }

      if (kinds.length === 0) {
        cleanRoutes++;
      } else {
        findings.push({ from: s.label, to: t.label, kinds, details, lengthM });
      }
    }
  }

  return {
    totalRoutes,
    cleanRoutes,
    violatingRoutes: findings.length,
    counts,
    detailCounts,
    findings,
    startCount: starts.length,
    destCount: dests.length,
    reachablePoiIds: dests.map((d) => Number(d.key.replace('poi-', ''))),
    layout,
  };
}

function formatAuditReport(audit: ReturnType<typeof runRouteSafetyAudit>): string {
  const topOrigins = new Map<string, number>();
  const topDests = new Map<string, number>();
  for (const f of audit.findings) {
    topOrigins.set(f.from, (topOrigins.get(f.from) ?? 0) + 1);
    topDests.set(f.to, (topDests.get(f.to) ?? 0) + 1);
  }
  const sortTop = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const lines: string[] = [
    '# تدقيق أمان التوجيه — المرحلة 3 (`D12-أ`، قراءة فقط دون تغيير سلوك)',
    '',
    'تاريخ التدقيق: `[2026-11-14]` | الفرع: `rebuild/from-main`',
    '',
    '> **الغرض (وفق الخطة المعدلة §5 المرحلة 3):** حصر جميع المسارات الحالية التي تقطع سجادة مصلى أو حاجزًا موثقًا أو منطقة نساء، دون تعديل أي سلوك في `src/routing/` قبل اعتماد المالك لجدول التدقيق وتحديد قواعد الإصلاح (`D12-ب` و`D15`) في المرحلة 4.',
    '',
    '## 1. ملخص الإحصاءات',
    '',
    '| المؤشر | القيمة |',
    '|---|---|',
    `| عدد نقاط الانطلاق المفحوصة (4 ساحات + ${audit.destCount} معلم/بوابة/مرفق داخل الحرم) | **${audit.startCount}** |`,
    `| عدد الوجهات داخل الحرم (\`inHaram && !inObstacle\`) | **${audit.destCount}** |`,
    `| إجمالي المسارات المفحوصة | **${audit.totalRoutes}** |`,
    `| المسارات السليمة تمامًا (0 اختراقات) | **${audit.cleanRoutes}** |`,
    `| المسارات المخالفة (اختراق واحد على الأقل) | **${audit.violatingRoutes}** |`,
    `| مخالفة فئة 1 — قطع سجادة مصلى (\`carpet\`) | **${audit.counts.carpet}** |`,
    `| مخالفة فئة 2 — قطع حاجز موثق (\`barrier\`) | **${audit.counts.barrier}** |`,
    `| مخالفة فئة 3أ — عبور عابر عبر منطقة النساء (\`women_transit\`) | **${audit.counts.women_transit}** |`,
    `| مخالفة فئة 3ب — دخول/خروج عبر سور النساء خارج البوابة (\`women_barrier_cross\`) | **${audit.counts.women_barrier_cross}** |`,
    '',
    '### تفصيل الحواجز الفرعية المقطوعة',
    '',
    '| النوع الفرعي | عدد المسارات |',
    '|---|---|',
    ...Object.entries(audit.detailCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| \`${k}\` | ${v} |`),
    '',
    '## 2. أكثر نقاط الانطلاق والوصول تسببًا في المخالفات (أعلى 15)',
    '',
    '### أ. أكثر نقاط الانطلاق تسببًا في المخالفات',
    '| نقطة الانطلاق | عدد المسارات المخالفة |',
    '|---|---|',
    ...sortTop(topOrigins).map(([name, c]) => `| ${name} | ${c} |`),
    '',
    '### ب. أكثر الوجهات تسببًا في المخالفات',
    '| الوجهة | عدد المسارات المخالفة |',
    '|---|---|',
    ...sortTop(topDests).map(([name, c]) => `| ${name} | ${c} |`),
    '',
    '## 3. جدول التدقيق الكامل للمسارات المخالفة',
    '',
    '| # | من | إلى | نوع الاختراق | التفصيل | الطول الحالي (م) |',
    '|---|---|---|---|---|---:|',
    ...audit.findings.map((f, i) => `| ${i + 1} | ${f.from} | ${f.to} | \`${f.kinds.join(', ')}\` | ${f.details.join('؛ ')} | ${f.lengthM} |`),
    '',
  ];
  return lines.join('\n');
}

describe('Phase 3 route safety audit (D12-a: read-only audit without changing routing)', () => {
  it('verifies corridor graph safety (0 carpet crossings on walkways, 0 men_interior for women)', () => {
    const f = readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb'));
    const { gltf } = parseGlbBuffer(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
    const covered = rugLayout(nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf)).covered;
    const walkwayLines: [string, number[][]][] = [
      ['ring', [...ROUTING.walkway_ring, ROUTING.walkway_ring[0]]],
      ...ROUTING.walkways.map((w) => [w.id, w.path] as [string, number[][]]),
    ];
    let walkwayCarpetHits = 0;
    for (const [, path] of walkwayLines) {
      for (let i = 1; i < path.length; i++) {
        const a = metresFromOrigin([path[i - 1][1], path[i - 1][0]]);
        const b = metresFromOrigin([path[i][1], path[i][0]]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t <= len; t += 1) {
          const x = a[0] + ((b[0] - a[0]) * t) / Math.max(1, len);
          const z = a[1] + ((b[1] - a[1]) * t) / Math.max(1, len);
          if (covered.some((r) => insidePolygon([x, z], r))) walkwayCarpetHits++;
        }
      }
    }
    expect(walkwayCarpetHits).toBe(0);

    // Ensure womenSafe shortcut never enters men_interior across outer/inner plaza pairs.
    const gate3 = POI_BY_ID.get(3)!;
    const gate21 = POI_BY_ID.get(21)!;
    const gate37 = POI_BY_ID.get(37)!;
    for (const [from, to] of [
      [
        [gate3.lat, gate3.lng],
        [gate21.lat, gate21.lng],
      ],
      [
        [gate3.lat, gate3.lng],
        [gate37.lat, gate37.lng],
      ],
      [
        [24.4699, 39.609],
        [24.467, 39.6135],
      ],
    ] as [LatLng, LatLng][]) {
      const s = walkShortcutPath(from, to, { isWomen: true, allowWomenRawdahCorridor: false });
      expect(s?.kind).not.toBe('interior');
    }
  });

  it('audits all reachable Haram pairs and records the Phase 3 baseline table', () => {
    const audit = runRouteSafetyAudit();
    if (process.env.WRITE_AUDIT_REPORT === '1') {
      const md = formatAuditReport(audit);
      for (const outPath of [
        resolve(__dirname, '../../docs/progress/2026-11-14-phase3-route-safety-audit.md'),
        '/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/جدول-تدقيق-أمان-التوجيه-المرحلة-3.md',
      ]) {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, md, 'utf8');
      }
    }
    // Phase 3 baseline updated after navQ outer gates (1401–1420) & 251–254 center nudge (pre-Phase 4 fixes):
    expect(audit.startCount).toBe(171);
    expect(audit.destCount).toBe(167);
    expect(audit.totalRoutes).toBe(28_390);
    expect(audit.cleanRoutes + audit.violatingRoutes).toBe(audit.totalRoutes);
    expect(audit.cleanRoutes).toBe(26_640);
    expect(audit.violatingRoutes).toBe(1_750);
    expect(audit.counts).toEqual({
      carpet: 1_423,
      barrier: 800,
      women_transit: 0,
      women_barrier_cross: 0,
    });
  }, 60_000);
});
