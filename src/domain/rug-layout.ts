import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import routing from '../../data/routing.json';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, PRAYER_CLEARINGS } from '../data-next/alharamain-prayers';
import { fromModelMetres as lngLatFromMetres, toModelMetres as metresFromOrigin } from './frames';
import { restroomFootprints, restroomWalkways } from './prayer-layout';

type XY = readonly [number, number];

function stripPoly(a: XY, b: XY, halfW: number): XY[] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  const nx = (-dy / len) * halfW;
  const ny = (dx / len) * halfW;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
}

/**
 * The prayer carpets (owner, 2026-11-07 / updated 2026-11-14): each 5 m across (east to west) and
 * 1.2 m deep toward the qibla (south). Partial rows (1, 2, or 3+ rows) and narrow wall strips are
 * allowed without requiring full 3-row groups, and small/medium walking aisles (`1.8 m` longitudinal
 * and `1.2 m`–`2.0 m` transverse) are carved inside large carpet blocks so visitors can take short
 * cuts across the courtyard prayer bays.
 */
export const RUG_W = 5;
export const RUG_D = 1.2;
export const GROUP_ROWS = 3;
export const GROUP_GAP = 0.8;
/** Width of carved longitudinal inter-carpet walking aisles (metres). */
export const AISLE_LONG_W = 1.8;
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

export interface AisleProps {
  kind: 'long' | 'cross';
  widthM: number;
}

export interface RugLayout {
  rugs: Rug[];
  /** The ground each laid area covers (carpets and the gaps inside it), four corners each, in metres. */
  covered: XY[][];
  /** The barriers round the courtyards' laid areas, to extrude. */
  barriers: FeatureCollection<Polygon, { height: number }>;
  /** Where walkers may not go: the covered ground with half a metre round it (the barriers' line). */
  blocked: XY[][];
  /** Small and medium walking aisles carved between sub-blocks inside prayer areas (for rendering & shortcuts). */
  aisles: FeatureCollection<LineString, AisleProps>;
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

/** The fewest carpets an area or split sub-block may hold (2026-11-14: allows narrow wall strips and 1–2 row patches). */
export const MIN_RUGS = 3;

/**
 * The largest rectangle of `on` cells (rows × columns) whose first row passes `top` and last row
 * passes `bottom`; null if there is none.
 */
export function largestRectangle(
  on: readonly (readonly boolean[])[],
  top: (row: number) => boolean = () => true,
  bottom: (row: number) => boolean = () => true,
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
  for (const w of routing.walkways) {
    for (let i = 1; i < w.path.length; i++) {
      const p = stripPoly(m([w.path[i - 1][1], w.path[i - 1][0]]), m([w.path[i][1], w.path[i][0]]), 1.0);
      if (p) avoid.push(p);
    }
  }
  const annex = alharamainPlaza().features.filter((f) => f.properties.kind === 'men' || f.properties.kind === 'women');
  const areas = [
    ...ALHARAMAIN_PRAYERS.map((r) => ({ ring: r.map(m), courtyard: true })),
    ...annex.map((f) => ({ ring: f.geometry.coordinates[0].slice(0, -1).map((ll) => m(ll as [number, number])), courtyard: false })),
  ];
  const rugs: Rug[] = [];
  const covered: XY[][] = [];
  const blocked: XY[][] = [];
  const features: Feature<Polygon, { height: number }>[] = [];
  const aisleFeatures: Feature<LineString, AisleProps>[] = [];
  /** The carpets laid so far, by their north-west corner in the laid frame, hashed by size. */
  const placed = new Map<string, [number, number][]>();
  /** Each area's covered cells in the laid frame, to drop a barrier that would stand on another's. */
  const cells: { area: number; u0: number; v0: number; u1: number; v1: number }[] = [];
  const pieces: { area: number; u: number; v: number; corners: [number, number][] }[] = [];
  let nextPatchId = 1;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const { ring, courtyard } of areas) {
    const us = ring.map((p) => p[0]);
    const vs = ring.map((p) => p[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const spanU = u1 - u0 - 2 * INSET;
    const rawAcross = Math.floor(spanU / RUG_W);
    if (rawAcross < 1) continue;
    // Wide blocks (≥ 30 m across) open a 1.8 m central walking aisle between left and right bays.
    const hasLongAisle = courtyard && rawAcross >= 6 && Math.floor((spanU - AISLE_LONG_W) / RUG_W) >= 5;
    const across = hasLongAisle ? Math.floor((spanU - AISLE_LONG_W) / RUG_W) : rawAcross;
    const splitCol = hasLongAisle ? Math.floor(across / 2) : -1;
    const totalW = across * RUG_W + (hasLongAisle ? AISLE_LONG_W : 0);
    const left = u0 + (u1 - u0 - totalW) / 2;
    const colU = (i: number) => left + i * RUG_W + (hasLongAisle && i >= splitCol ? AISLE_LONG_W : 0);
    let vStart = v0 + INSET;
    for (let dv = 0; dv <= RUG_D + 1e-6; dv += 0.1) {
      const v = v0 + INSET + dv;
      let fits = 0;
      for (let i = 0; i < across; i++) {
        const a = colU(i);
        if (within(a, v, a + RUG_W, v + RUG_D, ring)) fits++;
      }
      if (fits >= Math.ceil(across * 0.75)) {
        vStart = v;
        break;
      }
    }
    const rows: { v: number; gapAfter: boolean }[] = [];
    for (let g = 0; ; g++) {
      let done = false;
      for (let k = 0; k < GROUP_ROWS; k++) {
        const v = vStart + g * (GROUP_ROWS * RUG_D + GROUP_GAP) + k * RUG_D;
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
        const a = colU(i);
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
    const rugsIn = (r0: number, r1: number, c0: number, c1: number) => {
      let n = 0;
      for (let k = r0; k <= r1; k++) for (let i = c0; i <= c1; i++) if (laid[k][i] === 'rug') n++;
      return n;
    };
    // Extract clean, disjoint rectangles (1-row, 2-row, 3-row, or deeper strips are all allowed).
    const free = laid.map((row) => row.map((x) => x !== false));
    const rects: { r0: number; r1: number; c0: number; c1: number }[] = [];
    for (;;) {
      const r = largestRectangle(free);
      if (!r) break;
      const total = rugsIn(r.r0, r.r1, r.c0, r.c1);
      if (total < MIN_RUGS) break;
      // Split across any central longitudinal aisle, and split deep blocks (≥ 7 rows) across a middle row aisle.
      const horizParts =
        hasLongAisle && r.c0 < splitCol && r.c1 >= splitCol
          ? [
              { r0: r.r0, r1: r.r1, c0: r.c0, c1: splitCol - 1 },
              { r0: r.r0, r1: r.r1, c0: splitCol, c1: r.c1 },
            ]
          : [r];
      let added = 0;
      const pushedParts: typeof rects = [];
      for (const hPart of horizParts) {
        if (rugsIn(hPart.r0, hPart.r1, hPart.c0, hPart.c1) < MIN_RUGS) continue;
        const depth = hPart.r1 - hPart.r0 + 1;
        if (courtyard && depth >= 7) {
          let splitRow = Math.floor((hPart.r0 + hPart.r1) / 2);
          for (let dr = 0; dr <= 2; dr++) {
            if (splitRow - dr - hPart.r0 >= 2 && rows[splitRow - dr].gapAfter) {
              splitRow = splitRow - dr;
              break;
            }
            if (hPart.r1 - (splitRow + dr + 1) >= 2 && rows[splitRow + dr]?.gapAfter) {
              splitRow = splitRow + dr;
              break;
            }
          }
          const top = { r0: hPart.r0, r1: splitRow, c0: hPart.c0, c1: hPart.c1 };
          const bot = { r0: splitRow + 2, r1: hPart.r1, c0: hPart.c0, c1: hPart.c1 };
          if (bot.r0 <= bot.r1 && rugsIn(top.r0, top.r1, top.c0, top.c1) >= MIN_RUGS && rugsIn(bot.r0, bot.r1, bot.c0, bot.c1) >= MIN_RUGS) {
            rects.push(top, bot);
            pushedParts.push(top, bot);
            added += 2;
            const midV = (rows[splitRow].v + RUG_D + rows[splitRow + 2].v) / 2;
            const widthM = rows[splitRow + 2].v - (rows[splitRow].v + RUG_D);
            const uStartA = colU(hPart.c0);
            const uEndA = colU(hPart.c1) + RUG_W;
            aisleFeatures.push({
              type: 'Feature',
              properties: { kind: 'cross', widthM },
              geometry: { type: 'LineString', coordinates: [lngLatFromMetres(fromLaid([uStartA, midV])), lngLatFromMetres(fromLaid([uEndA, midV]))] },
            });
            continue;
          }
        }
        rects.push(hPart);
        pushedParts.push(hPart);
        added++;
      }
      if (hasLongAisle && r.c0 < splitCol && r.c1 >= splitCol && pushedParts.some((p) => p.c1 < splitCol) && pushedParts.some((p) => p.c0 >= splitCol)) {
        const midU = colU(splitCol - 1) + RUG_W + AISLE_LONG_W / 2;
        const vTopA = rows[r.r0].v;
        const vBotA = rows[r.r1].v + RUG_D;
        aisleFeatures.push({
          type: 'Feature',
          properties: { kind: 'long', widthM: AISLE_LONG_W },
          geometry: { type: 'LineString', coordinates: [lngLatFromMetres(fromLaid([midU, vTopA])), lngLatFromMetres(fromLaid([midU, vBotA]))] },
        });
      }
      for (let k = r.r0; k <= r.r1; k++) {
        for (let i = r.c0 - 1; i <= r.c1 + 1; i++) {
          if (i >= 0 && i < across) free[k][i] = false;
        }
      }
      if (added === 0 && horizParts.length === 1) break;
    }
    for (const rect of rects) {
      const patchId = nextPatchId++;
      for (let k = rect.r0; k <= rect.r1; k++) {
        for (let i = rect.c0; i <= rect.c1; i++) {
          if (laid[k][i] !== 'rug') continue;
          const a = colU(i);
          const r = rows[k];
          const key = `${Math.floor(a / RUG_W)}|${Math.floor(r.v / RUG_D)}`;
          placed.set(key, [...(placed.get(key) ?? []), [a, r.v]]);
          const [cx, cz] = fromLaid([a + RUG_W / 2, r.v + RUG_D / 2]);
          rugs.push({ x: cx, z: cz, flip: rnd() < 0.5, courtyard });
        }
      }
      // Lattice for this rectangle only: carpet rows, plus internal 0.8 m gaps between groups.
      const lattice: { v0: number; v1: number }[] = [];
      for (let k = rect.r0; k <= rect.r1; k++) {
        const r = rows[k];
        lattice.push({ v0: r.v, v1: r.v + RUG_D });
        if (r.gapAfter && k < rect.r1) lattice.push({ v0: r.v + RUG_D, v1: rows[k + 1].v });
      }
      for (const cell of lattice) {
        for (let i = rect.c0; i <= rect.c1; i++) {
          const a = colU(i);
          cells.push({ area: patchId, u0: a, v0: cell.v0, u1: a + RUG_W, v1: cell.v1 });
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
        }
      }
      if (!courtyard) continue;
      const uStart = colU(rect.c0);
      const uEnd = colU(rect.c1) + RUG_W;
      const vTop = lattice[0].v0;
      const vBot = lattice[lattice.length - 1].v1;
      const edges: readonly ['h' | 'v', number, number, number, number, number][] = [
        ['h', 0, -1, vTop, uStart, uEnd],
        ['h', 0, 1, vBot, uStart, uEnd],
        ['v', -1, 0, uStart, vTop, vBot],
        ['v', 1, 0, uEnd, vTop, vBot],
      ];
      for (const [dir, nu, nv, line, s0, s1] of edges) {
        // Round the corners: the run reaches out to where the barrier of the next side runs.
        const e0 = s0 - 0.42;
        const e1 = s1 + 0.42;
        const len = e1 - e0;
        const sections = Math.max(1, Math.round(len / 2.1));
        const step = len / sections;
        for (let s = 0; s < sections; s++) {
          const t0 = e0 + s * step + 0.05;
          const t1 = e0 + (s + 1) * step - 0.05;
          const pt = (t: number, off: number): XY => (dir === 'h' ? [t, line + nv * off] : [line + nu * off, t]);
          const mid = pt((t0 + t1) / 2, 0.36);
          const corners = [pt(t0, 0.3), pt(t1, 0.3), pt(t1, 0.42), pt(t0, 0.42)].map((p) => lngLatFromMetres(fromLaid(p)));
          pieces.push({ area: patchId, u: mid[0], v: mid[1], corners });
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
  const layout: RugLayout = {
    rugs,
    covered,
    blocked,
    barriers: { type: 'FeatureCollection', features },
    aisles: { type: 'FeatureCollection', features: aisleFeatures },
  };
  cache = { key, layout };
  return layout;
}

/**
 * Small and medium walking aisles carved between sub-blocks inside prayer areas, used both for
 * subtle visual lane rendering on the map and for optional secondary shortcut paths (`مسار فرعي`).
 */
export function buildInterCarpetAisles(columns?: readonly (readonly [number, number])[]): FeatureCollection<LineString, AisleProps> {
  if (!columns && cache) return cache.layout.aisles;
  return rugLayout(columns ?? []).aisles;
}
