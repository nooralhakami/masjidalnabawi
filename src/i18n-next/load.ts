import type { LangCode } from '../data/types';
import { pack } from '../i18n';

/**
 * Bring a language's texts in before the page uses them (ARCHITECTURE §7). The build ships Arabic
 * and English in full and the other 24 as i18n/<code>.json (vite.config.ts, splitI18n); this
 * merges the file into the pack src/i18n built at start, which pack() returns by reference, so
 * every t(), nm() and the search see it at once. Dev and the tests have every language already.
 * Without a connection and not cached, the texts fall back to English, as t() does for a missing key.
 */
const pending = new Map<LangCode, Promise<void>>();

export function loadLang(l: LangCode): Promise<void> {
  const p = pack(l);
  if (!p || Object.keys(p.ui).length) return Promise.resolve();
  let job = pending.get(l);
  if (!job) {
    job = fetch(new URL(`./i18n/${l}.json`, document.baseURI))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { pack: Record<string, unknown>; ui: Record<string, string> }) => {
        for (const [k, v] of Object.entries(j.pack)) if (k !== 'ui' && v !== undefined) (p as unknown as Record<string, unknown>)[k] = v;
        Object.assign(p.ui, j.ui);
      })
      .catch(() => {
        pending.delete(l);
      });
    pending.set(l, job);
  }
  return job;
}
