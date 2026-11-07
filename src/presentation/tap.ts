/**
 * What a tap on the map means (UI plan phase 3, owner 2026-11-07: markers stay where they are, no
 * count bubbles). A finger covers about 44 px, so every marker within 22 px of the tap is a
 * candidate. Only one: it opens. Several (the finger landed on a tight group, «I tapped a restroom
 * and a gate opened»): one opens only when the finger is right on it and the others are clearly
 * farther; otherwise the map zooms in there instead, until they part.
 * Pure: the map hands it the candidates' distances on screen.
 */
export const TAP_RADIUS_PX = 22;
/** Right on a marker: the finger this close to its centre (a far dot is only 4–8 px wide). */
export const TAP_DIRECT_PX = 6;
/** The others must be at least this much farther than the one right under the finger. */
export const TAP_TIE_PX = 8;
/** How far one ambiguous tap zooms in (whole zoom levels). */
export const TAP_ZOOM_STEP = 2;

export type TapChoice = { open: number | null } | { zoomIn: true };

export function tapChoice(hits: readonly { id: number; d: number }[], canZoomIn: boolean): TapChoice {
  const byId = new Map<number, number>();
  for (const h of hits) if (h.d <= TAP_RADIUS_PX) byId.set(h.id, Math.min(h.d, byId.get(h.id) ?? Infinity));
  const near = [...byId].map(([id, d]) => ({ id, d })).sort((a, b) => a.d - b.d);
  if (!near.length) return { open: null };
  const clear = near.length === 1 || (near[0].d <= TAP_DIRECT_PX && near[1].d - near[0].d >= TAP_TIE_PX);
  if (!clear && canZoomIn) return { zoomIn: true };
  return { open: near[0].id };
}
