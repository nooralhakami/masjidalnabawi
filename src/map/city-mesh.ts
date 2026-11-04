/**
 * Geometry of the 3D view's surroundings (`scripts/city-from-osm.py`): the buildings round the Haram
 * as walls and flat roofs, and the mountains as a height grid. Pure: arrays in, arrays out, in the
 * models' metres frame (X east, Y up, Z south). Nothing here touches WebGL.
 */

/** `[height, seed, x0, z0, x1, z1, …]`: one building, as `madinah-city.json` stores it. */
export type BuildingRow = number[];

export interface TerrainGrid {
  cols: number;
  rows: number;
  /** Metres east and south of the anchor of the grid's north-west corner. */
  x0: number;
  z0: number;
  step: number;
  /** Metres above the Haram's ground, row by row from the north-west corner going south. */
  heights: Float32Array;
}

/** Per vertex: position (3), normal (3), uv (2: metres along the wall, metres up), info (3: seed 0–1, building height, kind). */
export const STRIDE = 11;
export const KIND_WALL = 0;
export const KIND_ROOF = 1;
export const KIND_TERRAIN = 2;

export interface CityMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Read `madinah-terrain.bin` (format in the script's docstring). */
export function parseTerrain(buffer: ArrayBuffer): TerrainGrid {
  const view = new DataView(buffer);
  const cols = view.getUint16(0, true);
  const rows = view.getUint16(2, true);
  const x0 = view.getFloat32(4, true);
  const z0 = view.getFloat32(8, true);
  const step = view.getFloat32(12, true);
  const heights = new Float32Array(cols * rows);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getUint16(16 + i * 2, true) / 10;
  return { cols, rows, x0, z0, step, heights };
}

/** Twice the signed area of a ring in the x/z plane (shoelace): positive when its turns are left turns. */
function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a;
}

/**
 * Triangulate a simple polygon by ear clipping (building footprints: a handful of corners, so the
 * quadratic cost does not matter). Returns indices into `pts`; a ring it cannot clip falls back to a fan.
 */
export function triangulate(pts: [number, number][]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = signedArea(pts) > 0;
  const idx = [...Array(n).keys()];
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  // A corner is an ear candidate when it turns the same way as the whole ring.
  const convex = (a: number, b: number, c: number) => (ccw ? cross(a, b, c) > 0 : cross(a, b, c) < 0);
  const inside = (p: number, a: number, b: number, c: number) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (!convex(a, b, c)) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
  return out;
}

/** Build one mesh for every building and the mountains (only where the ground rises). */
export function buildCityMesh(buildings: readonly BuildingRow[], terrain: TerrainGrid | null): CityMesh {
  // Sized up front and filled in place: growing plain arrays cost tens of ms on a phone.
  let vCap = 0;
  let iCap = 0;
  for (const row of buildings) {
    const corners = (row.length - 2) >> 1;
    vCap += corners * 5;
    iCap += corners * 6 + Math.max(0, corners - 2) * 3;
  }
  if (terrain) {
    vCap += terrain.cols * terrain.rows;
    iCap += (terrain.cols - 1) * (terrain.rows - 1) * 6;
  }
  const v = new Float32Array(vCap * STRIDE);
  const ix = new Uint32Array(iCap);
  let vn = 0;
  let inN = 0;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, seed: number, h: number, kind: number) => {
    const o = vn * STRIDE;
    v[o] = x;
    v[o + 1] = y;
    v[o + 2] = z;
    v[o + 3] = nx;
    v[o + 4] = ny;
    v[o + 5] = nz;
    v[o + 6] = u;
    v[o + 7] = w;
    v[o + 8] = seed;
    v[o + 9] = h;
    v[o + 10] = kind;
    return vn++;
  };
  const tri = (a: number, b: number, c: number) => {
    ix[inN++] = a;
    ix[inN++] = b;
    ix[inN++] = c;
  };

  for (const row of buildings) {
    const [height, seedRaw] = row;
    const seed = seedRaw / 100;
    const pts: [number, number][] = [];
    for (let i = 2; i + 1 < row.length; i += 2) pts.push([row[i], row[i + 1]]);
    if (pts.length < 3) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;

    // Walls: a quad per edge; `u` runs on round the building so the windows line up at corners.
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      let nx = (z1 - z0) / len;
      let nz = -(x1 - x0) / len;
      // Outward: away from the building's middle.
      if (nx * ((x0 + x1) / 2 - cx) + nz * ((z0 + z1) / 2 - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const a = push(x0, 0, z0, nx, 0, nz, along, 0, seed, height, KIND_WALL);
      const b = push(x1, 0, z1, nx, 0, nz, along + len, 0, seed, height, KIND_WALL);
      const c = push(x1, height, z1, nx, 0, nz, along + len, height, seed, height, KIND_WALL);
      const d = push(x0, height, z0, nx, 0, nz, along, height, seed, height, KIND_WALL);
      tri(a, b, c);
      tri(a, c, d);
      along += len;
    }

    // The flat roof.
    const base = vn;
    for (const [x, z] of pts) push(x, height, z, 0, 1, 0, x, z, seed, height, KIND_ROOF);
    const roof = triangulate(pts);
    for (let i = 0; i < roof.length; i += 3) tri(base + roof[i], base + roof[i + 1], base + roof[i + 2]);
  }

  if (terrain) {
    const { cols, rows, x0, z0, step, heights } = terrain;
    const base = vn;
    for (let r = 0; r < rows; r++) {
      const up = (r > 0 ? r - 1 : r) * cols;
      const down = (r < rows - 1 ? r + 1 : r) * cols;
      for (let c = 0; c < cols; c++) {
        const left = c > 0 ? c - 1 : c;
        const right = c < cols - 1 ? c + 1 : c;
        const here = heights[r * cols + c];
        // Normal from the slope of the neighbours.
        const dx = (heights[r * cols + right] - heights[r * cols + left]) / (2 * step);
        const dz = (heights[down + c] - heights[up + c]) / (2 * step);
        const len = Math.sqrt(dx * dx + 1 + dz * dz);
        push(x0 + c * step, here, z0 + r * step, -dx / len, 1 / len, -dz / len, 0, 0, 0, here, KIND_TERRAIN);
      }
    }
    // Only the cells where the ground rises: the flat city stays the imagery's.
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const a = r * cols + c;
        if (heights[a] <= 0 && heights[a + 1] <= 0 && heights[a + cols] <= 0 && heights[a + cols + 1] <= 0) continue;
        tri(base + a, base + a + cols, base + a + 1);
        tri(base + a + 1, base + a + cols, base + a + cols + 1);
      }
    }
  }

  return { vertices: v.subarray(0, vn * STRIDE), indices: ix.subarray(0, inN) };
}
