import { describe, expect, it } from 'vitest';
import hadith from '../../data/library/hadith.json';
import companions from '../../data/library/companions.json';
import mosque from '../../data/library/mosque.json';
import poisJson from '../../data/pois.json';
import { approvalProblems, published, shownCompanions, shownMosquePlaces, textFor, type CompanionData, type LibraryItem, type MosqueData } from '../../src/domain/library';

const LANGS = ['ar', 'en', 'tr', 'ur', 'id', 'uz', 'bn', 'fr', 'fa', 'ru', 'ms', 'ha', 'ml', 'sw', 'ps', 'so', 'ta', 'hi', 'bs', 'de', 'zh', 'am', 'ku', 'az', 'th', 'es'];

describe('the library (owner, 2026-10-14)', () => {
  const items = hadith.hadiths as unknown as (LibraryItem & { text: Record<string, { hadeeth: string; grade: string }>; available: string[]; grade: string; reference: string })[];

  it('nothing is shown before a reviewer approves it', () => {
    expect(items.length).toBeGreaterThan(0);
    expect(published(items)).toEqual([]);
  });

  it('a text is never marked approved without a named reviewer', () => {
    const faulty = { id: 'x', review: 'approved' as const };
    expect(approvalProblems(faulty)).toContain('approved without a reviewer');
  });

  it('every hadith has its Arabic text, its grade and its reference (the book and number)', () => {
    for (const h of items) {
      expect(h.text.ar?.hadeeth, h.id).toBeTruthy();
      expect(h.grade, h.id).toBeTruthy();
      expect(h.reference, h.id).toMatch(/صحيح|سنن|مسند|فتح/);
    }
  });

  it('only languages the encyclopedia really has are stored: no invented translation', () => {
    for (const h of items) {
      for (const lang of Object.keys(h.text)) expect(LANGS, `${h.id} ${lang}`).toContain(lang);
      for (const lang of Object.keys(h.text)) expect(h.available, `${h.id}: ${lang} is not listed by the source`).toContain(lang);
    }
  });

  it('a language without a text gets the Arabic, and says so', () => {
    const h = items.find((x) => Object.keys(x.text).length === 1)!; // only Arabic exists for it
    const r = textFor(h.text, 'fr')!;
    expect(r.lang).toBe('ar');
    expect(r.translated).toBe(false);
    const other = items.find((x) => x.text.en)!;
    expect(textFor(other.text, 'en')).toMatchObject({ lang: 'en', translated: true });
  });

  it('records the source, its terms and the version (fetch date) the encyclopedia requires', () => {
    expect(hadith.source.url).toContain('hadeethenc.com');
    expect(hadith.source.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('companion cards (drafts written from the cited pages)', () => {
  type Fact = { ar: string; src: [string, string, string?][]; needs?: string; place?: number };
  type Card = Record<string, unknown> & { id: string; review: string; places?: number[]; hadith_links?: string[] };
  const data = companions as unknown as { sources: Record<string, { t: string; u?: string }>; companions: Card[] };
  /** Every fact of a card: objects with an Arabic text and sources, at any depth. */
  const facts = (v: unknown): Fact[] =>
    Array.isArray(v) ? v.flatMap(facts) : v && typeof v === 'object' ? ('ar' in (v as object) && 'src' in (v as object) ? [v as Fact] : Object.values(v as object).flatMap(facts)) : [];

  it('every fact names its sources (book and volume/page or hadith number), from the declared list', () => {
    for (const c of data.companions) {
      const fs = facts(c);
      expect(fs.length, c.id).toBeGreaterThan(5);
      for (const f of fs) {
        expect(f.src.length, `${c.id}: ${f.ar.slice(0, 30)}`).toBeGreaterThan(0);
        for (const [key, where] of f.src) {
          expect(Object.keys(data.sources), c.id).toContain(key);
          expect(where, `${c.id}: ${key}`).toBeTruthy();
        }
      }
    }
  });

  it('a fact with fewer than two sources says what it still needs — and such a card cannot be approved', () => {
    for (const c of data.companions) {
      const weak = facts(c).filter((f) => new Set(f.src.map((s) => s[0])).size < 2);
      for (const f of weak) expect(f.needs, `${c.id}: «${f.ar.slice(0, 40)}» has one source and no note`).toBeTruthy();
      if (weak.length || facts(c).some((f) => f.needs)) expect(c.review, c.id).toBe('draft');
    }
  });

  it('linked map places and hadiths exist', () => {
    const ids = new Set(poisJson.map((p: { id: number }) => p.id));
    const hadithIds = new Set(hadith.hadiths.map((h) => h.id));
    for (const c of data.companions) {
      for (const p of [...(c.places ?? []), ...facts(c).flatMap((f) => (f.place ? [f.place] : []))]) expect(ids.has(p), `${c.id}: place ${p}`).toBe(true);
      for (const h of c.hadith_links ?? []) expect(hadithIds.has(h), `${c.id}: hadith ${h}`).toBe(true);
    }
  });

  it('keeps ﷺ and the honorific text intact', () => {
    const all = JSON.stringify(data);
    expect(all).toContain('ﷺ');
    expect(all).not.toMatch(/�/);
  });

  describe('mosque places (drafts written from the cited pages)', () => {
    type Fact = { ar: string; src: [string, string][]; needs?: string };
    type Place = { id: string; review: string; where: Fact; story?: Fact[]; related_companions?: string[]; map_poi?: number };
    const m = mosque as unknown as { sources: Record<string, { t: string }>; places: Place[] };
    const facts = (p: Place): Fact[] => [p.where, ...(p.story ?? [])];

    it('every fact names declared sources, and two of them unless it says what it needs', () => {
      for (const p of m.places) {
        for (const f of facts(p)) {
          for (const [key, where] of f.src) {
            expect(Object.keys(m.sources), p.id).toContain(key);
            expect(where, `${p.id}: ${key}`).toBeTruthy();
          }
          if (new Set(f.src.map((s) => s[0])).size < 2) expect(f.needs, `${p.id}: «${f.ar.slice(0, 40)}»`).toBeTruthy();
        }
        if (facts(p).some((f) => f.needs)) expect(p.review, p.id).toBe('draft');
      }
    });

    it('nothing is approved without a reviewer, and linked companions exist', () => {
      const ids = new Set(data.companions.map((c) => c.id));
      for (const p of m.places) {
        if (p.review === 'approved') expect(approvalProblems(p as unknown as LibraryItem), p.id).toEqual([]);
        for (const c of p.related_companions ?? []) expect(ids.has(c), `${p.id}: ${c}`).toBe(true);
        if (p.map_poi) expect(poisJson.some((x: { id: number }) => x.id === p.map_poi), `${p.id}: poi ${p.map_poi}`).toBe(true);
      }
      expect(published(m.places as unknown as LibraryItem[]).every((p) => p.reviewer)).toBe(true);
    });
  });
});

describe('what the visitor sees (owner decision 2026-10-15: drafts shown with a notice)', () => {
  it('a fact still waiting for a second source is never shown, in places or companions', () => {
    const shown = JSON.stringify([shownMosquePlaces(mosque as unknown as MosqueData), shownCompanions(companions as unknown as CompanionData)]);
    expect(shown).not.toContain('"needs"');
    const cs = shownCompanions(companions as unknown as CompanionData);
    expect(cs.length).toBe((companions as unknown as CompanionData).companions.length);
    for (const c of cs) for (const x of c.fields) for (const f of x.facts) expect(new Set(f.src.map((s) => s[0])).size, c.id).toBeGreaterThanOrEqual(2);
  });

  it('without the owner decision, drafts stay hidden', () => {
    const d = { ...(companions as unknown as CompanionData), display: 'approved-only' as const };
    expect(shownCompanions(d)).toEqual([]);
  });
});
