import navqRoutesRaw from '../../data/navq-interior-routes.json';
import { toWalkMetres, type XY } from './frames';

/**
 * Separated men's and women's interior Mosque walking networks built from navQ's approved floor
 * plan and harvested /path/trip edges (Phase 2, owner rules 2026-11-18):
 * - Men's network (`menEdges`) stays strictly outside women's floor/carpets, all FF5/FF6 carpets,
 *   the Sacred Chamber, and the closed Rawdah waiting hall.
 * - Women's network (`womenEdges`) stays strictly inside the NW and NE women's floor (FF0 parts
 *   34, 291, 425), clear of all FF6 carpets, connecting only via approved women's gates 11-17 & 23-31.
 * - Zero links between the two networks (`menWomenLinks === 0`).
 */

export interface NavqInteriorRoutesRaw {
  source: Record<string, string>;
  womenGateIds: number[];
  menWomenLinks: number;
  menEdges: [[number, number], [number, number]][];
  womenEdges: [[number, number], [number, number]][];
  menCarpets: [number, number][][];
  womenCarpets: [number, number][][];
  womenFloor: [number, number][][];
  chamber: [number, number][];
}

export interface InteriorRoutingData {
  womenGateIds: ReadonlySet<number>;
  menWomenLinks: number;
  /** Disjoint men's interior edges in walk metres `[east, north]`. */
  menEdges: [XY, XY][];
  /** Disjoint women's interior edges in walk metres `[east, north]`. */
  womenEdges: [XY, XY][];
  /** NavQ FF5 men's prayer carpet polygons in walk metres. */
  menCarpets: XY[][];
  /** NavQ FF6 women's prayer carpet polygons in walk metres. */
  womenCarpets: XY[][];
  /** NavQ FF0 women's walking floor polygons (parts 34, 291, 425) in walk metres. */
  womenFloor: XY[][];
  /** NavQ FF1 #13 Sacred Chamber exterior polygon in walk metres (never walkable). */
  chamber: XY[];
}

const RAW = navqRoutesRaw as unknown as NavqInteriorRoutesRaw;

/** Owner-approved women's Mosque gates inside the Haram (2026-11-18): 11–17 and 23–31. */
export const WOMEN_MOSQUE_GATE_IDS: ReadonlySet<number> = new Set(RAW.womenGateIds);

export const isWomenMosqueGate = (gateId: number): boolean => WOMEN_MOSQUE_GATE_IDS.has(gateId);

let cached: InteriorRoutingData | null = null;

/** Parsed navQ separated interior routing data in walk metres (`[east, north]`). */
export function interiorRoutingData(): InteriorRoutingData {
  if (cached) return cached;
  const toRing = (ring: readonly [number, number][]): XY[] => ring.map(([lng, lat]) => toWalkMetres([lat, lng]));
  const toEdge = ([a, b]: [[number, number], [number, number]]): [XY, XY] => [toWalkMetres([a[1], a[0]]), toWalkMetres([b[1], b[0]])];
  cached = {
    womenGateIds: WOMEN_MOSQUE_GATE_IDS,
    menWomenLinks: RAW.menWomenLinks,
    menEdges: RAW.menEdges.map(toEdge),
    womenEdges: RAW.womenEdges.map(toEdge),
    menCarpets: RAW.menCarpets.map(toRing),
    womenCarpets: RAW.womenCarpets.map(toRing),
    womenFloor: RAW.womenFloor.map(toRing),
    chamber: toRing(RAW.chamber),
  };
  return cached;
}
