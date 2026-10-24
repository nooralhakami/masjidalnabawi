import { describe, expect, it } from 'vitest';
import { POI_BY_ID, VISITS } from '../../src/data';
import { LANGS } from '../../src/i18n';
import { FEATURED_IDS, SLIDE_MS, VISIT_LIST, imageFor, isPrayerSlide, nextPos, prevPos, segmentFill, slideCount, slideLang, slideText, visitRank } from '../../src/domain/visits';
import { markerSpec } from '../../src/presentation/markers';

describe('must-visit data', () => {
  it('every site is a historic place, listed once', () => {
    const ids = VISITS.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(POI_BY_ID.get(id)?.subCategory).toBe('historic');
    expect(VISIT_LIST).toHaveLength(ids.length);
  });

  it('every religious or historic text is backed by two sources (SPEC §7)', () => {
    for (const v of VISIT_LIST) {
      expect(v.sources.length, String(v.id)).toBeGreaterThanOrEqual(2);
      expect(new Set(v.sources.map((s) => s.u)).size).toBe(v.sources.length);
      for (const s of v.sources) {
        expect(s.u).toMatch(/^https:\/\//);
        expect(s.t.trim()).not.toBe('');
      }
      expect(v.slides.length).toBeGreaterThan(0);
      for (const sl of v.slides) {
        expect(sl.ar.trim().length, `${v.id} ar`).toBeGreaterThan(20);
        expect(sl.en.trim().length, `${v.id} en`).toBeGreaterThan(20);
        expect(sl.ar.length, 'slides stay short').toBeLessThan(260);
        expect(sl.en).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('every slide is translated into every language, and keeps the ﷺ sign where the Arabic has it', () => {
    for (const v of VISIT_LIST) {
      for (const sl of v.slides) {
        for (const l of LANGS) {
          const text = sl[l];
          expect(text?.trim().length ?? 0, `${v.id} ${l}`).toBeGreaterThan(15);
          expect(text!.length, `${v.id} ${l} stays short`).toBeLessThan(420);
          expect(text!.includes('ﷺ'), `${v.id} ${l} ﷺ`).toBe(sl.ar.includes('ﷺ'));
          expect(text, `${v.id} ${l} no emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
        }
        // A translation is not a copy of the English (unless a language writes the same).
        for (const l of LANGS.filter((x) => x !== 'ar' && x !== 'en')) expect(sl[l], `${v.id} ${l} differs from English`).not.toBe(sl.en);
      }
    }
  });

  it('every photo carries its credit and licence, and sits under public/visits/', () => {
    for (const v of VISIT_LIST) {
      for (const img of v.images) {
        expect(img.src).toMatch(/^visits\/[\w-]+\.webp$/);
        expect(img.by.trim()).not.toBe('');
        expect(img.license.trim()).not.toBe('');
        expect(img.alt.ar.trim()).not.toBe('');
        expect(img.alt.en.trim()).not.toBe('');
        if (img.focus) expect(img.focus).toMatch(/^\d{1,3}% \d{1,3}%$/);
      }
    }
  });

  it("is ranked: Quba first, then Al-Baqi'", () => {
    expect(visitRank(542)).toBe(1);
    expect(visitRank(531)).toBe(2);
    expect(visitRank(1)).toBeUndefined();
    expect(FEATURED_IDS.has(542)).toBe(true);
  });
});

describe('story flow', () => {
  const first = { site: 0, slide: 0 };

  it('walks every slide of a site, then the next site, then ends', () => {
    let p: ReturnType<typeof nextPos> = first;
    let steps = 0;
    let last = first;
    while (p) {
      last = p;
      p = nextPos(VISIT_LIST, p);
      steps++;
    }
    expect(steps).toBe(VISIT_LIST.reduce((n, v) => n + slideCount(v), 0));
    expect(last.site).toBe(VISIT_LIST.length - 1);
    expect(isPrayerSlide(VISIT_LIST[last.site], last.slide)).toBe(true);
  });

  it('every site closes with the prayer slide', () => {
    for (const v of VISIT_LIST) {
      expect(isPrayerSlide(v, v.slides.length)).toBe(true);
      expect(isPrayerSlide(v, 0)).toBe(false);
    }
  });

  it('goes back one slide, to the start of the previous site, and stops at the beginning', () => {
    expect(prevPos(VISIT_LIST, first)).toBeNull();
    expect(prevPos(VISIT_LIST, { site: 1, slide: 0 })).toEqual({ site: 0, slide: 0 });
    expect(prevPos(VISIT_LIST, { site: 0, slide: 2 })).toEqual({ site: 0, slide: 1 });
  });

  it('segments: done sites full, coming sites empty, the current one fills with time', () => {
    const p = { site: 2, slide: 1 };
    expect(segmentFill(VISIT_LIST, p, 0, 0.5)).toBe(1);
    expect(segmentFill(VISIT_LIST, p, 5, 0.5)).toBe(0);
    const n = slideCount(VISIT_LIST[2]);
    expect(segmentFill(VISIT_LIST, p, 2, 0)).toBeCloseTo(1 / n);
    expect(segmentFill(VISIT_LIST, p, 2, 1)).toBeCloseTo(2 / n);
    expect(segmentFill(VISIT_LIST, p, 2, 9)).toBeCloseTo(2 / n);
    expect(SLIDE_MS).toBeGreaterThanOrEqual(4000);
  });

  it('texts: own language when translated, otherwise English (Arabic stays Arabic)', () => {
    const s = { ar: 'نص', en: 'text', fr: 'texte' };
    expect(slideText(s, 'fr')).toBe('texte');
    expect(slideText(s, 'tr')).toBe('text');
    expect(slideText(s, 'ar')).toBe('نص');
    expect(slideLang(s, 'tr')).toBe('en');
    expect(slideLang(s, 'fr')).toBe('fr');
  });

  it('photos are spread over the text slides; none means none', () => {
    const v = { ...VISIT_LIST[0], images: [{ src: 'visits/a.webp' }, { src: 'visits/b.webp' }] as never };
    expect(imageFor(v, 0)?.src).toBe('visits/a.webp');
    expect(imageFor(v, 1)?.src).toBe('visits/b.webp');
    expect(imageFor(v, 2)?.src).toBe('visits/a.webp');
    expect(imageFor({ ...v, images: [] }, 0)).toBeUndefined();
  });
});

describe('featured markers', () => {
  it('a featured marker keeps a halo and the same markup at every zoom tier', () => {
    const p = POI_BY_ID.get(542)!;
    const html = (['s', 'm', 'l'] as const).map((t) => markerSpec(p, t, undefined, false, false, true).html);
    for (const h of html) expect(h).toContain('mk-halo');
    expect(new Set(html).size).toBe(1);
    expect(markerSpec(p, 's', undefined, false, false, true).className).toContain('mk-feat');
    expect(markerSpec(p, 's', undefined, false).html).not.toContain('mk-halo');
    // Selected: the normal dropped pin, no halo.
    expect(markerSpec(p, 's', undefined, true, false, true).html).not.toContain('mk-halo');
  });
});
