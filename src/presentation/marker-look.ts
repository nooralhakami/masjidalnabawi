import type { Poi } from '../data/types';
import { lookOf, type Tier } from './markers';
import type { IconName } from './icons';

/**
 * A place's marker for the GPU map, as data (no DOM, no map library). It carries the same decisions
 * as the live app's markerSpec() (presentation/markers.ts, ported verbatim): which kind of marker,
 * its colour and its icon. tests/unit/marker-look.test.ts checks the two agree for every place.
 */
export type MarkerKind = 'facility' | 'gate-outer' | 'gate-inner' | 'parking' | 'featured';

export interface MarkerLook {
  id: number;
  kind: MarkerKind;
  icon: IconName;
  /** A colour token name without its dashes ('cat-men', 'dir-south'…), or 'mixed' (half men, half women). */
  color: string;
  /** Key of the facility's drawn marker: one image per icon and colour. */
  look: string;
  /** An inner gate with a name of its own (its label shows at zoom 19). */
  named: boolean;
  /** A subscribers-only car park (crimson, with a lock). */
  sub: boolean;
  /** Draw order, as the live app's zIndexOffset: featured 400 › facilities 300 › parking 200 › outer gates 100 › inner gates 50. */
  z: number;
}

const token = (cssVar: string): string => (cssVar === 'mixed' ? 'mixed' : cssVar.replace(/^var\(--(.+)\)$/, '$1'));

/** Whether an inner gate has a name of its own (the live app: name_ar is not «باب رقم N»). */
export const isNamedGate = (p: Poi): boolean => p.subCategory === 'gate_inner' && p.name_ar !== `باب رقم ${p.id}`;

export function markerLook(p: Poi, featured: boolean): MarkerLook {
  const look = lookOf(p);
  const base = { id: p.id, icon: look.icon, named: isNamedGate(p), sub: p.category === 'parking' && p.access === 'subscribers' };
  if (p.subCategory === 'gate_outer') return { ...base, kind: 'gate-outer', color: token(look.color), look: '', z: 100 };
  if (p.subCategory === 'gate_inner') return { ...base, kind: 'gate-inner', color: p.women ? 'cat-women' : token(look.color), look: '', z: 50 };
  if (p.category === 'parking') return { ...base, kind: 'parking', color: base.sub ? 'cat-park-sub' : 'cat-men', look: '', z: 200 };
  // A must-visit site: its own icon on the historic bronze, with a warm halo (the live app's .mk-star).
  if (featured) return { ...base, kind: 'featured', color: 'cat-hist', look: `feat.${look.icon}`, z: 400 };
  const color = token(look.color);
  return { ...base, kind: 'facility', color, look: `${look.icon}.${color}`, z: 300 };
}

/**
 * Marker sizes by zoom (the live app's tiers, in Leaflet zoom levels). Facility dots: 4 px at 14 and
 * below, 5 px at 15, 8 px at 16, 14 px with their icon at 17–18, 20 px at 19 (FACILITY_SIZE,
 * zoomClass). Gate dots 6 px (inner 8), 3 px at 15 and below.
 */
export const FACILITY_PX: readonly [legacyZoom: number, px: number][] = [
  [14, 4],
  [15, 5],
  [16, 8],
  [17, 14],
  [18, 14],
  [19, 20],
];
export const GATE_DOT_PX: readonly [number, number][] = [
  [15, 3],
  [16, 6],
];
export const INNER_DOT_PX: readonly [number, number][] = [
  [15, 3],
  [16, 8],
];
/** Facilities show their icon from 17 (FACILITY_SIZE ≥ 13 in the live app). */
export const ICON_FROM = 17;
/** Outer-gate number chips from 17 (tier m); inner-gate numbers and named-gate labels at 19 (tier l); pair numbers from 18. */
export const OUTER_CHIP_FROM = 17;
export const INNER_NUMBER_FROM = 19;
export const PAIR_NUMBER_FROM = 18;
export const GATE_NAME_FROM = 19;
/** Must-visit badges: 24 px at every zoom, 30 px at 19 (the live app's .mk-star-wrap / .mk-l). */
export const FEATURED_PX = 24;
export const FEATURED_PX_L = 30;
/** Car parks shrink to 70% at 15 and below (.z-mid/.z-far .mk-park-wrap). */
export const PARKING_SMALL_AT = 15;

/** The tier a size table belongs to, for the record (presentation/markers.ts tierOf). */
export type { Tier };
