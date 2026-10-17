import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Direction, LangCode, Poi } from '../data/types';
import { dirName, dirOf, ds, nm, streetName, t } from '../i18n';
import { NEXT_UI } from '../i18n-next/strings';

/**
 * The language a part of the UI is drawn in. The app sets it from the visitor's choice; the /design
 * gallery sets a different one per column, so Arabic and English sit side by side.
 */
export const LangContext = createContext<LangCode>('ar');

export interface I18n {
  lang: LangCode;
  dir: 'rtl' | 'ltr';
  t(key: string, vars?: Record<string, string | number>): string;
  nm(p: Poi): string;
  ds(p: Poi): string;
  dirName(d: Direction): string;
  streetName(d: Direction): string;
}

export function i18nFor(lang: LangCode): I18n {
  return {
    lang,
    dir: dirOf(lang),
    // Texts added by «next» first, then the live app's (src/i18n, unchanged).
    t: (key, vars) => (NEXT_UI[lang][key] !== undefined ? fill(NEXT_UI[lang][key], vars) : t(key, vars, lang)),
    nm: (p) => nm(p, lang),
    ds: (p) => ds(p, lang),
    dirName: (d) => dirName(d, lang),
    streetName: (d) => streetName(d, lang),
  };
}

export const useI18n = (): I18n => i18nFor(useContext(LangContext));

function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
