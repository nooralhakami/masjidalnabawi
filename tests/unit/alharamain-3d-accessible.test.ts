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

  it('every listed 3D file exists as glTF 2.0, stands at 43 places, and the Mosque comes first', () => {
    expect(ALHARAMAIN_MODELS[0].url).toContain('haram-3d.glb');
    // 42 from navQ and the restroom blocks, and the outer fence (owner, 2026-11-08).
    expect(ALHARAMAIN_MODELS.reduce((n, m) => n + m.anchors.length, 0)).toBe(43);
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

  it("the restroom blocks (made from the owner's photographs) stand on navQ's footprints, from the ground up", () => {
    const bounds = (file: string) => {
      const glb = readFileSync(resolve(__dirname, '../../public/models', file));
      const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const prim of gltf.meshes[0].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], acc.min[k]);
          max[k] = Math.max(max[k], acc.max[k]);
        }
      }
      return { min, max };
    };
    // One file per way the entrance faces (owner, 2026-11-06), each on navQ's box: a spans
    // x -13.9..9.1, z -48.9..-34.9; b spans x -9.4..4.6, z -94.5..-71.3.
    const files = { 'a-east': 'a', 'a-west': 'a', 'b-north': 'b', 'b-south': 'b' } as const;
    const boxes = { a: [-13.9, 9.1, -48.9, -34.9], b: [-9.4, 4.6, -94.5, -71.3] };
    const urls = ALHARAMAIN_MODELS.map((m) => m.url);
    for (const [name, kind] of Object.entries(files)) {
      expect(urls).toContain(`./models/haram-restroom-${name}.glb`);
      const g = bounds(`haram-restroom-${name}.glb`);
      const [x0, x1, z0, z1] = boxes[kind];
      for (const [got, want] of [
        [g.min[0], x0],
        [g.max[0], x1],
        [g.min[2], z0],
        [g.max[2], z1],
      ]) {
        expect(Math.abs(got - want), name).toBeLessThan(0.6);
      }
      expect(g.min[1]).toBeLessThanOrEqual(0);
      expect(g.max[1]).toBeGreaterThan(8);
      expect(g.max[1]).toBeLessThan(9);
    }
  });

  it('the restroom entrances face the Mosque from the inner rows and the outer gates from the outer rows; east 233-236 north, 231-232 south (owner, 2026-11-06)', () => {
    const of = (lng: number, lat: number) =>
      ALHARAMAIN_MODELS.find((m) => m.url.includes('restroom') && m.anchors.some(([x, y]) => x === lng && y === lat))!.url.match(/restroom-(\w+-\w+)/)![1];
    expect(of(39.612668, 24.469562)).toBe('b-south'); // 229, inner north row
    expect(of(39.612668, 24.470105)).toBe('b-north'); // 230, outer north row
    expect(of(39.611669, 24.46608)).toBe('b-north'); // 203, inner south row
    expect(of(39.611666, 24.4655)).toBe('b-south'); // 204, outer south row
    expect(of(39.608676, 24.467703)).toBe('a-east'); // 213, inner west column
    expect(of(39.608028, 24.467703)).toBe('a-west'); // 214, outer west column
    for (const [lng, lat] of [
      [39.613613, 24.468454],
      [39.614195, 24.468454],
      [39.613613, 24.467806],
      [39.614195, 24.467806],
    ]) {
      expect(of(lng, lat)).toBe('b-north'); // 233-236
    }
    expect(of(39.613632, 24.469562)).toBe('b-south'); // 231
    expect(of(39.614195, 24.469562)).toBe('b-south'); // 232
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
    // 236 marks the middle of its block since 2026-11-06, about 24 m from the lift; routing looks up to 40 m.
    expect(node?.meters).toBeLessThan(30);
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
