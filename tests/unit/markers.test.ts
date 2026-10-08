import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID } from '../../src/data';
import { CLUSTER_MAX_ZOOM, FACILITY_SIZE, clusterColor, clusterItems, clusterSize, gateLabelVisible, markerSpec, tierOf, visibleAtZoom } from '../../src/map/markers';

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

describe('city view (zoom ≤ 15): bubbles with counts', () => {
  const P = (id: number) => POI_BY_ID.get(id)!;

  it('nearby markers share a bubble; far ones stay apart', () => {
    const c = clusterItems([
      { p: P(201), x: 100, y: 100 },
      { p: P(202), x: 120, y: 105 },
      { p: P(203), x: 300, y: 300 },
    ]);
    expect(c.map((k) => k.members.length).sort()).toEqual([1, 2]);
    const pair = c.find((k) => k.members.length === 2)!;
    expect(pair.x).toBeCloseTo(110, 5);
  });

  it('a bubble takes the colour of its most common kind, and stays small', () => {
    expect(clusterColor([P(701), P(702), P(201)])).toBe('var(--cat-hotel)');
    expect(clusterSize(2)).toBe(20);
    expect(clusterSize(500)).toBe(28);
  });

  it('gates are left out of the city view under «all», but not under their own pill', () => {
    const gate = P(330);
    expect(visibleAtZoom(gate, 's', 'all', false, CLUSTER_MAX_ZOOM)).toBe(false);
    expect(visibleAtZoom(gate, 's', 'all', false, 16)).toBe(true);
    expect(visibleAtZoom(gate, 's', 'gates', false, CLUSTER_MAX_ZOOM)).toBe(true);
  });
});
