import { POI_BY_ID, VISITS } from '../data';
import type { LangCode, Poi, VisitSite, VisitText } from '../data/types';

/** A must-visit site with its place resolved. */
export interface Visit extends VisitSite {
  poi: Poi;
}

/** The must-visit sites, most important first. */
export const VISIT_LIST: readonly Visit[] = VISITS.sites.flatMap((s) => {
  const poi = POI_BY_ID.get(s.id);
  return poi ? [{ ...s, poi }] : [];
});

export const VISIT_SITES: readonly Poi[] = VISIT_LIST.map((v) => v.poi);

/** Ids of the featured sites: their marker stays big and glowing at every zoom. */
export const FEATURED_IDS: ReadonlySet<number> = new Set(VISIT_SITES.map((p) => p.id));

/** 1 = most important; undefined if the place is not a featured site. */
export const visitRank = (id: number): number | undefined => {
  const i = VISIT_LIST.findIndex((v) => v.poi.id === id);
  return i < 0 ? undefined : i + 1;
};

/** How long each slide stays on screen. */
export const SLIDE_MS = 6000;

/** Position in the stories: which site, which slide. The last slide of every site is the prayer-on-the-Prophet slide. */
export interface Pos {
  site: number;
  slide: number;
}

/** Text slides plus the closing prayer slide. */
export const slideCount = (v: Visit): number => v.slides.length + 1;
export const isPrayerSlide = (v: Visit, slide: number): boolean => slide === v.slides.length;

/** Next position, moving on to the next site after the last slide; null at the very end. */
export function nextPos(list: readonly Visit[], p: Pos): Pos | null {
  if (p.slide + 1 < slideCount(list[p.site])) return { site: p.site, slide: p.slide + 1 };
  return p.site + 1 < list.length ? { site: p.site + 1, slide: 0 } : null;
}

/** Previous position, back to the last slide of the previous site; null at the very start. */
export function prevPos(_list: readonly Visit[], p: Pos): Pos | null {
  if (p.slide > 0) return { site: p.site, slide: p.slide - 1 };
  return p.site > 0 ? { site: p.site - 1, slide: 0 } : null;
}

/** Fill of site `i`'s segment in the top bar: 0..1, given the current position and time on the slide (0..1). */
export function segmentFill(list: readonly Visit[], p: Pos, i: number, slideProgress: number): number {
  if (i < p.site) return 1;
  if (i > p.site) return 0;
  return Math.min(1, (p.slide + Math.min(1, Math.max(0, slideProgress))) / slideCount(list[i]));
}

/** Slide text in a language; languages not translated yet show English, and Arabic stays Arabic. */
export const slideText = (s: VisitText, lang: LangCode): string => s[lang] ?? (lang === 'ar' ? s.ar : s.en);
/** Language the shown text is actually in (for the `lang` attribute). */
export const slideLang = (s: VisitText, lang: LangCode): LangCode => (s[lang] ? lang : lang === 'ar' ? 'ar' : 'en');

/** The photo for a text slide (photos are spread over the slides), if the site has any. */
export const imageFor = (v: Visit, slide: number) => (v.images.length ? v.images[slide % v.images.length] : undefined);
