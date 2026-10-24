import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';

// What the data files must hold to be usable, checked by content (owner, 2026-10-24). This replaces
// the byte-for-byte hashes of data/ against the old live app: those only said that a file changed,
// never what was wrong, and every approved change had to update them. Content rules for the places,
// gates, languages and library stay in data.test.ts and library.test.ts; behaviour in parity.test.ts.

const read = <T>(file: string): T => JSON.parse(readFileSync(join(__dirname, '../../data', file), 'utf-8')) as T;
type LatLng = [number, number];

/** Madinah and its approaches (Quba, Uhud, the car parks): every coordinate in data/ falls inside. */
const BOX = { south: 24.4, north: 24.53, west: 39.55, east: 39.66 };
const inMadinah = ([lat, lng]: LatLng) => lat >= BOX.south && lat <= BOX.north && lng >= BOX.west && lng <= BOX.east;

/** Every [lat, lng] pair anywhere in a value (a pair: two numbers, the first a latitude near 24). */
function coordinates(value: unknown, out: LatLng[] = []): LatLng[] {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((n) => typeof n === 'number') && value[0] > 20 && value[0] < 30) out.push(value as LatLng);
    else for (const v of value) coordinates(v, out);
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) coordinates(v, out);
  return out;
}

describe('every coordinate in data/ is in Madinah', () => {
  for (const file of ['pois.json', 'garage.json', 'routing.json', 'overrides.json', 'rules.json']) {
    it(file, () => {
      const pts = coordinates(read(file));
      const outside = pts.filter((p) => !inMadinah(p));
      expect(outside, `${outside.length} of ${pts.length} outside`).toEqual([]);
    });
  }
});

describe('streets.json (generated from OpenStreetMap)', () => {
  const s = read<{ bbox: number[]; nodes: LatLng[]; ways: number[][]; restrictions: number[][]; parking_entrances: LatLng[] }>('streets.json');

  it('every node lies near the extract’s box (a way that crosses it keeps its far end, up to ~10 km out)', () => {
    const [south, west, north, east] = s.bbox;
    const m = 0.1;
    expect(s.nodes.length).toBeGreaterThan(10_000);
    expect(s.nodes.filter(([lat, lng]) => lat < south - m || lat > north + m || lng < west - m || lng > east + m)).toEqual([]);
  });

  it('every way is [mode, oneway, ...at least two nodes that exist]', () => {
    const bad = s.ways.filter(([mode, oneway, ...ids]) => !Number.isInteger(mode) || ![-1, 0, 1].includes(oneway) || ids.length < 2 || ids.some((i) => !Number.isInteger(i) || i < 0 || i >= s.nodes.length));
    expect(bad.length, JSON.stringify(bad[0])).toBe(0);
  });

  it('every turn restriction names three nodes that exist, and a kind (0 no turn, 1 only this turn)', () => {
    for (const [from, via, to, kind] of s.restrictions) {
      for (const i of [from, via, to]) expect(i >= 0 && i < s.nodes.length).toBe(true);
      expect([0, 1]).toContain(kind);
    }
  });
});

describe('garage.json (generated from the owner’s drawing)', () => {
  type Lane = { id: string; path: LatLng[] };
  type End = { id: string; lane: string };
  type Side = { entry_lane: string; exit_lane: string };
  const g = read<{ lanes: Lane[]; entrances: End[]; exits: End[]; lots: (Side & { id: number; levels?: Record<string, Side> })[] }>('garage.json');
  const lanes = new Set(g.lanes.map((l) => l.id));

  it('lane ids are unique and each lane is a line of at least two points', () => {
    expect(lanes.size).toBe(g.lanes.length);
    expect(g.lanes.filter((l) => l.path.length < 2).map((l) => l.id)).toEqual([]);
  });

  it('the three entrances and exits (Omar ibn al-Khattab street, Sultana, Qurban) start on lanes that exist', () => {
    for (const ends of [g.entrances, g.exits]) {
      expect(ends.map((e) => e.id).sort()).toEqual(['omar', 'qurban', 'sultana']);
      for (const e of ends) expect(lanes.has(e.lane), `${e.id}: ${e.lane}`).toBe(true);
    }
  });

  it('the 13 lots are car park places, and their ways in and out are lanes that exist', () => {
    expect(g.lots.map((l) => l.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => 901 + i));
    for (const lot of g.lots) {
      expect(POI_BY_ID.get(lot.id)?.category, `${lot.id}`).toBe('parking');
      for (const side of [lot, ...Object.values(lot.levels ?? {})]) {
        expect(lanes.has(side.entry_lane), `${lot.id} in: ${side.entry_lane}`).toBe(true);
        expect(lanes.has(side.exit_lane), `${lot.id} out: ${side.exit_lane}`).toBe(true);
      }
    }
  });
});

describe('visits.json (the landmark stories)', () => {
  const v = read<{ sites: { id: number; slides: { ar: string }[] }[] }>('visits.json');
  it('nine sites, each a place on the map, each with slides that have Arabic text', () => {
    expect(v.sites).toHaveLength(9);
    for (const s of v.sites) {
      expect(POI_BY_ID.has(s.id), `${s.id}`).toBe(true);
      expect(s.slides.length).toBeGreaterThan(0);
      for (const slide of s.slides) expect(slide.ar.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('routing.json (walkways and areas round the mosque)', () => {
  const r = read<{ women_prayer_areas: { polygon: LatLng[] }[]; walkway_ring: LatLng[] }>('routing.json');
  it('the walkway ring and each women’s prayer area are real shapes (three points or more)', () => {
    expect(r.walkway_ring.length).toBeGreaterThanOrEqual(3);
    for (const a of r.women_prayer_areas) expect(a.polygon.length).toBeGreaterThanOrEqual(3);
  });
});
