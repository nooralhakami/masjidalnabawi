/**
 * Provenance governance (comprehensive plan §9, owner 2026-11-12): every dataset carries one of
 * three tags —
 * - `verified`: documented — the Authority, the owner, or OSM with attribution;
 * - `candidate`: proposed, not approved (e.g. Microsoft building footprints) — hidden from
 *   routing and from the default view until the owner approves it;
 * - `simulation`: representative only (crowds, canopy states, day/night) — never live occupancy.
 *
 * **Routing reads verified data only.** Every routing input passes `verified()` / `assertRoutable()`
 * below, and `tests/unit/provenance.test.ts` fails if a routing module ever imports a dataset that
 * is not tagged verified. New data enters the registry first, with its source.
 */

export type Provenance = 'verified' | 'candidate' | 'simulation';

/** Every dataset the app ships, and its tag. All are verified today [2026-11-12]. */
export const DATA_PROVENANCE: Readonly<Record<string, Provenance>> = {
  // data/ — the live app's data, calibrated by the owner, and what was built from documented sources.
  'pois.json': 'verified', // the live app's places, owner-calibrated
  'routing.json': 'verified', // the live app's network + the owner's walkways
  'rules.json': 'verified', // the live app's rules
  'overrides.json': 'verified', // the owner's nudges
  'streets.json': 'verified', // OpenStreetMap, scripts/streets-from-osm.py (attribution on the map)
  'garage.json': 'verified', // the owner's car-park drawings (docs/routes/GARAGE.md)
  'haram-fence.json': 'verified', // the Authority's fence line, via the owner (2026-11-08)
  'i18n.json': 'verified', // the live app's place texts
  'visits.json': 'verified', // the owner's stories
  library: 'verified', // the owner's library texts
  // data-next/ — navQ under the owner's permission (D8 pending deposit) and the owner's own marks.
  'alharamain-3d': 'verified', // navQ's venues and models + the owner's photographs
  'alharamain-prayers': 'verified', // navQ's prayer areas + the owner's additions and clearings
  'car-entrances': 'verified', // the owner's car-entrance marks
  'vertical-nodes': 'verified', // navQ's vertical_nodes.geojson
  floors: 'verified', // navQ's GetVenueFloors (the five floors, Phase 1)
  'vertical-edges': 'verified', // floor-to-floor links derived from vertical-nodes by mutual nearest (Phase 1)
  'women-areas': 'verified', // the women's areas and their barriers (owner, 2026-11-07)
};

/** Routing may read verified data only (plan §9). */
export const routable = (p: Provenance): boolean => p === 'verified';

/** Throws unless the tag is verified — the guard every routing input passes. */
export function checkRoutable(name: string, tag: Provenance | undefined): void {
  if (tag !== 'verified') throw new Error(`Routing may not read ${name}: provenance is ${tag ?? 'unregistered'}, not verified`);
}

export const assertRoutable = (name: string): void => checkRoutable(name, DATA_PROVENANCE[name]);

/** A routing input: asserted verified, then returned unchanged. */
export function verified<T>(name: string, data: T): T {
  assertRoutable(name);
  return data;
}
