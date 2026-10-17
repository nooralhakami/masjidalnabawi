import { describe, expect, it } from 'vitest';
import { POIS } from '../../src/data';
import { search } from '../../src/domain/search';
import { groupResults, highlight, shownOrder } from '../../src/presentation/search-view';
import { nm } from '../../src/i18n';

// The search panel (SPEC N12): grouped by kind, the search's ranking kept, the match highlighted.

describe('grouped results', () => {
  it('the best match stays first (215 for «215» and «٢١٥»), so Enter picks it', () => {
    for (const q of ['215', '٢١٥']) {
      const groups = groupResults(search(POIS, q));
      expect(shownOrder(groups)[0].id).toBe(215);
      expect(groups[0].label).toBe('p_toilets');
      expect(groups.map((g) => g.label)).toEqual(['p_toilets', 'p_parking']);
    }
  });
  it('at most eight rows, as the live app', () => {
    const all = search(POIS, '33');
    expect(all.length).toBeGreaterThan(8);
    expect(shownOrder(groupResults(all))).toHaveLength(8);
    expect(shownOrder(groupResults(all))).toEqual(all.slice(0, 8));
  });
  it('historic sites have their own heading', () => {
    const groups = groupResults(search(POIS, 'قباء'));
    expect(groups.map((g) => g.label)).toContain('p_historic');
  });
  it('nothing matches: no groups', () => expect(groupResults(search(POIS, 'zzzzqq'))).toEqual([]));
});

describe('highlight', () => {
  it('marks the typed part of a name, digits in either script', () => {
    const name = nm(POIS.find((p) => p.id === 215)!, 'ar');
    expect(highlight(name, '215')?.[1]).toBe('215');
    expect(highlight(name, '٢١٥')?.[1]).toBe('215');
    expect(highlight('Al Baik — Central', 'al baik')).toEqual(['', 'Al Baik', ' — Central']);
  });
  it('no plain match (found by number or another language): no highlight', () => {
    expect(highlight('Bab al-Salam', 'باب')).toBeNull();
    expect(highlight('anything', '  ')).toBeNull();
  });
});
