import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import fence from '../../data/haram-fence.json';
import { INTERIOR_POIS, PARKING_SECTIONS, POI_BY_ID, POIS } from '../../src/data';
import { Facilities } from '../../src/domain/facilities';
import { isHidden } from '../../src/domain/filters';
import { toModelMetres } from '../../src/domain/frames';
import { haversine } from '../../src/domain/geo';
import { parkingSectionsForLot } from '../../src/domain/parking';
import {
  APPROVED_BUILDINGS,
  APPROVED_FOOTPRINT_BUILDINGS,
  APPROVED_HOTEL_IDS,
  CONTEXT_BUILDINGS,
  isApprovedHotel,
  pathHitsApprovedBuilding,
  pickApprovedBuildingRay,
  resolveUrban3DMode,
  urbanOpacityForCamera,
} from '../../src/domain/urban-approval';
import { visiblePois } from '../../src/domain/visible';
import { lngLatFromMetres, parseGlbBuffer } from '../../src/map/glb-layer';
import { sceneLight } from '../../src/map/scene-light';
import { Urban3DLayer, type UrbanZoneId, validateUrbanGlb } from '../../src/map/urban-3d';
import { fullPath, planRoutes } from '../../src/routing/plan';
import { restroomDoor } from '../../src/routing/walk';

const ROOT = resolve(import.meta.dirname, '../..');
const SOUTH_GLB_PATH = resolve(ROOT, 'public/models/urban-south-stage6.glb');
const WEST_GLB_PATH = resolve(ROOT, 'public/models/urban-west-stage6.glb');
const NORTH_GLB_PATH = resolve(ROOT, 'public/models/urban-north-stage6.glb');
const SW_GLB_PATH = resolve(ROOT, 'public/models/urban-sw-stage6.glb');
const CONTEXT_GLB_PATH = resolve(ROOT, 'public/models/urban-context-stage7.glb');

const ORIGINAL_IDS = [701, 705, 706, 710, 711, 713, 716, 720, 722, 724, 725, 728, 732, 734, 735, 738, 741, 743];
const SAMPLE_SOUTH_IDS = [2402, 2420, 2441, 2449, 2475];
const SAMPLE_WEST_IDS = [2203, 2206, 2216, 2224, 2237, 2253];
const SAMPLE_NORTH_IDS = [2104, 2110, 2127, 2157, 2165];
const SAMPLE_SW_IDS = [2302, 2307, 2310, 2342, 2371, 2377, 2388];

function insideRing(lng: number, lat: number, ring: readonly (readonly [number, number])[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('Stage 6 Zones 1–4 (South + West + North + Southwest) urban slice & 3D pick verification', () => {
  it('A7 gate reveals 228 owner-approved South+West+North+SW hotels (226 on satellite-aligned footprints, 2 pin-only) and hides 4 unapproved hotels, food, and wheelchair', () => {
    expect(APPROVED_BUILDINGS).toHaveLength(228);
    expect(APPROVED_BUILDINGS.filter((b) => b.zone === 'south')).toHaveLength(57);
    expect(APPROVED_BUILDINGS.filter((b) => b.zone === 'west')).toHaveLength(39);
    expect(APPROVED_BUILDINGS.filter((b) => b.zone === 'north')).toHaveLength(61);
    expect(APPROVED_BUILDINGS.filter((b) => b.zone === 'sw')).toHaveLength(71);
    expect(APPROVED_FOOTPRINT_BUILDINGS).toHaveLength(226);
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.zone === 'south')).toHaveLength(57);
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.zone === 'west')).toHaveLength(38);
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.zone === 'north')).toHaveLength(61);
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.zone === 'sw')).toHaveLength(70);
    expect(APPROVED_BUILDINGS.filter((b) => !b.hasFootprint).map((b) => b.guideNumber)).toEqual([206, 374]);
    // Stage 7 alignment pass (2026-11-27): no provisional pin partition and no ms_shifted hotel remain;
    // every footprinted outline (including #104 via stitched OSM relation r9248089) is a real OSM building.
    expect(APPROVED_FOOTPRINT_BUILDINGS.every((b) => b.footprintSplit === 'single' || b.footprintSplit === 'osm_split')).toBe(true);
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.footprintSplit === 'ms_shifted')).toHaveLength(0);
    expect(APPROVED_FOOTPRINT_BUILDINGS.find((b) => b.guideNumber === 104)?.osm).toBe('r9248089');
    expect(APPROVED_FOOTPRINT_BUILDINGS.filter((b) => (b.holes?.length ?? 0) > 0)).toHaveLength(12);
    expect(APPROVED_HOTEL_IDS.size).toBe(228);
    for (const id of ORIGINAL_IDS) expect(APPROVED_HOTEL_IDS.has(id)).toBe(true);

    // Unmatched South/West/North & duplicates #171 / #373 are never duplicated as separate POIs; #171 sits in 734's alias and #373 in 735's alias.
    expect(POI_BY_ID.has(2244)).toBe(false);
    expect(POI_BY_ID.has(2166)).toBe(false);
    expect(POI_BY_ID.has(2167)).toBe(false);
    expect(POI_BY_ID.has(2171)).toBe(false);
    expect(POI_BY_ID.has(2373)).toBe(false);
    expect((POI_BY_ID.get(734)?.alias ?? '').split(/\s+/)).toContain('171');
    expect((POI_BY_ID.get(735)?.alias ?? '').split(/\s+/)).toContain('373');

    const hotels = POIS.filter((p) => p.subCategory === 'hotel');
    expect(hotels).toHaveLength(232);

    const visibleHotels = hotels.filter((p) => !isHidden(p));
    expect(visibleHotels).toHaveLength(228);
    for (const h of hotels) {
      expect(isApprovedHotel(h.id)).toBe(APPROVED_HOTEL_IDS.has(h.id));
    }

    expect(POIS.filter((p) => p.subCategory === 'food').every(isHidden)).toBe(true);
    expect(POIS.filter((p) => p.subCategory === 'wheelchair_zone').every(isHidden)).toBe(true);
  });

  it.each([
    ['south', SOUTH_GLB_PATH, 57],
    ['west', WEST_GLB_PATH, 38],
    ['north', NORTH_GLB_PATH, 61],
    ['sw', SW_GLB_PATH, 70],
  ] as readonly [UrbanZoneId, string, number][])(
    'A9 provenance guard validates urban-%s-stage6.glb under <= 250 KiB gzip with %d tiered buildings',
    (zone, glbPath, expectedCount) => {
      const buf = readFileSync(glbPath);
      expect(gzipSync(buf).length).toBeLessThanOrEqual(250 * 1024);

      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const { gltf } = parseGlbBuffer(ab);
      const res = validateUrbanGlb(gltf, zone);
      expect(res.ok, res.reason).toBe(true);
      expect(res.buildingCount).toBe(expectedCount);
      expect(res.maxHeightM).toBeGreaterThanOrEqual(10);
      expect(res.maxHeightM).toBeLessThanOrEqual(72);

      const otherZone: UrbanZoneId = zone === 'south' ? 'west' : zone === 'west' ? 'north' : 'south';
      expect(validateUrbanGlb(gltf, otherZone).ok).toBe(false);

      const accs = (gltf as { accessors: { min?: number[]; max?: number[] }[] }).accessors;
      const meshes = (gltf as { meshes: { primitives: { attributes: { POSITION: number } }[] }[] }).meshes;
      const nodes = (gltf as { nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[] }).nodes;
      for (const node of nodes) {
        // Owner, 2026-11-25: all 3D streets and street props removed from hotel GLBs; every node is an approved hotel tower.
        expect(node.name?.startsWith('urban-hotel-'), node.name).toBe(true);
        if (!node.name?.startsWith('urban-hotel-') || typeof node.mesh !== 'number') continue;
        const b = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === Number(node.extras?.poiId))!;
        expect(b).toBeDefined();
        expect(b.zone).toBe(zone);
        const pos = accs[meshes[node.mesh].primitives[0].attributes.POSITION];
        expect(Math.abs((pos.max?.[1] ?? 0) - b.heightM), node.name).toBeLessThanOrEqual(2.0);
        const sw = lngLatFromMetres([pos.min![0], pos.max![2]]);
        const ne = lngLatFromMetres([pos.max![0], pos.min![2]]);
        const polyLngs = b.polygon.map((c) => c[0]);
        const polyLats = b.polygon.map((c) => c[1]);
        expect(haversine([sw[1], sw[0]], [Math.min(...polyLats), Math.min(...polyLngs)]), `${node.name} sw`).toBeLessThan(2.5);
        expect(haversine([ne[1], ne[0]], [Math.max(...polyLats), Math.max(...polyLngs)]), `${node.name} ne`).toBeLessThan(2.5);
      }

      const spoofed = structuredClone(gltf) as unknown as { nodes: { name?: string; mesh?: number }[] };
      spoofed.nodes.push({ name: 'osm-synthetic-tower-999' });
      expect(validateUrbanGlb(spoofed, zone).ok).toBe(false);

      const spoofedStreet = structuredClone(gltf) as unknown as { nodes: { name?: string; mesh?: number }[] };
      spoofedStreet.nodes.push({ name: `urban-street-${zone}-roads` });
      expect(validateUrbanGlb(spoofedStreet, zone).ok).toBe(false);

      const extruded = structuredClone(gltf) as unknown as {
        nodes: { name?: string; mesh?: number }[];
        meshes: { primitives: { attributes: { POSITION: number } }[] }[];
        accessors: { max?: number[] }[];
      };
      const hotelNode = extruded.nodes.find((n) => n.name?.startsWith('urban-hotel-'))!;
      const accIdx = extruded.meshes[hotelNode.mesh!].primitives[0].attributes.POSITION;
      extruded.accessors[accIdx].max = [0, 95, 0];
      expect(validateUrbanGlb(extruded, zone).ok).toBe(false);
    },
  );

  it('height provenance & zero Haram fence intrusion across all 226 footprinted South+West+North+SW hotels', () => {
    const est = APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.heightSource === 'estimated_display_only');
    const osm = APPROVED_FOOTPRINT_BUILDINGS.filter((b) => b.heightSource === 'osm_levels');
    expect(osm.length).toBe(9);
    expect(est.length).toBe(217);
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

  it('Stage 7 context GLB carries exactly the central-area non-hotel buildings, clear of hotels and the Haram fence', () => {
    expect(CONTEXT_BUILDINGS.length).toBe(20);
    expect(CONTEXT_BUILDINGS.filter((c) => (c.holes?.length ?? 0) > 0).map((c) => c.buildingId)).toEqual(['Cr1021907']);
    for (const excluded of ['Cw1357107466', 'Cw369464177', 'Cw625632624', 'Cw791137667']) {
      expect(CONTEXT_BUILDINGS.some((c) => c.buildingId === excluded)).toBe(false);
    }
    expect(CONTEXT_BUILDINGS.find((c) => c.buildingId === 'Cw369085866')!.heightM).toBeLessThanOrEqual(18);
    expect(CONTEXT_BUILDINGS.find((c) => c.buildingId === 'Cw625628207')!.heightM).toBeLessThanOrEqual(24);
    expect(CONTEXT_BUILDINGS.find((c) => c.buildingId === 'Cw522127205')!.heightM).toBeLessThanOrEqual(15);
    expect(CONTEXT_BUILDINGS.find((c) => c.buildingId === 'Cw369085868')!.heightM).toBeLessThanOrEqual(15);
    expect(new Set(CONTEXT_BUILDINGS.map((c) => c.buildingId)).size).toBe(CONTEXT_BUILDINGS.length);
    for (const c of CONTEXT_BUILDINGS) {
      expect(['south', 'west', 'north', 'sw']).toContain(c.zone);
      expect(c.heightM).toBeGreaterThanOrEqual(10);
      expect(c.heightM).toBeLessThanOrEqual(72);
      expect(c.source === 'osm' ? typeof c.osm : c.osm).toBe(c.source === 'osm' ? 'string' : null);
      // Not clickable: a context outline never contains a hotel centre.
      for (const h of APPROVED_FOOTPRINT_BUILDINGS) expect(insideRing(h.center[1], h.center[0], c.polygon), `${c.buildingId} over ${h.buildingId}`).toBe(false);
    }
    const haramRing = (fence.runs as { path: number[][] }[]).flatMap((r) => r.path as [number, number][]);
    for (const c of CONTEXT_BUILDINGS) for (const [lng, lat] of c.polygon) expect(insideRing(lng, lat, haramRing), `${c.buildingId} inside Haram fence`).toBe(false);

    const buf = readFileSync(CONTEXT_GLB_PATH);
    expect(gzipSync(buf).length).toBeLessThanOrEqual(250 * 1024);
    const { gltf } = parseGlbBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const res = validateUrbanGlb(gltf, 'context');
    expect(res.ok, res.reason).toBe(true);
    expect(res.buildingCount).toBe(CONTEXT_BUILDINGS.length);
    expect(validateUrbanGlb(gltf, 'south').ok).toBe(false);

    const spoofed = structuredClone(gltf) as unknown as { nodes: { name?: string; extras?: Record<string, unknown> }[] };
    spoofed.nodes.push({ name: 'urban-context-Cw999', extras: { buildingId: 'Cw999', zone: 'south', heightSource: 'estimated_display_only' } });
    expect(validateUrbanGlb(spoofed, 'context').ok).toBe(false);
  });

  it('A8 obstruction fade dims South looking North (0°), West looking East (90°), North looking South (180°), and SW looking NE (45°) independently', () => {
    expect(urbanOpacityForCamera(0, 0, 'south')).toBe(1);
    expect(urbanOpacityForCamera(22, 15, 'south')).toBe(1);
    expect(urbanOpacityForCamera(180, 45, 'south')).toBe(1);
    expect(urbanOpacityForCamera(90, 50, 'south')).toBe(1);
    expect(urbanOpacityForCamera(0, 50, 'west')).toBe(1);
    expect(urbanOpacityForCamera(-90, 50, 'west')).toBe(1);
    expect(urbanOpacityForCamera(0, 50, 'north')).toBe(1);
    expect(urbanOpacityForCamera(90, 50, 'north')).toBe(1);
    expect(urbanOpacityForCamera(-135, 50, 'sw')).toBe(1);
    expect(urbanOpacityForCamera(180, 50, 'sw')).toBe(1);

    for (const [b, p] of [
      [0, 45],
      [22, 45],
      [-30, 50],
      [45, 35],
    ]) {
      const a = urbanOpacityForCamera(b, p, 'south');
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.35);
    }

    for (const [b, p] of [
      [90, 45],
      [75, 50],
      [115, 48],
      [135, 35],
    ]) {
      const a = urbanOpacityForCamera(b, p, 'west');
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.35);
    }

    for (const [b, p] of [
      [180, 45],
      [-180, 50],
      [150, 48],
      [-155, 35],
    ]) {
      const a = urbanOpacityForCamera(b, p, 'north');
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.35);
    }

    for (const [b, p] of [
      [45, 45],
      [30, 50],
      [70, 48],
      [15, 35],
    ]) {
      const a = urbanOpacityForCamera(b, p, 'sw');
      expect(a).toBeGreaterThanOrEqual(0.25);
      expect(a).toBeLessThanOrEqual(0.35);
    }
  });

  it('pickApprovedBuildingRay hits roofs, upper facades across South+West+North+SW, ignores sky/Haram, and picks nearest occluded tower', () => {
    // 1. Vertical downward ray onto South tower 2449, West tower 2224, North tower 701, & SW tower 2371
    for (const pid of [2449, 2224, 701, 2371]) {
      const b = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === pid)!;
      const [mx, mz] = toModelMetres([b.center[1], b.center[0]]);
      const hitRoof = pickApprovedBuildingRay([mx, 200, mz], [0, -1, 0]);
      expect(hitRoof?.poiId).toBe(pid);

      // Upward ray above roof into sky returns null
      expect(pickApprovedBuildingRay([mx, b.heightM + 10, mz], [0, 1, 0])).toBeNull();
    }

    // 1b. Hollow inner courtyard rays on N158 (poiId 704) and N156 (poiId 702) pass cleanly through their courtyard opening
    for (const pid of [704, 702]) {
      const b = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === pid)!;
      expect(b.holes?.length).toBe(1);
      const hole = b.holes![0].slice(0, -1);
      const avgLng = hole.reduce((s, p) => s + p[0], 0) / hole.length;
      const avgLat = hole.reduce((s, p) => s + p[1], 0) / hole.length;
      const [hx, hz] = toModelMetres([avgLat, avgLng]);
      expect(pickApprovedBuildingRay([hx, 200, hz], [0, -1, 0])).toBeNull();
    }

    // 2. Angled camera rays from unobstructed Haram courtyard hitting upper facades (y = 0.65 * heightM) of West 2224, North 701, & SW 2371
    const b2224 = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === 2224)!;
    const [wx, wz] = toModelMetres([b2224.center[1], b2224.center[0]]);
    {
      const ox = wx + 160;
      const oy = 75;
      const oz = wz + 40;
      const dx = wx - ox;
      const dy = b2224.heightM * 0.65 - oy;
      const dz = wz - oz;
      const len = Math.hypot(dx, dy, dz);
      expect(pickApprovedBuildingRay([ox, oy, oz], [dx / len, dy / len, dz / len])?.poiId).toBe(2224);
    }

    const b701 = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === 701)!;
    const [nx, nz] = toModelMetres([b701.center[1], b701.center[0]]);
    {
      const ox = nx;
      const oy = 75;
      const oz = nz + 140;
      const dx = nx - ox;
      const dy = b701.heightM * 0.65 - oy;
      const dz = nz - oz;
      const len = Math.hypot(dx, dy, dz);
      expect(pickApprovedBuildingRay([ox, oy, oz], [dx / len, dy / len, dz / len])?.poiId).toBe(701);
    }

    const b2371 = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === 2371)!;
    const [swx, swz] = toModelMetres([b2371.center[1], b2371.center[0]]);
    {
      const ox = swx + 140;
      const oy = 75;
      const oz = swz - 140;
      const dx = swx - ox;
      const dy = b2371.heightM * 0.65 - oy;
      const dz = swz - oz;
      const len = Math.hypot(dx, dy, dz);
      expect(pickApprovedBuildingRay([ox, oy, oz], [dx / len, dy / len, dz / len])?.poiId).toBe(2371);
    }

    // 3. Courtyard center straight down misses all buildings
    const [hx, hz] = toModelMetres([39.6111, 24.4673]);
    expect(pickApprovedBuildingRay([hx, 200, hz], [0, -1, 0])).toBeNull();

    // 4. Occlusion: ray through #226 (2226) toward #228 (2228) behind it picks closer #226 first
    const b226 = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === 2226)!;
    const b228 = APPROVED_FOOTPRINT_BUILDINGS.find((x) => x.poiId === 2228)!;
    const [x226, z226] = toModelMetres([b226.center[1], b226.center[0]]);
    const [x228, z228] = toModelMetres([b228.center[1], b228.center[0]]);
    const rdx = x228 - x226;
    const rdz = z228 - z226;
    const rlen = Math.hypot(rdx, rdz);
    const camX = x226 - (rdx / rlen) * 80;
    const camZ = z226 - (rdz / rlen) * 80;
    expect(pickApprovedBuildingRay([camX, 15, camZ], [rdx / rlen, 0, rdz / rlen])?.poiId).toBe(2226);

    // 5. Urban3DLayer tracks selected / routed hotel POI ID and lazy display modes ('none' | 'single' | 'all')
    const layer = new Urban3DLayer(sceneLight({ elevation: 45, azimuth: 180 }));
    expect(layer.getDisplayMode()).toEqual({ kind: 'none' });
    expect(layer.getRequestedZones()).toEqual([]);
    expect(layer.getSelectedPoiId()).toBeNull();
    layer.setSelectedPoiId(2371);
    expect(layer.getSelectedPoiId()).toBe(2371);
    layer.setSelectedPoiId(null);
    expect(layer.getSelectedPoiId()).toBeNull();

    // resolveUrban3DMode: 'none' outside hotels filter unless a footprinted hotel is selected
    expect(resolveUrban3DMode('all', null)).toEqual({ kind: 'none' });
    expect(resolveUrban3DMode('gates', null)).toEqual({ kind: 'none' });
    expect(resolveUrban3DMode('toilets', 204)).toEqual({ kind: 'none' });
    expect(resolveUrban3DMode('all', 21)).toEqual({ kind: 'none' });
    // Pin-only approved hotel (#206 -> POI 2206) has no 3D footprint, so no GLB is needed
    expect(resolveUrban3DMode('all', 2206)).toEqual({ kind: 'none' });
    // Selecting a footprinted hotel from search under 'all' or 'gates' renders only that single hotel and its zone
    expect(resolveUrban3DMode('all', 2371)).toEqual({ kind: 'single', poiId: 2371, zone: 'sw' });
    expect(resolveUrban3DMode('gates', 701)).toEqual({ kind: 'single', poiId: 701, zone: 'north' });
    // Tapping the 'hotels' pill renders all hotels + context buildings
    expect(resolveUrban3DMode('hotels', null)).toEqual({ kind: 'all', selectedPoiId: null });
    expect(resolveUrban3DMode('hotels', 2449)).toEqual({ kind: 'all', selectedPoiId: 2449 });
  });

  it('walk and drive routes to original + representative South, West, North & SW hotels end <= 3 m from entrance with 0 polygon intersections', async () => {
    const plazaStart: [number, number] = [24.46605, 39.6095];
    const carStart: [number, number] = [24.4605, 39.6085];

    for (const id of new Set([...ORIGINAL_IDS, ...SAMPLE_SOUTH_IDS, ...SAMPLE_WEST_IDS, ...SAMPLE_NORTH_IDS, ...SAMPLE_SW_IDS])) {
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
  }, 120_000);

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
