import { describe, expect, it } from 'vitest';
import { ROUTING } from '../../src/data';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../../src/data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS } from '../../src/data-next/alharamain-prayers';
import { interiorCorridors, interiorPrayerAreas } from '../../src/map/interior-layout';
import { WOMEN_RAWDAH_CORRIDOR_BOUNDS } from '../../src/map/rawdah-layout';
import { buildInterCarpetAisles, rugLayout } from '../../src/map/rug-layout';
import { saqifahAndSurroundings3D, saqifahGround2D } from '../../src/map/saqifah-3d';
import { womenRawdahCorridorBarriers } from '../../src/map/women-barriers';
import { walkPath, walkShortcutPath } from '../../src/routing/walk';
import { SHORTCUT_PAINT, shortcutBadgeMeta } from '../../src/map/route';

function pointInPolygon([lat, lng]: [number, number], ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

describe('Phase 1-B resolution, inter-carpet aisles, interior routing, and Saqifah 3D', () => {
  it('keeps only the 5 Western Annex prayer areas and adds wall-adjacent carpet strips (67 polygons total)', () => {
    const annexPrayers = alharamainPlaza().features.filter((f) => f.properties.kind === 'men' || f.properties.kind === 'women');
    expect(annexPrayers).toHaveLength(5);
    expect(ALHARAMAIN_PRAYERS).toHaveLength(67);
    const layout = rugLayout([]);
    expect(layout.rugs.length).toBeGreaterThan(8_500);
  });

  it('generates inter-carpet walking aisles and computes secondary aisle shortcuts across carpets', () => {
    const aisles = buildInterCarpetAisles();
    expect(aisles.features.length).toBeGreaterThan(0);

    // Try aisles until finding a transverse/longitudinal aisle bridging across a courtyard carpet zone.
    const aisleHits = aisles.features
      .map((f) => {
        const coords = f.geometry.coordinates;
        const a: [number, number] = [coords[0][1], coords[0][0]];
        const b: [number, number] = [coords[coords.length - 1][1], coords[coords.length - 1][0]];
        return walkShortcutPath(a, b, { isWomen: true, allowWomenRawdahCorridor: false });
      })
      .filter((res): res is NonNullable<typeof res> => res !== null && res.kind === 'aisle');

    expect(aisleHits.length).toBeGreaterThan(0);
    expect(aisleHits[0].path.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps exterior route priority and strictly forbids women from men interior Mosque halls except Gate 21 Rawdah corridor', () => {
    const areas = interiorPrayerAreas();
    const corridors = interiorCorridors();
    expect(areas.features.some((f) => f.properties.kind === 'men_hall')).toBe(true);
    expect(areas.features.some((f) => f.properties.kind === 'women_rawdah_corridor')).toBe(true);
    expect(corridors.features.some((f) => f.properties.kind === 'men_interior')).toBe(true);
    expect(corridors.features.some((f) => f.properties.kind === 'women_rawdah_corridor')).toBe(true);

    const rawdahBarriers = womenRawdahCorridorBarriers();
    expect(rawdahBarriers.features.length).toBeGreaterThan(0);
    expect(WOMEN_RAWDAH_CORRIDOR_BOUNDS.northLat).toBeGreaterThan(WOMEN_RAWDAH_CORRIDOR_BOUNDS.southLat);

    // Exterior route priority: walking around West exterior stays outside the Mosque building rectangle.
    const mainWalk = walkPath([24.4702, 39.6095], [24.4671, 39.6095]);
    expect(mainWalk.length).toBeGreaterThan(2);
    const mosquePoly = ROUTING.obstacles.mosque_building;
    for (const pt of mainWalk) {
      expect(pointInPolygon(pt, mosquePoly)).toBe(false);
    }

    // Strict women's protection: women must NEVER get a shortcut through men's interior halls.
    const womenCheck = walkShortcutPath([24.46992, 39.61001], [24.46776, 39.61001], {
      isWomen: true,
      allowWomenRawdahCorridor: false,
    });
    expect(womenCheck?.kind).not.toBe('interior');

    // Men can take the interior Mosque corridor shortcut (savedM > 0).
    const menCheck = walkShortcutPath([24.46992, 39.61001], [24.46776, 39.61001], {
      isWomen: false,
    });
    expect(menCheck).not.toBeNull();
    expect(menCheck!.kind).toBe('interior');
    expect(menCheck!.savedM).toBeGreaterThan(0);

    // Women going Gate 21 -> Behind Rawdah are permitted through the enclosed East/West barrier corridor.
    const womenRawdahCheck = walkShortcutPath(
      [WOMEN_RAWDAH_CORRIDOR_BOUNDS.northLat, WOMEN_RAWDAH_CORRIDOR_BOUNDS.centerLng],
      [WOMEN_RAWDAH_CORRIDOR_BOUNDS.southLat, WOMEN_RAWDAH_CORRIDOR_BOUNDS.centerLng],
      { isWomen: true, allowWomenRawdahCorridor: true },
    );
    expect(womenRawdahCheck).not.toBeNull();
    expect(womenRawdahCheck!.kind).toBe('women_rawdah');
  });

  it('builds 2D and 3D Saqifat Bani Sa idah Garden and surrounding West OSM buildings excluding restroom blocks', () => {
    const g2d = saqifahGround2D();
    expect(g2d.features.length).toBeGreaterThan(30);

    const f3d = saqifahAndSurroundings3D();
    const byKind = (kind: string) => f3d.features.filter((f) => f.properties.kind === kind);

    expect(byKind('wall')).toHaveLength(5);
    expect(byKind('lawn')).toHaveLength(4);
    expect(byKind('path')).toHaveLength(3);

    const heritage = byKind('heritage');
    expect(heritage.map((f) => f.properties.id).sort()).toEqual(['775419642', '775419643', '775419644', '775419645']);

    expect(byKind('tree-trunk')).toHaveLength(28);
    expect(byKind('tree-crown')).toHaveLength(28);

    const surrounding = [...byKind('hotel'), ...byKind('civic'), ...byKind('building')];
    expect(surrounding).toHaveLength(45);

    for (const f of surrounding) {
      expect(/^(209|21\d|22[0-2])$/.test((f.properties.name ?? '').trim())).toBe(false);
    }

    // Ensure GLB canopy anchor constant was not dropped
    expect(ALHARAMAIN_MODELS.length).toBeGreaterThan(0);
  });

  it('uses faded styling and gender/access badge metadata for secondary shortcuts (D15)', () => {
    expect(SHORTCUT_PAINT.lineOpacity).toBeLessThan(0.5);
    expect(SHORTCUT_PAINT.casingOpacity).toBeLessThan(0.35);
    expect(SHORTCUT_PAINT.lineWidth).toBeLessThanOrEqual(2.5);

    const men = shortcutBadgeMeta('interior');
    const women = shortcutBadgeMeta('women_rawdah');
    const aisle = shortcutBadgeMeta('aisle');

    expect(men.label).toContain('للرجال');
    expect(men.glyph).toBeTruthy();
    expect(women.label).toContain('للنساء');
    expect(women.glyph).toBeTruthy();
    expect(aisle.label).toBeTruthy();
    expect(new Set([men.color, women.color, aisle.color]).size).toBe(3);
  });
});
