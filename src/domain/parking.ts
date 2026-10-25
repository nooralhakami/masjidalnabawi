import { POIS, POI_BY_ID } from '../data';
import type { Poi } from '../data/types';
import { parkingBetween } from '../i18n';

export const PARKING: readonly Poi[] = POIS.filter((p) => p.category === 'parking');

/** Lot number 1–13 (POI ids 901–913). */
export const lotNumber = (p: Poi): number => p.id - 900;

/** "P5" chip label. */
/** "P 5": the letter apart from the number (owner, 2026-10-13). */
export const lotLabel = (p: Poi): string => `P ${lotNumber(p)}`;

/** The levels a lot is on: B below and A above, unless its place says otherwise (owner, 2026-10-25: no 12A or 13A). */
export const lotLevels = (p: Poi): readonly ('A' | 'B')[] => p.levels ?? ['B', 'A'];

/** The levels of a lot as named on its signs: "5A", "5B"; "12B" alone. */
export const levels = (p: Poi): string[] => ['A' as const, 'B' as const].filter((l) => lotLevels(p).includes(l)).map((l) => `${lotNumber(p)}${l}`);

/** The two facility pairs the lot sits between, e.g. ["201/202", "203/204"]. */
export const between = (p: Poi): [string, string] | null => parkingBetween(p);

export const parkingAccess = (p: Poi): 'public' | 'subscribers' => p.access ?? 'public';

export function parkingEntrances(p: Poi): Poi[] {
  if (p.category !== 'parking') return [];
  const ids = (between(p) ?? []).flatMap((pair) => pair.split('/').map(Number));
  return ids.map((id) => POI_BY_ID.get(id)).filter((entry): entry is Poi => Boolean(entry));
}
