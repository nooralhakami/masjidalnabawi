import { ALHARAMAIN_MODELS } from '../data-next/alharamain-3d';
import type { LatLng } from '../data/types';

/**
 * Unified local metric coordinate frames and lossless `[lat, lng]` / `[lng, lat]`
 * bridges between the routing frame (east/north from `WALK_ORIGIN`) and the
 * glTF/scene frame (east/south from `MODEL_ORIGIN_LNGLAT`).
 */

/** Walk/routing tangent-plane origin `[lat, lng]`. */
export const WALK_ORIGIN_LAT = 24.4673;
export const WALK_ORIGIN_LNG = 39.6111;

const METRES_PER_DEG_LAT = 111_320;
const WALK_KX = METRES_PER_DEG_LAT * Math.cos((WALK_ORIGIN_LAT * Math.PI) / 180);

export type XY = [number, number];

/** Project `[lat, lng]` into routing tangent-plane `[east, north]` metres. */
export const toWalkMetres = (ll: LatLng): XY => [(ll[1] - WALK_ORIGIN_LNG) * WALK_KX, (ll[0] - WALK_ORIGIN_LAT) * METRES_PER_DEG_LAT];

/** Invert `toWalkMetres` from `[east, north]` metres back to `[lat, lng]`. */
export const fromWalkMetres = (m: XY): LatLng => [WALK_ORIGIN_LAT + m[1] / METRES_PER_DEG_LAT, WALK_ORIGIN_LNG + m[0] / WALK_KX];

/** glTF scene anchor `[lng, lat]` (Venue 4 Mosque anchor). */
export const MODEL_ORIGIN_LNGLAT: readonly [number, number] = ALHARAMAIN_MODELS[0].anchors[0] as readonly [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;

const mercatorX = (lng: number): number => (180 + lng) / 360;
const lngFromMercatorX = (x: number): number => x * 360 - 180;

const mercatorY = (lat: number): number => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

const latFromMercatorY = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;

const ORIGIN_MERCATOR_X = mercatorX(MODEL_ORIGIN_LNGLAT[0]);
const ORIGIN_MERCATOR_Y = mercatorY(MODEL_ORIGIN_LNGLAT[1]);
const MODEL_METRE_UNITS = (1 / EARTH_CIRCUMFERENCE_M) * (1 / Math.cos((latFromMercatorY(ORIGIN_MERCATOR_Y) * Math.PI) / 180));

/** Metres `[east, south]` from `MODEL_ORIGIN_LNGLAT` matching Web Mercator glTF scaling. */
export function toModelMetres([lng, lat]: readonly [number, number]): XY {
  return [(mercatorX(lng) - ORIGIN_MERCATOR_X) / MODEL_METRE_UNITS, (mercatorY(lat) - ORIGIN_MERCATOR_Y) / MODEL_METRE_UNITS];
}

/** Invert `toModelMetres`: `[east, south]` metres from `MODEL_ORIGIN_LNGLAT` to `[lng, lat]`. */
export function fromModelMetres([east, south]: readonly [number, number]): [number, number] {
  return [lngFromMercatorX(ORIGIN_MERCATOR_X + east * MODEL_METRE_UNITS), latFromMercatorY(ORIGIN_MERCATOR_Y + south * MODEL_METRE_UNITS)];
}

/** Bridge model-frame `[east, south]` metres directly into routing-frame `[east, north]` metres. */
export function modelToWalkMetres(modelXY: readonly [number, number]): XY {
  const [lng, lat] = fromModelMetres(modelXY);
  return toWalkMetres([lat, lng]);
}

/** Bridge routing-frame `[east, north]` metres directly into model-frame `[east, south]` metres. */
export function walkToModelMetres(walkXY: readonly [number, number]): XY {
  const [lat, lng] = fromWalkMetres([walkXY[0], walkXY[1]]);
  return toModelMetres([lng, lat]);
}
