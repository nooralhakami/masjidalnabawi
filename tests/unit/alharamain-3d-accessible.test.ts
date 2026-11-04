import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import { alharamainPlaza, alharamainZones } from '../../src/data-next/alharamain-3d';
import { VERTICAL_NODES, verticalNodesGeoJson } from '../../src/data-next/vertical-nodes';
import { routeSummary } from '../../src/presentation/route-view';
import { ACCESSIBLE_WALK_M_PER_MIN, nearestVerticalNode, planRoutes } from '../../src/routing/plan';

const P = (id: number) => POI_BY_ID.get(id)!;

describe('3D extrusion zones, courtyard plaza & Blender GLB model', () => {
  const fc = alharamainZones();
  const plaza = alharamainPlaza();

  it('includes the Mosque 3D wings plus all 174 navQ polygons (176 total)', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(176);
  });

  it('includes the Haram marble courtyard plaza + 81 courtyard prayer carpets (82 total)', () => {
    expect(plaza.type).toBe('FeatureCollection');
    expect(plaza.features).toHaveLength(82);
    expect(plaza.features[0].properties.kind).toBe('plaza');
    expect(plaza.features.filter((f) => f.properties.kind === 'men').length).toBeGreaterThan(20);
    expect(plaza.features.filter((f) => f.properties.kind === 'women').length).toBeGreaterThan(40);
  });

  it('bundles a valid glTF 2.0 binary model at public/models/haram-3d.glb', () => {
    const glb = readFileSync(resolve(__dirname, '../../public/models/haram-3d.glb'));
    expect(glb.byteLength).toBeGreaterThan(2_000_000);
    expect(glb.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
    expect(glb.readUInt32LE(4)).toBe(2); // version 2
  });

  it('every polygon ring is closed, lies in the Haram area, and has colour + positive extrusion_height', () => {
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('Polygon');
      const ring = f.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lng, lat] of ring) {
        expect(lat).toBeGreaterThan(24.46);
        expect(lat).toBeLessThan(24.48);
        expect(lng).toBeGreaterThan(39.6);
        expect(lng).toBeLessThan(39.62);
      }
      expect(f.properties.category_color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(f.properties.extrusion_height).toBeGreaterThan(0);
    }
  });
});

describe('vertical transit nodes (vertical_nodes.geojson)', () => {
  it('contains all 99 extracted nodes (16 elevators, 80 escalators, 3 accessible gates)', () => {
    expect(VERTICAL_NODES).toHaveLength(99);
    expect(VERTICAL_NODES.filter((n) => n.type === 'elevator')).toHaveLength(16);
    expect(VERTICAL_NODES.filter((n) => n.type === 'escalator')).toHaveLength(80);
    expect(VERTICAL_NODES.filter((n) => n.type === 'gate')).toHaveLength(3);
    expect(verticalNodesGeoJson().features).toHaveLength(99);
  });

  it('prefers an elevator when one stands near the facility (e.g. facility 236 on the east side)', () => {
    const f236 = P(236);
    const node = nearestVerticalNode([f236.lat, f236.lng], { venueId: 20 });
    expect(node).not.toBeNull();
    expect(node?.kind).toBe('elevator');
    expect(node?.meters).toBeLessThan(20);
  });

  it('finds Mosque elevators near Gate 33 and Gate 9 (venueId 4)', () => {
    const g33 = P(33);
    const g9 = P(9);
    expect(nearestVerticalNode([g33.lat, g33.lng], { venueId: 4 })?.kind).toBe('elevator');
    expect(nearestVerticalNode([g9.lat, g9.lng], { venueId: 4 })?.kind).toBe('elevator');
  });
});

describe('accessible step-free walking routes', () => {
  it('attaches accessible vertical node metadata and uses the comfortable 60 m/min pace', async () => {
    const std = await planRoutes([24.469, 39.6125], P(227), 'walk');
    const acc = await planRoutes([24.469, 39.6125], P(227), 'walk', { accessible: true });
    expect(acc[0].accessible).toBe(true);
    expect(acc[0].accessibleNode).toBeDefined();
    expect(acc[0].accessibleNode?.kind).toBe('escalator');
    expect(acc[0].minutes).toBe(Math.ceil(acc[0].walkM / ACCESSIBLE_WALK_M_PER_MIN));
    expect(acc[0].minutes).toBeGreaterThanOrEqual(std[0].minutes);

    const summary = routeSummary(acc, 0);
    expect(summary.accessible?.kind).toBe('escalator');
    expect(summary.accessible?.nodeId).toBeGreaterThan(0);
  });

  it('routes to an elevator-equipped facility (236) with elevator metadata', async () => {
    const acc = await planRoutes([24.469, 39.6125], P(236), 'walk', { accessible: true });
    expect(acc[0].accessibleNode?.kind).toBe('elevator');
    expect(routeSummary(acc, 0).accessible?.kind).toBe('elevator');
  });
});
