import { describe, expect, it } from 'vitest';
import { POIS } from '../../src/data';
import { FEATURED_IDS } from '../../src/domain/visits';
import { icon } from '../../src/presentation/icons';
import { FACILITY_PX, isNamedGate, markerLook } from '../../src/presentation/marker-look';
import { FACILITY_SIZE, gateLabelVisible, markerSpec, tierOf, zoomClass } from '../../src/presentation/markers';

// The GPU map draws markers from markerLook(); the live app drew them from markerSpec() (ported
// verbatim). For every one of the 325 places the two must agree on the kind of marker, its colour
// and its icon — this replaces checking the Leaflet HTML (owner's approval, SPEC §9-7).

const KIND_CLASS = { 'gate-outer': 'mk-chip', 'gate-inner': 'mk-inum', parking: 'mk-park-wrap', featured: 'mk-star-wrap', facility: 'mk-dot' } as const;

describe('markerLook agrees with the live app’s markerSpec for every place', () => {
  for (const p of POIS) {
    const featured = FEATURED_IDS.has(p.id);
    it(`${p.id}`, () => {
      const look = markerLook(p, featured);
      const html = markerSpec(p, 'l', undefined, false, false, featured).html;
      expect(html).toContain(KIND_CLASS[look.kind]);
      if (look.kind === 'gate-outer' || look.kind === 'gate-inner') expect(html).toContain(`--c:var(--${look.color})`);
      if (look.kind === 'facility') {
        if (look.color === 'mixed') expect(html).toContain('mk-mixed');
        else expect(html).toContain(`--c:var(--${look.color})`);
      }
      if (look.kind === 'facility' || look.kind === 'featured') expect(html).toContain(icon(look.icon, 24));
      if (look.kind === 'parking') expect(html.includes('is-sub')).toBe(look.sub);
    });
  }
});

describe('marker rules carried over', () => {
  it('facility sizes are the live app’s at each zoom (FACILITY_SIZE and the zoom classes)', () => {
    for (const [z, px] of FACILITY_PX) {
      const live = zoomClass(z) === 'z-far' ? 4 : zoomClass(z) === 'z-mid' ? 5 : FACILITY_SIZE[tierOf(z)];
      expect(px, `zoom ${z}`).toBe(live);
    }
  });
  it('named gates are exactly those whose label shows at 19', () => {
    for (const p of POIS) expect(isNamedGate(p), `${p.id}`).toBe(gateLabelVisible(p, 19));
  });
  it('the nine must-visit sites are featured badges, not plain dots', () => {
    const featured = POIS.filter((p) => markerLook(p, FEATURED_IDS.has(p.id)).kind === 'featured');
    expect(featured.map((p) => p.id).sort()).toEqual([...FEATURED_IDS].sort());
    expect(featured).toHaveLength(9);
  });
});
