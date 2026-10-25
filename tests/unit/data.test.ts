import { describe, expect, it } from 'vitest';
import rawPois from '../../data/pois.json';
import { POIS, POI_BY_ID, RULES, ROUTING, I18N } from '../../src/data';
import { applyOverrides } from '../../src/data/overrides';
import type { Poi } from '../../src/data';

const count = (pred: (p: Poi) => boolean) => POIS.filter(pred).length;
const ids = (pred: (p: Poi) => boolean) =>
  POIS.filter(pred)
    .map((p) => p.id)
    .sort((a, b) => a - b);
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
    for (const lang of [
      'en',
      'tr',
      'ur',
      'id',
      'uz',
      'bn',
      'fr',
      'fa',
      'ru',
      'ms',
      'ha',
      'ml',
      'sw',
      'ps',
      'so',
      'ta',
      'hi',
      'bs',
      'de',
      'zh',
      'am',
      'ku',
      'az',
      'th',
      'es',
    ] as const) {
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
  it('has 324 POIs with unique ids (police stations at Gates 2 and 34, 523–524, removed by the owner 2026-10-10)', () => {
    expect(POIS).toHaveLength(324);
    expect(POI_BY_ID.has(523)).toBe(false);
    expect(POI_BY_ID.has(524)).toBe(false);
    expect(POI_BY_ID.size).toBe(324);
    expect(POI_BY_ID.has(409)).toBe(false);
    expect(POI_BY_ID.has(410)).toBe(false);
    expect(POI_BY_ID.get(604)?.category).toBe('landmarks');
  });

  it.each([
    ['gates', 112],
    ['toilets', 40],
    ['parking', 13],
    ['landmarks', 38],
    ['wheelchair', 8],
    ['emergency', 9],
    ['women', 2],
    ['hotels', 43],
    ['food', 44],
    ['shopping', 15],
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
    // The women enter 201's upper floor, not 202's (owner, 2026-10-25).
    expect(ids((p) => p.subCategory === 'toilet_mixed')).toEqual([201, 210, 221]);
    expect(ids((p) => p.subCategory === 'toilet_elderly')).toEqual([204]);
    expect(count((p) => p.subCategory === 'toilet_accessible')).toBe(0);
  });

  it('west plaza restrooms pair too: men 251↔252, women 253↔254, each pair with its number (owner, 2026-10-11)', () => {
    for (const [a, b, no, gender] of [
      [251, 252, 251, 'men'],
      [253, 254, 252, 'women'],
    ] as const) {
      for (const [id, other] of [
        [a, b],
        [b, a],
      ]) {
        const p = POI_BY_ID.get(id)!;
        expect(p.pairWith, `pair of ${id}`).toBe(other);
        expect(p.pairNo, `number of ${id}`).toBe(no);
        expect(p.gender).toBe(gender);
      }
    }
  });

  it('toilet facilities 201–236 pair up (201↔202 … 235↔236)', () => {
    for (let id = 201; id <= 235; id += 2) {
      expect(POI_BY_ID.get(id)?.pairWith, `pair of ${id}`).toBe(id + 1);
      expect(POI_BY_ID.get(id + 1)?.pairWith, `pair of ${id + 1}`).toBe(id);
    }
  });

  it('parking 1–13, each searchable by its levels and P-number; 12 and 13 on level B only (owner, 2026-10-25)', () => {
    const parking = POIS.filter((p) => p.category === 'parking');
    expect(parking.map((p) => p.subCategory)).toEqual(Array(13).fill('parking'));
    parking.forEach((p, i) => {
      const n = i + 1;
      const one = n === 12 || n === 13;
      expect(p.levels).toEqual(one ? ['B'] : undefined);
      expect(p.alias!.split(' ').includes(`${n}A`), `${n}A`).toBe(!one);
      expect(p.alias).toContain(`${n}B`);
      expect(p.alias).toContain(`P${n}`);
      expect(p.description_ar.includes('بدورين'), `P${n}`).toBe(!one);
    });
  });

  it('key services: health, police, lost children, lost & found, child care and service centres', () => {
    const by = (s: string) => POIS.filter((p) => p.category === 'emergency' && p.subCategory === s).map((p) => p.id);
    expect(by('health')).toEqual([501, 502]);
    expect(by('police')).toEqual([]); // 523 (Gate 2) and 524 (Gate 34) removed by the owner
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
      // Within about 5 km: the historic sites reach out to Quba, al-Qiblatain and Uhud.
      expect(Math.abs(p.lat - 24.468)).toBeLessThan(0.045);
      expect(Math.abs(p.lng - 39.611)).toBeLessThan(0.045);
    }
  });
});

describe('overrides', () => {
  it('only the owner-requested POIs are nudged (outer gates north 328–343, west 322–327, south 301–309 and 365–370; restrooms 205–209, 211–218 and north 220–230 (even); service buildings 501, 504–507; centres 511 and 604; women prayer halls 601–602); everything else is untouched', () => {
    const raw = rawPois as Poi[];
    const moved = (id: number) =>
      (id >= 322 && id <= 343) ||
      (id >= 301 && id <= 309) ||
      (id >= 365 && id <= 370) ||
      (id >= 205 && id <= 209) ||
      (id >= 211 && id <= 218) ||
      [220, 222, 224, 226, 228, 230].includes(id) ||
      id === 501 ||
      (id >= 504 && id <= 507) ||
      id === 511 ||
      id === 601 ||
      id === 602 ||
      id === 604;
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
    // West side (2026-10-10): 327 15 m north, 322–326 5 m north; restrooms 207–208 5 m west.
    expect(metres(327).north).toBeCloseTo(15, 5);
    for (const id of [322, 324, 326]) {
      expect(metres(id).north).toBeCloseTo(5, 5);
      expect(metres(id).east).toBeCloseTo(0, 5);
    }
    // Restrooms: 207–208 5 m then 12 m west (17 m in all), 205–206 4 m west.
    for (const id of [207, 208]) {
      expect(metres(id).east).toBeCloseTo(-17, 5);
      expect(metres(id).north).toBeCloseTo(0, 5);
    }
    for (const id of [205, 206]) expect(metres(id).east).toBeCloseTo(-4, 5);
    // 209 3 m east; 211–212 9 m south.
    expect(metres(209).east).toBeCloseTo(3, 5);
    expect(metres(209).north).toBeCloseTo(0, 5);
    for (const id of [211, 212]) {
      expect(metres(id).north).toBeCloseTo(-9, 5);
      expect(metres(id).east).toBeCloseTo(0, 5);
    }
    // 213–214 4 m south, 215–216 3 m north, 217–218 6 m north, north restrooms 220–230 (even) 4 m then 2 m north (6 m).
    const north: [number[], number][] = [
      [[213, 214], -4],
      [[215, 216], 3],
      [[217, 218], 6],
      [[220, 222, 224, 226, 228, 230], 6],
    ];
    for (const [group, m] of north) {
      for (const id of group) {
        expect(metres(id).north, String(id)).toBeCloseTo(m, 5);
        expect(metres(id).east, String(id)).toBeCloseTo(0, 5);
      }
    }
    // South services centre 7 m north; all southern outer gates 5 m north.
    expect(metres(511).north).toBeCloseTo(7, 5);
    // South service buildings (health centre, lost & found, services 1–2, Seerah exhibition): 8 m north.
    for (const id of [501, 504, 505, 506, 507]) {
      expect(metres(id).north).toBeCloseTo(8, 5);
      expect(metres(id).east).toBeCloseTo(0, 5);
    }
    for (const id of [301, 305, 309, 365, 370]) {
      expect(metres(id).north).toBeCloseTo(5, 5);
      expect(metres(id).east).toBeCloseTo(0, 5);
    }
  });

  it("each women's prayer-hall icon sits in the middle of its pink area (owner, 2026-10-10)", () => {
    const centre = (id: string) => {
      const poly = ROUTING.women_prayer_areas.find((a) => a.id === id)!.polygon;
      return [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
    };
    for (const [pid, area] of [
      [601, 'north-east'],
      [602, 'north-west'],
    ] as const) {
      const p = POI_BY_ID.get(pid)!;
      const [lat, lng] = centre(area);
      const metres = Math.hypot((p.lat - lat) * 111_320, (p.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180));
      expect(metres, String(pid)).toBeLessThan(0.5);
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

  it('twenty-six languages with identical UI keys', () => {
    const langs = Object.keys(I18N);
    expect(langs).toEqual([
      'ar',
      'en',
      'tr',
      'ur',
      'id',
      'uz',
      'bn',
      'fr',
      'fa',
      'ru',
      'ms',
      'ha',
      'ml',
      'sw',
      'ps',
      'so',
      'ta',
      'hi',
      'bs',
      'de',
      'zh',
      'am',
      'ku',
      'az',
      'th',
      'es',
    ]);
    // The interface texts themselves are checked in i18n.test.ts (src/i18n/locales, 2026-10-24).
    expect(Object.keys(I18N).sort()).toEqual([...langs].sort());
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

describe('hotels, food and landmarks (OpenStreetMap, 2026-10-09)', () => {
  const m = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 101_330);
  const of = (c: string) => POIS.filter((p) => p.category === c);

  it('every hotel and food place has a source (an OSM element, or Al Baik’s own branch list)', () => {
    for (const p of of('hotels')) {
      expect(p.osm, p.name_ar).toMatch(/^[nwr]\d+$/);
      expect(m(p, { lat: 24.4686, lng: 39.6111 }), p.name_ar).toBeLessThan(1500); // the central area
    }
    for (const p of of('food')) {
      expect(p.osm ?? p.source, p.name_ar).toBeTruthy();
      expect(m(p, { lat: 24.4686, lng: 39.6111 }), p.name_ar).toBeLessThan(6000); // within the street data's area
    }
  });

  it('no hotel is listed twice (towers and duplicate map entries collapse)', () => {
    const h = of('hotels');
    for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) expect(m(h[i], h[j]), `${h[i].name_ar} / ${h[j].name_ar}`).toBeGreaterThan(40);
    expect(new Set(h.map((p) => p.name_ar)).size).toBe(h.length);
  });

  it('the official landmarks are at their mapped positions (Al-Baqi’, the historic mosques, museums)', () => {
    for (const id of [508, 516, 517, 518, 520, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541]) {
      expect(POI_BY_ID.get(id)?.osm, String(id)).toMatch(/^[nwr]\d+$/);
    }
    expect(POI_BY_ID.get(531)!.name_ar).toBe('مقبرة بقيع الغرقد');
  });
});

describe('historic sites (confirmed, 2026-10-09)', () => {
  const hist = POIS.filter((p) => p.subCategory === 'historic');

  it('17 sites, each in OpenStreetMap; the new ones also confirmed by Wikidata', () => {
    expect(hist).toHaveLength(17);
    for (const p of hist) expect(p.osm ?? p.id, p.name_ar).toBeTruthy();
    for (let id = 542; id <= 550; id++) {
      const p = POI_BY_ID.get(id)!;
      expect(p.subCategory).toBe('historic');
      expect(p.wikidata, p.name_ar).toMatch(/^Q\d+$/);
      expect(p.osm, p.name_ar).toMatch(/^[nwr]\d+$/);
    }
  });

  it('Quba, al-Qiblatain, the Uhud martyrs, the archers’ hill, the Trench, al-Jumu’ah and the Well of Uthman are where they are', () => {
    const near = (id: number, lat: number, lng: number, m: number) =>
      expect(Math.hypot((POI_BY_ID.get(id)!.lat - lat) * 111_320, (POI_BY_ID.get(id)!.lng - lng) * 101_330), String(id)).toBeLessThan(m);
    near(542, 24.4392, 39.6172, 80); // Quba
    near(543, 24.4841, 39.5789, 60); // al-Qiblatain
    near(544, 24.5038, 39.6118, 80); // Uhud martyrs
    near(546, 24.5022, 39.6122, 80); // Jabal al-Rumat
    near(547, 24.4778, 39.5957, 80); // al-Fath (the Trench)
    near(548, 24.4455, 39.6155, 60); // al-Jumu'ah
    near(549, 24.4944, 39.5778, 120); // Well of Uthman
  });

  it('Abu Dharr (539) is not marked historic: its position is not confirmed', () => {
    expect(POI_BY_ID.get(539)!.subCategory).toBe('landmark');
  });
});

describe('chains, Al Baik branches and shopping (2026-10-09)', () => {
  const of = (c: string) => POIS.filter((p) => p.category === c);

  it('Al Baik: the central branch plus the official branches in the area (albaik.com), named by where they are', () => {
    const baik = of('food').filter((p) => p.name_ar.startsWith('البيك'));
    expect(baik.map((p) => p.name_ar).sort()).toEqual(['البيك', 'البيك – المنار مول', 'البيك – النور مول', 'البيك – برج طيبة', 'البيك – حسان مول']);
    for (const p of baik.filter((p) => p.name_ar !== 'البيك')) expect(p.source).toBe('albaik.com/branches');
  });

  it('every place has a unique name, and every chain branch says where it is', () => {
    const names = POIS.map((p) => p.name_ar);
    expect(new Set(names).size).toBe(names.length);
    for (const p of of('food').filter((p) => p.id > 826)) expect(p.name_ar, String(p.id)).toContain(' – ');
  });

  it('shopping: 10 malls, 4 hypermarkets and the central vegetable market, all from OSM', () => {
    const shop = of('shopping');
    expect(shop.filter((p) => p.subCategory === 'mall')).toHaveLength(10);
    expect(shop.filter((p) => p.subCategory === 'hypermarket')).toHaveLength(4);
    expect(shop.find((p) => p.subCategory === 'market')!.name_ar).toContain('الخضار');
    for (const p of shop) expect(p.osm, p.name_ar).toMatch(/^[nwr]\d+$/);
  });
});

describe('the car park lots (owner)', () => {
  it('lots 2, 6, 8, 10 and 13 are for subscribers (lot 13: 2026-10-14); the rest open to all', () => {
    const sub = POIS.filter((p) => p.category === 'parking' && p.access === 'subscribers').map((p) => p.id - 900);
    expect(sub.sort((a, b) => a - b)).toEqual([2, 6, 8, 10, 13]);
  });
});
