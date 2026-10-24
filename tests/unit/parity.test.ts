import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID } from '../../src/data';
import { Facilities } from '../../src/domain/facilities';
import { FILTERS } from '../../src/domain/filters';
import { parkingAccess } from '../../src/domain/parking';
import { rawdahState } from '../../src/domain/rawdah';
import { search } from '../../src/domain/search';
import { visiblePois } from '../../src/domain/visible';
import { LANGS, dirOf } from '../../src/i18n';
import { planExit, planRoutes } from '../../src/routing/plan';

// Reference behaviour, first produced by the live app's own code (masjidalnabawi@e0c6ca7; docs/SPEC.md
// §8): routes, search, the Rawdah schedule, counts and languages. A change here is a change the visitor
// sees, so it needs the owner's word and a note in docs/DECISIONS.md. The data files themselves are
// checked by content in data-integrity.test.ts (owner, 2026-10-24: no more byte-for-byte hashes).

const P = (id: number) => POI_BY_ID.get(id)!;
const round = (n: number) => Math.round(n);

describe('parity: walking', () => {
  it('from [24.469, 39.6125] to restroom 227: 415 m, 6 minutes, one route', async () => {
    const plans = await planRoutes([24.469, 39.6125], P(227), 'walk');
    expect(plans.map((p) => [round(p.walkM), p.minutes])).toEqual([[415, 6]]);
  });
  it('from the south plaza to Quba Mosque: about 3.3 km, with two alternatives', async () => {
    const plans = await planRoutes([24.4655, 39.6111], P(542), 'walk');
    expect(plans.map((p) => [round(p.walkM), p.minutes])).toEqual([
      [3324, 42],
      [3554, 45],
      [4315, 54],
    ]);
  });
});

describe('parity: driving to the car park under the Haram', () => {
  const FROM: [number, number] = [24.4718, 39.6035];
  it('to 226 on level A: lot 9 from the Sultana entrance, up the yellow ramp', async () => {
    const [plan, ...others] = await planRoutes(FROM, P(226), 'drive', { level: 'A' });
    expect(others).toEqual([]);
    expect([plan.lot?.id, plan.level, plan.entrance, plan.ramps?.map((r) => r.to)]).toEqual([909, 'A', 'sultana', ['A']]);
    expect([round(plan.driveM), round(plan.walkM), plan.minutes]).toEqual([1786, 7, 7]);
  });
  it('to 226 on level B: the same lot, no ramp', async () => {
    const [plan] = await planRoutes(FROM, P(226), 'drive', { level: 'B' });
    expect([plan.lot?.id, plan.level, plan.entrance, plan.ramps?.length ?? 0]).toEqual([909, 'B', 'sultana', 0]);
    expect([round(plan.driveM), round(plan.walkM), plan.minutes]).toEqual([1067, 7, 4]);
  });
  it('the way out of lot 9 from level A: Sultana first, Omar ibn al-Khattab as the alternative', () => {
    expect(planExit(P(909), 'A').map((p) => [p.exit, round(p.driveM), p.minutes])).toEqual([
      ['sultana', 1577, 6],
      ['omar', 1842, 7],
    ]);
  });
});

describe('parity: search', () => {
  const ids = (q: string) => search(POIS, q).map((p) => p.id);
  it('215 and ٢١٥ find restroom 215 first', () => {
    expect(ids('215')).toEqual([215, 906, 907]);
    expect(ids('٢١٥')).toEqual(ids('215'));
  });
  it('«Al Baik» finds the five branches', () => expect(ids('Al Baik')).toEqual([824, 827, 828, 829, 830]));
  it('«1A» finds lot 1', () => expect(ids('1A')).toEqual([901]));
  it('«مشتركين» finds every lot, the five subscriber lots among them (as the live app does)', () => {
    const sub = POIS.filter((p) => p.category === 'parking' && parkingAccess(p) === 'subscribers').map((p) => p.id);
    expect(sub).toEqual([902, 906, 908, 910, 913]);
    expect(ids('مشتركين')).toEqual([901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912, 913]);
  });
  it('a gate by its name', () => expect(ids('باب الملك فهد')).toEqual([21]));
  it('no match: nothing, and nothing breaks', () => expect(ids('zzzzqq')).toEqual([]));
});

describe('parity: Rawdah schedule (R5), 16 October 2026', () => {
  const at = (iso: string) => {
    const s = rawdahState(new Date(iso));
    return [s.turn, s.minutesLeft, s.since.toISOString(), s.until.toISOString()];
  };
  it('men from midnight until Fajr', () => expect(at('2026-10-16T01:00:00Z')).toEqual(['men', 62, '2026-10-15T21:00:00.000Z', '2026-10-16T02:02:00.000Z']));
  it('women from Fajr until 10:00', () => {
    expect(at('2026-10-16T03:30:00Z')).toEqual(['women', 210, '2026-10-16T02:02:00.000Z', '2026-10-16T07:00:00.000Z']);
    expect(at('2026-10-16T05:00:00Z')).toEqual(['women', 120, '2026-10-16T02:02:00.000Z', '2026-10-16T07:00:00.000Z']);
  });
  it('men from 10:00 until Isha', () => {
    expect(at('2026-10-16T08:00:00Z')).toEqual(['men', 504, '2026-10-16T07:00:00.000Z', '2026-10-16T16:24:00.000Z']);
    expect(at('2026-10-16T12:00:00Z')).toEqual(['men', 264, '2026-10-16T07:00:00.000Z', '2026-10-16T16:24:00.000Z']);
  });
  it('women from Isha until midnight', () => {
    expect(at('2026-10-16T17:30:00Z')).toEqual(['women', 210, '2026-10-16T16:24:00.000Z', '2026-10-16T21:00:00.000Z']);
    expect(at('2026-10-16T19:00:00Z')).toEqual(['women', 120, '2026-10-16T16:24:00.000Z', '2026-10-16T21:00:00.000Z']);
  });
  it('then men again until the next Fajr', () => expect(at('2026-10-16T21:30:00Z')).toEqual(['men', 272, '2026-10-16T21:00:00.000Z', '2026-10-17T02:02:00.000Z']));
});

describe('parity: places and category counts (SPEC F1)', () => {
  it('324 places, 8 hidden (wheelchair areas 401–408), 316 shown', () => {
    expect(POIS).toHaveLength(324);
    expect(POIS.filter((p) => p.subCategory === 'wheelchair_zone').map((p) => p.id)).toEqual([401, 402, 403, 404, 405, 406, 407, 408]);
  });
  it('each pill counts what it shows, computed the way the live app does', () => {
    const fac = new Facilities();
    const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, visiblePois(id, 'all', '', fac, undefined, id === 'parking' ? 'all' : undefined).length]));
    expect(counts).toEqual({ all: 303, gates: 112, women: 35, toilets: 40, hotels: 43, food: 44, shopping: 15, landmarks: 38, historic: 17, parking: 13, emergency: 9 });
    expect(counts.all + counts.parking).toBe(316);
  });
});

describe('parity: languages', () => {
  it('26 languages; right to left: Arabic, Urdu, Persian, Pashto (Kurdish is Kurmanji in Latin script)', () => {
    expect(LANGS).toHaveLength(26);
    expect(LANGS.filter((l) => dirOf(l) === 'rtl')).toEqual(['ar', 'ur', 'fa', 'ps']);
    expect(dirOf('ku')).toBe('ltr');
  });
});
