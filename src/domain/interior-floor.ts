import type { InteriorCarpetData, InteriorFloorData } from '../data-next/interior-floor-data';
import { toModelMetres, type XY } from './frames';
import { INTERIOR_COL_STEP_M, interiorColumnCentres } from './interior-layout';
import { COLUMN_CLEAR, fromLaid, inside, RUG_D, RUG_W, type Rug, toLaid, within } from './rug-layout';

/**
 * The Mosque's interior floor as navQ's ground-floor plan draws it (owner, 2026-11-18): "the prayer
 * areas with carpets, and the walkways with the tiles inside the Haram, as the plan extracted from
 * the Authority's site shows". `data/navq-interior-floor.json` (scripts/interior-floor-from-navq.py)
 * holds the shapes in `[lng, lat]`; here they become the models' metres, and the carpets, Ottoman
 * Rawdah/Sacred Chamber exterior/Greeting Passage landmarks, and women's wooden partitions are laid.
 */

export type { InteriorCarpetData, InteriorFloorData };

export interface InteriorCarpetArea {
  navq: number;
  /** Corners in the models' metres (x east, z south). */
  ring: XY[];
  women: boolean;
  /** The old Mosque and the Rawdah (navQ 513, 506): rendered in the Ottoman style. */
  oldMosque: boolean;
  names: string[];
}

export interface InteriorLandmarks {
  minbar: XY | null;
  mihrab: XY | null;
  salamFront: XY | null;
}

export interface InteriorFloor {
  /** The walking floor, polished marble (navQ FF0, outer rings: the carpets lie over it). */
  marble: XY[][];
  /** The women's marble walking floor parts (navQ FF0 parts 34, 291, 425). */
  womenMarble: XY[][];
  /** The men's marble walking floor parts (navQ FF0 excluding women's parts). */
  menMarble: XY[][];
  carpets: InteriorCarpetArea[];
  /** Open to the sky (the First Hasawa): no roof, no columns, canopies over its carpet. */
  courtyards: XY[][];
  /** Exterior perimeter of the Sacred Chamber (الحجرة الشريفة, navQ FF1 #13) — solid exterior only. */
  chamber: XY[] | null;
  /** Exact navQ positions of the Prophetic Minbar, Mihrab, and Greeting Passage front. */
  landmarks: InteriorLandmarks;
}

/** An architectural prop placed at `[x, z]` (model metres), turned by `angle` (rad, XZ) and scaled along local X. */
export interface OrientedProp {
  x: number;
  z: number;
  /** Rotation in radians so local `+X` points along `(cos(angle), sin(angle))` in `(x, z)`. */
  angle: number;
  /** Length scale along local X (e.g. segment length for 1 m unit meshes). */
  scaleX: number;
}

export const RAWDAH_NAVQ = 506;
const OLD_MOSQUE_NAVQ = new Set([506, 513]);
const RAWDAH_COL_STEP_M = 6.8;

const metres = (ring: readonly (readonly [number, number])[]): XY[] => ring.map((ll) => toModelMetres([ll[0], ll[1]]));

export function interiorFloorMetres(data: InteriorFloorData): InteriorFloor {
  const carpet = (c: InteriorCarpetData, women: boolean): InteriorCarpetArea => ({
    navq: c.navq,
    ring: metres(c.ring),
    women,
    oldMosque: OLD_MOSQUE_NAVQ.has(c.navq),
    names: c.names,
  });
  const marbleAll = data.marble.map((m) => ({ ring: metres(m.ring), women: Boolean(m.women) }));
  return {
    marble: marbleAll.map((m) => m.ring),
    womenMarble: marbleAll.filter((m) => m.women).map((m) => m.ring),
    menMarble: marbleAll.filter((m) => !m.women).map((m) => m.ring),
    carpets: [...data.men.map((c) => carpet(c, false)), ...data.women.map((c) => carpet(c, true))],
    courtyards: data.courtyard.map((c) => metres(c.ring)),
    chamber: data.chamber?.ring ? metres(data.chamber.ring) : null,
    landmarks: {
      minbar: data.landmarks?.minbar ? toModelMetres(data.landmarks.minbar) : null,
      mihrab: data.landmarks?.mihrab ? toModelMetres(data.landmarks.mihrab) : null,
      salamFront: data.landmarks?.salamFront ? toModelMetres(data.landmarks.salamFront) : null,
    },
  };
}

/** Is `[x, z]` (model metres) under the open sky of a courtyard? */
export function inCourtyard(floor: InteriorFloor, p: XY): boolean {
  return floor.courtyards.some((r) => inside(p, r));
}

/** Is `[x, z]` inside the Sacred Chamber footprint (`FF1 #13`)? */
export function inChamber(floor: InteriorFloor, p: XY): boolean {
  return floor.chamber ? inside(p, floor.chamber) : false;
}

/** Is `[x, z]` inside the Ottoman old Mosque or Noble Rawdah (`navQ 506`, `513`)? */
export function inOldMosque(floor: InteriorFloor, p: XY): boolean {
  return floor.carpets.some((c) => c.oldMosque && inside(p, c.ring));
}

function nearPoint(p: XY, target: XY | null, radius: number): boolean {
  return target !== null && Math.hypot(p[0] - target[0], p[1] - target[1]) < radius;
}

/**
 * The columns that stand: the approved grid (`interiorColumnCentres`, owner 2026-11-18: kept for
 * now) inside the Mosque's floor, never in an open courtyard (the Hasawa has its canopies) and
 * never inside the Sacred Chamber.
 */
export function interiorColumns(floor: InteriorFloor): XY[] {
  const rings = [...floor.marble, ...floor.carpets.map((c) => c.ring)];
  return interiorColumnCentres()
    .map(([x, z]): XY => [x, z])
    .filter((c) => rings.some((r) => inside(c, r)) && !inCourtyard(floor, c) && !inChamber(floor, c));
}

/**
 * Additional Ottoman columns placed on the denser historic rhythm (~6.8 m) inside the Noble Rawdah
 * (`navQ 506`), clear of the Sacred Chamber, the Prophetic Minbar and Mihrab, and existing columns.
 */
export function rawdahExtraColumns(floor: InteriorFloor, gridColumns: readonly XY[]): XY[] {
  const rawdah = floor.carpets.find((c) => c.navq === RAWDAH_NAVQ);
  if (!rawdah) return [];
  const xs = rawdah.ring.map((p) => p[0]);
  const zs = rawdah.ring.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const extra: XY[] = [];
  for (let x = x0 + 3.2; x <= x1 - 2.2; x += RAWDAH_COL_STEP_M) {
    for (let z = z0 + 3.4; z <= z1 - 3.0; z += RAWDAH_COL_STEP_M) {
      const p: XY = [x, z];
      if (!inside(p, rawdah.ring) || inChamber(floor, p)) continue;
      if (nearPoint(p, floor.landmarks.minbar, 3.0) || nearPoint(p, floor.landmarks.mihrab, 2.5)) continue;
      if (gridColumns.some((c) => Math.hypot(c[0] - x, c[1] - z) < 3.8)) continue;
      extra.push(p);
    }
  }
  return extra;
}

/**
 * The carpets inside the Mosque: whole rugs (`RUG_W` across, `RUG_D` deep, the plazas' own) laid in
 * unbroken rows from each prayer area's northern edge toward the qibla, turned with the paving as the
 * plazas' are, every rug wholly inside its area and clear of the columns, the Sacred Chamber, and the
 * Prophetic Minbar/Mihrab. Carpets inside the Noble Rawdah (`navQ 506`) carry `rawdah: true`.
 */
export function interiorRugs(floor: InteriorFloor, columns: readonly XY[]): Rug[] {
  const rugs: Rug[] = [];
  const allCols = [...columns, ...rawdahExtraColumns(floor, columns)];
  const cols = allCols.map(toLaid);
  const { minbar, mihrab } = floor.landmarks;
  let seed = 11;
  for (const area of floor.carpets) {
    const isRawdah = area.navq === RAWDAH_NAVQ;
    const ring = area.ring.map(toLaid);
    const us = ring.map((p) => p[0]);
    const vs = ring.map((p) => p[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const across = Math.floor((u1 - u0) / RUG_W);
    if (across < 1) continue;
    const left = u0 + (u1 - u0 - across * RUG_W) / 2;
    for (let v = v0 + 0.2; v + RUG_D <= v1; v += RUG_D) {
      for (let i = 0; i < across; i++) {
        const a = left + i * RUG_W;
        if (!within(a, v, a + RUG_W, v + RUG_D, ring)) continue;
        const column = cols.some(([cu, cv]) => {
          const du = Math.max(a - cu, 0, cu - (a + RUG_W));
          const dv = Math.max(v - cv, 0, cv - (v + RUG_D));
          return du * du + dv * dv < COLUMN_CLEAR * COLUMN_CLEAR;
        });
        if (column) continue;
        const [x, z] = fromLaid([a + RUG_W / 2, v + RUG_D / 2]);
        if (inChamber(floor, [x, z])) continue;
        if (nearPoint([x, z], minbar, 2.5) || nearPoint([x, z], mihrab, 2.0)) continue;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        rugs.push({ x, z, flip: seed % 2 === 0, courtyard: false, rawdah: isRawdah || undefined });
      }
    }
  }
  return rugs;
}

/**
 * Tile a straight segment `a -> b` into oriented 1 m-unit props so their local `+Z` faces toward
 * `(nx, nz)` (outward normal). Keeps each unit close to `maxTileM` wide so lattice/grille spacing
 * stays uniform without stretching.
 */
function tileSegment(a: XY, b: XY, outward: XY, maxTileM = 2.0): OrientedProp[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return [];
  // Local +X = (cos t, sin t), local +Z = (-sin t, cos t). Flip direction if +Z points inward.
  let tx = dx / len;
  let tz = dz / len;
  if (-tz * outward[0] + tx * outward[1] < 0) {
    tx = -tx;
    tz = -tz;
  }
  const angle = Math.atan2(tz, tx);
  const count = Math.max(1, Math.round(len / maxTileM));
  const step = len / count;
  const out: OrientedProp[] = [];
  for (let k = 0; k < count; k++) {
    const u = (k + 0.5) / count;
    out.push({ x: a[0] + dx * u, z: a[1] + dz * u, angle, scaleX: step });
  }
  return out;
}

/**
 * Exterior golden grilles & green Qur'anic plaques wrapping the Sacred Chamber (`FF1 #13`).
 * Every face points outward away from the chamber's centroid; zero interior depiction (dignity rule).
 */
export function chamberExteriorGrilles(floor: InteriorFloor): OrientedProp[] {
  const ring = floor.chamber;
  if (!ring || ring.length < 3) return [];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const out: OrientedProp[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.8) continue;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    let nx = -(b[1] - a[1]) / len;
    let nz = (b[0] - a[0]) / len;
    // Choose the normal pointing outside the chamber polygon (away from centroid)
    const test: XY = [mx + nx * 0.4, mz + nz * 0.4];
    if (inside(test, ring) || (nx * (mx - cx) + nz * (mz - cz) < 0 && !inside([mx - nx * 0.4, mz - nz * 0.4], ring))) {
      nx = -nx;
      nz = -nz;
    }
    out.push(...tileSegment(a, b, [nx, nz], 1.8));
  }
  return out;
}

/**
 * Low gilded brass railing along the Greeting Passage (`ممر السلام`) south of the Sacred Chamber
 * and Noble Rawdah, matching the owner's photograph `03-ممر-السلام-السجاد-والحاجز-الذهبي.jpg`.
 */
export function salamPassageRails(floor: InteriorFloor): OrientedProp[] {
  if (!floor.chamber) return [];
  const xs = floor.chamber.map((p) => p[0]);
  const zs = floor.chamber.map((p) => p[1]);
  const zRail = Math.max(...zs) + 1.45; // ~1.45 m south of the Sacred Chamber's southern façade
  const rawdah = floor.carpets.find((c) => c.navq === RAWDAH_NAVQ);
  const xStart = rawdah ? Math.min(...rawdah.ring.map((p) => p[0])) : Math.min(...xs) - 18;
  const xEnd = Math.max(...xs);
  return tileSegment([xStart, zRail], [xEnd, zRail], [0, 1], 1.5);
}

/**
 * Wooden partitions separating the interior women's prayer areas (`womenMarble` + women's `FF6`
 * carpets) from men's areas (`menMarble` + men's `FF5` carpets). Derived purely from navQ's floor
 * boundaries, so they never block women's outer gates (11–17, 23–31) on the Mosque's exterior wall.
 */
export function womenWoodPartitions(floor: InteriorFloor): OrientedProp[] {
  const menRings = [...floor.menMarble, ...floor.carpets.filter((c) => !c.women).map((c) => c.ring)];
  const womenRings = [...floor.womenMarble, ...floor.carpets.filter((c) => c.women).map((c) => c.ring)];
  if (!menRings.length || !womenRings.length) return [];
  const out: OrientedProp[] = [];
  const PROBE_M = 2.5;
  for (const ring of womenRings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1.5) continue;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const nx = -(b[1] - a[1]) / len;
      const nz = (b[0] - a[0]) / len;
      for (const sgn of [1, -1] as const) {
        const probe: XY = [mx + sgn * nx * PROBE_M, mz + sgn * nz * PROBE_M];
        const inMen = menRings.some((r) => inside(probe, r));
        const inWomen = womenRings.some((r) => inside(probe, r));
        if (inMen && !inWomen) {
          out.push(...tileSegment(a, b, [sgn * nx, sgn * nz], 2.0));
          break;
        }
      }
    }
  }
  return out;
}

/** Where the interior's props stand (model metres): Saudi extension columns/arches/chandeliers,
 * plus the Ottoman Rawdah/old-Mosque columns & chandeliers, the Sacred Chamber's exterior grilles,
 * the Greeting Passage golden rail, the Prophetic Minbar & Mihrab, and women's wooden partitions. */
export interface InteriorPropPlacements {
  columns: XY[];
  archesEastWest: XY[];
  archesNorthSouth: XY[];
  chandeliers: XY[];
  ottomanColumns: XY[];
  ottomanChandeliers: XY[];
  chamberGrilles: OrientedProp[];
  salamRails: OrientedProp[];
  minbar: OrientedProp | null;
  mihrab: OrientedProp | null;
  womenPartitions: OrientedProp[];
}

export function interiorPropPlacements(columns: readonly XY[], step = INTERIOR_COL_STEP_M, floor?: InteriorFloor): InteriorPropPlacements {
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const stands = new Set(columns.map(([x, z]) => key(x, z)));
  const has = (x: number, z: number) => stands.has(key(x, z));
  const saudiCols: XY[] = [];
  const ottomanCols: XY[] = [];
  for (const c of columns) {
    if (floor && inOldMosque(floor, c)) ottomanCols.push(c);
    else saudiCols.push(c);
  }
  const extraRawdah = floor ? rawdahExtraColumns(floor, columns) : [];
  ottomanCols.push(...extraRawdah);

  const out: InteriorPropPlacements = {
    columns: saudiCols,
    archesEastWest: [],
    archesNorthSouth: [],
    chandeliers: [],
    ottomanColumns: ottomanCols,
    ottomanChandeliers: [],
    chamberGrilles: floor ? chamberExteriorGrilles(floor) : [],
    salamRails: floor ? salamPassageRails(floor) : [],
    minbar: floor?.landmarks.minbar ? { x: floor.landmarks.minbar[0], z: floor.landmarks.minbar[1], angle: 0, scaleX: 1 } : null,
    mihrab: floor?.landmarks.mihrab ? { x: floor.landmarks.mihrab[0], z: floor.landmarks.mihrab[1], angle: 0, scaleX: 1 } : null,
    womenPartitions: floor ? womenWoodPartitions(floor) : [],
  };
  for (const [x, z] of columns) {
    if (has(x + step, z)) out.archesEastWest.push([x + step / 2, z]);
    if (has(x, z + step)) out.archesNorthSouth.push([x, z + step / 2]);
    if (has(x + step, z) && has(x, z + step) && has(x + step, z + step)) {
      const mid: XY = [x + step / 2, z + step / 2];
      if (floor && inOldMosque(floor, mid)) out.ottomanChandeliers.push(mid);
      else out.chandeliers.push(mid);
    }
  }
  // Hanging Ottoman chandeliers in the Noble Rawdah & along the Greeting Passage (photos 01/03/13)
  if (floor) {
    const rawdah = floor.carpets.find((c) => c.navq === RAWDAH_NAVQ);
    if (rawdah) {
      const xs = rawdah.ring.map((p) => p[0]);
      const zs = rawdah.ring.map((p) => p[1]);
      for (let x = Math.min(...xs) + 5.5; x <= Math.max(...xs) - 3.5; x += 7.5) {
        for (let z = Math.min(...zs) + 5.5; z <= Math.max(...zs) - 4.0; z += 7.5) {
          if (inside([x, z], rawdah.ring) && !inChamber(floor, [x, z])) out.ottomanChandeliers.push([x, z]);
        }
      }
    }
    if (floor.chamber) {
      const zSalam = Math.max(...floor.chamber.map((p) => p[1])) + 2.3;
      for (let x = -56; x <= -24; x += 6.5) out.ottomanChandeliers.push([x, zSalam]);
    }
  }
  return out;
}
