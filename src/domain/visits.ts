import { POI_BY_ID, VISITS } from '../data';
import type { Poi } from '../data/types';

/** The must-visit sites, most important first. */
export const VISIT_SITES: readonly Poi[] = VISITS.order.flatMap((id) => POI_BY_ID.get(id) ?? []);

/** Ids of the featured sites: their marker stays big and glowing at every zoom. */
export const FEATURED_IDS: ReadonlySet<number> = new Set(VISIT_SITES.map((p) => p.id));

/** 1 = most important; undefined if the place is not a featured site. */
export const visitRank = (id: number): number | undefined => {
  const i = VISITS.order.indexOf(id);
  return i < 0 ? undefined : i + 1;
};
