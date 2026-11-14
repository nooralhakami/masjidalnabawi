import { MercatorCoordinate } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
  MODEL_ORIGIN_LNGLAT,
  WALK_ORIGIN_LAT,
  WALK_ORIGIN_LNG,
  fromModelMetres,
  fromWalkMetres,
  modelToWalkMetres,
  toModelMetres,
  toWalkMetres,
  walkToModelMetres,
} from '../../src/domain/frames';

const SAMPLES: readonly [number, number][] = [
  // [lat, lng] across Al-Haram corners, gates, and parking
  [24.4673, 39.6111],
  [24.466806, 39.611752],
  [24.4704, 39.6081],
  [24.4642, 39.6152],
  [24.4695, 39.6145],
];

describe('coordinate frames unification (A2)', () => {
  it('origin points map to [0, 0] in their respective frames', () => {
    const walk0 = toWalkMetres([WALK_ORIGIN_LAT, WALK_ORIGIN_LNG]);
    expect(Math.hypot(walk0[0], walk0[1])).toBeLessThan(1e-9);

    const model0 = toModelMetres(MODEL_ORIGIN_LNGLAT);
    expect(Math.hypot(model0[0], model0[1])).toBeLessThan(1e-9);
  });

  it('round-trips walk metres and model metres within 1e-6 metres', () => {
    for (const [lat, lng] of SAMPLES) {
      const w = toWalkMetres([lat, lng]);
      const llFromWalk = fromWalkMetres(w);
      const w2 = toWalkMetres(llFromWalk);
      expect(Math.hypot(w2[0] - w[0], w2[1] - w[1])).toBeLessThan(1e-6);

      const m = toModelMetres([lng, lat]);
      const lngLatFromModel = fromModelMetres(m);
      const m2 = toModelMetres(lngLatFromModel);
      expect(Math.hypot(m2[0] - m[0], m2[1] - m[1])).toBeLessThan(1e-6);
    }
  });

  it('matches MapLibre MercatorCoordinate within 1e-6 metres', () => {
    const origin = MercatorCoordinate.fromLngLat([MODEL_ORIGIN_LNGLAT[0], MODEL_ORIGIN_LNGLAT[1]], 0);
    const perMetre = origin.meterInMercatorCoordinateUnits();

    for (const [lat, lng] of SAMPLES) {
      const here = MercatorCoordinate.fromLngLat([lng, lat], 0);
      const expectedEast = (here.x - origin.x) / perMetre;
      const expectedSouth = (here.y - origin.y) / perMetre;

      const [east, south] = toModelMetres([lng, lat]);
      expect(Math.abs(east - expectedEast)).toBeLessThan(1e-6);
      expect(Math.abs(south - expectedSouth)).toBeLessThan(1e-6);

      const expectedLl = new MercatorCoordinate(origin.x + east * perMetre, origin.y + south * perMetre, 0).toLngLat();
      const [backLng, backLat] = fromModelMetres([east, south]);
      expect(Math.abs(backLng - expectedLl.lng)).toBeLessThan(1e-11);
      expect(Math.abs(backLat - expectedLl.lat)).toBeLessThan(1e-11);
    }
  });

  it('bridges seamlessly between model and walk metric frames within 1e-6 metres', () => {
    for (const [lat, lng] of SAMPLES) {
      const w = toWalkMetres([lat, lng]);
      const m = toModelMetres([lng, lat]);

      const bridgedToWalk = modelToWalkMetres(m);
      expect(Math.hypot(bridgedToWalk[0] - w[0], bridgedToWalk[1] - w[1])).toBeLessThan(1e-6);

      const bridgedToModel = walkToModelMetres(w);
      expect(Math.hypot(bridgedToModel[0] - m[0], bridgedToModel[1] - m[1])).toBeLessThan(1e-6);
    }
  });
});
