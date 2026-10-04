import type { Overrides, Poi } from './types';

const METERS_PER_DEG_LAT = 111_320;

/**
 * Shift POIs by whole metres north/east, e.g. `{ "332": { "north": -7, "east": 7 } }`.
 * Returns new objects; POIs without an override are returned unchanged.
 */
export function applyOverrides(pois: readonly Poi[], overrides: Overrides): Poi[] {
  return pois.map((p) => {
    const o = overrides[String(p.id)];
    if (!o) return p;
    const north = o.north ?? 0;
    const east = o.east ?? 0;
    const dLat = north / METERS_PER_DEG_LAT;
    const dLng = east / (METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
    return { ...p, lat: p.lat + dLat, lng: p.lng + dLng };
  });
}
