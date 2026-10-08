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
  it('has 223 POIs with unique ids (restrooms 251–254 and key services 521–527 added 2026-10-08)', () => {
    expect(POIS).toHaveLength(223);
    expect(POI_BY_ID.size).toBe(223);
    expect(POI_BY_ID.has(409)).toBe(false);
    expect(POI_BY_ID.has(410)).toBe(false);
    expect(POI_BY_ID.get(604)?.category).toBe('landmarks');
  });

  it.each([
    ['gates', 112],
    ['toilets', 40],
    ['parking', 13],
    ['landmarks', 18],
    ['wheelchair', 8],
    ['emergency', 11],
    ['women', 2],
    ['hotels', 7],
    ['food', 12],
  ] as const)('category %s has %i POIs', (cat, n) => {
    expect(count((p) => p.category === cat)).toBe(n);
  });

  it('gates: 70 outer (301–370) and 42 inner (1–42)', () => {
    expect(ids((p) => p.subCategory === 'gate_outer')).toEqual(range(301, 370));
    expect(ids((p) => p.subCategory === 'gate_inner')).toEqual(range(1, 42));
  });

  it('toilets split by subCategory', () => {
    expect(count((p) => p.subCategory === 'toilet_men')).toBe(22);
    expect(count((p) => p.subCategory === 'toilet_women')).toBe(14);
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

  it('key services: health, police, lost children, lost & found, child care and service centres', () => {
    const by = (s: string) => POIS.filter((p) => p.category === 'emergency' && p.subCategory === s).map((p) => p.id);
    expect(by('health')).toEqual([501, 502]);
    expect(by('police')).toEqual([523, 524]);
    expect(by('lost_children')).toEqual([503]);
    expect(by('lost_found').sort()).toEqual([504, 521, 522]);
    expect(by('child_care')).toEqual([526]);
    expect(by('service').sort()).toEqual([525, 527]);
  });

  it('restrooms 251–254: at the west edge of the west plaza, numbered south to north; 251–252 men, 253–254 women', () => {
    const r = [251, 252, 253, 254].map((id) => POI_BY_ID.get(id)!);
    expect(r.map((p) => p.subCategory)).toEqual(['toilet_men', 'toilet_men', 'toilet_women', 'toilet_women']);
    for (let i = 1; i < r.length; i++) expect(r[i].lat).toBeGreaterThan(r[i - 1].lat);
    // The far (west) edge of the plaza: well west of the west gates 318–320.
    const gate = POI_BY_ID.get(318)!;
    for (const p of r) expect((gate.lng - p.lng) * 101_330).toBeGreaterThan(200);
    expect(RULES.rules.WOMEN).toEqual(expect.arrayContaining([253, 254]));
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
  it('only the owner-requested north outer gates (328–343) and the women entrance 604 are nudged; everything else is untouched', () => {
    const raw = rawPois as Poi[];
    const moved = (id: number) => (id >= 328 && id <= 343) || id === 604;
    POIS.forEach((p, i) => {
      if (moved(p.id)) return;
      expect(p.lat).toBe(raw[i].lat);
      expect(p.lng).toBe(raw[i].lng);
    });
    const metres = (id: number) => {
      const p = POI_BY_ID.get(id)!;
      const r = raw.find((x) => x.id === id)!;
      return { north: (p.lat - r.lat) * 111_320, east: (p.lng - r.lng) * 111_320 * Math.cos((r.lat * Math.PI) / 180) };
    };
    // The middle group 332–336: 3 m south and 12 m east; the rest of the north side: 18 m north.
    for (const id of [332, 334, 336]) {
      expect(metres(id).north).toBeCloseTo(-3, 5);
      expect(metres(id).east).toBeCloseTo(12, 5);
    }
    // 604 shared Gate 21's exact point and hid it: it now sits 15 m north, facing the gate.
    expect(metres(604).north).toBeCloseTo(15, 5);
    expect(POI_BY_ID.get(21)!.lat).toBe(raw.find((x) => x.id === 21)!.lat);
    for (const id of [328, 331, 337, 343]) {
      expect(metres(id).north).toBeCloseTo(18, 5);
      expect(metres(id).east).toBeCloseTo(0, 5);
    }
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
