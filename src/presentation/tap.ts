/**
 * What a tap on the map means (UI plan phase 3, owner 2026-11-07: markers stay where they are, no
 * count bubbles). A finger covers about 44 px, so every marker within 22 px of the tap is a
 * candidate. One clearly nearest: it opens. Several about as near (the finger landed on a tight
 * group, «I tapped a restroom and a gate opened»): the map zooms in there instead, until they part.
 * Pure: the map hands it the candidates' distances on screen.
 */
export const TAP_RADIUS_PX = 22;
/** Two markers whose distances to the finger differ by less than this are «about as near». */
export const TAP_TIE_PX = 8;
/** How far one ambiguous tap zooms in (whole zoom levels). */
export const TAP_ZOOM_STEP = 2;

export type TapChoice = { open: number | null } | { zoomIn: true };

export function tapChoice(hits: readonly { id: number; d: number }[], canZoomIn: boolean): TapChoice {
  const byId = new Map<number, number>();
  for (const h of hits) if (h.d <= TAP_RADIUS_PX) byId.set(h.id, Math.min(h.d, byId.get(h.id) ?? Infinity));
  const near = [...byId].map(([id, d]) => ({ id, d })).sort((a, b) => a.d - b.d);
  if (!near.length) return { open: null };
  if (near.length > 1 && canZoomIn && near[1].d - near[0].d < TAP_TIE_PX) return { zoomIn: true };
  return { open: near[0].id };
}
