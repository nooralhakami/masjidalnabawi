import { describe, expect, it } from 'vitest';
import rawPois from '../../data/pois.json';
import { POIS, POI_BY_ID, RULES, ROUTING, I18N } from '../../src/data';
import { applyOverrides } from '../../src/data/overrides';
import type { Poi } from '../../src/data';

const count = (pred: (p: Poi) => boolean) => POIS.filter(pred).length;
const ids = (pred: (p: Poi) => boolean) => POIS.filter(pred).map((p) => p.id).sort((a, b) => a - b);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('inner gate names and descriptions', () => {
  const named = [1, 2, 3, 4, 5, 8, 11, 13, 17, 19, 21, 23, 25, 29, 32, 34, 37, 38, 39, 40, 41, 42];
  it('uses the approved Arabic names and non-empty descriptions', () => {
    for (const id of named) {
      const p = POI_BY_ID.get(id)!;
      expect(p.subCategory).toBe('gate_inner');
      expect(p.name_ar).toContain(`- رقم ${id}`);
      expect(p.description_ar.trim()).not.toBe('');
    }
    expect(POI_BY_ID.get(10)?.name_ar).toBe('باب رقم 10');
    expect(POI_BY_ID.get(37)?.rawdah).toBe(true);
  });
  it('has translated names and descriptions for every named gate', () => {
    for (const lang of ['en', 'tr', 'ur', 'id', 'uz'] as const) {
      for (const id of named) {
        const p = POI_BY_ID.get(id)!;
        expect(I18N[lang].gi?.[id]).toBeTruthy();
        expect(I18N[lang].descs?.[p.name_ar]).toBeTruthy();
      }
      expect(I18N[lang].gi?.[10]).toBeUndefined();
    }
  });
});

describe('pois.json', () => {
  it('has 213 POIs with unique ids (accessible restrooms 409/410 removed, landmark 604 added)', () => {
    expect(POIS).toHaveLength(213);
    expect(POI_BY_ID.size).toBe(213);
    expect(POI_BY_ID.has(409)).toBe(false);
    expect(POI_BY_ID.has(410)).toBe(false);
    expect(POI_BY_ID.get(604)?.category).toBe('landmarks');
  });

  it.each([
    ['gates', 112],
    ['toilets', 36],
    ['parking', 13],
    ['landmarks', 20],
    ['wheelchair', 8],
    ['emergency', 2],
    ['women', 2],
    ['hotels', 8],
    ['food', 12],
  ] as const)('category %s has %i POIs', (cat, n) => {
    expect(count((p) => p.category === cat)).toBe(n);
  });

  it('gates: 70 outer (301–370) and 42 inner (1–42)', () => {
    expect(ids((p) => p.subCategory === 'gate_outer')).toEqual(range(301, 370));
    expect(ids((p) => p.subCategory === 'gate_inner')).toEqual(range(1, 42));
  });

  it('toilets split by subCategory', () => {
    expect(count((p) => p.subCategory === 'toilet_men')).toBe(20);
    expect(count((p) => p.subCategory === 'toilet_women')).toBe(12);
    expect(ids((p) => p.subCategory === 'toilet_mixed')).toEqual([202, 210, 221]);
    expect(ids((p) => p.subCategory === 'toilet_elderly')).toEqual([204]);
    expect(count((p) => p.subCategory === 'toilet_accessible')).toBe(0);
  });

  it('toilet facilities 201–236 pair up (201↔202 … 235↔236)', () => {
    for (let id = 201; id <= 235; id += 2) {
      expect(POI_BY_ID.get(id)?.pairWith, `pair of ${id}`).toBe(id + 1);
      expect(POI_BY_ID.get(id + 1)?.pairWith, `pair of ${id + 1}`).toBe(id);
    }
  });

  it('parking 1–13, each searchable by A/B level and P-number', () => {
    const parking = POIS.filter((p) => p.category === 'parking');
    expect(parking.map((p) => p.subCategory)).toEqual(Array(13).fill('parking'));
    parking.forEach((p, i) => {
      const n = i + 1;
      expect(p.alias).toContain(`${n}A`);
      expect(p.alias).toContain(`${n}B`);
      expect(p.alias).toContain(`P${n}`);
    });
  });

  it('emergency POIs are landmark subCategory (health centres)', () => {
    expect(POIS.filter((p) => p.category === 'emergency').every((p) => p.subCategory === 'landmark')).toBe(true);
  });

  it('every POI has a direction and coordinates near the mosque', () => {
    for (const p of POIS) {
      expect(['south', 'west', 'north', 'east']).toContain(p.direction);
      expect(Math.abs(p.lat - 24.468)).toBeLessThan(0.02);
      expect(Math.abs(p.lng - 39.611)).toBeLessThan(0.02);
    }
  });
});

describe('overrides', () => {
  it('overrides.json is empty by default, so coordinates are untouched', () => {
    const raw = rawPois as Poi[];
    POIS.forEach((p, i) => {
      expect(p.lat).toBe(raw[i].lat);
      expect(p.lng).toBe(raw[i].lng);
    });
  });

  it('shifts a POI by metres north/east', () => {
    const p = POI_BY_ID.get(332)!;
    const [moved] = applyOverrides([p], { '332': { north: -7, east: 7 } });
    expect((moved.lat - p.lat) * 111_320).toBeCloseTo(-7, 6);
    expect((moved.lng - p.lng) * 111_320 * Math.cos((p.lat * Math.PI) / 180)).toBeCloseTo(7, 6);
    expect(p.lat).toBe(POI_BY_ID.get(332)!.lat); // original untouched
  });
});

describe('supporting data', () => {
  it('rules reference existing toilets', () => {
    const r = RULES.rules;
    for (const id of [...r.WOMEN, ...r.MIXED, ...r.ELDERLY, ...r.ELEV_SOON, ...r.ELEV_WOMEN]) {
      expect(POI_BY_ID.get(id)?.category, `rule id ${id}`).toBe('toilets');
    }
    for (const [a, b] of Object.entries(r.WORKS_PAIR)) {
      expect(r.WORKS_PAIR[String(b)]).toBe(Number(a));
    }
    expect(POI_BY_ID.get(r.rawdah.gate)?.rawdah).toBe(true);
  });

  it('routing has a closed walkway ring and two obstacles', () => {
    expect(ROUTING.walkway_ring.length).toBeGreaterThanOrEqual(4);
    expect(ROUTING.obstacles.mosque_building).toHaveLength(4);
    expect(ROUTING.obstacles.baqi_outside_haram).toHaveLength(4);
  });

  it('six languages with identical UI keys', () => {
    const langs = Object.keys(I18N);
    expect(langs).toEqual(['ar', 'en', 'tr', 'ur', 'id', 'uz']);
    const keys = Object.keys(I18N.ar.ui).sort();
    for (const l of langs) expect(Object.keys(I18N[l as keyof typeof I18N].ui).sort()).toEqual(keys);
  });
});

describe('data integrity', () => {
  it('no damaged characters (U+FFFD) in any data file', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['pois', 'i18n', 'routing', 'rules', 'overrides']) {
      const text = readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8');
      expect(text.includes('�'), `${f}.json`).toBe(false);
    }
  });
});
