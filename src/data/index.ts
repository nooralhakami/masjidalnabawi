import poisJson from '../../data/pois.json';
import routingJson from '../../data/routing.json';
import rulesJson from '../../data/rules.json';
import i18nJson from '../../data/i18n.json';
import overridesJson from '../../data/overrides.json';
import type { I18n, Overrides, Poi, Routing, Rules } from './types';
import { applyOverrides } from './overrides';

export * from './types';

/** Coordinates from pois.json are final and calibrated; only overrides.json may nudge them. */
export const POIS: readonly Poi[] = applyOverrides(poisJson as Poi[], overridesJson as Overrides);

export const POI_BY_ID: ReadonlyMap<number, Poi> = new Map(POIS.map((p) => [p.id, p]));

export const ROUTING = routingJson as unknown as Routing;
export const RULES = rulesJson as unknown as Rules;
export const I18N = i18nJson as I18n;

export function poi(id: number): Poi | undefined {
  return POI_BY_ID.get(id);
}
