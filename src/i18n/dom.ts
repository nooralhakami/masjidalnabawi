import type { LangCode } from '../data/types';
import { SITE } from '../config/site.config';
import { dirOf, getLang, isLang, setLang } from './index';

const KEY = 'lang';

/** Saved language, else ?lang=, else the configured default. */
export function initialLang(): LangCode {
  const q = new URLSearchParams(location.search).get('lang');
  if (isLang(q)) return q;
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return SITE.DEFAULT_LANG;
}

/** Switch language: updates <html lang/dir>, remembers the choice and notifies listeners. */
export function applyLang(l: LangCode): void {
  setLang(l);
  document.documentElement.lang = l;
  document.documentElement.dir = dirOf(l);
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage unavailable */
  }
  document.dispatchEvent(new CustomEvent<LangCode>('langchange', { detail: getLang() }));
}
