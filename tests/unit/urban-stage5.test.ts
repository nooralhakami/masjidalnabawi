import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { INTERIOR_POIS, PARKING_SECTIONS, POI_BY_ID, POIS } from '../../src/data';
import { isHidden } from '../../src/domain/filters';
import { haversine } from '../../src/domain/geo';
import { parkingSectionsForLot } from '../../src/domain/parking';
import { APPROVED_BUILDINGS, APPROVED_HOTEL_IDS, isApprovedHotel, pathHitsApprovedBuilding, urbanOpacityForCamera } from '../../src/domain/urban-approval';
import { visiblePois } from '../../src/domain/visible';
import { Facilities } from '../../src/domain/facilities';
import { lngLatFromMetres, parseGlbBuffer } from '../../src/map/glb-layer';
import { validateUrbanGlb } from '../../src/map/urban-3d';
import { fullPath, planRoutes } from '../../src/routing/plan';
import { restroomDoor } from '../../src/routing/walk';

const ROOT = resolve(import.meta.dirname, '../..');
const GLB_PATH = resolve(ROOT, 'public/models/urban-south-stage5.glb');

const APPROVED_IDS = [711, 713, 722, 724, 725, 728, 735];

describe('Stage 5 Southern Plaza urban slice & navQ verification', () => {
  it('A7 gate reveals only the 7 owner-approved hotels and keeps the other 36 hotels, food, and wheelchair hidden', () => {
    expect(APPROVED_BUILDINGS).toHaveLength(7);
    expect([...APPROVED_HOTEL_IDS].sort((a, b) => a - b)).toEqual(APPROVED_IDS);

    const hotels = POIS.filter((p) => p.subCategory === 'hotel');
    expect(hotels).toHaveLength(43);

    const visibleHotels = hotels.filter((p) => !isHidden(p));
    expect(visibleHotels.map((p) => p.id).sort((a, b) => a - b)).toEqual(APPROVED_IDS);
    for (const h of hotels) {
      expect(isApprovedHotel(h.id)).toBe(APPROVED_IDS.includes(h.id));
    }

    expect(POIS.filter((p) => p.subCategory === 'food').every(isHidden)).toBe(true);
    expect(POIS.filter((p) => p.subCategory === 'wheelchair_zone').every(isHidden)).toBe(true);
  });

  it('A9 synthetic-scene guard validates urban-south-stage5.glb under <= 250 KB gzip with flat footprints only', () => {
    const buf = readFileSync(GLB_PATH);
    expect(gzipSync(buf).length).toBeLessThanOrEqual(250 * 1024);

    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { gltf } = parseGlbBuffer(ab);
    const res = validateUrbanGlb(gltf);
    expect(res.ok).toBe(true);
    expect(res.buildingCount).toBe(7);
    expect(res.maxHeightM).toBeLessThan(1.0);

    // Every exported building mesh node's glTF XZ bounds match its Microsoft footprint bbox within 0.5 m.
    const accs = (gltf as { accessors: { min?: number[]; max?: number[] }[] }).accessors;
    const meshes = (gltf as { meshes: { primitives: { attributes: { POSITION: number } }[] }[] }).meshes;
    const nodes = (gltf as { nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[] }).nodes;
    for (const node of nodes) {
      if (!node.name?.startsWith('urban-hotel-') || typeof node.mesh !== 'number') continue;
      const b = APPROVED_BUILDINGS.find((x) => x.poiId === Number(node.extras?.poiId))!;
      const pos = accs[meshes[node.mesh].primitives[0].attributes.POSITION];
      expect(pos.max?.[1]).toBeCloseTo(0.35, 2);
      const sw = lngLatFromMetres([pos.min![0], pos.max![2]]);
      const ne = lngLatFromMetres([pos.max![0], pos.min![2]]);
      const polyLngs = b.polygon.map((c) => c[0]);
      const polyLats = b.polygon.map((c) => c[1]);
      expect(haversine([sw[1], sw[0]], [Math.min(...polyLats), Math.min(...polyLngs)])).toBeLessThan(0.5);
      expect(haversine([ne[1], ne[0]], [Math.max(...polyLats), Math.max(...polyLngs)])).toBeLessThan(0.5);
    }

    // A9 rejects unapproved building nodes or synthetic vertical extrusion >= 1 m.
    const spoofed = structuredClone(gltf) as unknown as { nodes: { name?: string; mesh?: number }[]; accessors: { max?: number[] }[] };
    spoofed.nodes.push({ name: 'osm-synthetic-tower-999' });
    expect(validateUrbanGlb(spoofed).ok).toBe(false);

    const extruded = structuredClone(gltf) as unknown as { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { max?: number[] }[] };
    const accIdx = extruded.meshes[0].primitives[0].attributes.POSITION;
    extruded.accessors[accIdx].max = [0, 32, 0];
    expect(validateUrbanGlb(extruded).ok).toBe(false);
  });

  it('A8 obstruction fade stays in [0.25, 0.35] when looking northward across Southern Plaza at 3D pitch, else 1', () => {
    expect(urbanOpacityForCamera(0, 0)).toBe(1);
    expect(urbanOpacityForCamera(22, 15)).toBe(1);
    expect(urbanOpacityForCamera(180, 45)).toBe(1);
    expect(urbanOpacityForCamera(-120, 50)).toBe(1);

    for (const [b, p] of [
      [0, 45],
      [22, 45],
      [-30, 50],
      [45, 35],
    ]) {
      const a = urbanOpacityForCamera(b, p);
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.35);
    }
  });

  it('walk and drive routes to all 7 approved hotels end <= 3 m from western facade door with 0 polygon intersections', async () => {
    const plazaStart: [number, number] = [24.46605, 39.6095];
    const carStart: [number, number] = [24.4605, 39.6085];

    for (const b of APPROVED_BUILDINGS) {
      const poi = POI_BY_ID.get(b.poiId)!;
      expect(poi).toBeDefined();

      const walkPlans = await planRoutes(plazaStart, poi, 'walk');
      expect(walkPlans.length, `walk ${b.poiId}`).toBeGreaterThan(0);
      const walkPath = fullPath(walkPlans[0]);
      expect(haversine(walkPath[walkPath.length - 1], b.entrance), `walk end dist ${b.poiId}`).toBeLessThanOrEqual(3);
      expect(pathHitsApprovedBuilding(walkPath), `walk polygon intersect ${b.poiId}`).toBe(false);

      const drivePlans = await planRoutes(carStart, poi, 'drive');
      expect(drivePlans.length, `drive ${b.poiId}`).toBeGreaterThan(0);
      const drivePath = fullPath(drivePlans[0]);
      expect(haversine(drivePath[drivePath.length - 1], b.entrance), `drive end dist ${b.poiId}`).toBeLessThanOrEqual(3);
      expect(pathHitsApprovedBuilding(drivePath), `drive polygon intersect ${b.poiId}`).toBe(false);
    }
  });

  it('navQ interior (112) & parking sections (24) load cleanly, and western blocks 251–254 have valid restroomDoor', () => {
    expect(INTERIOR_POIS).toHaveLength(112);
    expect(INTERIOR_POIS.filter((p) => p.floor === 'GF' && p.kind === 'prayer')).toHaveLength(41);
    expect(INTERIOR_POIS.filter((p) => p.floor === 'ROF' && p.kind === 'prayer')).toHaveLength(57);
    expect(INTERIOR_POIS.filter((p) => p.kind === 'landmark')).toHaveLength(14);

    const fac = new Facilities();
    const emptyVisible = visiblePois('all', 'all', '', fac);
    expect(emptyVisible.some((p) => p.interiorOnly)).toBe(false);

    const searchVisible = visiblePois('all', 'all', 'A19', fac);
    expect(searchVisible.some((p) => p.interiorOnly && p.code === 'A19')).toBe(true);

    expect(PARKING_SECTIONS).toHaveLength(24);
    expect(parkingSectionsForLot(901).length).toBeGreaterThan(0);

    for (const id of [251, 252, 253, 254]) {
      expect(restroomDoor(POI_BY_ID.get(id)!), `restroomDoor(${id})`).not.toBeNull();
    }
  });
});
