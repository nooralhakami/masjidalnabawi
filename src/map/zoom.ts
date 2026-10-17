import type { Poi } from '../data/types';

/**
 * Zoom levels. MapLibre's world is 512 px wide at zoom 0; with 256 px raster tiles Leaflet's is
 * 256 px. So a MapLibre zoom is the Leaflet zoom minus one, and every threshold the live app's rules
 * use (14/15/16 shrink, 17 chips, 18 pairs, 19 names, default 17, max 19) is a *Leaflet* zoom.
 * Everything crosses between the two here, and only here.
 */
export const legacyZoom = (mapZoom: number): number => mapZoom + 1;
export const mapZoom = (legacy: number): number => legacy - 1;

/** The live app's zoom range (Leaflet): 14–19. */
export const LEGACY_MIN = 14;
export const LEGACY_MAX = 19;

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The Haram's bounds: the ring of outer gates (the live app's HARAM_BOUNDS). */
export function haramBounds(pois: readonly Poi[]): Bounds {
  const outer = pois.filter((p) => p.subCategory === 'gate_outer');
  return {
    south: Math.min(...outer.map((p) => p.lat)),
    north: Math.max(...outer.map((p) => p.lat)),
    west: Math.min(...outer.map((p) => p.lng)),
    east: Math.max(...outer.map((p) => p.lng)),
  };
}

/** Web Mercator, in pixels of a 256 px world at zoom 0 (Leaflet's CRS). */
function project(lat: number, lng: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256];
}
function unproject(x: number, y: number): [number, number] {
  const lng = (x / 256) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / 256;
  return [(180 / Math.PI) * Math.atan(Math.sinh(n)), lng];
}

/**
 * The opening view, exactly as the live app fits it: Leaflet's fitBounds(HARAM_BOUNDS,
 * { padding: [16, 16] }) with zoomSnap 1 — the largest whole zoom at which the bounds fit inside
 * the map less 16 px on each side, clamped to 14–19, centred on the bounds' projected middle.
 */
export function fitView(b: Bounds, width: number, height: number, padding = 16): { legacyZoom: number; center: [lat: number, lng: number] } {
  const [x0, y0] = project(b.north, b.west);
  const [x1, y1] = project(b.south, b.east);
  const scale = Math.min((width - 2 * padding) / (x1 - x0), (height - 2 * padding) / (y1 - y0));
  const z = Math.max(LEGACY_MIN, Math.min(LEGACY_MAX, Math.floor(Math.log2(scale))));
  return { legacyZoom: z, center: unproject((x0 + x1) / 2, (y0 + y1) / 2) };
}
