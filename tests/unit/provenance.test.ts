import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_PROVENANCE, assertRoutingSourceVerified, assertRoutingSourcesVerified, type DataSourceId } from '../../src/data/provenance';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('data provenance ledger and routing guards (A3)', () => {
  it('enforces tier invariants and backs every entry with a real workspace path', () => {
    const entries = Object.values(DATA_PROVENANCE);
    expect(entries.length).toBeGreaterThanOrEqual(15);

    for (const record of entries) {
      expect(record.routingAllowed).toBe(record.tier === 'verified');
      expect(existsSync(resolve(ROOT, record.path)), `missing file for provenance entry "${record.id}": ${record.path}`).toBe(true);
    }

    expect(DATA_PROVENANCE['apple-maps-rug-ref'].tier).toBe('candidate');
    expect(DATA_PROVENANCE['apple-maps-rug-closeup-ref'].tier).toBe('candidate');
    expect(DATA_PROVENANCE['pm-central-guide-2026'].tier).toBe('candidate');
    expect(DATA_PROVENANCE['crowd-sim'].tier).toBe('simulation');
    expect(DATA_PROVENANCE['scene-light'].tier).toBe('simulation');
  });

  it('assertRoutingSourceVerified allows verified sources and rejects candidate, simulation, or unknown sources', () => {
    const verifiedIds = (Object.keys(DATA_PROVENANCE) as DataSourceId[]).filter((id) => DATA_PROVENANCE[id].tier === 'verified');
    expect(() => assertRoutingSourcesVerified(verifiedIds)).not.toThrow();

    for (const id of ['apple-maps-rug-ref', 'apple-maps-rug-closeup-ref', 'pm-central-guide-2026', 'crowd-sim', 'scene-light'] as const) {
      expect(() => assertRoutingSourceVerified(id)).toThrow(/rejected (candidate|simulation) data source/);
      expect(() => assertRoutingSourcesVerified(['pois', id])).toThrow(/rejected (candidate|simulation) data source/);
    }

    expect(() => assertRoutingSourceVerified('unregistered-source')).toThrow(/rejected unknown data source/);
  });

  it('static import scan confirms src/routing/*.ts consumes only verified sources', () => {
    const routingDir = resolve(ROOT, 'src/routing');
    const files = readdirSync(routingDir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    const forbidden = Object.values(DATA_PROVENANCE).filter((r) => !r.routingAllowed);

    for (const file of files) {
      const source = readFileSync(resolve(routingDir, file), 'utf8');
      const specifiers = [...source.matchAll(/^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

      for (const spec of specifiers) {
        if (spec.startsWith('./') || spec.startsWith('../domain/')) continue;

        const isVerifiedDataImport =
          spec === '../data' ||
          spec === '../data/types' ||
          spec === '../data/provenance' ||
          spec === '../../data/garage.json' ||
          spec === '../../data/streets.json' ||
          spec === '../data-next/alharamain-3d' ||
          spec === '../data-next/vertical-nodes';

        expect(isVerifiedDataImport, `${file} imports unverified/unlisted module "${spec}"`).toBe(true);
      }

      for (const blocked of forbidden) {
        expect(source).not.toContain(blocked.id);
        expect(source).not.toContain(blocked.path);
      }
    }
  });
});
