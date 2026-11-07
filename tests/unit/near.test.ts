import { describe, expect, it } from 'vitest';
import { POIS, POI_BY_ID } from '../../src/data';
import type { LatLng, Poi } from '../../src/data/types';
import { nearestByAir, nearPool, pickTwo, placeByNumber, TIE_M } from '../../src/domain/near';
import { nextPrayer, PRAYERS, prayersOn } from '../../src/domain/prayer';
import { stepMarks, type StepKind } from '../../src/presentation/route-view';
import { garageExit, garageRoute, LEVELS } from '../../src/routing/garage';
import { planFromLot } from '../../src/routing/plan';

const P = (id: number) => POI_BY_ID.get(id)!;
const open = () => true;
const at = (p: Poi): LatLng => [p.lat, p.lng];

describe('«near you now»: which places count', () => {
  it('restrooms for men are men’s and shared blocks only; for women, women’s and shared', () => {
    const men = nearPool('toilet', 'men', open);
    const women = nearPool('toilet', 'women', open);
    expect(men.length).toBeGreaterThan(10);
    expect(new Set(men.map((p) => p.subCategory))).toEqual(new Set(['toilet_men', 'toilet_mixed']));
    expect(new Set(women.map((p) => p.subCategory))).toEqual(new Set(['toilet_women', 'toilet_mixed']));
  });

  it('the step-free route adds the seniors’ block', () => {
    expect(nearPool('toilet', 'men', open, true).some((p) => p.subCategory === 'toilet_elderly')).toBe(true);
    expect(nearPool('toilet', 'men', open, false).some((p) => p.subCategory === 'toilet_elderly')).toBe(false);
  });

  it('gates are the numbered outer gates of the Haram', () => {
    const gates = nearPool('gate', 'men', open);
    expect(gates.length).toBe(POIS.filter((p) => p.subCategory === 'gate_outer').length);
    expect(gates.every((p) => p.subCategory === 'gate_outer')).toBe(true);
  });

  it('a closed facility is never offered', () => {
    const near = nearestByAir(at(P(205)), nearPool('toilet', 'men', open), 1)[0];
    const pool = nearPool('toilet', 'men', (id) => id !== near.id);
    expect(pool.some((p) => p.id === near.id)).toBe(false);
    expect(nearestByAir(at(P(205)), pool, 6).some((p) => p.id === near.id)).toBe(false);
  });

  it('the nearest in a straight line come first', () => {
    const from = at(P(205));
    const six = nearestByAir(from, nearPool('toilet', 'men', open), 6);
    expect(six).toHaveLength(6);
    expect(six[0].id).toBe(205);
  });
});

describe('«near you now»: two choices, spread', () => {
  const r = (id: number, meters: number) => ({ poi: P(id), meters });

  it('offers the nearest first when the second is clearly farther', () => {
    expect(pickTwo([r(205, 100), r(208, 300)], 0).map((x) => x.poi.id)).toEqual([205, 208]);
    expect(pickTwo([r(205, 100), r(208, 300)], 0.9).map((x) => x.poi.id)).toEqual([205, 208]);
  });

  it('never offers a block’s pair across the walkway as the second (same restrooms underground)', () => {
    expect(P(205).pairWith).toBe(206);
    expect(pickTwo([r(205, 100), r(206, 110), r(208, 400)], 0.9).map((x) => x.poi.id)).toEqual([205, 208]);
  });

  it('on a near tie, the coin decides which is first, so a crowd is split', () => {
    const near = [r(205, 100), r(208, 100 + TIE_M - 1)];
    expect(pickTwo(near, 0.2).map((x) => x.poi.id)).toEqual([208, 205]);
    expect(pickTwo(near, 0.7).map((x) => x.poi.id)).toEqual([205, 208]);
  });

  it('one choice, or none', () => {
    expect(pickTwo([r(205, 100)], 0)).toHaveLength(1);
    expect(pickTwo([], 0)).toEqual([]);
  });
});

describe('«where are you exactly?»: a number seen on site', () => {
  it('finds outer gates, mosque doors and restroom blocks by their number', () => {
    expect(placeByNumber(312)?.subCategory).toBe('gate_outer');
    expect(placeByNumber(21)?.subCategory).toBe('gate_inner');
    expect(placeByNumber(215)?.category).toBe('toilets');
  });
  it('nothing else (a lot is picked from its own list)', () => {
    expect(placeByNumber(901)).toBeUndefined();
    expect(placeByNumber(999)).toBeUndefined();
    expect(placeByNumber(Number.NaN)).toBeUndefined();
  });
});

describe('next prayer in Madinah', () => {
  const mad = (iso: string) => new Date(`${iso}+03:00`);
  const today = prayersOn(2026, 10, 7);

  it('the five are in order through the day', () => {
    const times = PRAYERS.map((p) => today[p].getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('after Dhuhr comes Asr, with the minutes left', () => {
    const now = new Date(today.dhuhr.getTime() + 60_000);
    const n = nextPrayer(now);
    expect(n.name).toBe('asr');
    expect(n.at.getTime()).toBe(today.asr.getTime());
    expect(n.minutesLeft).toBe(Math.ceil((today.asr.getTime() - now.getTime()) / 60_000));
  });

  it('after Isha it is tomorrow’s Fajr', () => {
    const n = nextPrayer(mad('2026-11-07T23:30:00'));
    expect(n.name).toBe('fajr');
    expect(n.at.getTime()).toBe(prayersOn(2026, 10, 8).fajr.getTime());
  });
});

describe('numbered steps underground', () => {
  const step = (kind: StepKind, ...path: LatLng[]) => ({ kind, path });
  // North then east is a right turn; north then west a left one (as the driver sees it).
  const o: LatLng = [24.47, 39.61];
  const n: LatLng = [24.4705, 39.61];
  const ne: LatLng = [24.4705, 39.6105];
  const nw: LatLng = [24.4705, 39.6095];

  it('no number where the visitor starts; «1» at the first turn, read as left or right', () => {
    expect(stepMarks([step('n', o, n), step('e', n, ne)])).toEqual([{ n: 1, at: n, turn: 'right' }]);
    expect(stepMarks([step('n', o, n), step('w', n, nw)])).toEqual([{ n: 1, at: n, turn: 'left' }]);
  });

  it('turning back, and the ramps up to A and down to B', () => {
    expect(stepMarks([step('n', o, n), step('s', n, o)])[0].turn).toBe('back');
    const marks = stepMarks([step('n', o, n), step('up', n, ne), step('down', ne, n)]);
    expect(marks.map((m) => m.turn)).toEqual(['up', 'down']);
    expect(marks.map((m) => m.n)).toEqual([1, 2]);
  });

  it('every way in and out of the car park gets numbered marks, a ramp step as «up» or «down»', () => {
    const lot = P(905);
    for (const level of LEVELS) {
      const way = garageRoute('omar', lot, level)!;
      const marks = stepMarks(way.steps);
      expect(marks.length, `omar → P5${level}`).toBeGreaterThan(0);
      expect(marks.map((m) => m.n)).toEqual(marks.map((_, i) => i + 1));
      expect(marks[marks.length - 1].turn).toBe('lot_in');
      expect(marks.filter((m) => m.turn === 'up').length).toBe(way.steps.filter((s) => s.kind === 'up').length);
      const out = stepMarks(garageExit(lot, 'omar', level)!.steps);
      // The way out starts in the lot: no «leave the lot» mark where the visitor already is.
      expect(out.some((m) => m.turn === 'lot_out')).toBe(false);
    }
  });

  it('counting goes on from a number given', () => {
    expect(stepMarks([step('n', o, n), step('e', n, ne)], 4)[0].n).toBe(4);
  });
});

describe('on foot from a lot underground', () => {
  it('across the lot to the stairs of a facility round it, then up and on to the place', () => {
    const lot = P(903);
    const to = P(212);
    const plan = planFromLot(lot, to)!;
    expect(plan.mode).toBe('walk');
    const [under, up] = plan.legs;
    expect(under.path[0]).toEqual(at(lot));
    expect(under.steps?.map((s) => s.kind)).toEqual(['stairs']);
    expect(stepMarks(under.steps!)).toEqual([{ n: 1, at: under.path[1], turn: 'stairs' }]);
    expect(up.path[0]).toEqual(under.path[1]);
    expect(plan.walkM).toBeGreaterThan(0);
  });
  it('none to a lot itself', () => {
    expect(planFromLot(P(903), P(904))).toBeNull();
  });
});
