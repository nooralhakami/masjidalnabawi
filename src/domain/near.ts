import { POIS } from '../data';
import type { LatLng, Poi, SubCategory } from '../data/types';
import { haversine, ll } from './geo';

/**
 * «Near you now» (UI plan phase 2, owner 2026-11-07): the nearest restroom and the nearest gate,
 * open ones only, two of them so not every visitor is sent to the same block. Pure: the app plans
 * the walks and hands back their lengths.
 */
export type NearKind = 'toilet' | 'gate';
/** Whose restrooms: asked once on this device (a man must not be sent to a women's block). */
export type NearWho = 'men' | 'women';

/** GPS worse than this (metres) is not trusted: the visitor says where they are (owner, 2026-11-07). */
export const WEAK_FIX_M = 50;

const SERVES: Record<NearWho, SubCategory[]> = {
  men: ['toilet_men', 'toilet_mixed'],
  women: ['toilet_women', 'toilet_mixed'],
};
/** With the step-free route on, the seniors' and accessible blocks count too. */
const ACCESSIBLE: SubCategory[] = ['toilet_elderly', 'toilet_accessible'];

/** Which places answer «nearest …»: open restrooms for `who`, or open outer gates of the Haram (the numbered «بوابة»). */
export function nearPool(kind: NearKind, who: NearWho, isOpen: (id: number) => boolean, accessible = false, pois: readonly Poi[] = POIS): Poi[] {
  if (kind === 'gate') return pois.filter((p) => p.subCategory === 'gate_outer' && isOpen(p.id));
  const ok = new Set<SubCategory>([...SERVES[who], ...(accessible ? ACCESSIBLE : [])]);
  return pois.filter((p) => p.category === 'toilets' && ok.has(p.subCategory) && isOpen(p.id));
}

/** The `n` nearest of `pool` in a straight line, nearest first: the ones worth planning a walk to. */
export function nearestByAir(from: LatLng, pool: readonly Poi[], n = 6): Poi[] {
  return pool
    .map((p) => ({ p, m: haversine(from, ll(p)) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((x) => x.p);
}

/** Two choices this close in walking are a tie: either may be offered first (metres, or share of the nearer walk). */
export const TIE_M = 40;
export const TIE_SHARE = 0.15;

/**
 * The two to offer, from walks ranked shortest first: the nearest, and the next one that is not
 * its pair across the walkway (a pair leads to the same restrooms underground, so it would not
 * spread anyone). When the second is about as near, `rnd` (0–1) decides which is offered first,
 * so a crowd asking at once is split between the two.
 */
export function pickTwo<T extends { poi: Poi; meters: number }>(ranked: readonly T[], rnd: number): T[] {
  const [first, ...rest] = ranked;
  if (!first) return [];
  const second = rest.find((r) => r.poi.id !== first.poi.pairWith && r.poi.pairWith !== first.poi.id);
  if (!second) return [first];
  const tie = second.meters - first.meters <= Math.max(TIE_M, first.meters * TIE_SHARE);
  return tie && rnd < 0.5 ? [second, first] : [first, second];
}

/** The places a visitor can name as «I am here» by the number in front of them: outer gates, mosque doors, restroom blocks. */
export function placeByNumber(n: number, pois: readonly Poi[] = POIS): Poi | undefined {
  return pois.find((p) => p.id === n && (p.subCategory === 'gate_outer' || p.subCategory === 'gate_inner' || p.category === 'toilets'));
}
