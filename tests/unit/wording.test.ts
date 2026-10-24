import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC N13 and CLAUDE.md: no «free», and never a promise to work without internet. The approved
// wording is «تبقى واجهتها متاحة حتى مع ضعف الاتصال». Every text a visitor can read is checked.

const ROOT = join(__dirname, '../..');
const sources = [
  ...readdirSync(join(ROOT, 'src/i18n'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(ROOT, 'src/i18n', f)),
  join(ROOT, 'src/i18n-next/strings.ts'),
  join(ROOT, 'data/i18n.json'),
  join(ROOT, 'index.html'),
  join(ROOT, 'map.html'),
  join(ROOT, 'src/landing/view.ts'),
  join(ROOT, 'vite.config.ts'),
];
/** Comments explain the rule itself; only the texts are checked. */
const text = (f: string) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('wording (SPEC N13)', () => {
  it('no «free» in any language the texts are written in', () => {
    const bad = sources.filter((f) => /مجان|\bfree of charge\b|\bfor free\b|\bfree app\b|\bgratis\b|\bgratuit|\bücretsiz\b|\bkostenlos\b|\bбесплатн/i.test(text(f)));
    expect(bad).toEqual([]);
  });

  it('no promise to work without internet', () => {
    const bad = sources.filter((f) => /بدون إنترنت|بلا إنترنت|دون إنترنت|without (an )?internet|works offline|fully offline|çevrimdışı çalışır/i.test(text(f)));
    expect(bad).toEqual([]);
  });

  it('the install section uses the approved wording', () => {
    expect(readFileSync(join(ROOT, 'src/i18n/landing-strings.ts'), 'utf8')).toContain('تبقى واجهتها متاحة حتى مع ضعف الاتصال');
  });
});
