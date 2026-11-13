import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The test exercises the JavaScript generator directly.
import { buildAudit, matchPoi, polygonLineDistance, unproject } from '../../scripts/audit-urban-ring1.mjs';

type AuditBuilding = {
  id: string;
  name: string | null;
  distanceM: number;
  heightM: string | null;
  levels: string | null;
  tags: Record<string, string>;
  review: Record<string, string>;
};

type AuditPoi = {
  id: number;
  matchedBuildingId: string | null;
  matchMethod: string;
  distanceM: number;
  mapStatus: string;
  review: Record<string, string>;
};

type Audit = {
  buildings: AuditBuilding[];
  pois: AuditPoi[];
  summary: { excludedInside: number };
};

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const fence = read('data/haram-fence.json');
const pois = read('data/pois.json');
const osm = read('docs/routes/osm/buildings-2026-10-08.json');
const audit = buildAudit(fence, pois, osm) as Audit;

const rectangle = (minX: number, minY: number, maxX: number, maxY: number): [number, number][] =>
  [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ].map(unproject);

function syntheticAudit() {
  const syntheticFence = {
    captured: 'test',
    _source: 'test',
    runs: [{ path: rectangle(-1000, -1000, 1000, 1000) }],
    gates: [{ id: 301, at: unproject([0, -1000]) }],
  };
  const way = (id: number, name: string, distance: number) => ({
    type: 'way',
    id,
    tags: { name },
    geometry: rectangle(-10, 1000 + distance, 10, 1020 + distance).map(([lon, lat]) => ({ lon, lat })),
  });
  return buildAudit(syntheticFence, [], {
    osm3s: {},
    elements: [way(1, 'exact-250', 250), way(2, 'outside-250', 250.01), { ...way(3, 'interior', 0), geometry: rectangle(-10, -10, 10, 10).map(([lon, lat]) => ({ lon, lat })) }],
  });
}

describe('urban ring 250 m geometry', () => {
  it('includes a footprint at exactly 250 m and excludes one beyond it and one inside the fence', () => {
    const result = syntheticAudit() as Audit;
    expect(result.buildings.map((building) => building.name)).toEqual(['exact-250']);
    expect(result.buildings[0].distanceM).toBe(250);
    expect(result.summary.excludedInside).toBe(1);
  });

  it('does not treat disjoint collinear segments as intersecting', () => {
    expect(
      polygonLineDistance(
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
        [
          [2, 0],
          [3, 0],
        ],
      ),
    ).toBe(1);
  });
});

describe('urban ring POI matching', () => {
  const buildings = [
    {
      id: 'N001',
      osmWay: 42,
      tags: {},
      areaM2: 100,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    },
  ];

  it('uses a direct OSM way reference before spatial candidates', () => {
    expect(matchPoi({ osm: 'w42', name_ar: '', xy: [100, 100] }, buildings)).toMatchObject({
      matchedBuildingId: 'N001',
      matchMethod: 'osm_way_reference',
    });
  });

  it('never exact-name matches two missing names', () => {
    expect(matchPoi({ name_ar: '', xy: [5, 5] }, buildings).matchMethod).toBe('point_inside_footprint');
  });

  it('keeps manual POI 827 as a source point, never an entrance', () => {
    const poi = audit.pois.find((candidate) => candidate.id === 827);
    expect(poi).toMatchObject({
      sourcePosition: 'manual_unspecified',
      mapStatus: 'source_point_not_entrance',
      review: { pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' },
    });
  });
});

describe('urban ring audit integrity', () => {
  it('has unique building IDs and valid matched-building references', () => {
    const ids = audit.buildings.map((building) => building.id);
    const known = new Set(ids);
    expect(known.size).toBe(ids.length);
    expect(audit.pois.filter((poi) => poi.matchedBuildingId && !known.has(poi.matchedBuildingId))).toEqual([]);
  });

  it('keeps every selected footprint and POI inside the 250 m source-distance ring', () => {
    expect(audit.buildings.filter((building) => building.distanceM > 250)).toEqual([]);
    expect(audit.pois.filter((poi) => poi.distanceM > 250)).toEqual([]);
  });

  it('does not infer heights, identities, host buildings, or entrances', () => {
    for (const building of audit.buildings) {
      expect(building.heightM).toBe(building.tags.height ?? null);
      expect(building.levels).toBe(building.tags['building:levels'] ?? null);
      expect(building.review).toEqual({
        footprint: 'pending_owner',
        identity: 'pending_owner',
        height: 'pending_owner',
        pedestrianEntrance: 'not_supplied',
        carEntrance: 'not_supplied',
      });
    }
    for (const poi of audit.pois) {
      expect(poi.mapStatus).toBe('source_point_not_entrance');
      expect(poi.review).toEqual({
        identity: 'pending_owner',
        hostBuilding: 'pending_owner',
        pedestrianEntrance: 'not_supplied',
        carEntrance: 'not_supplied',
      });
    }
  });

  it('pins the current source-data counts and match methods', () => {
    expect(audit.summary).toMatchObject({ buildings: 117, hotels: 32, food: 16, construction: 4, withLevels: 2, withHeight: 0, excludedInside: 67 });
    const methods: Record<string, number> = {};
    for (const poi of audit.pois) methods[poi.matchMethod] = (methods[poi.matchMethod] ?? 0) + 1;
    expect(methods).toEqual({
      osm_way_reference: 19,
      point_inside_footprint: 16,
      nearest_footprint_unverified: 12,
      exact_name_unverified: 1,
    });
  });
});
