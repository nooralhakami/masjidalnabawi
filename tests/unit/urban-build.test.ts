import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The test exercises the JavaScript generator directly.
import { buildUrbanGeoJSON, KIND, validateBuilding } from '../../scripts/build-urban-3d.mjs';

const root = resolve(import.meta.dirname, '../..');
const fence = JSON.parse(readFileSync(resolve(root, 'data/haram-fence.json'), 'utf8'));

// A footprint north of the courtyards (outside the fence), and one inside them.
const outside = [
  [39.61, 24.4745],
  [39.612, 24.4745],
  [39.612, 24.4755],
  [39.61, 24.4755],
];
const inside = [
  [39.6108, 24.467],
  [39.6114, 24.467],
  [39.6114, 24.4674],
  [39.6108, 24.4674],
];
const approved = { id: 'N001', approved: true, kind: 'hotel', heightM: 40, footprint: outside, source: 'test' };

describe('urban approval gate (zero guessing)', () => {
  it('accepts an approved footprint with a verified numeric height outside the fence', () => {
    expect(validateBuilding(approved, fence)).toBeNull();
  });

  it('rejects anything unapproved, unmeasured, inferred from levels, inside the fence, or unnamed', () => {
    expect(validateBuilding({ ...approved, approved: false }, fence)).toBe('not_approved');
    expect(validateBuilding({ ...approved, heightM: null }, fence)).toBe('height_not_a_verified_number');
    expect(validateBuilding({ ...approved, heightM: '40' }, fence)).toBe('height_not_a_verified_number');
    expect(validateBuilding({ ...approved, heightM: undefined, levels: 12 }, fence)).toBe('height_not_a_verified_number');
    expect(validateBuilding({ ...approved, heightM: 0 }, fence)).toBe('height_not_a_verified_number');
    expect(validateBuilding({ ...approved, footprint: inside }, fence)).toBe('footprint_inside_fence');
    expect(validateBuilding({ ...approved, footprint: [[39.61, 24.4745]] }, fence)).toBe('footprint_too_small');
    expect(validateBuilding({ ...approved, footprint: [[39.61, 'x'], ...outside.slice(1)] }, fence)).toBe('footprint_not_coordinates');
    expect(validateBuilding({ ...approved, kind: 'palace' }, fence)).toBe('unknown_kind');
    expect(validateBuilding({ ...approved, id: '' }, fence)).toBe('missing_id');
  });

  it('packs only the accepted records as GeoJSON and reports the rest', () => {
    const { geojson, accepted, rejected } = buildUrbanGeoJSON({ buildings: [approved, { ...approved, id: 'N002', approved: false }] }, fence);
    expect(accepted).toBe(1);
    expect(rejected).toEqual([{ id: 'N002', reason: 'not_approved' }]);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(1);
    const f = geojson.features[0];
    expect(f.properties).toEqual({ id: 'N001', height: 40, kind: KIND.hotel });
    expect(f.geometry.type).toBe('Polygon');
    // The ring is closed for GeoJSON, keeping the footprint's own corners.
    expect(f.geometry.coordinates[0]).toEqual([...outside, outside[0]]);
  });

  it('keeps an already-closed ring as it is and rejects a duplicate id', () => {
    const closed = { ...approved, footprint: [...outside, outside[0]] };
    const { geojson, rejected } = buildUrbanGeoJSON({ buildings: [closed, { ...closed, id: 'N001' }] }, fence);
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(rejected).toEqual([{ id: 'N001', reason: 'duplicate_id' }]);
  });

  it('builds an empty collection when nothing is approved', () => {
    const { geojson, accepted } = buildUrbanGeoJSON({ buildings: [] }, fence);
    expect(accepted).toBe(0);
    expect(geojson).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('urban shipped data', () => {
  it('ships no surrounding buildings until exact positions are approved (owner, 2026-11-04)', () => {
    expect(existsSync(resolve(root, 'data/urban-approved.json'))).toBe(false);
    const shipped = JSON.parse(readFileSync(resolve(root, 'public/models/urban-3d.json'), 'utf8'));
    expect(shipped).toEqual({ type: 'FeatureCollection', features: [] });
    expect(existsSync(resolve(root, 'public/models/urban-3d.bin'))).toBe(false);
    // The Blender massing path (scripts/build-urban-glb.py) is gated by the same approval file.
    expect(existsSync(resolve(root, 'public/models/urban-3d.glb'))).toBe(false);
    expect(existsSync(resolve(root, 'public/models/madinah-city.json'))).toBe(false);
  });
});

describe('environment shipped data (Blender multi-category tooling)', () => {
  it('ships no environment GLB; the example scene is a labelled synthetic demo, never real geography', () => {
    expect(existsSync(resolve(root, 'public/models/environment.glb'))).toBe(false);
    const example = JSON.parse(readFileSync(resolve(root, 'scripts/environment-scene.example.json'), 'utf8'));
    expect(example.meta.synthetic).toBe(true);
    expect(String(example.meta.label)).toMatch(/SYNTHETIC/);
  });
});
