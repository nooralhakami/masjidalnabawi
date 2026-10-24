// Imported directly (not via ../data) so pages that only need text don't bundle the POI list.
import i18nJson from '../../data/i18n.json';
import type { Direction, I18n, LangCode, LangPack, Poi } from '../data/types';

/**
 * Menu order (owner, 2026-10-10): Arabic, English, then by how widely known and spoken a language
 * is and how many Muslims speak it. The less widespread ones (MORE_LANGS) come last, folded under
 * an arrow in the language menu.
 */
export const LANGS: readonly LangCode[] = [
  'ar',
  'en',
  'ur',
  'id',
  'fr',
  'tr',
  'bn',
  'fa',
  'ru',
  'ms',
  'es',
  'hi',
  'zh',
  'de',
  'ha',
  'ps',
  'uz',
  'sw',
  'so',
  'az',
  'ku',
  'ml',
  'ta',
  'am',
  'th',
  'bs',
];
export const MORE_LANGS: ReadonlySet<LangCode> = new Set<LangCode>(['ha', 'ps', 'uz', 'sw', 'so', 'az', 'ku', 'ml', 'ta', 'am', 'th', 'bs']);

/**
 * The prayer on the Prophet ﷺ in the stories: Arabic in every language (the meaning is translated
 * beside it, key st_pray_meaning), word for word as in the live app's ui/stories.ts.
 */
export const SALAWAT_AR = 'اللهم صل وسلم على نبينا محمد';

const I18N = i18nJson as I18n;

/**
 * Every interface text, one file per language, one key per line (owner, 2026-10-24: the one place to
 * add or change a text; tests/unit/ui-strings.test.ts keeps all 26 complete). Place names and
 * descriptions stay in data/i18n.json, which the place scripts generate. The build ships Arabic and
 * English in full and the others as i18n/<code>.json (vite.config.ts, splitI18n; ./load.ts).
 */
const LOCALES = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' });
const uiOf = (l: LangCode): Record<string, string> => ({ ...LOCALES[`./locales/${l}.json`] });

const PACKS: Record<LangCode, LangPack> = Object.fromEntries(LANGS.map((l) => [l, { ...I18N[l], ui: uiOf(l) }])) as Record<LangCode, LangPack>;

let current: LangCode = 'ar';

export const getLang = (): LangCode => current;
export function setLang(l: LangCode): void {
  if (LANGS.includes(l)) current = l;
}
export const isLang = (v: unknown): v is LangCode => typeof v === 'string' && (LANGS as readonly string[]).includes(v);
export const pack = (l: LangCode = current): LangPack => PACKS[l];
export const dirOf = (l: LangCode = current): 'rtl' | 'ltr' => PACKS[l].dir;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu;

/** Remove emoji from data strings (the redesign uses SVG icons instead). */
export function stripEmoji(s: string): string {
  return s
    .replace(EMOJI, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** UI string in the current language, falling back to English then Arabic. Emoji-free. */
export function t(key: string, vars?: Record<string, string | number>, l: LangCode = current): string {
  const s = PACKS[l].ui[key] ?? PACKS.en.ui[key] ?? PACKS.ar.ui[key] ?? key;
  return stripEmoji(fill(s, vars));
}

/** Template key used for names/descriptions. */
function pkey(p: Poi): string {
  if (p.category === 'emergency') return 'emergency';
  return p.subCategory;
}

/** Number shown in a templated name: wheelchair 401→1, accessible 409→1, parking 901→1. */
export function displayNumber(p: Poi): number {
  if (p.category === 'parking') return p.id - 900;
  if (p.subCategory === 'wheelchair_zone') return p.id - 400;
  if (p.subCategory === 'toilet_accessible') return p.id - 408;
  return p.id;
}

/** POI name in a language (digits stay Latin). */
export function nm(p: Poi, l: LangCode = current): string {
  if (l === 'ar') return stripEmoji(p.name_ar);
  const L = PACKS[l];
  if (p.subCategory === 'gate_inner' && L.gi?.[p.id]) return L.gi[p.id];
  if (L.names?.[p.name_ar]) return L.names[p.name_ar];
  const tpl = L.nt?.[pkey(p)];
  return tpl ? tpl.replace('{id}', String(displayNumber(p))) : stripEmoji(p.name_ar);
}

/** English name — always searchable whatever the UI language. */
export const enName = (p: Poi): string => nm(p, 'en');

/** Facilities a parking lot sits between, read from its Arabic description ("بين مرفقي 201/202 ومرفقي 203/204"). */
export function parkingBetween(p: Poi): [string, string] | null {
  const m = p.description_ar.match(/(\d+\/\d+)\D+(\d+\/\d+)/);
  return m ? [m[1], m[2]] : null;
}

/** POI description in a language. */
export function ds(p: Poi, l: LangCode = current): string {
  if (l === 'ar') return stripEmoji(p.description_ar);
  const L = PACKS[l];
  const dt = L.dt ?? {};
  if (p.category === 'parking') {
    const b = parkingBetween(p);
    return b && dt.parking ? dt.parking.replace('{a}', b[0]).replace('{b}', b[1]) : stripEmoji(p.description_ar);
  }
  if (p.rawdah && dt.rawdah) return dt.rawdah;
  if (L.descs?.[p.name_ar]) return stripEmoji(L.descs[p.name_ar]);
  const k = pkey(p);
  const s = (dt[k] ?? '').replace('{d}', L.dirs[p.direction]);
  const full = k === 'gate_inner' && p.women && dt.women_gate ? `${s} ${dt.women_gate}` : s;
  return stripEmoji(full) || stripEmoji(p.description_ar);
}

export const dirName = (d: Direction, l: LangCode = current): string => PACKS[l].dirs[d];
export const streetName = (d: Direction, l: LangCode = current): string => PACKS[l].streets[d];

/** Arabic-Indic (٠–٩) and Persian/Urdu (۰–۹) digits → Latin. */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Whole metres/minutes, Latin digits in every language. */
export const num = (n: number): string => String(Math.round(n));
