declare const __POI_COUNTS__: { places: number; gates: number; parking: number };

/**
 * Headline numbers for the landing page, computed from data/pois.json at build time
 * (see `define` in vite.config.ts) so the page doesn't ship the whole POI list.
 */
export const COUNTS = __POI_COUNTS__;
