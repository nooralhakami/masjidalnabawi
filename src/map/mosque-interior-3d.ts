import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { fromModelMetres, toModelMetres } from '../domain/frames';
import { WOMEN_RAWDAH_CORRIDOR_BOUNDS } from '../domain/rawdah-layout';

/**
 * What remains of the first, box-built interior (2026-11-14): the red velvet ropes and brass posts
 * along the women's closed corridor (Gate 21 → behind the Rawdah). Since 2026-11-18 the interior
 * itself is drawn from navQ's plan and the Blender props: the carpets by the rug layer, the marble by
 * the plaza layer, and the columns, ablaq arches, lanterns and chandeliers by the models' layer
 * (`domain/interior-floor.ts`, `scripts/build-interior-props-glb.py`).
 */

export interface Interior3DProps {
  part:
    | 'carpet'
    | 'carpet_stripe'
    | 'rawdah'
    | 'walkway'
    | 'walkway_inlay'
    | 'plinth'
    | 'ac_brass'
    | 'column'
    | 'capital'
    | 'arch'
    | 'chandelier'
    | 'stanchion_post'
    | 'stanchion_rope';
  color: string;
  height: number;
  base: number;
  opacity: number;
}

function rectModelFeature(cx: number, cz: number, hx: number, hz: number, props: Interior3DProps, rotRad = 0): Feature<Polygon, Interior3DProps> {
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ].map(([dx, dz]) => fromModelMetres([cx + dx * cos - dz * sin, cz + dx * sin + dz * cos]));
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [[...corners, corners[0]]],
    },
  };
}

function octagonModelFeature(cx: number, cz: number, r: number, props: Interior3DProps): Feature<Polygon, Interior3DProps> {
  const ring: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    ring.push(fromModelMetres([cx + Math.cos(a) * r, cz + Math.sin(a) * r]));
  }
  ring.push(ring[0]);
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

export function buildMosqueInterior3D(): FeatureCollection<Polygon, Interior3DProps> {
  const features: Feature<Polygon, Interior3DProps>[] = [];

  // Red Velvet & Brass Stanchions along Gate 21 -> Rawdah enclosed women's corridor
  const wb = WOMEN_RAWDAH_CORRIDOR_BOUNDS;
  const [wx0, wz0] = toModelMetres([wb.westLng, wb.northLat]);
  const [wx1, wz1] = toModelMetres([wb.eastLng, wb.southLat]);
  const zStart = Math.min(wz0, wz1);
  const zEnd = Math.max(wz0, wz1);
  for (const wallX of [wx0, wx1]) {
    features.push(
      rectModelFeature(wallX, (zStart + zEnd) / 2, 0.12, Math.max(1, (zEnd - zStart) / 2), {
        part: 'stanchion_rope',
        color: '#8b1e24',
        base: 0.72,
        height: 0.92,
        opacity: 0.96,
      }),
    );
    for (let pz = zStart; pz <= zEnd; pz += 6) {
      features.push(
        octagonModelFeature(wallX, pz, 0.22, {
          part: 'stanchion_post',
          color: '#d4af37',
          base: 0,
          height: 1.05,
          opacity: 0.98,
        }),
      );
    }
  }

  return { type: 'FeatureCollection', features };
}
