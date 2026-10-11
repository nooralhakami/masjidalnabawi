/**
 * Places kept in the data but not shown anywhere (map, search, filters, links, headline counts).
 * Owner decision 2026-10-10: the wheelchair areas inside the mosque are not useful for now.
 * Remove a sub-category from this set to bring its places back.
 *
 * Dependency-free on purpose: the build (vite.config.ts) reads it for the landing page's counters.
 */
export const HIDDEN_SUBCATEGORIES: ReadonlySet<string> = new Set(['wheelchair_zone']);
