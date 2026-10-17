import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import { haversine } from '../../src/domain/geo';
import { ARROW_EVERY_M, arrowsAlong, bearing, boundsOf, lengthOf, pointAlong, routeSummary } from '../../src/presentation/route-view';
import { planRoutes } from '../../src/routing/plan';

// The route card's numbers and the map's arrows, as data (the live app computed them inside its Leaflet layer).

describe('routeSummary', () => {
  it('walking to restroom 204 from the west plaza: ≈510 m, 7 min, as the live app’s e2e', async () => {
    const plans = await planRoutes([24.4685, 39.6084], POI_BY_ID.get(204)!, 'walk');
    const s = routeSummary(plans, 0);
    expect(s.meters).toBeGreaterThan(470);
    expect(s.meters).toBeLessThan(550);
    expect(s.minutes).toBe(7);
    expect(s.drive).toBeUndefined();
    expect(s.options.length).toBe(plans.length);
  });

  it('by car to lot 9 from the north: the Sultana entrance, lot 9, level B', async () => {
    const plans = await planRoutes([24.476, 39.611], POI_BY_ID.get(909)!, 'drive', { level: 'B' });
    const s = routeSummary(plans, 0);
    expect(s.drive?.entrance).toBe('sultana');
    expect(s.drive?.lot).toBe(9);
    expect(s.drive?.level).toBe('B');
    expect(s.drive?.unsure).toBe(false);
  });
});

describe('geometry', () => {
  const path: [number, number][] = [
    [24.467, 39.61],
    [24.468, 39.61],
    [24.468, 39.611],
  ];

  it('pointAlong halves the length, not the points', () => {
    const mid = pointAlong(path, 0.5);
    const total = lengthOf(path);
    expect(haversine(path[0], mid)).toBeCloseTo(total / 2, 0);
  });

  it('bearing: north 0, east 90', () => {
    expect(bearing(path[0], path[1])).toBeCloseTo(0, 5);
    expect(bearing(path[1], path[2])).toBeCloseTo(90, 5);
  });

  it('arrows every 55 m, the first at 27.5 m, carried across legs, pointing along their segment', () => {
    const a = arrowsAlong([path.slice(0, 2), path.slice(1)]);
    const total = lengthOf(path);
    expect(a.length).toBe(Math.floor((total - ARROW_EVERY_M / 2) / ARROW_EVERY_M) + 1);
    expect(haversine(path[0], a[0].at)).toBeCloseTo(ARROW_EVERY_M / 2, 0);
    expect(a[0].bearing).toBeCloseTo(0, 5);
    expect(a[a.length - 1].bearing).toBeCloseTo(90, 5);
  });

  it('boundsOf gives [lng, lat] corners around every path', () => {
    expect(boundsOf([path, [[24.466, 39.612]]])).toEqual([
      [39.61, 24.466],
      [39.612, 24.468],
    ]);
  });
});
