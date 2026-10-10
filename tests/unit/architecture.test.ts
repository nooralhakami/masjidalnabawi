import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The dependency rule from ARCHITECTURE.md, enforced: a change that breaks it fails the tests.
const ROOT = join(__dirname, '../../src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1]);
const moduleOf = (file: string) => file.slice(ROOT.length + 1).split('/')[0];
const target = (file: string, spec: string) => join(file, '..', spec).slice(ROOT.length + 1).split('/')[0];

const FORBIDDEN: Record<string, string[]> = {
  data: ['domain', 'routing', 'location', 'i18n', 'ui', 'map', 'navigation', 'landing'],
  domain: ['routing', 'location', 'ui', 'map', 'navigation', 'landing'],
  routing: ['location', 'ui', 'map', 'navigation', 'landing'],
  ui: ['map', 'navigation'],
};

describe('architecture: module boundaries (ARCHITECTURE.md §2)', () => {
  for (const [mod, banned] of Object.entries(FORBIDDEN)) {
    it(`${mod}/ does not import ${banned.join(', ')}`, () => {
      const offenders = files(ROOT)
        .filter((f) => moduleOf(f) === mod)
        .flatMap((f) => importsOf(f).filter((s) => banned.includes(target(f, s))).map((s) => `${f.slice(ROOT.length + 1)} → ${s}`));
      expect(offenders).toEqual([]);
    });
  }

  it('domain/ and routing/ stay free of the DOM and Leaflet', () => {
    const offenders = files(ROOT)
      .filter((f) => ['domain', 'routing'].includes(moduleOf(f)))
      .filter((f) => /from 'leaflet'|\bdocument\.|\bwindow\./.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});
