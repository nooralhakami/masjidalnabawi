import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS, pack } from '../../src/i18n';
import { NEXT_UI } from '../../src/i18n-next/strings';

// Every text the new components show comes from i18n, in all 26 languages (CLAUDE.md): each
// t('key') literal in src/ui must exist in every language pack, and no component carries Arabic
// letters of its own (data and i18n hold the texts).

const ROOT = join(__dirname, '../../src/ui');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
const SOURCES = files(ROOT).map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const);
// Every quoted key inside a t( … ) call, the ternaries included: t(dark ? 'theme_day' : 'theme_night').
const KEYS = [
  ...new Set(
    SOURCES.flatMap(([, s]) =>
      [...s.matchAll(/\bt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].flatMap((m) => [...m[1].replace(/[!=]==\s*'[^']*'/g, '').matchAll(/'([a-z][a-z0-9_]*)'/g)].map((k) => k[1])),
    ),
  ),
];
// Keys built from a variable part, as the live app does (g_step_n, ro_women, p_gates …).
const DYNAMIC = [
  'g_step_n',
  'g_step_e',
  'g_step_s',
  'g_step_w',
  'g_step_up',
  'g_step_down',
  'g_step_lot_in',
  'g_step_lot_out',
  'p_gates',
  'p_toilets',
  'p_parking',
  'p_landmarks',
  'p_wheelchair',
  'p_emergency',
  'p_women',
  'p_hotels',
  'p_food',
  'p_shopping',
  'p_historic',
];

describe('ui strings', () => {
  it('finds the keys the components use', () => expect(KEYS.length).toBeGreaterThan(40));
  for (const key of [...KEYS, ...DYNAMIC]) {
    it(`«${key}» exists in all 26 languages`, () => {
      const missing = LANGS.filter((l) => !pack(l).ui[key] && !NEXT_UI[l]?.[key]);
      expect(missing).toEqual([]);
    });
  }
  it('the texts «next» adds are in all 26 languages, and never shadow one of the live app’s', () => {
    const keys = Object.keys(NEXT_UI.en);
    for (const l of LANGS) {
      expect(Object.keys(NEXT_UI[l]).sort(), l).toEqual([...keys].sort());
      for (const k of keys) expect(NEXT_UI[l][k].trim().length, `${l}.${k}`).toBeGreaterThan(0);
      for (const k of keys) expect(pack(l).ui[k], `${l}.${k} already exists in src/i18n`).toBeUndefined();
    }
  });
  it('no component carries Arabic text of its own', () => {
    const offenders = SOURCES.filter(([, s]) => /[؀-ۿ]/.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').replace(/`باب رقم \$\{p\.id\}`/g, ''))).map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});
