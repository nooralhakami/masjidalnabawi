import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The test exercises the JavaScript generator directly.
import { buildMsAudit } from '../../scripts/audit-urban-ring1-ms.mjs';
// @ts-expect-error The test exercises the JavaScript generator directly.
import { unproject } from '../../scripts/audit-urban-ring1.mjs';

type MsBuilding = {
  id: string;
  footprintSource: string;
  name: string | null;
  kind: string;
  identitySource: string;
  corroborated: boolean;
  distanceM: number;
  heightM: string | null;
  levels: string | null;
  msHeight: number;
  review: Record<string, string>;
};
type MsPoi = { id: number; category: string; matchedBuildingId: string | null; matchMethod: string; distanceM: number; mapStatus: string; review: Record<string, string> };
type MsAudit = { buildings: MsBuilding[]; pois: MsPoi[]; summary: Record<string, number>; sources: { footprints: { name: string; license: string } } };

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const fence = read('data/haram-fence.json');
const pois = read('data/pois.json');
const osm = read('docs/routes/osm/buildings-2026-10-08.json');
const ms = read('docs/routes/ms-buildings/haram-bbox-2026-11-11.json');
const audit = buildMsAudit(fence, pois, osm, ms) as MsAudit;

const rectangle = (minX: number, minY: number, maxX: number, maxY: number): [number, number][] =>
  [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ].map(unproject);

const feature = (ring: [number, number][]) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { height: -1, confidence: -1 } });

function syntheticAudit() {
  const syntheticFence = {
    captured: 'test',
    _source: 'test',
    runs: [{ path: rectangle(-1000, -1000, 1000, 1000) }],
    gates: [{ id: 301, at: unproject([0, -1000]) }],
  };
  const msSynthetic = {
    license: 'CDLA-Permissive-2.0',
    datasetRelease: 'test',
    quadkey: 'test',
    projectUrl: 'test',
    heightNote: 'test',
    features: [
      feature(rectangle(-10, 1250, 10, 1270)), // exactly 250 m outside -> kept
      feature(rectangle(-10, 1250.01, 10, 1270.01)), // beyond 250 m -> excluded
      feature(rectangle(-10, -10, 10, 10)), // inside fence -> excluded
      feature(rectangle(-10, 990, 10, 1010)), // crosses fence -> excluded
    ],
  };
  return buildMsAudit(syntheticFence, [], { osm3s: {}, elements: [] }, msSynthetic) as MsAudit;
}

describe('microsoft ring 250 m geometry', () => {
  it('keeps a footprint at exactly 250 m and excludes beyond, inside, and fence-crossing', () => {
    const result = syntheticAudit();
    expect(result.buildings.length).toBe(1);
    expect(result.buildings[0].distanceM).toBe(250);
    expect(result.summary.excludedInside).toBe(1);
    expect(result.summary.excludedBeyond).toBe(1);
    expect(result.summary.excludedCrosses).toBe(1);
  });
});

describe('microsoft ring audit integrity', () => {
  it('uses Microsoft footprints and keeps every selection within the 250 m ring', () => {
    expect(audit.buildings.every((b) => b.footprintSource === 'microsoft_ml')).toBe(true);
    expect(audit.buildings.filter((b) => b.distanceM > 250)).toEqual([]);
    expect(audit.pois.filter((p) => p.distanceM > 250)).toEqual([]);
  });

  it('has unique building IDs and valid matched-building references', () => {
    const ids = audit.buildings.map((b) => b.id);
    const known = new Set(ids);
    expect(known.size).toBe(ids.length);
    expect(audit.pois.filter((p) => p.matchedBuildingId && !known.has(p.matchedBuildingId))).toEqual([]);
  });

  it('never infers heights, levels, or entrances', () => {
    for (const b of audit.buildings) {
      expect(b.heightM).toBeNull();
      expect(b.levels).toBeNull();
      expect(b.review).toEqual({ footprint: 'pending_owner', identity: 'pending_owner', height: 'pending_owner', pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' });
    }
    for (const p of audit.pois) {
      expect(p.mapStatus).toBe('source_point_not_entrance');
      expect(p.review).toEqual({ identity: 'pending_owner', hostBuilding: 'pending_owner', pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' });
    }
  });

  it('keeps manual POI 827 as a source point, never an entrance', () => {
    const poi = audit.pois.find((p) => p.id === 827);
    expect(poi).toMatchObject({ mapStatus: 'source_point_not_entrance', review: { pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' } });
  });

  it('splits corroborated and Microsoft-only buildings and pins source counts', () => {
    expect(audit.summary.corroborated + audit.summary.msOnly).toBe(audit.summary.buildings);
    expect(audit.buildings.filter((b) => b.corroborated).length).toBe(audit.summary.corroborated);
    expect(audit.summary).toMatchObject({ buildings: 164, corroborated: 74, msOnly: 90, hotels: 32, food: 16, named: 59, excludedInside: 5, excludedCrosses: 6 });
    expect(audit.sources.footprints.name).toBe('Microsoft Global ML Building Footprints');
    expect(audit.sources.footprints.license).toBe('CDLA-Permissive-2.0');
  });

  it('links hotel POIs to a hotel-kind building', () => {
    const hotelPoi = audit.pois.find((p) => p.category === 'hotels' && p.matchedBuildingId);
    expect(hotelPoi).toBeTruthy();
    const host = audit.buildings.find((b) => b.id === hotelPoi?.matchedBuildingId);
    expect(host?.kind).toBe('hotel');
  });
});
