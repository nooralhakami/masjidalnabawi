import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';
import { describe, expect, it } from 'vitest';
import { sunPosition } from '../../src/domain/daylight';
import { gateLattice, materialColor, materialGlow, minaretCrown, portalKind, sceneLight, sceneOverride } from '../../src/map/scene-light';
import { sunMatrix } from '../../src/map/sun-shadow';

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

  it('lights the canopy lanterns near white and the Mosque windows warm', () => {
    const lantern = materialGlow('./models/haram-canopies.glb', 'glass1')!;
    const window = materialGlow('./models/haram-3d.glb', 'glass1')!;
    expect(lantern.tint).toBe(0);
    // Near white: no channel far from the others (owner, 2026-11-04: no cyan, no orange).
    expect(Math.max(...lantern.color) / Math.min(...lantern.color)).toBeLessThan(1.1);
    expect(window.color[0]).toBeGreaterThan(window.color[2]);
  });

  it('never floodlights in a saturated colour: every lamp but the lit halls is near white', () => {
    for (const m of ['1w', 'MINTEX', 'cornice', 'Domes', 'column goold', 'roof', 'steel.001', 'uMB']) {
      for (const file of ['./models/haram-3d.glb', './models/haram-canopies.glb']) {
        const g = materialGlow(file, m)!;
        expect(Math.max(...g.color) / Math.min(...g.color), `${file} ${m}`).toBeLessThan(1.2);
      }
    }
  });

  it("gives the folded canopies beige fabric and bronze housings instead of the file's blue and green", () => {
    const fabric = materialColor('./models/haram-canopies.glb', 'steel.001')!;
    expect(fabric[0]).toBeGreaterThan(fabric[2]);
    const housing = materialColor('./models/haram-canopies.glb', 'GREENDOME2')!;
    expect(housing[0]).toBeGreaterThan(housing[1]);
    // The Mosque keeps its own colours.
    expect(materialColor('./models/haram-3d.glb', 'GREENDOME2')).toBeNull();
    expect(materialColor('./models/haram-canopies.glb', 'red2')).toBeNull();
  });

  it('floodlights the walls from below', () => {
    expect(materialGlow('./models/haram-3d.glb', '1w')!.rise).toBe(1);
    expect(materialGlow('./models/haram-service-a.glb', 'Material.005')!.rise).toBe(1);
  });

  it('lights the gates softly so their wood and gold show, never burnt to white', () => {
    for (const m of ['Gate1', 'GateR', 'Door3', 'Door5-1', 'ogdoor.001', 'arc', 'G1']) {
      const g = materialGlow('./models/haram-3d.glb', m)!;
      expect(g.tint, m).toBe(1);
      expect(Math.max(...g.color), m).toBeLessThan(0.8);
    }
    const dome = materialGlow('./models/haram-3d.glb', 'Domes')!;
    expect(dome.color[0]).toBeGreaterThanOrEqual(dome.color[2]);
  });

  it("paints a gate on the portals' dark back walls, and Bab al-Salam open", () => {
    expect(portalKind('./models/haram-3d.glb', 'Plane.005', 'DEEP')).toBe(1);
    expect(portalKind('./models/haram-3d.glb', 'Plane.058', 'DEEP')).toBe(1);
    expect(portalKind('./models/haram-3d.glb', 'Plane.057', 'DEEP')).toBe(2);
    expect(portalKind('./models/haram-3d.glb', 'Plane.005', 'G1')).toBe(0);
    expect(portalKind('./models/haram-canopies.glb', 'Plane.005', 'DEEP')).toBe(0);
    expect(gateLattice('./models/haram-3d.glb', 'Gate1')).toBe(true);
    expect(gateLattice('./models/haram-3d.glb', 'Door3')).toBe(false);
  });
});

describe("sunMatrix (the sun's view for shadows)", () => {
  const apply = (m: Float64Array, [x, y, z]: number[]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

  it('frames the Haram and its plazas inside the map', () => {
    const m = sunMatrix(sceneLight({ elevation: 50, azimuth: 180 }).sunDir);
    // The Mosque's anchor, and the far corners of the plazas (west annex, east sector).
    for (const p of [
      [0, 0, 0],
      [-740, 0, -480],
      [260, 0, 180],
    ]) {
      for (const c of apply(m, p)) expect(Math.abs(c)).toBeLessThan(1);
    }
  });

  it('puts what is nearer the sun nearer in depth', () => {
    const dir = sceneLight({ elevation: 30, azimuth: 90 }).sunDir;
    const m = sunMatrix(dir);
    const ground = apply(m, [0, 0, 0])[2];
    const top = apply(m, [0, 80, 0])[2];
    expect(top).toBeLessThan(ground);
  });
});

describe('minaretCrown (the green-lit crown at night)', () => {
  it("lights only the minarets' crown band, between the upper balcony and the finial", () => {
    expect(minaretCrown('./models/haram-3d.glb', 'Circle', 'MINTEX')).toEqual([68, 72]);
    expect(minaretCrown('./models/haram-3d.glb', 'Circle.002', 'MINTEX')).toEqual([68, 72]);
    expect(minaretCrown('./models/haram-3d.glb', 'Circle', 'column goold')).toBeNull();
    expect(minaretCrown('./models/haram-3d.glb', 'Plane.001', 'MINTEX')).toBeNull();
    expect(minaretCrown('./models/haram-canopies.glb', 'Circle', 'MINTEX')).toBeNull();
  });
});
