import type { Poi } from '../data/types';
import { ds, enName, latinDigits, nm, t } from '../i18n';
import { parkingAccess } from './parking';

/** Lower-case with Latin digits, collapsed spaces. */
export function normalize(s: string): string {
  return latinDigits(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Match rank for a query, or 0 when it doesn't match. Higher ranks list first.
 * Searches: id, Arabic name, UI-language name, English name, descriptions, alias tags.
 */
export function matchRank(p: Poi, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const id = String(p.id);
  if (id === q) return 100;
  const tags = (p.alias ?? '').toLowerCase().split(' ').filter(Boolean);
  if (tags.some((w) => w === q)) return 90;
  const access = p.category === 'parking' ? parkingAccess(p) : '';
  const accessText = p.category === 'parking' ? `${t(access === 'subscribers' ? 'park_sub' : 'park_public')} subscribers public مشتركين للجميع بالساعة` : '';
  const names = normalize(`${p.name_ar} ${nm(p)} ${enName(p)} ${access} ${accessText}`);
  if (id.startsWith(q)) return 80;
  if (names.split(' ').some((w) => w.startsWith(q))) return 60;
  if (names.includes(q)) return 50;
  if (q.length > 3 && tags.some((w) => w.startsWith(q))) return 40;
  if (normalize(`${p.description_ar} ${ds(p)}`).includes(q)) return 20;
  return 0;
}

export const matchesQuery = (p: Poi, query: string): boolean => matchRank(p, query) > 0;

/** Ranked matches; stable on the original order within a rank. */
export function search(pois: readonly Poi[], query: string, limit = Infinity): Poi[] {
  return pois
    .map((p, i) => ({ p, i, r: matchRank(p, query) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}
