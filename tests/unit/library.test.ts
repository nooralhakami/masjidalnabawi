import { describe, expect, it } from 'vitest';
import hadith from '../../data/library/hadith.json';
import { approvalProblems, published, textFor, type LibraryItem } from '../../src/domain/library';

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
