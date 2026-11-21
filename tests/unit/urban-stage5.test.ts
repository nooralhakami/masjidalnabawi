import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import fence from '../../data/haram-fence.json';
import { INTERIOR_POIS, PARKING_SECTIONS, POI_BY_ID, POIS } from '../../src/data';
import { Facilities } from '../../src/domain/facilities';
import { isHidden } from '../../src/domain/filters';
import { haversine } from '../../src/domain/geo';
import { parkingSectionsForLot } from '../../src/domain/parking';
import {
  APPROVED_BUILDINGS,
  APPROVED_FOOTPRINT_BUILDINGS,
  APPROVED_HOTEL_IDS,
  isApprovedHotel,
  pathHitsApprovedBuilding,
  urbanOpacityForCamera,
} from '../../src/domain/urban-approval';
import { visiblePois } from '../../src/domain/visible';
import { lngLatFromMetres, parseGlbBuffer } from '../../src/map/glb-layer';
import { validateUrbanGlb } from '../../src/map/urban-3d';
import { fullPath, planRoutes } from '../../src/routing/plan';
import { restroomDoor } from '../../src/routing/walk';

const ROOT = resolve(import.meta.dirname, '../..');
const GLB_PATH = resolve(ROOT, 'public/models/urban-south-stage6.glb');

const ORIGINAL_IDS = [711, 713, 722, 724, 725, 728, 735];
// Representative Zone 1 South additions: single, provisional split, OSM-level (2449/2458/2466/2475), pin-only (2441)
const SAMPLE_NEW_IDS = [2402, 2403, 2411, 2420, 2431, 2441, 2449, 2458, 2466, 2475];

function insideRing(lng: number, lat: number, ring: readonly (readonly [number, number])[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('Stage 6 Zone 1 South urban slice & navQ verification', () => {
  it('A7 gate reveals all 57 owner-approved South hotels and keeps the 36 unapproved hotels, food, and wheelchair hidden', () => {
    expect(APPROVED_BUILDINGS).toHaveLength(57);
    expect(APPROVED_FOOTPRINT_BUILDINGS).toHaveLength(52);
    expect(APPROVED_HOTEL_IDS.size).toBe(57);
    for (const id of ORIGINAL_IDS) expect(APPROVED_HOTEL_IDS.has(id)).toBe(true);

    const hotels = POIS.filter((p) => p.subCategory === 'hotel');
    expect(hotels).toHaveLength(93);

    const visibleHotels = hotels.filter((p) => !isHidden(p));
    expect(visibleHotels).toHaveLength(57);
    for (const h of hotels) {
      expect(isApprovedHotel(h.id)).toBe(APPROVED_HOTEL_IDS.has(h.id));
    }

    expect(POIS.filter((p) => p.subCategory === 'food').every(isHidden)).toBe(true);
    expect(POIS.filter((p) => p.subCategory === 'wheelchair_zone').every(isHidden)).toBe(true);
  });

  it('A9 provenance guard validates urban-south-stage6.glb under <= 250 KB gzip with 52 tiered South buildings', () => {
    const buf = readFileSync(GLB_PATH);
    expect(gzipSync(buf).length).toBeLessThanOrEqual(250 * 1024);

    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { gltf } = parseGlbBuffer(ab);
    const res = validateUrbanGlb(gltf);
    expect(res.ok, res.reason).toBe(true);
    expect(res.buildingCount).toBe(52);
    expect(res.maxHeightM).toBeGreaterThanOrEqual(10);
    expect(res.maxHeightM).toBeLessThanOrEqual(72);

    // Every exported building mesh node's height & XZ bounds match its approved record (allowing <= 2.5 m cornice/canopy overhang).
    const accs = (gltf as { accessors: { min?: number[]; max?: number[] }[] }).accessors;
    const meshes = (gltf as { meshes: { primitives: { attributes: { POSITION: number } }[] }[] }).meshes;
    const nodes = (gltf as { nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[] }).nodes;
    for (const node of nodes) {
      if (!node.name?.startsWith('urban-hotel-') || typeof node.mesh !== 'number') continue;
      const b = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === Number(node.extras?.poiId))!;
      expect(b).toBeDefined();
      const pos = accs[meshes[node.mesh].primitives[0].attributes.POSITION];
      expect(Math.abs((pos.max?.[1] ?? 0) - b.heightM), node.name).toBeLessThanOrEqual(2.0);
      const sw = lngLatFromMetres([pos.min![0], pos.max![2]]);
      const ne = lngLatFromMetres([pos.max![0], pos.min![2]]);
      const polyLngs = b.polygon.map((c) => c[0]);
      const polyLats = b.polygon.map((c) => c[1]);
      expect(haversine([sw[1], sw[0]], [Math.min(...polyLats), Math.min(...polyLngs)]), `${node.name} sw`).toBeLessThan(2.5);
      expect(haversine([ne[1], ne[0]], [Math.max(...polyLats), Math.max(...polyLngs)]), `${node.name} ne`).toBeLessThan(2.5);
    }

    // A9 rejects unapproved nodes or tampered out-of-range heights.
    const spoofed = structuredClone(gltf) as unknown as { nodes: { name?: string; mesh?: number }[] };
    spoofed.nodes.push({ name: 'osm-synthetic-tower-999' });
    expect(validateUrbanGlb(spoofed).ok).toBe(false);

    const extruded = structuredClone(gltf) as unknown as {
      nodes: { name?: string; mesh?: number }[];
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
      accessors: { max?: number[] }[];
    };
    const hotelNode = extruded.nodes.find((n) => n.name?.startsWith('urban-hotel-'))!;
    const accIdx = extruded.meshes[hotelNode.mesh!].primitives[0].attributes.POSITION;
    extruded.accessors[accIdx].max = [0, 95, 0];
    expect(validateUrbanGlb(extruded).ok).toBe(false);
  });

  it('height provenance & zero Haram fence intrusion across all 52 footprinted South hotels', () => {
    const est = APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.heightSource === 'estimated_display_only');
    const osm = APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.heightSource === 'osm_levels');
    expect(osm.length).toBe(4);
    expect(est.length).toBe(48);
    for (const b of est) {
      expect(b.levels).toBeNull();
      expect(b.displayFloors).toBeGreaterThanOrEqual(10);
      expect(b.displayFloors).toBeLessThanOrEqual(14);
    }
    for (const b of osm) {
      expect(typeof b.levels).toBe('number');
      expect(b.levels!).toBeGreaterThanOrEqual(1);
    }
    const haramRing = (fence.runs as { path: number[][] }[]).flatMap((r) => r.path as [number, number][]);
    for (const b of APPROVED_FOOTPRINT_BUILDINGS) {
      for (const [lng, lat] of b.polygon) {
        expect(insideRing(lng, lat, haramRing), `${b.buildingId} inside Haram fence`).toBe(false);
      }
    }
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

  it('walk and drive routes to all 7 original + 10 representative new South hotels end <= 3 m from entrance with 0 polygon intersections', async () => {
    const plazaStart: [number, number] = [24.46605, 39.6095];
    const carStart: [number, number] = [24.4605, 39.6085];

    for (const id of [...ORIGINAL_IDS, ...SAMPLE_NEW_IDS]) {
      const b = APPROVED_BUILDINGS.find((x) => x.poiId === id)!;
      const poi = POI_BY_ID.get(id)!;
      expect(b, `approved ${id}`).toBeDefined();
      expect(poi, `poi ${id}`).toBeDefined();

      const walkPlans = await planRoutes(plazaStart, poi, 'walk');
      expect(walkPlans.length, `walk ${id}`).toBeGreaterThan(0);
      const walkPath = fullPath(walkPlans[0]);
      expect(haversine(walkPath[walkPath.length - 1], b.entrance), `walk end dist ${id}`).toBeLessThanOrEqual(3);
      expect(pathHitsApprovedBuilding(walkPath), `walk polygon intersect ${id}`).toBe(false);

      const drivePlans = await planRoutes(carStart, poi, 'drive');
      expect(drivePlans.length, `drive ${id}`).toBeGreaterThan(0);
      const drivePath = fullPath(drivePlans[0]);
      expect(haversine(drivePath[drivePath.length - 1], b.entrance), `drive end dist ${id}`).toBeLessThanOrEqual(3);
      expect(pathHitsApprovedBuilding(drivePath), `drive polygon intersect ${id}`).toBe(false);
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
