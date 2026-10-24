import { HIDDEN_SUBCATEGORIES } from '../data/hidden';
import type { Category, Poi } from '../data/types';
import type { Facilities } from './facilities';
import { isClosed } from './facilities';
import { parkingAccess } from './parking';

export type FilterId = 'all' | 'gates' | 'women' | 'toilets' | 'hotels' | 'food' | 'shopping' | 'landmarks' | 'historic' | 'parking' | 'emergency';
export type ToiletSub = 'all' | 'open' | 'closed';
export type ParkingSub = 'all' | 'public' | 'subscribers';

/** Filter pills in display order, with their i18n.json label keys. */
export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: 'all', label: 'p_all' },
  { id: 'gates', label: 'p_gates' },
  { id: 'women', label: 'p_women' },
  { id: 'toilets', label: 'p_toilets' },
  { id: 'hotels', label: 'p_hotels' },
  { id: 'food', label: 'p_food' },
  { id: 'shopping', label: 'p_shopping' },
  { id: 'landmarks', label: 'p_landmarks' },
  { id: 'historic', label: 'p_historic' },
  { id: 'parking', label: 'p_parking' },
  { id: 'emergency', label: 'p_emergency' },
];

export const PARKING_SUBS: readonly { id: ParkingSub; label: string }[] = [
  { id: 'all', label: 'park_f_all' },
  { id: 'public', label: 'park_f_public' },
  { id: 'subscribers', label: 'park_f_sub' },
];

export const TOILET_SUBS: readonly { id: ToiletSub; label: string }[] = [
  { id: 'all', label: 's_all' },
  { id: 'open', label: 's_open' },
  { id: 'closed', label: 's_closed' },
];

export interface FilterState {
  filter: FilterId;
  toiletSub: ToiletSub;
  parkingSub?: ParkingSub;
  /** A non-empty search query makes parking visible under any filter. */
  searching: boolean;
}

export { HIDDEN_SUBCATEGORIES };

export const isHidden = (p: Poi): boolean => HIDDEN_SUBCATEGORIES.has(p.subCategory);

const SAME_CATEGORY: readonly Category[] = ['hotels', 'food', 'shopping', 'landmarks', 'emergency', 'gates'];

/** Whether a POI passes the active filter pill (search matching is separate). */
export function passesFilter(p: Poi, s: FilterState, fac: Facilities): boolean {
  if (isHidden(p)) return false;
  const f = s.filter;
  // Parking only ever shows with its own pill or while searching.
  if (p.category === 'parking') return (f === 'parking' && ((s.parkingSub ?? 'all') === 'all' || parkingAccess(p) === (s.parkingSub ?? 'all'))) || s.searching;
  switch (f) {
    case 'all':
      return true;
    case 'parking':
      return false;
    case 'women':
      return (
        p.category === 'women' || p.subCategory === 'toilet_women' || p.subCategory === 'toilet_mixed' || (p.subCategory === 'gate_inner' && p.women === true && fac.isOpen(p.id))
      );
    case 'toilets': {
      if (p.category !== 'toilets') return false;
      if (s.toiletSub === 'open') return fac.isOpen(p.id);
      if (s.toiletSub === 'closed') return isClosed(fac.status(p.id));
      return true;
    }
    case 'historic':
      // Confirmed historic sites (docs/places/PLACES.md); they also show under landmarks.
      return p.subCategory === 'historic';
    case 'landmarks':
      return p.category === 'landmarks';
    default:
      return SAME_CATEGORY.includes(f as Category) && p.category === f;
  }
}
