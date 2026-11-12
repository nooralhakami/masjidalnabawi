import { ALHARAMAIN_MODELS } from '../data-next/alharamain-3d';

/**
 * The app's two metric frames, defined once (D6, owner 2026-11-12, `docs/DECISIONS.md`):
 *
 * - The **walk frame** (`routing/walk.ts`, ported from the live app): equirectangular about
 *   24.4673 N, 39.6111 E at 111 320 m per degree; x east, **y north**. The ported code's tuples
 *   are `[lat, lng]`, so walk.ts swaps at its edge; everything here is `[lng, lat]`.
 * - The **model frame** (the glTF files of `data-next/alharamain-3d.ts`): Web Mercator metres
 *   about the Mosque's anchor, x east, **y south** (glTF Z), at the scale MapLibre's
 *   `MercatorCoordinate` uses (earth radius 6 371 008.8 m).
 *
 * They differ by their anchors (~66 m east, ~55 m north), the y sign, and ~0.11 % of scale
 * (111 320 vs ≈111 195 m per degree of longitude here). Conversions between them go through
 * `[lng, lat]` — the only sanctioned bridge; no code should mix the two frames' metres directly.
 */

export type LngLat = readonly [number, number];
export type Metres = readonly [number, number];

// ---- The walk frame ------------------------------------------------------------------------

export const WALK_LAT0 = 24.4673;
export const WALK_LNG0 = 39.6111;
export const WALK_KY = 111_320;
export const WALK_KX = 111_320 * Math.cos((WALK_LAT0 * Math.PI) / 180);

/** `[lng, lat]` → walk metres `[east, north]`. */
export const walkFromLngLat = ([lng, lat]: LngLat): Metres => [(lng - WALK_LNG0) * WALK_KX, (lat - WALK_LAT0) * WALK_KY];
/** Walk metres `[east, north]` → `[lng, lat]`. */
export const lngLatFromWalk = ([east, north]: Metres): LngLat => [WALK_LNG0 + east / WALK_KX, WALK_LAT0 + north / WALK_KY];

// ---- The model frame -----------------------------------------------------------------------

/** The Mosque's anchor (Venue 4 in navQ's `DataAPI_svc_GetVenues.json`), `[lng, lat]`. */
export const MODEL_ORIGIN: LngLat = ALHARAMAIN_MODELS[0].anchors[0];

const EARTH_RADIUS = 6371008.8;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;

// Web Mercator written exactly as MapLibre 6 computes it (src/geo/mercator_coordinate.ts), so
// these pure functions and the map's own projection agree to the last bit.
const mercatorX = (lng: number) => (180 + lng) / 360;
const mercatorY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const lngFromMercatorX = (x: number) => x * 360 - 180;
const latFromMercatorY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;

const ORIGIN_X = mercatorX(MODEL_ORIGIN[0]);
const ORIGIN_Y = mercatorY(MODEL_ORIGIN[1]);

/** The anchor in Mercator units (z is 0: everything stands on the ground). */
export const MODEL_ORIGIN_MERCATOR: Metres = [ORIGIN_X, ORIGIN_Y];
/** One metre in Mercator units at the anchor — MapLibre's `meterInMercatorCoordinateUnits()`. */
export const MODEL_PER_METRE = (1 / EARTH_CIRCUMFERENCE) * (1 / Math.cos((latFromMercatorY(ORIGIN_Y) * Math.PI) / 180));

/** `[lng, lat]` → model metres `[east, south]` about the Mosque's anchor. */
export const modelFromLngLat = ([lng, lat]: LngLat): Metres => [(mercatorX(lng) - ORIGIN_X) / MODEL_PER_METRE, (mercatorY(lat) - ORIGIN_Y) / MODEL_PER_METRE];
/** Model metres `[east, south]` → `[lng, lat]`. */
export const lngLatFromModel = ([east, south]: Metres): LngLat => [lngFromMercatorX(ORIGIN_X + east * MODEL_PER_METRE), latFromMercatorY(ORIGIN_Y + south * MODEL_PER_METRE)];

/** Model metres → walk metres, through `[lng, lat]`. */
export const walkFromModel = (es: Metres): Metres => walkFromLngLat(lngLatFromModel(es));
/** Walk metres → model metres, through `[lng, lat]`. */
export const modelFromWalk = (xy: Metres): Metres => modelFromLngLat(lngLatFromWalk(xy));

// ---- The qibla ------------------------------------------------------------------------------

/**
 * The qibla's true bearing from the Haram: 176.24°, the great circle to the Kaaba (21.4225 N,
 * 39.8262 E) — not due south (D5, owner 2026-11-12). The carpets' rows and the compass's Kaaba
 * mark follow it; `tests/unit/frames.test.ts` checks the bearing against the great circle.
 */
export const QIBLA_BEARING = 176.24;
