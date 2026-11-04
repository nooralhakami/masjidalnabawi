import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';
import { describe, expect, it } from 'vitest';
import { sunPosition } from '../../src/domain/daylight';
import { materialGlow, sceneLight, sceneOverride } from '../../src/map/scene-light';

describe('sunPosition (the sun over the Mosque)', () => {
  const pt = new PrayerTimes(new Coordinates(24.4672, 39.6111), new Date(2026, 10, 4, 12), CalculationMethod.UmmAlQura());

  it('sits on the horizon at sunrise and sunset, as the prayer times have them', () => {
    // Sunrise and sunset are when the sun's top edge, refracted, touches the horizon: about -0.83°.
    expect(sunPosition(pt.sunrise).elevation).toBeCloseTo(-0.83, 0);
    expect(sunPosition(pt.maghrib).elevation).toBeCloseTo(-0.83, 0);
  });

  it('rises in the east, sets in the west, and stands due south at noon in November', () => {
    expect(sunPosition(pt.sunrise).azimuth).toBeGreaterThan(95);
    expect(sunPosition(pt.sunrise).azimuth).toBeLessThan(115);
    expect(sunPosition(pt.maghrib).azimuth).toBeGreaterThan(245);
    expect(sunPosition(pt.maghrib).azimuth).toBeLessThan(265);
    const noon = sunPosition(pt.dhuhr);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(2);
    // 90° − latitude − declination (about −15.5° on 4 November).
    expect(noon.elevation).toBeCloseTo(50, 0);
  });

  it('is far below the horizon at midnight', () => {
    expect(sunPosition(new Date('2026-11-04T21:00:00Z')).elevation).toBeLessThan(-50);
  });
});

describe('sceneLight (how the 3D view is lit)', () => {
  it('lights the Mosque at night and not by day', () => {
    expect(sceneLight({ elevation: -20, azimuth: 0 }).night).toBe(1);
    expect(sceneLight({ elevation: 50, azimuth: 180 }).night).toBe(0);
  });

  it('keeps the day look of the 3D mode: pale imagery and a bright ambient', () => {
    const day = sceneLight({ elevation: 50, azimuth: 180 });
    expect(day.raster.brightnessMin).toBeCloseTo(0.76);
    expect(day.ambient[0]).toBeGreaterThan(0.85);
  });

  it('darkens the ground and the sky as the sun goes down, without jumps', () => {
    let last = sceneLight({ elevation: 40, azimuth: 250 });
    for (let el = 39; el >= -20; el--) {
      const now = sceneLight({ elevation: el, azimuth: 250 });
      expect(now.raster.brightnessMax).toBeLessThanOrEqual(last.raster.brightnessMax + 1e-9);
      expect(now.night).toBeGreaterThanOrEqual(last.night - 1e-9);
      expect(Math.abs(now.night - last.night)).toBeLessThan(0.2);
      last = now;
    }
  });

  it('points the sunlight toward the sun (glTF frame: X east, Y up, Z south)', () => {
    const [x, y, z] = sceneLight({ elevation: 30, azimuth: 90 }).sunDir;
    expect(x).toBeGreaterThan(0.8);
    expect(y).toBeCloseTo(0.5, 2);
    expect(Math.abs(z)).toBeLessThan(1e-9);
    // Due south at noon: +Z.
    expect(sceneLight({ elevation: 30, azimuth: 180 }).sunDir[2]).toBeGreaterThan(0.8);
  });

  it('gives MapLibre a valid sky', () => {
    const sky = sceneLight({ elevation: -10, azimuth: 0 }).sky;
    expect(sky['sky-color']).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(sky['horizon-color']).toMatch(/^rgb\(/);
  });
});

describe('sceneOverride (preview links)', () => {
  it('names fixed moments, and follows the sun otherwise', () => {
    expect(sceneOverride('?scene=night')!.elevation).toBeLessThan(-12);
    expect(sceneOverride('?scene=day')!.elevation).toBeGreaterThan(30);
    expect(sceneOverride('?poi=215')).toBeNull();
    expect(sceneOverride('?scene=bogus')).toBeNull();
  });
});

describe('materialGlow (what lights up at night)', () => {
  it('turns the minarets gold, brightest toward the top', () => {
    for (const m of ['MINTEX', 'MINTEX.001', 'MIN2TEX2']) {
      const g = materialGlow('./models/haram-3d.glb', m)!;
      expect(g.rise).toBe(-1);
      expect(g.color[0]).toBeGreaterThan(g.color[2]);
    }
  });

  it('lights the canopy lanterns cold white and the Mosque windows warm', () => {
    const lantern = materialGlow('./models/haram-canopies.glb', 'glass1')!;
    const window = materialGlow('./models/haram-3d.glb', 'glass1')!;
    expect(lantern.tint).toBe(0);
    expect(lantern.color[2]).toBeGreaterThan(lantern.color[0]);
    expect(window.color[0]).toBeGreaterThan(window.color[2]);
  });

  it('floodlights the walls from below', () => {
    expect(materialGlow('./models/haram-3d.glb', '1w')!.rise).toBe(1);
    expect(materialGlow('./models/haram-service-a.glb', 'Material.005')!.rise).toBe(1);
  });

  it('lights the gates and doors from inside, warm, and the domes warm white', () => {
    for (const m of ['Gate1', 'GateR', 'Door3', 'Door5-1', 'ogdoor.001', 'arc']) {
      const g = materialGlow('./models/haram-3d.glb', m)!;
      expect(g.rise, m).toBe(0);
      expect(g.color[0], m).toBeGreaterThan(1.2);
    }
    const dome = materialGlow('./models/haram-3d.glb', 'Domes')!;
    expect(dome.color[0]).toBeGreaterThan(dome.color[2]);
  });
});
