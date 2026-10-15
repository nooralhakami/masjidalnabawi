import { POIS } from '../data';
import type { Poi } from '../data/types';
import type { Facilities } from './facilities';
import { passesFilter, type FilterId, type ParkingSub, type ToiletSub } from './filters';
import { matchRank } from './search';

/** Within the same kind of match, a place in the chosen filter lists before one outside it. */
const IN_FILTER_BONUS = 5;

/**
 * POIs shown on the map for the current filter + query; ranked when searching. A search looks at
 * every place, not only the chosen filter (owner, 2026-10-14: restroom 227 must be found with the
 * car park filter still on — not everyone knows to switch it); the filter's places come first
 * when they match as well, and a place's own number first of all.
 */
export function visiblePois(filter: FilterId, toiletSub: ToiletSub, query: string, fac: Facilities, pois: readonly Poi[] = POIS, parkingSub: ParkingSub = 'all'): Poi[] {
  const q = query.trim();
  const state = { filter, toiletSub, parkingSub, searching: q.length > 0 };
  if (!q) return pois.filter((p) => passesFilter(p, state, fac));
  const any = { filter: 'all' as FilterId, toiletSub: 'all' as ToiletSub, parkingSub: 'all' as ParkingSub, searching: true };
  return pois
    .filter((p) => passesFilter(p, any, fac))
    .map((p, i) => ({ p, i, r: matchRank(p, q) }))
    .filter((x) => x.r > 0)
    .map((x) => ({ ...x, r: x.r + (passesFilter(x.p, state, fac) ? IN_FILTER_BONUS : 0) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.p);
}
