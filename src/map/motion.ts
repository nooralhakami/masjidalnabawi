import type L from 'leaflet';

/** How long after the last movement the costly effects come back. */
const SETTLE_MS = 150;

/**
 * While the map is being panned, zoomed or rotated, <body> gets the class "map-moving". The CSS uses
 * it to drop effects that must be recomputed on every frame — the blur behind the glass panels,
 * the soft glow round markers, endless animations — and they return as soon as the map settles.
 * On phones these were the main cause of stutter during gestures (SPEC F13).
 */
export function trackMotion(map: L.Map, root: HTMLElement = document.body): void {
  let timer = 0;
  const moving = () => {
    clearTimeout(timer);
    root.classList.add('map-moving');
  };
  const settled = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => root.classList.remove('map-moving'), SETTLE_MS);
  };
  map.on('movestart zoomstart', moving);
  map.on('moveend zoomend', settled);
  // leaflet-rotate has no reliable start/end for button and touch rotation: treat each step as motion.
  map.on('rotate', () => {
    moving();
    settled();
  });
}
