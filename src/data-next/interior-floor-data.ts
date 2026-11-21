/**
 * The Mosque's interior floor from navQ's plan (`data/navq-interior-floor.json`, 45 KB, written by
 * scripts/interior-floor-from-navq.py), fetched only when the 3D view asks for it: a chunk of its
 * own, never in the 2D map's first load.
 */

export interface InteriorCarpetData {
  navq: number;
  ring: [number, number][];
  names: string[];
  poi: number[];
}

export interface InteriorMarbleData {
  navq: number;
  ring: [number, number][];
  women?: boolean;
}

export interface InteriorLandmarksData {
  minbar?: [number, number];
  mihrab?: [number, number];
  salamFront?: [number, number];
}

export interface InteriorFloorData {
  source: Record<string, string>;
  marble: InteriorMarbleData[];
  men: InteriorCarpetData[];
  women: InteriorCarpetData[];
  courtyard: { navq: number; name: string; ring: [number, number][] }[];
  chamber?: { navq: number; name: string; ring: [number, number][] } | null;
  landmarks?: InteriorLandmarksData;
}

export function loadInteriorFloorData(): Promise<InteriorFloorData> {
  return import('../../data/navq-interior-floor.json').then((m) => m.default as unknown as InteriorFloorData);
}
