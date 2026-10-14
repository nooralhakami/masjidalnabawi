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

/** A fact of a library card: Arabic text, its sources (key, volume/page) and what it still needs. */
export interface LibFact {
  title?: string;
  ar: string;
  src: (string[] | [string, string])[];
  needs?: string;
}

export interface MosquePlace {
  id: string;
  review: Review;
  name: string;
  kind?: string;
  where: LibFact;
  story?: LibFact[];
  related_companions?: string[];
  map_poi?: number;
}

export interface MosqueData {
  /** Owner decision 2026-10-14: show the drafts with a notice that no religious reviewer checked them yet. */
  display?: 'approved-only' | 'with-unreviewed-notice';
  sources: Record<string, { t: string; u?: string }>;
  places: MosquePlace[];
}

export interface ShownPlace {
  id: string;
  name: string;
  /** False while no qualified reviewer approved it: the visitor sees the notice. */
  reviewed: boolean;
  where: LibFact | null;
  story: LibFact[];
}

/**
 * The places the visitor may see and, in each, only the facts with two sources: a fact that still
 * says what it needs is never shown. Drafts appear only when the owner chose to show them with the
 * "not reviewed yet" notice.
 */
export function shownMosquePlaces(d: MosqueData): ShownPlace[] {
  const ok = (f: LibFact | undefined): f is LibFact => !!f && !f.needs && new Set(f.src.map((s) => s[0])).size >= 2;
  return d.places
    .filter((p) => p.review === 'approved' || d.display === 'with-unreviewed-notice')
    .map((p) => ({ id: p.id, name: p.name, reviewed: p.review === 'approved', where: ok(p.where) ? p.where : null, story: (p.story ?? []).filter(ok) }))
    .filter((p) => p.where || p.story.length);
}

/** "Book — vol/page" for each source of a fact, from the source list. */
export function sourceLines(f: LibFact, sources: MosqueData['sources']): { text: string; url?: string }[] {
  return f.src.map((s) => ({ text: `${sources[s[0]]?.t ?? s[0]} — ${s[1]}`, url: s[2] ?? sources[s[0]]?.u }));
}
