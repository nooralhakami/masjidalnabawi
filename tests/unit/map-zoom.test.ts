import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POIS } from '../../src/data';
import { RULES } from '../../src/data';
import { fitView, haramBounds, legacyZoom, mapZoom } from '../../src/map/zoom';

// The map's opening view and zoom scale (SPEC §9-3: as the live app does it).

describe('zoom scale', () => {
  it('MapLibre zoom = Leaflet zoom − 1 (512 px world vs 256 px tiles), both ways', () => {
    expect(mapZoom(17)).toBe(16);
    expect(legacyZoom(18)).toBe(19);
    expect(legacyZoom(mapZoom(14))).toBe(14);
  });
  it('the live app’s range and default stay in Leaflet terms (rules.json)', () => {
    expect(RULES.map.default_zoom).toBe(17);
    expect(RULES.map.max_zoom).toBe(19);
  });
});

describe('opening view: fitBounds over the outer gates, 16 px padding, whole zooms', () => {
  const b = haramBounds(POIS);
  it('the bounds are the 70 outer gates, with the owner’s position nudges (overrides.json) applied', () => {
    expect(POIS.filter((p) => p.subCategory === 'gate_outer')).toHaveLength(70);
    expect(b.south).toBeCloseTo(24.4660176, 7);
    expect(b.north).toBeCloseTo(24.4710527, 7);
    expect([b.west, b.east]).toEqual([39.6077755, 39.6142706]);
  });
  it('phones open at Leaflet zoom 16 (15 on a small 320 × 568 phone); tablets and laptops at 17, a large screen at 18', () => {
    expect(fitView(b, 320, 568).legacyZoom).toBe(15);
    for (const [w, h] of [
      [360, 740],
      [375, 812],
      [390, 844],
      [412, 915],
    ])
      expect(fitView(b, w, h).legacyZoom, `${w}×${h}`).toBe(16);
    expect(fitView(b, 768, 1024).legacyZoom).toBe(17);
    expect(fitView(b, 1280, 800).legacyZoom).toBe(17);
    expect(fitView(b, 1920, 1080).legacyZoom).toBe(18);
  });
  it('matches the live app’s own formula (its map.html tile preload, copied verbatim) at many sizes', () => {
    // From masjidalnabawi@e0c6ca7 map.html: the same fit as setup.ts, written out for the preload.
    const live = (w: number, h: number) => {
      const S = b.south,
        N = b.north,
        W = b.west,
        E = b.east,
        pad = 32,
        ts = 256;
      const px = (lat: number, lng: number, z: number) => {
        const s = ts * Math.pow(2, z),
          r = (lat * Math.PI) / 180;
        return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + Math.sin(r)) / (1 - Math.sin(r))) / (4 * Math.PI)) * s];
      };
      const a = px(N, W, 0),
        c = px(S, E, 0);
      const scale = Math.min((w - pad) / (c[0] - a[0]), (h - pad) / (c[1] - a[1]));
      return Math.max(14, Math.min(19, Math.floor(Math.log(scale) / Math.LN2)));
    };
    for (let w = 300; w <= 2600; w += 37) for (let h = 480; h <= 1600; h += 53) expect(fitView(b, w, h).legacyZoom, `${w}×${h}`).toBe(live(w, h));
  });
  it('never outside 14–19', () => {
    expect(fitView(b, 100, 100).legacyZoom).toBe(14);
    expect(fitView(b, 20000, 20000).legacyZoom).toBe(19);
  });
  it('centred on the middle of the Haram', () => {
    const { center } = fitView(b, 375, 812);
    expect(center[0]).toBeCloseTo(24.46854, 5);
    expect(center[1]).toBeCloseTo(39.61102, 5);
  });
  it('map.html preloads the same first tiles: its bounds are these (to 7 decimals, ≈ 1 cm)', () => {
    // The live app's map.html had the bounds before the owner's nudges (south 24.4659727), so its
    // preload could miss; here they follow the data.
    const html = readFileSync(join(__dirname, '../../map.html'), 'utf8');
    const m = html.match(/S = ([\d.]+), N = ([\d.]+), W = ([\d.]+), E = ([\d.]+)/);
    const got = m!.slice(1).map(Number);
    [b.south, b.north, b.west, b.east].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 7));
  });
});
