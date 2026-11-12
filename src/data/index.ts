import poisJson from '../../data/pois.json';
import routingJson from '../../data/routing.json';
import rulesJson from '../../data/rules.json';
import i18nJson from '../../data/i18n.json';
import overridesJson from '../../data/overrides.json';
import visitsJson from '../../data/visits.json';
import type { I18n, Overrides, Poi, Routing, Rules, VisitSite } from './types';
import { applyOverrides } from './overrides';
import { verified } from './provenance';

export * from './types';

/** Coordinates from pois.json are final and calibrated; only overrides.json may nudge them. */
export const POIS: readonly Poi[] = applyOverrides(verified('pois.json', poisJson as Poi[]), verified('overrides.json', overridesJson as Overrides));

export const POI_BY_ID: ReadonlyMap<number, Poi> = new Map(POIS.map((p) => [p.id, p]));

export const ROUTING = verified('routing.json', routingJson as unknown as Routing);
export const RULES = verified('rules.json', rulesJson as unknown as Rules);
export const I18N = i18nJson as I18n;

/** Must-visit sites in order of importance (ids of data/pois.json). */
export const VISITS = visitsJson as { sites: VisitSite[] };

export function poi(id: number): Poi | undefined {
  return POI_BY_ID.get(id);
}
