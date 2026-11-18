import type { InteriorCarpetData, InteriorFloorData } from '../data-next/interior-floor-data';
import { toModelMetres, type XY } from './frames';
import { INTERIOR_COL_STEP_M, interiorColumnCentres } from './interior-layout';
import { COLUMN_CLEAR, fromLaid, inside, RUG_D, RUG_W, type Rug, toLaid, within } from './rug-layout';

/**
 * The Mosque's interior floor as navQ's ground-floor plan draws it (owner, 2026-11-18): "the prayer
 * areas with carpets, and the walkways with the tiles inside the Haram, as the plan extracted from
 * the Authority's site shows". `data/navq-interior-floor.json` (scripts/interior-floor-from-navq.py)
 * holds the shapes in `[lng, lat]`; here they become the models' metres, and the carpets are laid.
 */

export type { InteriorCarpetData, InteriorFloorData };

export interface InteriorCarpetArea {
  navq: number;
  /** Corners in the models' metres (x east, z south). */
  ring: XY[];
  women: boolean;
  /** The old Mosque and the Rawdah (navQ 513, 506): their own design comes in a later slice. */
  oldMosque: boolean;
  names: string[];
}

export interface InteriorFloor {
  /** The walking floor, polished marble (navQ FF0, outer rings: the carpets lie over it). */
  marble: XY[][];
  carpets: InteriorCarpetArea[];
  /** Open to the sky (the First Hasawa): no roof, no columns, canopies over its carpet. */
  courtyards: XY[][];
}

const OLD_MOSQUE_NAVQ = new Set([506, 513]);

const metres = (ring: readonly (readonly [number, number])[]): XY[] => ring.map((ll) => toModelMetres([ll[0], ll[1]]));

export function interiorFloorMetres(data: InteriorFloorData): InteriorFloor {
  const carpet = (c: InteriorCarpetData, women: boolean): InteriorCarpetArea => ({
    navq: c.navq,
    ring: metres(c.ring),
    women,
    oldMosque: OLD_MOSQUE_NAVQ.has(c.navq),
    names: c.names,
  });
  return {
    marble: data.marble.map((m) => metres(m.ring)),
    carpets: [...data.men.map((c) => carpet(c, false)), ...data.women.map((c) => carpet(c, true))],
    courtyards: data.courtyard.map((c) => metres(c.ring)),
  };
}

/** Is `[x, z]` (model metres) under the open sky of a courtyard? */
export function inCourtyard(floor: InteriorFloor, p: XY): boolean {
  return floor.courtyards.some((r) => inside(p, r));
}

/**
 * The columns that stand: the approved grid (`interiorColumnCentres`, owner 2026-11-18: kept for
 * now) inside the Mosque's floor, and none in an open courtyard (the Hasawa has its canopies).
 */
export function interiorColumns(floor: InteriorFloor): XY[] {
  const rings = [...floor.marble, ...floor.carpets.map((c) => c.ring)];
  return interiorColumnCentres()
    .map(([x, z]): XY => [x, z])
    .filter((c) => rings.some((r) => inside(c, r)) && !inCourtyard(floor, c));
}

/**
 * The carpets inside the Mosque: whole rugs (`RUG_W` across, `RUG_D` deep, the plazas' own) laid in
 * unbroken rows from each prayer area's northern edge toward the qibla, turned with the paving as the
 * plazas' are, every rug wholly inside its area and clear of the columns. As the photographs show,
 * the rows run wall to wall inside an area; the walkways between areas are the marble.
 */
export function interiorRugs(floor: InteriorFloor, columns: readonly XY[]): Rug[] {
  const rugs: Rug[] = [];
  const cols = columns.map(toLaid);
  let seed = 11;
  for (const area of floor.carpets) {
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
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const [x, z] = fromLaid([a + RUG_W / 2, v + RUG_D / 2]);
        rugs.push({ x, z, flip: seed % 2 === 0, courtyard: false });
      }
    }
  }
  return rugs;
}

/** Where the interior's props stand (model metres): the columns, an arch between each two columns
 * one grid step apart (east–west or north–south), and a chandelier in each bay with all four. */
export interface InteriorPropPlacements {
  columns: XY[];
  archesEastWest: XY[];
  archesNorthSouth: XY[];
  chandeliers: XY[];
}

export function interiorPropPlacements(columns: readonly XY[], step = INTERIOR_COL_STEP_M): InteriorPropPlacements {
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const stands = new Set(columns.map(([x, z]) => key(x, z)));
  const has = (x: number, z: number) => stands.has(key(x, z));
  const out: InteriorPropPlacements = { columns: [...columns], archesEastWest: [], archesNorthSouth: [], chandeliers: [] };
  for (const [x, z] of columns) {
    if (has(x + step, z)) out.archesEastWest.push([x + step / 2, z]);
    if (has(x, z + step)) out.archesNorthSouth.push([x, z + step / 2]);
    if (has(x + step, z) && has(x, z + step) && has(x + step, z + step)) out.chandeliers.push([x + step / 2, z + step / 2]);
  }
  return out;
}
