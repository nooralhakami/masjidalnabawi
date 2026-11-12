import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertRoutable, checkRoutable, DATA_PROVENANCE, routable, verified } from '../../src/data/provenance';

const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

describe('the provenance guard (plan §9)', () => {
  it('only verified data may be read by routing', () => {
    expect(routable('verified')).toBe(true);
    expect(routable('candidate')).toBe(false);
    expect(routable('simulation')).toBe(false);
    expect(() => checkRoutable('a footprint', 'candidate')).toThrow(/candidate/);
    expect(() => checkRoutable('a crowd', 'simulation')).toThrow(/simulation/);
    expect(() => checkRoutable('unknown', undefined)).toThrow(/unregistered/);
    expect(() => checkRoutable('pois.json', 'verified')).not.toThrow();
  });

  it('verified() returns the data unchanged once the tag passes', () => {
    const data = { a: 1 };
    expect(verified('pois.json', data)).toBe(data);
    expect(() => assertRoutable('pois.json')).not.toThrow();
  });

  it('every dataset on disk is registered', () => {
    const jsons = readdirSync(join(ROOT, 'data')).filter((f) => f.endsWith('.json'));
    for (const f of jsons) expect(DATA_PROVENANCE[f], f).toBeDefined();
    expect(DATA_PROVENANCE.library).toBeDefined();
    const next = readdirSync(join(SRC, 'data-next')).filter((f) => f.endsWith('.ts'));
    for (const f of next) expect(DATA_PROVENANCE[f.replace(/\.ts$/, '')], f).toBeDefined();
  });
});

describe('no candidate or simulation data leaks into routing (plan §9)', () => {
  const routingFiles = readdirSync(join(SRC, 'routing')).filter((f) => f.endsWith('.ts'));
  const sources = [...routingFiles.map((f) => join(SRC, 'routing', f)), join(SRC, 'data/index.ts')];

  it('every JSON a routing module imports is tagged verified', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      const specs = [...text.matchAll(/(?:from|import\()\s*'(\.\.\/[^']+\.json)'/g)].map((m) => m[1]);
      for (const spec of specs) {
        const name = spec.split('/').pop()!;
        expect(DATA_PROVENANCE[name], `${file} → ${name}`).toBe('verified');
      }
    }
  });

  it('every data-next module a routing module imports is tagged verified', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      const specs = [...text.matchAll(/from '\.\.\/data-next\/([^']+)'/g)].map((m) => m[1]);
      for (const name of specs) expect(DATA_PROVENANCE[name], `${file} → ${name}`).toBe('verified');
    }
  });

  it('the data barrel guards the four inputs routing reads through it', () => {
    const text = readFileSync(join(SRC, 'data/index.ts'), 'utf8');
    for (const name of ['pois.json', 'routing.json', 'rules.json', 'overrides.json']) {
      expect(text, name).toContain(`verified('${name}'`);
    }
  });
});
