import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { fromModelMetres, toModelMetres } from '../domain/frames';
import { QIBLA_BEARING_DEG } from '../domain/geo';
import {
  INTERIOR_COL_STEP_M,
  INTERIOR_MAIN_BOUNDS,
  INTERIOR_SOUTH_BOUNDS,
  INTERIOR_WALKWAY_HALF_W,
  INTERIOR_WALKWAY_X,
  INTERIOR_WALKWAY_Z,
  RAWDAH_INTERIOR_BOUNDS,
  interiorColumnCentres,
} from '../domain/interior-layout';
import { WOMEN_RAWDAH_CORRIDOR_BOUNDS } from '../domain/rawdah-layout';

/**
 * 3D interior architectural model of Al-Masjid an-Nabawi for manual interior cutaway view:
 * - Qibla-aligned (`176.24°`) green carpets and lush Rawdah green floor with saf stripes
 * - White & tan-inlaid marble walkways connecting major gates
 * - Hypostyle marble columns with octagonal mushaf/shoe plinths, brass AC vents, and gilded capitals
 * - Alternating Ablaq (`أبلق`: cream `#efe8d8`, basalt `#2f3337`, terracotta `#b86b43`) span arches
 * - Suspended warm brass chandeliers/lanterns (`#ffd98a`)
 * - Red velvet & brass stanchions (`#8b1e24`, `#d4af37`) along protected Gate 21 → Rawdah and women borders
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

const RAD = Math.PI / 180;
const QIBLA_ROT_RAD = (QIBLA_BEARING_DEG - 180) * RAD;

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

  // 1. Interior Prayer Carpets (main northern expansion + southern hall, Qibla-aligned)
  const addCarpetBlock = (x0: number, x1: number, z0: number, z1: number, isRawdah = false) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const hx = (x1 - x0) / 2;
    const hz = (z1 - z0) / 2;
    if (hx < 2 || hz < 2) return;
    features.push(
      rectModelFeature(
        cx,
        cz,
        hx,
        hz,
        {
          part: isRawdah ? 'rawdah' : 'carpet',
          color: isRawdah ? '#157347' : '#1f6b45',
          base: 0,
          height: 0.08,
          opacity: 0.96,
        },
        QIBLA_ROT_RAD,
      ),
    );
    // Saf horizontal alignment stripes every 3.6 m facing Qibla
    for (let z = z0 + 2.4; z <= z1 - 2.4; z += 3.6) {
      features.push(
        rectModelFeature(
          cx,
          z,
          Math.max(1, hx - 0.8),
          0.16,
          {
            part: 'carpet_stripe',
            color: isRawdah ? '#2ea466' : '#278556',
            base: 0.08,
            height: 0.11,
            opacity: 0.95,
          },
          QIBLA_ROT_RAD,
        ),
      );
    }
  };

  // Carve main expansion between the major N-S and E-W white marble walkways
  const xEdges = [
    INTERIOR_MAIN_BOUNDS.xMin,
    ...INTERIOR_WALKWAY_X.map((w) => w - INTERIOR_WALKWAY_HALF_W),
    ...INTERIOR_WALKWAY_X.map((w) => w + INTERIOR_WALKWAY_HALF_W),
    INTERIOR_MAIN_BOUNDS.xMax,
  ].sort((a, b) => a - b);
  const zEdges = [
    INTERIOR_MAIN_BOUNDS.zMin,
    ...INTERIOR_WALKWAY_Z.map((w) => w - INTERIOR_WALKWAY_HALF_W),
    ...INTERIOR_WALKWAY_Z.map((w) => w + INTERIOR_WALKWAY_HALF_W),
    INTERIOR_MAIN_BOUNDS.zMax,
  ].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xEdges.length; i += 2) {
    for (let j = 0; j + 1 < zEdges.length; j += 2) {
      addCarpetBlock(xEdges[i] + 0.4, xEdges[i + 1] - 0.4, zEdges[j] + 0.4, zEdges[j + 1] - 0.4, false);
    }
  }

  // Southern old hall west wing + lush Rawdah east bay
  addCarpetBlock(INTERIOR_SOUTH_BOUNDS.xMin + 1, RAWDAH_INTERIOR_BOUNDS.xMin - 2, INTERIOR_SOUTH_BOUNDS.zMin + 1, INTERIOR_SOUTH_BOUNDS.zMax - 1, false);
  addCarpetBlock(RAWDAH_INTERIOR_BOUNDS.xMin, RAWDAH_INTERIOR_BOUNDS.xMax, RAWDAH_INTERIOR_BOUNDS.zMin, RAWDAH_INTERIOR_BOUNDS.zMax, true);

  // 2. White Marble Interior Walkways + warm geometric inlay border
  for (const wx of INTERIOR_WALKWAY_X) {
    features.push(
      rectModelFeature(wx, (INTERIOR_MAIN_BOUNDS.zMin + INTERIOR_MAIN_BOUNDS.zMax) / 2, INTERIOR_WALKWAY_HALF_W, (INTERIOR_MAIN_BOUNDS.zMax - INTERIOR_MAIN_BOUNDS.zMin) / 2, {
        part: 'walkway',
        color: '#f4efe4',
        base: 0,
        height: 0.05,
        opacity: 0.96,
      }),
    );
    features.push(
      rectModelFeature(wx, (INTERIOR_MAIN_BOUNDS.zMin + INTERIOR_MAIN_BOUNDS.zMax) / 2, 0.25, (INTERIOR_MAIN_BOUNDS.zMax - INTERIOR_MAIN_BOUNDS.zMin) / 2 - 2, {
        part: 'walkway_inlay',
        color: '#c8a878',
        base: 0.05,
        height: 0.07,
        opacity: 0.9,
      }),
    );
  }
  for (const wz of INTERIOR_WALKWAY_Z) {
    features.push(
      rectModelFeature((INTERIOR_MAIN_BOUNDS.xMin + INTERIOR_MAIN_BOUNDS.xMax) / 2, wz, (INTERIOR_MAIN_BOUNDS.xMax - INTERIOR_MAIN_BOUNDS.xMin) / 2, INTERIOR_WALKWAY_HALF_W, {
        part: 'walkway',
        color: '#f4efe4',
        base: 0,
        height: 0.05,
        opacity: 0.96,
      }),
    );
  }

  // 3. Hypostyle Columns (plinth, brass AC vent collar, white marble shaft, gilded capital)
  const cols = interiorColumnCentres();
  const colKey = new Set(cols.map(([x, z]) => `${Math.round(x)},${Math.round(z)}`));
  for (const [cx, cz] of cols) {
    features.push(
      octagonModelFeature(cx, cz, 0.95, {
        part: 'plinth',
        color: '#e6dfd1',
        base: 0,
        height: 1.1,
        opacity: 0.98,
      }),
    );
    features.push(
      octagonModelFeature(cx, cz, 0.88, {
        part: 'ac_brass',
        color: '#c59b38',
        base: 0.78,
        height: 0.98,
        opacity: 0.98,
      }),
    );
    features.push(
      octagonModelFeature(cx, cz, 0.58, {
        part: 'column',
        color: '#f5f0e4',
        base: 1.1,
        height: 6.8,
        opacity: 0.98,
      }),
    );
    features.push(
      octagonModelFeature(cx, cz, 0.78, {
        part: 'capital',
        color: '#d4af37',
        base: 6.8,
        height: 7.8,
        opacity: 0.98,
      }),
    );

    // 4. Striped Ablaq (أبلق) Arches & Suspended Chandeliers to East and South neighbor columns
    const ablaqPalette = ['#efe8d8', '#2f3337', '#b86b43'] as const;
    const neighbors: readonly [number, number, boolean][] = [
      [cx + INTERIOR_COL_STEP_M, cz, true],
      [cx, cz + INTERIOR_COL_STEP_M, false],
    ];
    for (const [nx, nz, horizontal] of neighbors) {
      if (!colKey.has(`${Math.round(nx)},${Math.round(nz)}`)) continue;
      // Only add alternating basalt/cream/terracotta voussoirs along E-W and N-S span
      const segments = 5;
      for (let s = 0; s < segments; s++) {
        const t = (s + 0.5) / segments;
        const sx = cx + (nx - cx) * t;
        const sz = cz + (nz - cz) * t;
        const archHalfSpan = (INTERIOR_COL_STEP_M / segments) * 0.46;
        const archElev = s === 0 || s === 4 ? 7.6 : s === 1 || s === 3 ? 8.15 : 8.55;
        features.push(
          rectModelFeature(sx, sz, horizontal ? archHalfSpan : 0.42, horizontal ? 0.42 : archHalfSpan, {
            part: 'arch',
            color: ablaqPalette[s % ablaqPalette.length],
            base: archElev,
            height: archElev + 0.95,
            opacity: 0.92,
          }),
        );
      }
      // Chandelier centered in bays whose neighbor diagonally exists (avoids double chandeliers)
      if (horizontal && colKey.has(`${Math.round(cx)},${Math.round(cz + INTERIOR_COL_STEP_M)}`)) {
        features.push(
          octagonModelFeature(cx + INTERIOR_COL_STEP_M / 2, cz + INTERIOR_COL_STEP_M / 2, 0.85, {
            part: 'chandelier',
            color: '#ffd98a',
            base: 5.2,
            height: 6.0,
            opacity: 0.95,
          }),
        );
      }
    }
  }

  // 5. Red Velvet & Brass Stanchions along Gate 21 -> Rawdah enclosed women's corridor
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
