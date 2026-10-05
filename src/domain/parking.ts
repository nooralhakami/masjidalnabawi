import { POIS, POI_BY_ID } from '../data';
import type { Poi } from '../data/types';
import { parkingBetween } from '../i18n';
import { pathLength, walkPath } from '../routing/walk';
import type { LatLng } from '../data/types';

export const PARKING: readonly Poi[] = POIS.filter((p) => p.category === 'parking');

/** Lot number 1–13 (POI ids 901–913). */
export const lotNumber = (p: Poi): number => p.id - 900;

/** "P5" chip label. */
export const lotLabel = (p: Poi): string => `P${lotNumber(p)}`;

/** Both levels of a lot: "5A", "5B". */
export const levels = (p: Poi): [string, string] => [`${lotNumber(p)}A`, `${lotNumber(p)}B`];

/** The two facility pairs the lot sits between, e.g. ["201/202", "203/204"]. */
export const between = (p: Poi): [string, string] | null => parkingBetween(p);

export const parkingAccess = (p: Poi): 'public' | 'subscribers' => p.access ?? 'public';

export function parkingEntrances(p: Poi): Poi[] {
  if (p.category !== 'parking') return [];
  const ids = (between(p) ?? []).flatMap((pair) => pair.split('/').map(Number));
  return ids.map((id) => POI_BY_ID.get(id)).filter((entry): entry is Poi => Boolean(entry));
}

export function nearestEntrance(from: LatLng, p: Poi): { entrance: Poi; path: LatLng[] } {
  const candidates = parkingEntrances(p).map((entrance) => {
    const path = walkPath(from, [entrance.lat, entrance.lng]);
    return { entrance, path, length: pathLength(path) };
  });
  if (!candidates.length) return { entrance: p, path: walkPath(from, [p.lat, p.lng]) };
  return candidates.reduce((best, candidate) => (candidate.length < best.length ? candidate : best));
}
