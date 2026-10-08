import { beforeEach, describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID, RULES } from '../../src/data';
import type { Poi } from '../../src/data';
import { Facilities, elevatorBadge, pairOf } from '../../src/domain/facilities';
import { passesFilter, type FilterId } from '../../src/domain/filters';
import { search } from '../../src/domain/search';
import { visiblePois } from '../../src/domain/visible';
import { PARKING, between, levels, lotLabel } from '../../src/domain/parking';
import { nearestOuterGate } from '../../src/domain/nearby';
import { setLang } from '../../src/i18n';

const P = (id: number): Poi => POI_BY_ID.get(id)!;
let fac: Facilities;

beforeEach(() => {
  fac = new Facilities();
  setLang('ar');
});

const shown = (filter: FilterId, toiletSub: 'all' | 'open' | 'closed' = 'all') =>
  POIS.filter((p) => passesFilter(p, { filter, toiletSub, searching: false }, fac));

describe('filters', () => {
  it('"all" shows everything except parking', () => {
    const all = shown('all');
    expect(all).toHaveLength(284 - 13);
    expect(all.some((p) => p.category === 'parking')).toBe(false);
  });

  it('parking appears only with its pill or while searching', () => {
    for (const f of ['all', 'gates', 'toilets', 'landmarks', 'women'] as FilterId[]) {
      expect(shown(f).some((p) => p.category === 'parking'), f).toBe(false);
    }
    expect(shown('parking')).toHaveLength(13);
    expect(shown('parking').every((p) => p.category === 'parking')).toBe(true);
    expect(passesFilter(P(901), { filter: 'all', toiletSub: 'all', searching: true }, fac)).toBe(true);
  });

  it('landmarks exclude wheelchair zones, which have their own pill', () => {
    expect(shown('landmarks').some((p) => p.subCategory === 'wheelchair_zone')).toBe(false);
    expect(shown('landmarks')).toHaveLength(29);
    expect(shown('wheelchair')).toHaveLength(8);
    expect(shown('wheelchair').every((p) => p.subCategory === 'wheelchair_zone')).toBe(true);
  });

  it('women services = women + mixed restrooms + prayer halls + open women-section inner gates', () => {
    const w = shown('women');
    const womenGates = POIS.filter((p) => p.subCategory === 'gate_inner' && p.women);
    expect(w.filter((p) => p.subCategory === 'toilet_women')).toHaveLength(14);
    expect(w.filter((p) => p.subCategory === 'toilet_mixed').map((p) => p.id).sort()).toEqual([202, 210, 221]);
    expect(w.filter((p) => p.category === 'women')).toHaveLength(2);
    expect(w.filter((p) => p.subCategory === 'gate_inner')).toHaveLength(womenGates.length);
    expect(w.some((p) => p.subCategory === 'toilet_men' || p.subCategory === 'gate_outer')).toBe(false);
  });

  it('toilet sub-filters: everything starts open; closed = maintenance + works', () => {
    expect(shown('toilets')).toHaveLength(40);
    expect(shown('toilets', 'closed')).toHaveLength(0);
    expect(shown('toilets', 'open')).toHaveLength(40);
    fac.toggleMaintenance(212);
    fac.toggleElevatorWorks(215);
    expect(shown('toilets', 'closed').map((p) => p.id).sort()).toEqual([212, 215, 216]);
    expect(shown('toilets', 'open')).toHaveLength(37);
  });

  it('category pills match their category', () => {
    expect(shown('gates')).toHaveLength(112);
    expect(shown('hotels')).toHaveLength(43);
    expect(shown('food')).toHaveLength(26);
    expect(shown('emergency')).toHaveLength(11);
  });
});

describe('facilities: alternatives by gender', () => {
  it('a closed women facility suggests the nearest open women/mixed one', () => {
    fac.toggleElevatorWorks(215); // closes 215 and its pair 216
    const alt = fac.nearestOpen(P(215))!;
    expect(alt.poi.id).toBe(217);
    expect(['toilet_women', 'toilet_mixed']).toContain(alt.poi.subCategory);
    expect(alt.meters).toBeGreaterThan(50);
    expect(alt.meters).toBeLessThan(110); // 215↔217 after the v0 coordinate update: ~95 m
  });

  it('men → men or mixed, never women', () => {
    const alt = fac.nearestOpen(P(212))!;
    expect(['toilet_men', 'toilet_mixed']).toContain(alt.poi.subCategory);
    expect(fac.isOpen(alt.poi.id)).toBe(true);
  });

  it('mixed → any type', () => {
    const alt = fac.nearestOpen(P(221))!;
    expect(['toilet_men', 'toilet_women', 'toilet_mixed']).toContain(alt.poi.subCategory);
  });

  it('elderly restrooms have no alternative of the same group since 409/410 were removed', () => {
    fac.toggleMaintenance(204);
    expect(fac.nearestOpen(P(204))).toBeNull();
  });

  it('never suggests a closed facility', () => {
    for (const p of POIS.filter((q) => q.category === 'toilets')) {
      const alt = fac.nearestOpen(p);
      if (alt) expect(fac.isOpen(alt.poi.id), `alt for ${p.id}`).toBe(true);
    }
  });
});

describe('facilities: elevator works on pairs', () => {
  it('works at 215 close 216 with it', () => {
    fac.toggleElevatorWorks(215);
    expect(fac.status(215)).toBe('works');
    expect(fac.status(216)).toBe('works');
    expect(fac.worksBy(216)).toBe(215);
  });

  it('starting works at a women site closes its pair; ending reopens both', () => {
    expect(fac.toggleElevatorWorks(223)).toBe(true);
    expect(fac.status(223)).toBe('works');
    expect(fac.status(224)).toBe('works');
    expect(fac.worksBy(224)).toBe(223);
    fac.toggleElevatorWorks(224); // acting on the pair targets the owner
    expect(fac.status(223)).toBe('open');
    expect(fac.status(224)).toBe('open');
  });

  it('men sites with elevators under construction stay open and cannot get works', () => {
    for (const id of RULES.rules.ELEV_SOON.filter((i) => !RULES.rules.ELEV_WOMEN.includes(i))) {
      expect(fac.isOpen(id), String(id)).toBe(true);
      expect(fac.toggleElevatorWorks(id)).toBe(false);
      expect(elevatorBadge(P(id))).toBe('elev');
    }
    expect(elevatorBadge(P(215))).toBe('elev_w');
    expect(elevatorBadge(P(201))).toBeNull();
  });

  it('maintenance toggle on a works site ends the works for the pair', () => {
    fac.toggleElevatorWorks(215);
    fac.toggleMaintenance(216);
    expect(fac.status(215)).toBe('open');
    expect(fac.status(216)).toBe('open');
    fac.toggleMaintenance(216);
    expect(fac.status(216)).toBe('maintenance');
    expect(fac.status(215)).toBe('open');
  });

  it('notifies listeners on change', () => {
    let n = 0;
    fac.onChange(() => n++);
    fac.toggleMaintenance(201);
    fac.toggleElevatorWorks(229);
    expect(n).toBe(2);
  });

  it('pairs lead to the same restrooms', () => {
    expect(pairOf(P(203))?.id).toBe(204);
    expect(pairOf(P(236))?.id).toBe(235);
    expect(pairOf(P(301))).toBeUndefined();
  });
});

describe('search', () => {
  it('finds parking by level code, P-number, Arabic and English words', () => {
    expect(search(POIS, '1A')[0].id).toBe(901);
    expect(search(POIS, '1b')[0].id).toBe(901);
    expect(search(POIS, 'P5')[0].id).toBe(905);
    expect(search(POIS, 'مواقف').filter((p) => p.category === 'parking')).toHaveLength(13);
    expect(search(POIS, 'parking').filter((p) => p.category === 'parking')).toHaveLength(13);
  });

  it('converts Arabic-Indic digits', () => {
    expect(search(POIS, '٢١٥')[0].id).toBe(215);
    expect(search(POIS, '۲۱۵')[0].id).toBe(215); // Urdu digits
  });

  it('always searches English names, from any UI language', () => {
    expect(search(POIS, 'Al Baik')[0].name_ar).toBe('البيك');
    setLang('tr');
    expect(search(POIS, 'al baik')[0].name_ar).toBe('البيك');
  });

  it('searches the UI-language name', () => {
    setLang('en');
    expect(search(POIS, 'Lost & Found')[0].id).toBe(504);
  });

  it('id prefix matches, exact id first', () => {
    const r = search(POIS, '33');
    expect(r[0].id).toBe(33);
    expect(r.slice(1, 11).map((p) => p.id)).toEqual([330, 331, 332, 333, 334, 335, 336, 337, 338, 339]);
  });

  it('the exhibition above restrooms 204 is findable by its description', () => {
    for (const q of ['متحف', 'معرض', 'مخطوطات']) expect(search(POIS, q).map((p) => p.id), q).toContain(204);
    setLang('en');
    expect(search(POIS, 'manuscripts').map((p) => p.id)).toContain(204);
  });

  it('returns nothing for gibberish', () => {
    expect(search(POIS, 'zzqxw')).toEqual([]);
  });

  it('search makes parking visible under "all"', () => {
    expect(visiblePois('all', 'all', '', fac).some((p) => p.category === 'parking')).toBe(false);
    expect(visiblePois('all', 'all', '1A', fac)[0].id).toBe(901);
  });
});

describe('parking', () => {
  it('13 lots with A/B levels between facility pairs', () => {
    expect(PARKING).toHaveLength(13);
    expect(lotLabel(P(905))).toBe('P5');
    expect(levels(P(905))).toEqual(['5A', '5B']);
    expect(between(P(901))).toEqual(['201/202', '203/204']);
    for (const p of PARKING) expect(between(p), String(p.id)).not.toBeNull();
  });
});

describe('nearby', () => {
  it('nearest outer gate and street side', () => {
    const g = nearestOuterGate(P(215))!;
    expect(g.poi.subCategory).toBe('gate_outer');
    expect(g.poi.id).toBe(321);
    expect(nearestOuterGate(P(301))).toBeNull();
  });
});

describe('weather', () => {
  it('maps WMO codes to the skies we show', async () => {
    const { skyOf } = await import('../../src/domain/weather');
    expect([0, 1, 3, 45, 61, 81, 95].map(skyOf)).toEqual(['clear', 'cloudy', 'cloudy', 'fog', 'rain', 'rain', 'storm']);
  });

  it('reads the Open-Meteo "current" block and rejects anything else', async () => {
    const { parseWeather } = await import('../../src/domain/weather');
    expect(parseWeather({ current: { temperature_2m: 33.6, weather_code: 0, is_day: 0 } }, 5)).toEqual({ temp: 34, sky: 'clear', day: false, at: 5 });
    expect(parseWeather({ error: true })).toBeNull();
    expect(parseWeather(null)).toBeNull();
  });
});
