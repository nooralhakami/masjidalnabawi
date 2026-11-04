import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../../src/data-next/alharamain-3d';
import { VERTICAL_NODES, verticalNodesGeoJson } from '../../src/data-next/vertical-nodes';
import { routeSummary } from '../../src/presentation/route-view';
import { ACCESSIBLE_WALK_M_PER_MIN, nearestVerticalNode, planRoutes } from '../../src/routing/plan';

const P = (id: number) => POI_BY_ID.get(id)!;

function glbNodes(file: Buffer): { mesh?: number; name?: string }[] {
  const jsonLength = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')).nodes;
}

describe('the Al-Haramain 3D view: plaza areas and 3D files', () => {
  const plaza = alharamainPlaza();

  it('has the 5 plaza sectors, the western annex and its 6 + 6 prayer areas', () => {
    const count = (kind: string) => plaza.features.filter((f) => f.properties.kind === kind).length;
    expect(count('sector')).toBe(5);
    expect(count('annex')).toBe(1);
    expect(count('men')).toBe(6);
    expect(count('women')).toBe(6);
  });

  it('every area is a closed ring in the Haram with a colour and an opacity', () => {
    for (const f of plaza.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lng, lat] of ring) {
        expect(lat).toBeGreaterThan(24.46);
        expect(lat).toBeLessThan(24.48);
        expect(lng).toBeGreaterThan(39.6);
        expect(lng).toBeLessThan(39.62);
      }
      expect(f.properties.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(f.properties.opacity).toBeGreaterThan(0);
      expect(f.properties.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('every listed 3D file exists as glTF 2.0, stands at 41 places, and the Mosque comes first', () => {
    expect(ALHARAMAIN_MODELS[0].url).toContain('haram-3d.glb');
    expect(ALHARAMAIN_MODELS.reduce((n, m) => n + m.anchors.length, 0)).toBe(41);
    for (const model of ALHARAMAIN_MODELS) {
      const glb = readFileSync(resolve(__dirname, '../../public', model.url));
      expect(glb.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
      expect(glb.readUInt32LE(4)).toBe(2);
      for (const [lng, lat] of model.anchors) {
        expect(lat).toBeGreaterThan(24.46);
        expect(lat).toBeLessThan(24.48);
        expect(lng).toBeGreaterThan(39.6);
        expect(lng).toBeLessThan(39.62);
      }
    }
  });

  it('the canopies file carries all 318 canopies of the courtyards', () => {
    expect(glbNodes(readFileSync(resolve(__dirname, '../../public/models/haram-canopies.glb')))).toHaveLength(318);
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
