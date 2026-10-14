/**
 * The library's rules, pure (docs/PLAN-ISLAMIC-LIBRARY.md):
 *  - nothing is shown until a qualified reviewer approved it (`review: "approved"`);
 *  - a fact needs two sources;
 *  - a text appears in a language only if that language really has it (from HadeethEnc.com, or a
 *    reviewed translation) — otherwise the Arabic is shown with a notice, never a guessed translation.
 */

export type Review = 'draft' | 'approved';

export interface Source {
  /** Book, volume/page or hadith number, and a link to check it. */
  t: string;
  u?: string;
}

export interface LibraryItem {
  id: string;
  review: Review;
  /** Who approved it and when (required once approved). */
  reviewer?: { name: string; date: string };
  sources?: Source[];
}

/** What the visitor may be shown. */
export const published = <T extends LibraryItem>(items: readonly T[]): T[] => items.filter((i) => i.review === 'approved');

/** The text of an item in a language: its own when there is one, else the Arabic, said plainly. */
export function textFor<T>(texts: Partial<Record<string, T>>, lang: string): { lang: string; text: T; translated: boolean } | null {
  const own = texts[lang];
  if (own !== undefined) return { lang, text: own, translated: lang !== 'ar' };
  const ar = texts.ar;
  return ar === undefined ? null : { lang: 'ar', text: ar, translated: false };
}

/** Problems that keep an item from being approved (an empty list means it may be). */
export function approvalProblems(i: LibraryItem, minSources = 2): string[] {
  const out: string[] = [];
  if ((i.sources?.length ?? 0) < minSources) out.push(`needs ${minSources} sources`);
  if (i.review === 'approved' && !i.reviewer?.name) out.push('approved without a reviewer');
  return out;
}
