import { MercatorCoordinate } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import {
  lngLatFromModel,
  lngLatFromWalk,
  MODEL_ORIGIN,
  MODEL_ORIGIN_MERCATOR,
  MODEL_PER_METRE,
  modelFromLngLat,
  modelFromWalk,
  QIBLA_BEARING,
  walkFromLngLat,
  walkFromModel,
  WALK_KX,
  WALK_KY,
  WALK_LAT0,
  WALK_LNG0,
} from '../../src/domain/frames';
import { frameMatrix, lngLatFromMetres, metresFromOrigin } from '../../src/map/glb-layer';
import { fromM, toM } from '../../src/routing/walk';

/** Points about the Haram and beyond: the anchors, the plaza's corners, a point 3 km away. */
const POINTS: [number, number][] = [
  [39.611752, 24.466806], // the Mosque's anchor (the model frame's origin)
  [39.6111, 24.4673], // the walk frame's anchor
  [39.604755, 24.466028], // the plaza's south-west
  [39.614317, 24.471042], // its north-east
  [39.608028, 24.469958], // restroom 219
  [39.64, 24.49], // a few kilometres north-east
];

describe('the model frame agrees with MapLibre bit for bit (D6)', () => {
  it('metresFromOrigin matches MercatorCoordinate about the anchor', () => {
    const origin = MercatorCoordinate.fromLngLat(MODEL_ORIGIN as [number, number], 0);
    const perMetre = origin.meterInMercatorCoordinateUnits();
    expect(MODEL_PER_METRE).toBe(perMetre);
    expect(MODEL_ORIGIN_MERCATOR).toEqual([origin.x, origin.y]);
    for (const ll of POINTS) {
      const here = MercatorCoordinate.fromLngLat(ll, 0);
      expect(metresFromOrigin(ll)).toEqual([(here.x - origin.x) / perMetre, (here.y - origin.y) / perMetre]);
    }
  });

  it('lngLatFromMetres matches MercatorCoordinate the other way', () => {
    const origin = MercatorCoordinate.fromLngLat(MODEL_ORIGIN as [number, number], 0);
    const perMetre = origin.meterInMercatorCoordinateUnits();
    for (const es of [
      [0, 0],
      [100, 50],
      [-250, 300],
      [1000, -1000],
    ] as [number, number][]) {
      const ll = new MercatorCoordinate(origin.x + es[0] * perMetre, origin.y + es[1] * perMetre, 0).toLngLat();
      expect(lngLatFromMetres(es)).toEqual([ll.lng, ll.lat]);
    }
  });

  it('frameMatrix is the anchor’s Mercator matrix', () => {
    const origin = MercatorCoordinate.fromLngLat(MODEL_ORIGIN as [number, number], 0);
    const s = origin.meterInMercatorCoordinateUnits();
    expect([...frameMatrix()]).toEqual([s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, origin.x, origin.y, origin.z, 1]);
  });

  it('round trips to within a nanodegree', () => {
    for (const ll of POINTS) {
      const back = lngLatFromModel(modelFromLngLat(ll));
      expect(back[0]).toBeCloseTo(ll[0], 12);
      expect(back[1]).toBeCloseTo(ll[1], 12);
    }
  });
});

describe('the walk frame keeps the ported projection exactly (D6)', () => {
  it('toM and fromM are the live app’s formulas', () => {
    for (const ll of POINTS) {
      const latlng: [number, number] = [ll[1], ll[0]];
      expect(toM(latlng)).toEqual([(ll[0] - WALK_LNG0) * WALK_KX, (ll[1] - WALK_LAT0) * WALK_KY]);
      const m = toM(latlng);
      expect(fromM(m)).toEqual([WALK_LAT0 + m[1] / WALK_KY, WALK_LNG0 + m[0] / WALK_KX]);
      expect(fromM(m)[0]).toBeCloseTo(latlng[0], 12);
      expect(fromM(m)[1]).toBeCloseTo(latlng[1], 12);
    }
  });

  it('round trips through [lng, lat]', () => {
    for (const ll of POINTS) {
      const back = lngLatFromWalk(walkFromLngLat(ll));
      expect(back[0]).toBeCloseTo(ll[0], 12);
      expect(back[1]).toBeCloseTo(ll[1], 12);
    }
  });
});

describe('the two frames differ as documented, and the bridge converts them (D6)', () => {
  it('the walk anchor sits about 66 m west and 55 m north of the model anchor', () => {
    const [east, south] = modelFromLngLat([WALK_LNG0, WALK_LAT0]);
    expect(east).toBeGreaterThan(-70);
    expect(east).toBeLessThan(-60);
    expect(-south).toBeGreaterThan(50);
    expect(-south).toBeLessThan(60);
  });

  it('the model frame’s metre is about 0.11 % shorter than the walk frame’s', () => {
    // One degree of longitude at the anchor, in each frame’s metres.
    const modelDeg = modelFromLngLat([MODEL_ORIGIN[0] + 1, MODEL_ORIGIN[1]])[0];
    const ratio = WALK_KX / modelDeg;
    expect(ratio).toBeGreaterThan(1.001);
    expect(ratio).toBeLessThan(1.0013);
  });

  it('model → walk → model and walk → model → walk come back to the same metres', () => {
    for (const es of [
      [0, 0],
      [120, -80],
      [-300, 250],
    ] as [number, number][]) {
      const back = modelFromWalk(walkFromModel(es));
      expect(back[0]).toBeCloseTo(es[0], 6);
      expect(back[1]).toBeCloseTo(es[1], 6);
    }
    for (const ll of POINTS) {
      const xy = walkFromLngLat(ll);
      const back = walkFromModel(modelFromWalk(xy));
      expect(back[0]).toBeCloseTo(xy[0], 6);
      expect(back[1]).toBeCloseTo(xy[1], 6);
    }
  });

  it('the model frame’s origin is the Mosque’s anchor in the data', () => {
    expect(MODEL_ORIGIN).toEqual(ALHARAMAIN_MODELS[0].anchors[0]);
    expect(metresFromOrigin(MODEL_ORIGIN)).toEqual([0, 0]);
  });
});

describe('the qibla is 176.24°, not due south (D5)', () => {
  /** The great-circle bearing from a point to the Kaaba (21.4225 N, 39.8262 E). */
  const bearingToKaaba = ([lng, lat]: readonly [number, number]) => {
    const φ1 = (lat * Math.PI) / 180;
    const φ2 = (21.4225 * Math.PI) / 180;
    const Δλ = ((39.8262 - lng) * Math.PI) / 180;
    const b = Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ));
    return ((b * 180) / Math.PI + 360) % 360;
  };

  it('matches the great circle to the Kaaba from both anchors', () => {
    expect(bearingToKaaba(MODEL_ORIGIN)).toBeCloseTo(176.246, 2);
    expect(bearingToKaaba([WALK_LNG0, WALK_LAT0])).toBeCloseTo(176.235, 2);
    expect(Math.abs(QIBLA_BEARING - bearingToKaaba(MODEL_ORIGIN))).toBeLessThan(0.5);
  });

  it('is east of due south by the 3.76° the carpets’ rows turn', () => {
    expect(180 - QIBLA_BEARING).toBeCloseTo(3.76, 5);
  });
});