import { describe, expect, it } from 'vitest';
import { POI_BY_ID, VISITS } from '../../src/data';
import { FEATURED_IDS, VISIT_SITES, visitRank } from '../../src/domain/visits';
import { markerSpec } from '../../src/ui/markers';

describe('must-visit sites', () => {
  it('every id exists, is a historic site, and appears once', () => {
    expect(new Set(VISITS.order).size).toBe(VISITS.order.length);
    for (const id of VISITS.order) expect(POI_BY_ID.get(id)?.subCategory).toBe('historic');
    expect(VISIT_SITES).toHaveLength(VISITS.order.length);
  });

  it('is ranked: Quba first, then Al-Baqi\'', () => {
    expect(visitRank(542)).toBe(1);
    expect(visitRank(531)).toBe(2);
    expect(visitRank(1)).toBeUndefined();
    expect(FEATURED_IDS.has(542)).toBe(true);
  });

  it('a featured marker keeps a halo and the same markup at every zoom tier', () => {
    const p = POI_BY_ID.get(542)!;
    const html = (['s', 'm', 'l'] as const).map((t) => markerSpec(p, t, undefined, false, false, true).html);
    for (const h of html) expect(h).toContain('mk-halo');
    expect(new Set(html).size).toBe(1);
    expect(markerSpec(p, 's', undefined, false, false, true).className).toContain('mk-feat');
    expect(markerSpec(p, 's', undefined, false).html).not.toContain('mk-halo');
    // Selected: the normal dropped pin, no halo.
    expect(markerSpec(p, 's', undefined, true, false, true).html).not.toContain('mk-halo');
  });
});
