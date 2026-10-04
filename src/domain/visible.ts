import { POIS } from '../data';
import type { Poi } from '../data/types';
import type { Facilities } from './facilities';
import { passesFilter, type FilterId, type ToiletSub } from './filters';
import { matchRank } from './search';

/** POIs shown on the map for the current filter + query; ranked when searching. */
export function visiblePois(filter: FilterId, toiletSub: ToiletSub, query: string, fac: Facilities, pois: readonly Poi[] = POIS): Poi[] {
  const q = query.trim();
  const state = { filter, toiletSub, searching: q.length > 0 };
  const passing = pois.filter((p) => passesFilter(p, state, fac));
  if (!q) return passing;
  return passing
    .map((p, i) => ({ p, i, r: matchRank(p, q) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.p);
}
