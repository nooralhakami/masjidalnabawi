import type { InteriorFloorData } from '../domain/interior-floor';

/**
 * The Mosque's interior floor from navQ's plan (`data/navq-interior-floor.json`, 45 KB), fetched
 * only when the 3D view asks for it: a chunk of its own, never in the 2D map's first load.
 */
export function loadInteriorFloorData(): Promise<InteriorFloorData> {
  return import('../../data/navq-interior-floor.json').then((m) => m.default as unknown as InteriorFloorData);
}
