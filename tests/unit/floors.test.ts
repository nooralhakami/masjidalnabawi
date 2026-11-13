import { describe, expect, it } from 'vitest';
import { DATA_PROVENANCE } from '../../src/data/provenance';
import { FLOOR_BY_ID, FLOOR_IDS, GROUND_FLOORS, floorsOfVenue } from '../../src/data-next/floors';
import { ACCESSIBLE_VERTICAL_EDGES, UNLINKED_VERTICAL_NODES, VERTICAL_EDGES, verticalEdgesOfVenue } from '../../src/data-next/vertical-edges';
import { VERTICAL_NODES, type VerticalNode } from '../../src/data-next/vertical-nodes';

const NODE = new Map(VERTICAL_NODES.map((n) => [n.id, n]));

// The walk-frame plan metric (domain/frames.ts), repeated here to check the derivation independently.
const KX = 111_320 * Math.cos((24.4673 * Math.PI) / 180);
const KY = 111_320;
const planM = (a: VerticalNode, b: VerticalNode) => Math.hypot((a.lng - b.lng) * KX, (a.lat - b.lat) * KY);
const nearest = (from: VerticalNode, pool: VerticalNode[]) => pool.reduce((best, n) => (planM(from, n) < planM(from, best) ? n : best), pool[0]);

describe('the five verified floors (navQ GetVenueFloors)', () => {
  it('are exactly the captured five, top to bottom: ROF, GF, Plaza, B1, B2', () => {
    expect(FLOOR_IDS).toEqual([24, 12, 11, 94, 95]);
    expect([...FLOOR_BY_ID.keys()].sort((a, b) => a - b)).toEqual([11, 12, 24, 94, 95]);
  });

  it.each([
    [24, 4, 1, 'ROF'],
    [12, 4, 0, 'GF'],
    [11, 3, 0, null],
    [94, 20, -1, 'B1'],
    [95, 20, -2, 'B2'],
  ] as const)('floor %i belongs to venue %i at level %i with label %s', (id, venueId, level, label) => {
    const f = FLOOR_BY_ID.get(id)!;
    expect(f.venueId).toBe(venueId);
    expect(f.level).toBe(level);
    expect(f.label).toBe(label);
    expect(f.names.ar).toBeTruthy();
    expect(f.mapWidth).toBeGreaterThan(0);
    expect(f.alignment.center).toHaveLength(2);
  });

  it('groups the Mosque (GF, ROF) and the car park (B1, B2); the Plaza is the campus ground', () => {
    expect(floorsOfVenue(4).map((f) => f.id)).toEqual([24, 12]);
    expect(floorsOfVenue(20).map((f) => f.id)).toEqual([94, 95]);
    expect(floorsOfVenue(3).map((f) => f.id)).toEqual([11]);
    expect(GROUND_FLOORS.map((f) => f.id)).toEqual([12, 11]);
  });

  it('is tagged verified, so routing may read it', () => {
    expect(DATA_PROVENANCE.floors).toBe('verified');
  });
});

describe('the derived floor-to-floor links (mutual nearest, plan §4.2)', () => {
  it('recovers 46 links: 8 lifts and 38 escalators', () => {
    expect(VERTICAL_EDGES).toHaveLength(46);
    expect(VERTICAL_EDGES.filter((e) => e.type === 'elevator')).toHaveLength(8);
    expect(VERTICAL_EDGES.filter((e) => e.type === 'escalator')).toHaveLength(38);
    expect(DATA_PROVENANCE['vertical-edges']).toBe('verified');
  });

  it('splits 6 links in the Mosque (GF↔ROF) and 40 in the car park (B1↔B2)', () => {
    expect(verticalEdgesOfVenue(4)).toHaveLength(6);
    expect(verticalEdgesOfVenue(4).filter((e) => e.type === 'elevator')).toHaveLength(2);
    expect(verticalEdgesOfVenue(20)).toHaveLength(40);
    expect(verticalEdgesOfVenue(20).filter((e) => e.type === 'elevator')).toHaveLength(6);
  });

  // One test per vertical edge (the Phase 1 acceptance): each link is checked independently.
  it.each(VERTICAL_EDGES.map((e) => [e.a, e.b, e.type] as const))('link %i↔%i (%s) is mutual, same kind, lower→upper, within bound', (aId, bId, type) => {
    const e = VERTICAL_EDGES.find((x) => x.a === aId && x.b === bId)!;
    const a = NODE.get(aId)!;
    const b = NODE.get(bId)!;
    expect(a.type).toBe(type);
    expect(b.type).toBe(type);
    expect(a.venueId).toBe(e.venueId);
    expect(b.venueId).toBe(e.venueId);
    expect(a.floorId).toBe(e.fromFloor);
    expect(b.floorId).toBe(e.toFloor);
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
    // Lower floor really is below the upper.
    expect(FLOOR_BY_ID.get(e.fromFloor)!.level).toBeLessThan(FLOOR_BY_ID.get(e.toFloor)!.level);
    // Mutual nearest of the same kind across the venue's two floors.
    const lo = VERTICAL_NODES.filter((n) => n.venueId === e.venueId && n.floorId === e.fromFloor && n.type === type && !n.closed);
    const up = VERTICAL_NODES.filter((n) => n.venueId === e.venueId && n.floorId === e.toFloor && n.type === type && !n.closed);
    expect(nearest(a, up).id).toBe(bId);
    expect(nearest(b, lo).id).toBe(aId);
    // The recorded distance is the real plan distance, within the pairing bound.
    const m = planM(a, b);
    expect(m).toBeLessThanOrEqual(25);
    expect(e.meters).toBeCloseTo(m, 1);
  });

  it('joins the two Mosque lift shafts GF↔ROF (4703↔4705, 4704↔4706)', () => {
    const lifts = verticalEdgesOfVenue(4).filter((e) => e.type === 'elevator');
    expect(lifts.map((e) => [e.a, e.b]).sort()).toEqual([
      [4703, 4705],
      [4704, 4706],
    ]);
    for (const e of lifts) expect(e.meters).toBeLessThan(2);
  });

  it('keeps the step-free subset to lifts only (8), never an escalator', () => {
    expect(ACCESSIBLE_VERTICAL_EDGES).toHaveLength(8);
    expect(ACCESSIBLE_VERTICAL_EDGES.every((e) => e.type === 'elevator')).toBe(true);
  });

  it('leaves 7 landings openly unconnected: 3 GF gates and the 4 Mosque escalators with no captured roof partner', () => {
    expect(UNLINKED_VERTICAL_NODES.map((n) => n.id).sort((a, b) => a - b)).toEqual([3482, 3505, 4201, 4203, 4577, 4635, 4644]);
    // No link is invented for them, and no link ever uses a gate.
    const linkedIds = new Set(VERTICAL_EDGES.flatMap((e) => [e.a, e.b]));
    for (const n of UNLINKED_VERTICAL_NODES) expect(linkedIds.has(n.id)).toBe(false);
    expect(VERTICAL_EDGES.every((e) => NODE.get(e.a)!.type !== 'gate' && NODE.get(e.b)!.type !== 'gate')).toBe(true);
    // Every node is either linked or openly listed: none silently dropped.
    expect(linkedIds.size + UNLINKED_VERTICAL_NODES.length).toBe(VERTICAL_NODES.length);
  });
});
