/**
 * Places kept in the data but not shown anywhere (map, search, filters, links, headline counts).
 * Owner decisions:
 * - 2026-10-10: the wheelchair areas inside the mosque are not useful for now.
 * - 2026-11-04: hotels and restaurants are hidden until the owner adds them again with exact
 *   positions (the OSM ones are not all where the places really are).
 * Remove a sub-category from this set to bring its places back (their filter pill returns with them).
 *
 * Dependency-free on purpose: the build (vite.config.ts) reads it for the landing page's counters.
 */
export const HIDDEN_SUBCATEGORIES: ReadonlySet<string> = new Set(['wheelchair_zone', 'hotel', 'food']);
