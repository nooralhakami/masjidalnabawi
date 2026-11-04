/**
 * Geometry of the mountains round Madinah in the 3D view (`scripts/terrain-from-srtm.py`): a height
 * grid turned into triangles, only where the ground rises over the Haram. Pure: arrays in, arrays
 * out, in the models' metres frame (X east, Y up, Z south). Nothing here touches WebGL.
 */

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

/** Per vertex: position (3), normal (3). */
export const STRIDE = 6;

export interface TerrainMesh {
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

/** The mountains as one mesh: every grid point, and the cells where the ground rises (the flat city stays the imagery's). */
export function buildTerrainMesh({ cols, rows, x0, z0, step, heights }: TerrainGrid): TerrainMesh {
  const v = new Float32Array(cols * rows * STRIDE);
  for (let r = 0; r < rows; r++) {
    const up = (r > 0 ? r - 1 : r) * cols;
    const down = (r < rows - 1 ? r + 1 : r) * cols;
    for (let c = 0; c < cols; c++) {
      const left = c > 0 ? c - 1 : c;
      const right = c < cols - 1 ? c + 1 : c;
      // Normal from the slope of the neighbours.
      const dx = (heights[r * cols + right] - heights[r * cols + left]) / (2 * step);
      const dz = (heights[down + c] - heights[up + c]) / (2 * step);
      const len = Math.sqrt(dx * dx + 1 + dz * dz);
      const o = (r * cols + c) * STRIDE;
      v[o] = x0 + c * step;
      v[o + 1] = heights[r * cols + c];
      v[o + 2] = z0 + r * step;
      v[o + 3] = -dx / len;
      v[o + 4] = 1 / len;
      v[o + 5] = -dz / len;
    }
  }
  const ix = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let n = 0;
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c;
      if (heights[a] <= 0 && heights[a + 1] <= 0 && heights[a + cols] <= 0 && heights[a + cols + 1] <= 0) continue;
      ix[n++] = a;
      ix[n++] = a + cols;
      ix[n++] = a + 1;
      ix[n++] = a + 1;
      ix[n++] = a + cols;
      ix[n++] = a + cols + 1;
    }
  }
  return { vertices: v, indices: ix.subarray(0, n) };
}
