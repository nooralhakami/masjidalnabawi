import { describe, expect, it } from 'vitest';
import type { XY } from '../../src/domain/frames';
import {
  DOOR_REVEAL_INSET_M,
  DOOR_REVEAL_RADIUS_M,
  insideMosqueMetres,
  interiorReveal,
  LANE_REVEAL_HALF_M,
  MAX_REVEAL_LANES,
  REVEAL_LEGACY_ZOOM,
  revealedAt,
} from '../../src/domain/interior-reveal';
import { getGateDoorState } from '../../src/domain/mosque-doors';
import { MOSQUE_MAIN } from '../../src/domain/prayer-layout';
import { revealRoleOf } from '../../src/map/glb-layer';

const gate7 = getGateDoorState(7)!;
const door = { x: gate7.x, z: gate7.y, outward: gate7.outward };
const centre: XY = [MOSQUE_MAIN[0], MOSQUE_MAIN[1]];
const CLOSE = REVEAL_LEGACY_ZOOM[1] + 0.2;

describe('the Mosque is seen from outside by default (owner, 2026-11-18)', () => {
  it('shows no interior with nothing tapped and no route, however close', () => {
    const r = interiorReveal({ legacyZoom: 21, door: null, routes: [], centre });
    expect(r.discs).toEqual([]);
    expect(r.lanes).toEqual([]);
    expect(r.share).toBe(0);
  });

  it('keeps the roof shut over a tapped gate until the map is zoomed in, then lifts it gradually', () => {
    expect(interiorReveal({ legacyZoom: REVEAL_LEGACY_ZOOM[0] - 0.1, door, routes: [], centre }).discs).toEqual([]);
    const half = interiorReveal({ legacyZoom: (REVEAL_LEGACY_ZOOM[0] + REVEAL_LEGACY_ZOOM[1]) / 2, door, routes: [], centre });
    const full = interiorReveal({ legacyZoom: CLOSE, door, routes: [], centre });
    expect(half.discs[0][2]).toBeGreaterThan(0);
    expect(half.discs[0][2]).toBeLessThan(full.discs[0][2]);
    expect(full.discs[0][2]).toBe(DOOR_REVEAL_RADIUS_M);
  });
});

describe('a tapped gate, zoomed in', () => {
  const r = interiorReveal({ legacyZoom: CLOSE, door, routes: [], centre });
  it('lifts the roof over the bays just inside the gate, not over the plaza outside it', () => {
    const [x, z] = r.discs[0];
    expect(Math.hypot(x - door.x, z - door.z)).toBeCloseTo(DOOR_REVEAL_INSET_M, 6);
    expect(insideMosqueMetres([x, z])).toBe(true);
    // Gate 7 is on the west wall: the disc's centre is east of it, inside.
    expect(x).toBeGreaterThan(door.x);
    expect(revealedAt(r, [door.x - door.outward[0] * 5, door.z])).toBe(true);
    expect(revealedAt(r, [door.x + door.outward[0] * 40, door.z])).toBe(false);
  });
});

describe('a route that walks inside the Mosque, zoomed in', () => {
  const g = getGateDoorState(21)!;
  const outside: XY = [g.x, g.y - 30];
  const route: XY[] = [outside, [g.x, g.y + 6], [g.x, g.y + 60], [g.x + 50, g.y + 60]];

  it('lifts the roof along the stretches under it, and only there', () => {
    const r = interiorReveal({ legacyZoom: CLOSE, door: null, routes: [route], centre: route[2] });
    expect(r.lanes.length).toBe(3);
    expect(r.laneHalf).toBe(LANE_REVEAL_HALF_M);
    for (const [ax, az, bx, bz] of r.lanes) {
      expect(insideMosqueMetres([ax, az])).toBe(true);
      expect(insideMosqueMetres([bx, bz])).toBe(true);
    }
    expect(revealedAt(r, [g.x + 3, g.y + 40])).toBe(true);
    expect(revealedAt(r, outside)).toBe(false);
  });

  it('lifts at most a few stretches, the nearest to the view', () => {
    const zigzag: XY[] = Array.from({ length: 40 }, (_, i): XY => [centre[0] + (i % 2) * 20, centre[1] - 100 + i * 5]);
    const r = interiorReveal({ legacyZoom: CLOSE, door: null, routes: [zigzag], centre });
    expect(r.lanes.length).toBe(MAX_REVEAL_LANES);
    const far = interiorReveal({ legacyZoom: CLOSE, door: null, routes: [zigzag], centre: [centre[0], centre[1] + 200] });
    expect(far.lanes).not.toEqual(r.lanes);
  });

  it('shows nothing for a route that stays in the plazas', () => {
    const plaza: XY[] = [
      [MOSQUE_MAIN[0] - MOSQUE_MAIN[2] - 60, MOSQUE_MAIN[1]],
      [MOSQUE_MAIN[0] - MOSQUE_MAIN[2] - 20, MOSQUE_MAIN[1] + 40],
    ];
    expect(interiorReveal({ legacyZoom: CLOSE, door: null, routes: [plaza], centre }).lanes).toEqual([]);
  });
});

describe('what the lifted roof takes away', () => {
  it('never the minarets, the Green Dome, the canopies or the interior’s own props; the roof; above it, the rest', () => {
    expect(revealRoleOf('keep', false)).toBe(0);
    expect(revealRoleOf('roof', true)).toBe(0);
    expect(revealRoleOf('wall', true)).toBe(0);
    expect(revealRoleOf('roof', false)).toBe(1);
    expect(revealRoleOf('wall', false)).toBe(2);
  });
});
