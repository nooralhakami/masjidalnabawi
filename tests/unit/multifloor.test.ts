import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data/types';
import { FLOOR_BY_ID } from '../../src/data-next/floors';
import { ACCESSIBLE_VERTICAL_EDGES, VERTICAL_EDGES } from '../../src/data-next/vertical-edges';
import { VERTICAL_NODES } from '../../src/data-next/vertical-nodes';
import { type MFLevel, multifloorLinks, multifloorRoute } from '../../src/routing/multifloor';
import { planRoutes } from '../../src/routing/plan';

const NODE = new Map(VERTICAL_NODES.map((n) => [n.id, n]));
const at = (id: number): LatLng => {
  const n = NODE.get(id)!;
  return [n.lat, n.lng];
};
const levelOf = (floorId: number): MFLevel => FLOOR_BY_ID.get(floorId)!.level as MFLevel;

describe('the multi-floor walking graph (Phase 1, plan §4.2)', () => {
  it('composes all 46 verified links; accessible mode keeps the 8 lifts only', () => {
    expect(multifloorLinks(false)).toHaveLength(46);
    const acc = multifloorLinks(true);
    expect(acc).toHaveLength(8);
    expect(acc.every((e) => e.type === 'elevator')).toBe(true);
    expect([...acc]).toEqual([...ACCESSIBLE_VERTICAL_EDGES]);
  });

  // Acceptance: a test for every vertical edge — each recovered link is actually crossed by a route.
  it.each(VERTICAL_EDGES.map((e) => [e.a, e.b, e] as const))('crosses verified link %i→%i', (a, b, edge) => {
    const route = multifloorRoute(at(a), at(b), { fromLevel: levelOf(edge.fromFloor), toLevel: levelOf(edge.toFloor) });
    expect(route).not.toBeNull();
    expect(route!.links).toHaveLength(1);
    expect(route!.links[0].a).toBe(a);
    expect(route!.links[0].b).toBe(b);
    expect(route!.levels[0]).toBe(levelOf(edge.fromFloor));
    expect(route!.levels[route!.levels.length - 1]).toBe(levelOf(edge.toFloor));
    expect(route!.meters).toBeCloseTo(edge.meters, 1);
  });

  it('GF→ROF by the Mosque lift 4703↔4705', () => {
    const r = multifloorRoute(at(4703), at(4705), { toLevel: 1 })!;
    expect(r.links.map((l) => [l.a, l.b])).toEqual([[4703, 4705]]);
    expect(r.levels[r.levels.length - 1]).toBe(1);
  });

  it('B1→B2 by the car-park lift 5150↔4954', () => {
    const r = multifloorRoute(at(5150), at(4954), { fromLevel: -1, toLevel: -2 })!;
    // The link is stored lower floor first: B2 (4954) → B1 (5150); the route walks it downwards.
    expect(r.links.map((l) => [l.a, l.b])).toEqual([[4954, 5150]]);
    expect(r.levels).toEqual([-1, -2, -2]);
  });

  it('accessible mode uses lifts only on every floor change', () => {
    const gf = multifloorRoute(at(4703), at(4705), { toLevel: 1, accessible: true })!;
    const basement = multifloorRoute(at(5150), at(4954), { fromLevel: -1, toLevel: -2, accessible: true })!;
    for (const r of [gf, basement]) {
      expect(r.links.length).toBeGreaterThan(0);
      expect(r.links.every((l) => l.type === 'elevator')).toBe(true);
    }
  });

  it('accessible mode refuses an escalator-only roof landing — no invented ramp', () => {
    const roofEscalator = at(4204); // a ROF escalator landing, linked only by an escalator
    const std = multifloorRoute(roofEscalator, roofEscalator, { toLevel: 1 });
    const acc = multifloorRoute(roofEscalator, roofEscalator, { toLevel: 1, accessible: true });
    expect(std).not.toBeNull();
    expect(std!.links.some((l) => l.type === 'escalator')).toBe(true);
    expect(acc).toBeNull();
  });

  it('a ground walk stays on the ground with no floor change (the network is composed unchanged)', () => {
    const r = multifloorRoute([24.469, 39.6125], [24.4655, 39.6111], {})!;
    expect(r.links).toHaveLength(0);
    expect(r.levels.every((l) => l === 0)).toBe(true);
  });
});

describe('planRoutes cross-floor layer (Phase 1, plan §4.2 — signatures stay, parity protected)', () => {
  const FROM: LatLng = [24.469, 39.6125];
  const TO = POI_BY_ID.get(227)!;

  it('a ground request carries no floor metadata (the existing behaviour is untouched)', async () => {
    const plans = await planRoutes(FROM, TO, 'walk');
    expect(plans[0].floor).toBeUndefined();
  });

  it('requesting the ground floor (GF) is just a ground walk', async () => {
    const plans = await planRoutes(FROM, TO, 'walk', { toFloor: 12 });
    expect(plans[0].floor).toBeUndefined();
  });

  it('GF→ROF: a walk to the roof over a verified link', async () => {
    const plans = await planRoutes(FROM, TO, 'walk', { toFloor: 24 });
    const p = plans[0];
    expect(p.floor?.id).toBe(24);
    expect(p.floor!.changes.length).toBeGreaterThan(0);
    expect(p.floor!.levels[p.floor!.levels.length - 1]).toBe(1);
    expect(p.mode).toBe('walk');
  });

  it('GF→ROF accessible: lifts only, never an escalator', async () => {
    const plans = await planRoutes(FROM, TO, 'walk', { toFloor: 24, accessible: true });
    const p = plans[0];
    expect(p.accessible).toBe(true);
    expect(p.floor!.changes.length).toBeGreaterThan(0);
    expect(p.floor!.changes.every((c) => c.transit === 'elevator')).toBe(true);
  });

  it('ground→B2: down through the car park over a verified entrance or link', async () => {
    const plans = await planRoutes(FROM, TO, 'walk', { toFloor: 95 });
    const p = plans[0];
    expect(p.floor?.id).toBe(95);
    expect(p.floor!.changes.length).toBeGreaterThan(0);
    expect(p.floor!.levels[p.floor!.levels.length - 1]).toBe(-2);
  });

  it('ground→B2 accessible: lifts only', async () => {
    const plans = await planRoutes(FROM, TO, 'walk', { toFloor: 95, accessible: true });
    const p = plans[0];
    expect(p.accessible).toBe(true);
    expect(p.floor!.changes.length).toBeGreaterThan(0);
    expect(p.floor!.changes.every((c) => c.transit === 'elevator')).toBe(true);
  });
});
