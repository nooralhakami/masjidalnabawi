/**
 * Three more vehicle entrances to the car park under the Haram's courtyards (owner, 2026-10-16),
 * kept apart from the live app's data/ (which «next» does not change). Qurban is open today, the
 * other two closed (owner); the supervisor opens or closes each. They are not in the route planner
 * yet: their lanes inside the car park are not known, so no route goes through them, open or closed.
 *
 * Positions: from the owner's marked screenshots, matched to the map by seven outer gates (under a
 * metre off each). Quba is the opening beside Omar ibn al-Khattab's in the south-west tunnel (the
 * owner's photo). The eastern one is on the eastern road, at its end near the Haram: approximate,
 * as where it meets the car park roads is not known yet (closed for the eastern expansion works).
 */
export type CarEntranceId = 'quba' | 'qurban' | 'east';

export interface CarEntrance {
  id: CarEntranceId;
  lat: number;
  lng: number;
  /** Interface keys (src/i18n-next): the name, and a line for the visitor if any. */
  name: string;
  note?: string;
  /** Open when the page loads (until the supervisor changes it). */
  open: boolean;
}

export const CAR_ENTRANCES: readonly CarEntrance[] = [
  { id: 'quba', lat: 24.465375, lng: 39.607755, name: 'ent_quba', note: 'ent_quba_note', open: false },
  { id: 'qurban', lat: 24.464994, lng: 39.612841, name: 'ent_qurban', open: true },
  { id: 'east', lat: 24.468547, lng: 39.615174, name: 'ent_east', note: 'ent_east_note', open: false },
];
