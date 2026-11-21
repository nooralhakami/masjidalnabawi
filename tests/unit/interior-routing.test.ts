import { describe, expect, it } from 'vitest';
import rawData from '../../data/navq-interior-routes.json';
import { INTERIOR_POIS, POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data/types';
import { toWalkMetres, type XY } from '../../src/domain/frames';
import { interiorRoutingData, isWomenMosqueGate, WOMEN_MOSQUE_GATE_IDS } from '../../src/domain/interior-routing';
import {
  pointInInteriorMenZone,
  pointInInteriorWomenZone,
  pointInPoly,
  safetyWorld,
  segmentEntersInteriorMenZone,
  segmentEntersInteriorWomenZone,
  segmentHitsInteriorCarpet,
} from '../../src/domain/route-safety';
import { shortcutBadgeMeta } from '../../src/map/route';
import { walkShortcutPath } from '../../src/routing/walk';

describe('Phase 2 — separated men and women interior walking networks (navQ)', () => {
  const data = interiorRoutingData();
  const w = safetyWorld();

  it('has verified provenance, zero men-women links, and disjoint men/women edge sets', () => {
    expect(rawData.source.generatedBy).toBe('scripts/interior-routes-from-navq.py');
    expect(rawData.source.floorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rawData.source.pathsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.menWomenLinks).toBe(0);
    expect(data.menEdges.length).toBeGreaterThan(50);
    expect(data.womenEdges.length).toBeGreaterThan(15);
    expect([...WOMEN_MOSQUE_GATE_IDS].sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16, 17, 23, 24, 25, 26, 27, 28, 29, 30, 31]);

    // Zero close vertices between men's and women's networks
    const menPts = data.menEdges.flat();
    const womenPts = data.womenEdges.flat();
    let closePairs = 0;
    for (const mp of menPts) {
      for (const wp of womenPts) {
        if (Math.hypot(mp[0] - wp[0], mp[1] - wp[1]) < 1.5) closePairs++;
      }
    }
    expect(closePairs).toBe(0);
  });

  it('keeps every raw navQ interior edge free of carpets, Sacred Chamber, and cross-gender zones', () => {
    for (const [a, b] of data.menEdges) {
      expect(segmentHitsInteriorCarpet(a, b, [], w)).toBe(false);
      expect(segmentEntersInteriorWomenZone(a, b, w)).toBe(false);
    }
    for (const [a, b] of data.womenEdges) {
      expect(segmentHitsInteriorCarpet(a, b, [], w)).toBe(false);
      expect(segmentEntersInteriorMenZone(a, b, w, false)).toBe(false);
    }
  });

  it('enforces men_in_women_zone = 0, women_in_men_zone = 0, and navQ carpet/chamber safety on offered shortcuts', () => {
    const menGates = [1, 4, 8, 10, 19, 21, 34, 37].map((id) => POI_BY_ID.get(id)!).filter(Boolean);
    const womenGates = [12, 13, 15, 17, 24, 25, 28, 30].map((id) => POI_BY_ID.get(id)!).filter(Boolean);
    const menPrayerDests = INTERIOR_POIS.filter((p) => p.floor === 'GF' && p.kind === 'prayer' && p.gender === 'men').slice(0, 10);
    const womenPrayerDests = INTERIOR_POIS.filter((p) => p.floor === 'GF' && p.kind === 'prayer' && p.gender === 'women').slice(0, 10);

    let menOffered = 0;
    let womenInteriorOffered = 0;
    const violations = { menInWomen: 0, womenInMen: 0, womenBadGate: 0, chamber: 0 };

    const checkPath = (path: LatLng[], gender: 'men' | 'women') => {
      const pts = path.map(toWalkMetres);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(len / 1.0));
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const p: XY = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
          if (pointInPoly(p, data.chamber)) violations.chamber++;
          if (gender === 'men' && pointInInteriorWomenZone(p, w)) violations.menInWomen++;
          if (gender === 'women' && pointInInteriorMenZone(p, w, false)) violations.womenInMen++;
        }
      }
    };

    // Men: gates -> men's interior prayer areas and gates
    for (const g of menGates) {
      for (const d of [...menPrayerDests, ...menGates.slice(0, 3)]) {
        if (g.lat === d.lat && g.lng === d.lng) continue;
        const res = walkShortcutPath([g.lat, g.lng], [d.lat, d.lng], { isWomen: false, allowWomenRawdahCorridor: false });
        if (!res) continue;
        menOffered++;
        expect(res.kind).not.toBe('women_interior');
        expect(res.kind).not.toBe('women_rawdah');
        checkPath(res.path, 'men');
      }
    }

    // Women: women's gates -> women's interior prayer areas & other women's gates
    const nonWomenGatePts = Array.from({ length: 42 }, (_, i) => i + 1)
      .filter((id) => !isWomenMosqueGate(id))
      .map((id) => POI_BY_ID.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => toWalkMetres([p.lat, p.lng]));

    for (const g of womenGates) {
      for (const d of [...womenPrayerDests, ...womenGates]) {
        if (g.lat === d.lat && g.lng === d.lng) continue;
        const res = walkShortcutPath([g.lat, g.lng], [d.lat, d.lng], { isWomen: true, allowWomenRawdahCorridor: false });
        if (!res) continue;
        expect(res.kind).not.toBe('interior');
        if (res.kind === 'women_interior') {
          womenInteriorOffered++;
          // Check women's interior shortcut never enters/exits through a non-women Mosque gate
          const pts = res.path.map(toWalkMetres);
          for (let i = 1; i < pts.length; i++) {
            const wasIn = pointInInteriorWomenZone(pts[i - 1], w);
            const nowIn = pointInInteriorWomenZone(pts[i], w);
            if (wasIn !== nowIn) {
              const mid: XY = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
              if (nonWomenGatePts.some((gp) => Math.hypot(gp[0] - mid[0], gp[1] - mid[1]) < 8)) {
                violations.womenBadGate++;
              }
            }
          }
        }
        checkPath(res.path, 'women');
      }
    }

    expect(menOffered).toBeGreaterThan(5);
    expect(womenInteriorOffered).toBeGreaterThan(5);
    expect(violations).toEqual({ menInWomen: 0, womenInMen: 0, womenBadGate: 0, chamber: 0 });
  }, 60_000);

  it('provides distinct women_interior badge metadata', () => {
    const meta = shortcutBadgeMeta('women_interior');
    expect(meta.glyph).toBe('♀');
    expect(meta.label).toContain('للنساء');
    expect(meta.color).not.toBe(shortcutBadgeMeta('interior').color);
  });
});
