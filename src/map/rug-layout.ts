import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, PRAYER_CLEARINGS } from '../data-next/alharamain-prayers';
import { lngLatFromMetres, metresFromOrigin } from './glb-layer';
import { restroomFootprints, restroomWalkways } from './prayer-layout';

type XY = readonly [number, number];

/**
 * The prayer carpets (owner, 2026-11-07): each 5 m across (east to west) and 1.2 m deep toward the
 * qibla (south), the proportions of his reference photograph; in groups of three rows with 80 cm of
 * floor between the groups. Only whole carpets are laid: one that does not fit, or would cross a
 * walkway, a cleared corridor, a restroom block or a column, is left out, and the prayer area is
 * what its carpets cover.
 */
export const RUG_W = 5;
export const RUG_D = 1.2;
export const GROUP_ROWS = 3;
export const GROUP_GAP = 0.8;
/** Kept between a carpet and its area's edge. */
const INSET = 0.3;
const COLUMN_CLEAR = 1.05;
/** Kept between a carpet and a walkway, a cleared corridor or a restroom: the barrier's room. */
const KEEP_OFF = 0.5;

/** A carpet: its centre in the models' metres (x east, z south), and whether it lies turned round. */
export interface Rug {
  x: number;
  z: number;
  flip: boolean;
  /** The courtyards' areas (inside the Haram) are ringed by barriers; the western annex's are not. */
  courtyard: boolean;
}

export interface RugLayout {
  rugs: Rug[];
  /** The ground each laid area covers (carpets and the gaps inside it), four corners each, in metres. */
  covered: XY[][];
  /** The barriers round the courtyards' laid areas, to extrude. */
  barriers: FeatureCollection<Polygon, { height: number }>;
  /** Where walkers may not go: the covered ground with half a metre round it (the barriers' line). */
  blocked: XY[][];
}

/** Rotation of the prayer carpets (degrees clockwise): aligned with the canopies, never tilted to the qibla. */
export const RUG_TURN_DEG = ALHARAMAIN_MODELS[1].rotation;
/** The frame the carpets are laid in: turned with the canopies (and the paving), so rows run true. */
const TURN = (RUG_TURN_DEG * Math.PI) / 180;
const toLaid = ([x, z]: XY): XY => [Math.cos(TURN) * x - Math.sin(TURN) * z, Math.sin(TURN) * x + Math.cos(TURN) * z];
const fromLaid = ([u, v]: XY): XY => [Math.cos(TURN) * u + Math.sin(TURN) * v, -Math.sin(TURN) * u + Math.cos(TURN) * v];

function inside([x, y]: XY, ring: readonly XY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  }
  return c;
}

/** Do segments a-b and c-d cross (properly)? */
function cross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Does the axis-aligned rectangle [u0,u1]×[v0,v1] overlap the polygon at all? */
function touches(u0: number, v0: number, u1: number, v1: number, poly: readonly XY[]): boolean {
  const rect: XY[] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  if (poly.some(([u, v]) => u > u0 && u < u1 && v > v0 && v < v1)) return true;
  if (rect.some((p) => inside(p, poly))) return true;
  for (let i = 0; i < 4; i++) for (let j = 0; j < poly.length; j++) if (cross(rect[i], rect[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return true;
  return false;
}

/** Is the rectangle wholly inside the polygon (corners in, no edge of it crossing the rectangle)? */
function within(u0: number, v0: number, u1: number, v1: number, poly: readonly XY[]): boolean {
  const rect: XY[] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  if (!rect.every((p) => inside(p, poly))) return false;
  if (poly.some(([u, v]) => u > u0 && u < u1 && v > v0 && v < v1)) return false;
  for (let i = 0; i < 4; i++) for (let j = 0; j < poly.length; j++) if (cross(rect[i], rect[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return false;
  return true;
}

let cache: { key: number; layout: RugLayout } | null = null;

/** The fewest carpets an area may hold (owner, 2026-11-07: no small patches of three or seven). */
export const MIN_RUGS = 12;

/**
 * The largest rectangle of `on` cells (rows × columns) whose first row passes `top` and last row
 * passes `bottom` (whole groups of rows); null if there is none.
 */
export function largestRectangle(
  on: readonly (readonly boolean[])[],
  top: (row: number) => boolean,
  bottom: (row: number) => boolean,
): { r0: number; r1: number; c0: number; c1: number } | null {
  let best: { r0: number; r1: number; c0: number; c1: number } | null = null;
  let bestArea = 0;
  const width = on[0]?.length ?? 0;
  for (let r0 = 0; r0 < on.length; r0++) {
    if (!top(r0)) continue;
    const all = on[r0].slice();
    for (let r1 = r0; r1 < on.length; r1++) {
      if (r1 > r0) for (let c = 0; c < width; c++) all[c] = all[c] && on[r1][c];
      if (!all.some(Boolean)) break;
      if (!bottom(r1)) continue;
      // The longest run of columns open in every row from r0 to r1.
      let run = 0;
      for (let c = 0; c <= width; c++) {
        if (c < width && all[c]) {
          run++;
          continue;
        }
        const area = run * (r1 - r0 + 1);
        if (area > bestArea) {
          bestArea = area;
          best = { r0, r1, c0: c - run, c1: c - 1 };
        }
        run = 0;
      }
    }
  }
  return best;
}

/**
 * Lay the carpets in every prayer area (the courtyards' and the western annex's), clear of the
 * columns at `columns` (`[lng, lat]`, the canopies' and lamps'), and ring the courtyards' laid areas
 * with barriers. The same columns give the same layout (kept).
 */
export function rugLayout(columns: readonly (readonly [number, number])[]): RugLayout {
  const key = columns.length + (columns[0]?.[0] ?? 0);
  if (cache && cache.key === key) return cache.layout;
  const m = (ll: readonly [number, number]) => toLaid(metresFromOrigin(ll as [number, number]));
  const cols = columns.map(m);
  const avoid = [...restroomWalkways(), ...restroomFootprints(0.3)].map((r) => r.map(toLaid));
  for (const r of PRAYER_CLEARINGS) avoid.push(r.map(m));
  const annex = alharamainPlaza().features.filter((f) => f.properties.kind === 'men' || f.properties.kind === 'women');
  const areas = [
    ...ALHARAMAIN_PRAYERS.map((r) => ({ ring: r.map(m), courtyard: true })),
    ...annex.map((f) => ({ ring: f.geometry.coordinates[0].slice(0, -1).map((ll) => m(ll as [number, number])), courtyard: false })),
  ];
  const rugs: Rug[] = [];
  const covered: XY[][] = [];
  const blocked: XY[][] = [];
  const features: Feature<Polygon, { height: number }>[] = [];
  /** The carpets laid so far, by their north-west corner in the laid frame, hashed by size. */
  const placed = new Map<string, [number, number][]>();
  /** Each area's covered cells in the laid frame, to drop a barrier that would stand on another's. */
  const cells: { area: number; u0: number; v0: number; u1: number; v1: number }[] = [];
  const pieces: { area: number; u: number; v: number; corners: [number, number][] }[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const [areaIndex, { ring, courtyard }] of areas.entries()) {
    const us = ring.map((p) => p[0]);
    const vs = ring.map((p) => p[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const across = Math.floor((u1 - u0 - 2 * INSET) / RUG_W);
    if (across < 1) continue;
    // Centred across the area; rows from its north edge, in groups.
    const left = u0 + (u1 - u0 - across * RUG_W) / 2;
    const rows: { v: number; gapAfter: boolean }[] = [];
    for (let g = 0; ; g++) {
      let done = false;
      for (let k = 0; k < GROUP_ROWS; k++) {
        const v = v0 + INSET + g * (GROUP_ROWS * RUG_D + GROUP_GAP) + k * RUG_D;
        if (v + RUG_D > v1 - INSET) {
          done = true;
          break;
        }
        rows.push({ v, gapAfter: k === GROUP_ROWS - 1 });
      }
      if (done) break;
    }
    // Which carpets are laid: whole, inside the area, clear of everything in the way.
    const laid = rows.map(({ v }) =>
      Array.from({ length: across }, (_, i) => {
        const a = left + i * RUG_W;
        if (!within(a, v, a + RUG_W, v + RUG_D, ring)) return false;
        // Half a metre off a walkway, a cleared corridor or a restroom: room for the barrier.
        const c = KEEP_OFF;
        if (avoid.some((p) => touches(a - c, v - c, a + RUG_W + c, v + RUG_D + c, p))) return false;
        // Never over a carpet another area has laid (areas that touch share their edge).
        const hu = Math.floor(a / RUG_W);
        const hv = Math.floor(v / RUG_D);
        for (let du = -1; du <= 1; du++) {
          for (let dv = -1; dv <= 1; dv++) {
            for (const [pu, pv] of placed.get(`${hu + du}|${hv + dv}`) ?? []) {
              if (Math.abs(pu - a) < RUG_W - 1e-6 && Math.abs(pv - v) < RUG_D - 1e-6) return false;
            }
          }
        }
        // A column standing here: no carpet, but the place stays inside the area (the barrier goes
        // round the area, not round the column).
        const column = cols.some(([cu, cv]) => {
          const du = Math.max(a - cu, 0, cu - (a + RUG_W));
          const dv = Math.max(v - cv, 0, cv - (v + RUG_D));
          return du * du + dv * dv < COLUMN_CLEAR * COLUMN_CLEAR;
        });
        return column ? 'column' : 'rug';
      }),
    );
    // Only clean squares and rectangles (owner, 2026-11-07): the largest of whole groups of rows
    // inside what could be laid, then the next largest clear of it (not touching, so no L or T
    // shapes), each with at least MIN_RUGS carpets; what is left over is not laid.
    const free = laid.map((row) => row.map((x) => x !== false));
    const keepCell = laid.map((row) => row.map(() => false));
    for (;;) {
      const r = largestRectangle(
        free,
        (k) => k % GROUP_ROWS === 0,
        (k) => k % GROUP_ROWS === GROUP_ROWS - 1 || k === rows.length - 1,
      );
      if (!r) break;
      let count = 0;
      for (let k = r.r0; k <= r.r1; k++) for (let i = r.c0; i <= r.c1; i++) if (laid[k][i] === 'rug') count++;
      if (count < MIN_RUGS) break;
      for (let k = r.r0 - 1; k <= r.r1 + 1; k++) {
        for (let i = r.c0 - 1; i <= r.c1 + 1; i++) {
          if (k < 0 || i < 0 || k >= rows.length || i >= across) continue;
          free[k][i] = false;
          if (k >= r.r0 && k <= r.r1 && i >= r.c0 && i <= r.c1) keepCell[k][i] = true;
        }
      }
    }
    laid.forEach((row, k) =>
      row.forEach((_, i) => {
        if (!keepCell[k][i]) row[i] = false;
      }),
    );
    const onArea = laid.map((row) => row.map((x) => x !== false));
    // The lattice of the laid area: carpet rows, and between groups a gap row that belongs to the
    // area where carpets lie on both sides of it.
    type Cell = { v0: number; v1: number; on: boolean[] };
    const lattice: Cell[] = [];
    rows.forEach((r, k) => {
      lattice.push({ v0: r.v, v1: r.v + RUG_D, on: onArea[k] });
      if (r.gapAfter && k + 1 < rows.length) {
        lattice.push({ v0: r.v + RUG_D, v1: rows[k + 1].v, on: onArea[k].map((x, i) => x && onArea[k + 1][i]) });
      }
    });
    rows.forEach((r, k) =>
      laid[k].forEach((x, i) => {
        if (x !== 'rug') return;
        const a = left + i * RUG_W;
        const key = `${Math.floor(a / RUG_W)}|${Math.floor(r.v / RUG_D)}`;
        placed.set(key, [...(placed.get(key) ?? []), [a, r.v]]);
        const [cx, cz] = fromLaid([left + (i + 0.5) * RUG_W, r.v + RUG_D / 2]);
        rugs.push({ x: cx, z: cz, flip: rnd() < 0.5, courtyard });
      }),
    );
    for (const cell of lattice) {
      cell.on.forEach((x, i) => {
        if (!x) return;
        const a = left + i * RUG_W;
        cells.push({ area: areaIndex, u0: a, v0: cell.v0, u1: a + RUG_W, v1: cell.v1 });
        blocked.push(
          (
            [
              [a - 0.5, cell.v0 - 0.5],
              [a + RUG_W + 0.5, cell.v0 - 0.5],
              [a + RUG_W + 0.5, cell.v1 + 0.5],
              [a - 0.5, cell.v1 + 0.5],
            ] as XY[]
          ).map(fromLaid),
        );
        covered.push(
          (
            [
              [a, cell.v0],
              [a + RUG_W, cell.v0],
              [a + RUG_W, cell.v1],
              [a, cell.v1],
            ] as XY[]
          ).map(fromLaid),
        );
      });
    }
    if (!courtyard) continue;
    // The barrier: along every edge between a covered cell and an uncovered one, 0.3 m outside.
    const isOn = (r: number, i: number) => r >= 0 && r < lattice.length && i >= 0 && i < across && lattice[r].on[i];
    const segments: [XY, XY, XY][] = []; // from, to, outward normal (in the laid frame)
    lattice.forEach((cell, r) => {
      cell.on.forEach((x, i) => {
        if (!x) return;
        const a = left + i * RUG_W;
        const b = a + RUG_W;
        if (!isOn(r - 1, i))
          segments.push([
            [a, cell.v0],
            [b, cell.v0],
            [0, -1],
          ]);
        if (!isOn(r + 1, i))
          segments.push([
            [a, cell.v1],
            [b, cell.v1],
            [0, 1],
          ]);
        if (!isOn(r, i - 1))
          segments.push([
            [a, cell.v0],
            [a, cell.v1],
            [-1, 0],
          ]);
        if (!isOn(r, i + 1))
          segments.push([
            [b, cell.v0],
            [b, cell.v1],
            [1, 0],
          ]);
      });
    });
    // Joined into straight runs, so the sections are even.
    const runs = new Map<string, [number, number][]>();
    for (const [p, q, n] of segments) {
      const horizontal = n[0] === 0;
      const k = `${horizontal ? 'h' : 'v'}|${n[0]}|${n[1]}|${(horizontal ? p[1] : p[0]).toFixed(3)}`;
      const list = runs.get(k) ?? [];
      list.push(horizontal ? [p[0], q[0]] : [p[1], q[1]]);
      runs.set(k, list);
    }
    for (const [k, list] of runs) {
      const [dir, nu, nv, at] = k.split('|');
      const line = Number(at);
      const n: XY = [Number(nu), Number(nv)];
      list.sort((p, q) => p[0] - q[0]);
      const merged: [number, number][] = [];
      for (const s of list) {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]);
        else merged.push([s[0], s[1]]);
      }
      for (const [s0, s1] of merged) {
        // Round the corners: the run reaches out to where the barrier of the next side runs.
        const e0 = s0 - 0.42;
        const e1 = s1 + 0.42;
        const len = e1 - e0;
        const sections = Math.max(1, Math.round(len / 2.1));
        const step = len / sections;
        for (let s = 0; s < sections; s++) {
          const t0 = e0 + s * step + 0.05;
          const t1 = e0 + (s + 1) * step - 0.05;
          const pt = (t: number, off: number): XY => (dir === 'h' ? [t, line + n[1] * off] : [line + n[0] * off, t]);
          const mid = pt((t0 + t1) / 2, 0.36);
          const corners = [pt(t0, 0.3), pt(t1, 0.3), pt(t1, 0.42), pt(t0, 0.42)].map((p) => lngLatFromMetres(fromLaid(p)));
          pieces.push({ area: areaIndex, u: mid[0], v: mid[1], corners });
        }
      }
    }
  }
  // No barrier between two areas that touch or nearly do: a section within a metre of another
  // area's carpets is left out, and the carpet runs on.
  const near = new Map<string, typeof cells>();
  for (const c of cells) {
    for (let iu = Math.floor(c.u0 / 10); iu <= Math.floor(c.u1 / 10); iu++) {
      for (let iv = Math.floor(c.v0 / 10); iv <= Math.floor(c.v1 / 10); iv++) {
        const k = `${iu}|${iv}`;
        near.set(k, [...(near.get(k) ?? []), c]);
      }
    }
  }
  for (const p of pieces) {
    const others = near.get(`${Math.floor(p.u / 10)}|${Math.floor(p.v / 10)}`) ?? [];
    if (others.some((c) => c.area !== p.area && p.u > c.u0 - 1 && p.u < c.u1 + 1 && p.v > c.v0 - 1 && p.v < c.v1 + 1)) continue;
    features.push({ type: 'Feature', properties: { height: 1.05 }, geometry: { type: 'Polygon', coordinates: [[...p.corners, p.corners[0]]] } });
  }
  const layout = { rugs, covered, blocked, barriers: { type: 'FeatureCollection' as const, features } };
  cache = { key, layout };
  return layout;
}
