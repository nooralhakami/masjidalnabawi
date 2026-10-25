import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data/types';
import { HINT_HOLD_MS, HINT_MAX_ACCURACY_M, HintPicker, isTapName } from '../../src/domain/route-hint';

const P = (id: number) => POI_BY_ID.get(id)!;
const at = (id: number, dNorthM = 0, dEastM = 0): LatLng => [P(id).lat + dNorthM / 111_320, P(id).lng + dEastM / (111_320 * Math.cos((P(id).lat * Math.PI) / 180))];

describe('the name shown over the place a visitor goes by (owner, 2026-10-25)', () => {
  it('on foot: the gate or restroom block they are by; nothing when none is close', () => {
    const h = new HintPicker();
    expect(h.pick(at(338, 5), 10, 'walk', 0)).toBe(338);
    expect(new HintPicker().pick(at(339, 3, 3), 10, 'walk', 0)).toBe(339);
    expect(new HintPicker().pick(at(338, 300), 10, 'walk', 0)).toBeNull();
  });

  it('a poor or missing position names nothing: a wrong neighbour would mislead', () => {
    const h = new HintPicker();
    expect(h.pick(at(338), HINT_MAX_ACCURACY_M + 1, 'walk', 0)).toBeNull();
    expect(h.pick(null, 5, 'walk', 0)).toBeNull();
    expect(h.pick(at(338), HINT_MAX_ACCURACY_M, 'walk', 0)).toBe(338);
  });

  it('keeps the same name while the visitor is by it, then names the next once the first is left behind', () => {
    const h = new HintPicker();
    expect(h.pick(at(338, 0, 4), 10, 'walk', 0)).toBe(338);
    expect(h.pick(at(338, 0, 20), 10, 'walk', 1000)).toBe(338);
    // About 31 m from each (the gates are 62 m apart): still the first, never a jump to the other.
    expect(h.pick(at(338, 0, 30), 10, 'walk', 2000)).toBe(338);
    // Past it (and not yet by 339): the first is let go, never kept from afar.
    expect(h.pick(at(338, 0, 36), 10, 'walk', 3000)).not.toBe(338);
    expect(h.pick(at(339, 0, -10), 10, 'walk', 4000)).toBe(339);
  });

  it('two places a few metres apart: the first stays until the visitor is clearly nearer the second and its time has passed', () => {
    // Gates 22 and 23 m from each other (7↔8, 8↔9): never a flicker on every reading.
    const mid = (a: number, b: number, t: number): LatLng => [P(a).lat + (P(b).lat - P(a).lat) * t, P(a).lng + (P(b).lng - P(a).lng) * t];
    const h = new HintPicker();
    expect(h.pick(mid(7, 8, 0.1), 10, 'walk', 0)).toBe(7);
    expect(h.pick(mid(7, 8, 0.6), 10, 'walk', 1000)).toBe(7); // nearer 8, but only 4 m gain and too soon
    expect(h.pick(mid(7, 8, 0.95), 10, 'walk', 1500)).toBe(7); // clearly by 8, too soon
    expect(h.pick(mid(7, 8, 0.95), 10, 'walk', HINT_HOLD_MS + 100)).toBe(8);
  });

  it('when the one named is left behind, the next is named at once, or none', () => {
    const h = new HintPicker();
    expect(h.pick(at(338, 0, 2), 10, 'walk', 0)).toBe(338);
    expect(h.pick(at(339, 0, 2), 10, 'walk', 10)).toBe(339);
    expect(h.pick(at(339, 200), 10, 'walk', 20)).toBeNull();
  });

  it('by car: the car park they pass, not a gate', () => {
    const lot = P(901);
    expect(new HintPicker().pick(at(901), 10, 'drive', 0)).toBe(lot.id);
    expect(new HintPicker().pick(at(338, 150), 10, 'drive', 0)).toBeNull();
  });

  it('a tap names gates and restroom blocks only, never the hidden wheelchair areas', () => {
    expect(isTapName(P(338))).toBe(true);
    expect(isTapName(P(1))).toBe(true);
    expect(isTapName(P(201))).toBe(true);
    expect(isTapName(P(401))).toBe(false);
    expect(isTapName(P(901))).toBe(false);
    expect(isTapName(P(551))).toBe(false);
  });
});
