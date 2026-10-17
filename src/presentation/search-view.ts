import type { Category, Poi } from '../data/types';
import { latinDigits } from '../i18n';

/** Category name above a place's title and over a group of results: the filter pill labels (as the live app's sheet). */
export const CATEGORY_LABEL: Record<Category, string> = {
  gates: 'p_gates',
  toilets: 'p_toilets',
  parking: 'p_parking',
  landmarks: 'p_landmarks',
  wheelchair: 'p_wheelchair',
  emergency: 'p_emergency',
  women: 'p_women',
  hotels: 'p_hotels',
  food: 'p_food',
  shopping: 'p_shopping',
};

/** The label key of a place's kind (historic sites have their own, inside landmarks). */
export const kindLabel = (p: Poi): string => (p.subCategory === 'historic' ? 'p_historic' : CATEGORY_LABEL[p.category]);

/** Up to this many results show (as the live app), then «and N more». */
export const MAX_RESULTS = 8;

export interface ResultGroup {
  label: string;
  items: Poi[];
}

/**
 * Results in groups by kind, without losing the search's ranking: the best results are taken first
 * (in rank order), then gathered under their kind, the groups in the order their best result came.
 * So the first row is always the best match (215 for «215»), and Enter picks it.
 */
export function groupResults(ranked: readonly Poi[], max = MAX_RESULTS): ResultGroup[] {
  const groups = new Map<string, Poi[]>();
  for (const p of ranked.slice(0, max)) {
    const k = kindLabel(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

/** The results in the order they are shown (for the keyboard: ↑ ↓ move through these). */
export const shownOrder = (groups: readonly ResultGroup[]): Poi[] => groups.flatMap((g) => g.items);

/**
 * The part of a name the query matches, to highlight it: [before, match, after], or null when the
 * match is not a plain substring (the search also matches by number, alias and other languages).
 * Arabic-Indic digits in the query count as Latin ones (٢١٥ = 215), as in the search.
 */
export function highlight(text: string, query: string): [string, string, string] | null {
  const q = latinDigits(query).trim().toLowerCase();
  if (!q) return null;
  const i = text.toLowerCase().indexOf(q);
  return i < 0 ? null : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}
