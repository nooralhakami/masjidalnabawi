import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID } from '../../src/data';
import { FACILITY_SIZE, gateLabelVisible, markerSpec, tierOf, visibleAtZoom, zoomClass } from '../../src/ui/markers';

const P = (id: number) => POI_BY_ID.get(id)!;

describe('markers', () => {
  it('zoom tiers', () => {
    expect([15, 16, 17, 18, 19].map(tierOf)).toEqual(['s', 's', 'm', 'm', 'l']);
    expect(FACILITY_SIZE).toEqual({ s: 8, m: 14, l: 20 });
  });

  it('shows named inner-gate labels only at zoom 19+', () => {
    expect(gateLabelVisible(P(1), 18)).toBe(false);
    expect(gateLabelVisible(P(1), 19)).toBe(true);
    expect(gateLabelVisible(P(10), 19)).toBe(false);
  });

  it('no emoji in any marker', () => {
    for (const p of POIS) for (const t of ['s', 'm', 'l'] as const) {
      expect(markerSpec(p, t, p.status, false).html).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('outer gates: dot when zoomed out, numbered chip from 17', () => {
    expect(markerSpec(P(301), 's', 'open', false).html).toContain('mk-gdot');
    expect(markerSpec(P(301), 'm', 'open', false).html).toContain('>301<');
  });

  it('inner gates: number only at ≥18, women gates purple', () => {
    expect(markerSpec(P(1), 'm', 'open', false).html).not.toContain('>1<');
    expect(markerSpec(P(1), 'l', 'open', false).html).toContain('>1<');
    expect(markerSpec(P(11), 'l', 'open', false).html).toContain('--cat-women');
  });

  it('facility size follows the tier; icon hidden at 8px', () => {
    expect(markerSpec(P(201), 's', 'open', false).html).toContain('--d:8px');
    expect(markerSpec(P(201), 's', 'open', false).html).not.toContain('<svg');
    expect(markerSpec(P(201), 'l', 'open', false).html).toContain('--d:20px');
    expect(markerSpec(P(201), 'l', 'open', false).html).toContain('<svg');
  });

  it('closed facilities are grey with a badge; selected ones rise above all', () => {
    const c = markerSpec(P(215), 'l', 'works', false);
    expect(c.className).toContain('is-closed');
    expect(c.html).toContain('--cat-gray');
    const s = markerSpec(P(215), 'l', 'works', true);
    expect(s.className).toContain('is-selected');
    expect(s.zIndex).toBe(1000);
  });

  it('parking chip P1…P13; mixed restrooms split in two', () => {
    expect(markerSpec(P(913), 'm', undefined, false).html).toContain('P13');
    expect(markerSpec(P(202), 'l', 'open', false).html).toContain('mk-mixed');
  });

  it('progressive disclosure at ≤16 hides inner gates and wheelchair zones unless filtered', () => {
    expect(visibleAtZoom(P(1), 's', 'all', false)).toBe(false);
    expect(visibleAtZoom(P(401), 's', 'all', false)).toBe(false);
    expect(visibleAtZoom(P(301), 's', 'all', false)).toBe(true);
    expect(visibleAtZoom(P(201), 's', 'all', false)).toBe(true);
    expect(visibleAtZoom(P(401), 's', 'wheelchair', false)).toBe(true);
    expect(visibleAtZoom(P(1), 'm', 'all', false)).toBe(true);
  });
});

describe('zoomed out: every marker in its place, smaller', () => {
  it('the map gets a zoom class that shrinks the dots: 4px at ≤14, 5px at 15, normal from 16', () => {
    expect([13, 14, 15, 16, 17].map(zoomClass)).toEqual(['z-far', 'z-far', 'z-mid', '', '']);
  });

  it('nothing is merged or hidden for being zoomed out: outer gates stay', () => {
    expect(visibleAtZoom(POI_BY_ID.get(330)!, 's', 'all', false)).toBe(true);
  });
});
