import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES } from '../../src/data';
import { SITE } from '../../src/config/site.config';
import { WEATHER_URL } from '../../src/domain/weather';

// The security headers in vercel.json (OWASP Secure Headers; owner, 2026-10-24). The CSP lists the
// page's inline scripts by hash, so editing one of them without its hash here would block it.

const root = join(__dirname, '../..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf-8')) as {
  routes?: unknown;
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const all = vercel.headers.find((h) => h.source === '/(.*)')!;
const header = (key: string) => all?.headers.find((h) => h.key === key)?.value;
const csp = header('Content-Security-Policy') ?? header('Content-Security-Policy-Report-Only') ?? '';
const directive = (name: string) => csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];
const origin = (url: string) => new URL(url.replace(/\{[a-z]\}/g, 'a')).origin;

describe('security headers (vercel.json)', () => {
  it('every page gets them, and no `routes` block silently drops them', () => {
    expect(all).toBeDefined();
    expect(vercel.routes).toBeUndefined();
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBeTruthy();
    expect(header('Permissions-Policy')).toContain('geolocation=(self)');
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
  });

  it('the CSP allows each inline script of index.html and map.html by its hash, and nothing inline beyond them', () => {
    const allowed = directive('script-src');
    expect(allowed).not.toContain("'unsafe-inline'");
    expect(allowed).not.toContain("'unsafe-eval'");
    for (const page of ['index.html', 'map.html']) {
      const html = readFileSync(join(root, page), 'utf-8');
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
      for (const body of inline) {
        const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
        expect(allowed, `${page}: ${body.trim().slice(0, 40)}…`).toContain(hash);
      }
    }
  });

  it('the CSP lets the map tiles and the weather through', () => {
    for (const url of [RULES.map.tiles.satellite, SITE.LIGHT_TILES]) {
      expect(directive('img-src'), url).toContain(origin(url));
      expect(directive('connect-src'), url).toContain(origin(url));
    }
    expect(directive('connect-src')).toContain(origin(WEATHER_URL));
  });
});
