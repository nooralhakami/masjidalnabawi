/**
 * Explicit data-source provenance ledger (A3).
 *
 * Every spatial, routing, or visual dataset used by the application declares its
 * verification tier:
 * - `verified`: field-checked, survey-backed, or owner-approved production data;
 *   eligible for routing and navigation graphs.
 * - `candidate`: unverified reference imagery or external guides kept for visual
 *   comparison only; forbidden in routing graphs.
 * - `simulation`: synthetic visual effects (crowd flow, sun/lamp shaders);
 *   strictly excluded from routing logic.
 */

export type ProvenanceTier = 'verified' | 'candidate' | 'simulation';

export type DataSourceId =
  | 'pois'
  | 'routing'
  | 'rules'
  | 'overrides'
  | 'visits'
  | 'streets'
  | 'garage'
  | 'alharamain-3d'
  | 'alharamain-prayers'
  | 'women-areas'
  | 'haram-fence'
  | 'vertical-nodes'
  | 'apple-maps-rug-ref'
  | 'pm-central-guide-2026'
  | 'crowd-sim'
  | 'scene-light';

export interface DataSourceRecord {
  id: DataSourceId;
  tier: ProvenanceTier;
  routingAllowed: boolean;
  path: string;
  description: string;
}

export const DATA_PROVENANCE: Readonly<Record<DataSourceId, DataSourceRecord>> = {
  pois: {
    id: 'pois',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/pois.json',
    description: 'Verified points of interest, gates, prayer areas, and landmarks.',
  },
  routing: {
    id: 'routing',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/routing.json',
    description: 'Verified plaza walkway ring, spurs, and Mosque wall barriers.',
  },
  rules: {
    id: 'rules',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/rules.json',
    description: 'Verified gate schedules and operational routing rules.',
  },
  overrides: {
    id: 'overrides',
    tier: 'verified',
    routingAllowed: true,
    path: 'src/data/overrides.ts',
    description: 'Owner-curated coordinate and barrier overrides over base JSON.',
  },
  visits: {
    id: 'visits',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/visits.json',
    description: 'Curated guided visit sequences with verified POI references.',
  },
  streets: {
    id: 'streets',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/streets.json',
    description: 'Verified OSM street network around Al-Haram for walk/drive routing.',
  },
  garage: {
    id: 'garage',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/garage.json',
    description: 'Verified underground parking lanes, ramps, and plaza staircases.',
  },
  'alharamain-3d': {
    id: 'alharamain-3d',
    tier: 'verified',
    routingAllowed: true,
    path: 'src/data-next/alharamain-3d.ts',
    description: 'Verified glTF scene anchors, canopy rotation, and restroom block geometry.',
  },
  'alharamain-prayers': {
    id: 'alharamain-prayers',
    tier: 'verified',
    routingAllowed: true,
    path: 'src/data-next/alharamain-prayers.ts',
    description: 'Verified plaza prayer area polygons and cleared corridors.',
  },
  'women-areas': {
    id: 'women-areas',
    tier: 'verified',
    routingAllowed: true,
    path: 'src/data-next/women-areas.ts',
    description: 'Verified women courtyard prayer enclosure outlines.',
  },
  'haram-fence': {
    id: 'haram-fence',
    tier: 'verified',
    routingAllowed: true,
    path: 'data/haram-fence.json',
    description: 'Verified Haram outer boundary perimeter segments and gates.',
  },
  'vertical-nodes': {
    id: 'vertical-nodes',
    tier: 'verified',
    routingAllowed: true,
    path: 'src/data-next/vertical-nodes.ts',
    description: 'Verified elevators, escalators, and accessible ramps.',
  },
  'apple-maps-rug-ref': {
    id: 'apple-maps-rug-ref',
    tier: 'candidate',
    routingAllowed: false,
    path: 'docs/references/apple-maps-overview.jpg',
    description: 'Candidate visual reference imagery from Apple Maps; display study only.',
  },
  'pm-central-guide-2026': {
    id: 'pm-central-guide-2026',
    tier: 'candidate',
    routingAllowed: false,
    path: 'docs/references/pm-central-guide-ar-2026.pdf',
    description: 'Candidate external visitor guide PDF; unverified for routing.',
  },
  'crowd-sim': {
    id: 'crowd-sim',
    tier: 'simulation',
    routingAllowed: false,
    path: 'src/map/crowd-sim.ts',
    description: 'Synthetic crowd particles rendered purely for ambient map visualization.',
  },
  'scene-light': {
    id: 'scene-light',
    tier: 'simulation',
    routingAllowed: false,
    path: 'src/map/scene-light.ts',
    description: 'Time-of-day shader lighting and shadow simulation.',
  },
};

/**
 * Runtime guard ensuring routing graphs never consume candidate or simulation data sources.
 */
export function assertRoutingSourceVerified(id: DataSourceId | string): DataSourceRecord {
  const record = DATA_PROVENANCE[id as DataSourceId];
  if (!record) {
    throw new Error(`Routing guard rejected unknown data source "${id}"`);
  }
  if (record.tier !== 'verified' || !record.routingAllowed) {
    throw new Error(`Routing guard rejected ${record.tier} data source "${record.id}" (${record.path})`);
  }
  return record;
}

/** Verify a list of data sources required to build a routing graph. */
export function assertRoutingSourcesVerified(ids: readonly (DataSourceId | string)[]): void {
  for (const id of ids) {
    assertRoutingSourceVerified(id);
  }
}
