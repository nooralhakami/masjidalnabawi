import poisJson from '../../data/pois.json';
import navqInteriorJson from '../../data/navq-interior.json';
import navqParkingSectionsJson from '../../data/navq-parking-sections.json';
import routingJson from '../../data/routing.json';
import rulesJson from '../../data/rules.json';
import i18nJson from '../../data/i18n.json';
import overridesJson from '../../data/overrides.json';
import visitsJson from '../../data/visits.json';
import type { I18n, Overrides, ParkingSection, Poi, Routing, Rules, VisitSite } from './types';
import { applyOverrides } from './overrides';

export * from './types';

/** Coordinates from pois.json are final and calibrated; only overrides.json may nudge them. */
export const POIS: readonly Poi[] = applyOverrides(poisJson as Poi[], overridesJson as Overrides);

export const POI_BY_ID: ReadonlyMap<number, Poi> = new Map(POIS.map((p) => [p.id, p]));

/** Verified interior GF/ROF prayer halls (98) and Mosque interior landmarks (14) from navQ. */
export const INTERIOR_POIS: readonly Poi[] = navqInteriorJson as unknown as Poi[];
export const INTERIOR_BY_ID: ReadonlyMap<number, Poi> = new Map(INTERIOR_POIS.map((p) => [p.id, p]));
export const ALL_POIS: readonly Poi[] = [...POIS, ...INTERIOR_POIS];
export const ALL_POI_BY_ID: ReadonlyMap<number, Poi> = new Map(ALL_POIS.map((p) => [p.id, p]));

/** Underground parking section polygons (1A–11A, 1B–13B) linked to parking lots 901–913. */
export const PARKING_SECTIONS: readonly ParkingSection[] = navqParkingSectionsJson as ParkingSection[];

export const ROUTING = routingJson as unknown as Routing;
export const RULES = rulesJson as unknown as Rules;
export const I18N = i18nJson as I18n;

/** Must-visit sites in order of importance (ids of data/pois.json). */
export const VISITS = visitsJson as { sites: VisitSite[] };

export function poi(id: number): Poi | undefined {
  return ALL_POI_BY_ID.get(id);
}
