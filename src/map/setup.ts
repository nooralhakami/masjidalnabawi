import L from 'leaflet';
import { POIS, RULES } from '../data';
import type { Poi } from '../data/types';
import { SITE } from '../config/site.config';
import { t } from '../i18n';
import { icon } from '../ui/icons';

const OUTER = POIS.filter((p) => p.subCategory === 'gate_outer');

/** Haram bounds = the ring of outer gates. */
export const HARAM_BOUNDS = L.latLngBounds(OUTER.map((p) => [p.lat, p.lng] as [number, number]));

export interface MapHandle {
  map: L.Map;
  setBase(kind: 'satellite' | 'light'): void;
  base(): 'satellite' | 'light';
  relabel(): void;
}

export function createMap(el: HTMLElement): MapHandle {
  const cfg = RULES.map;
  const map = L.map(el, {
    center: cfg.center,
    zoom: cfg.default_zoom,
    maxZoom: cfg.max_zoom,
    minZoom: 14,
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 1,
    tapTolerance: 12,
  });

  const satellite = L.tileLayer(cfg.tiles.satellite, {
    maxZoom: cfg.max_zoom,
    maxNativeZoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  });
  const light = SITE.LIGHT_TILES
    ? L.tileLayer(SITE.LIGHT_TILES, { maxZoom: cfg.max_zoom, maxNativeZoom: 19, attribution: SITE.LIGHT_ATTRIBUTION })
    : L.tileLayer(cfg.tiles.light, { maxZoom: cfg.max_zoom, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO' });
  let current: 'satellite' | 'light' = 'satellite';
  satellite.addTo(map);

  const setBase = (kind: 'satellite' | 'light') => {
    if (kind === current) return;
    map.removeLayer(kind === 'satellite' ? light : satellite);
    (kind === 'satellite' ? satellite : light).addTo(map);
    current = kind;
    syncLabels();
  };

  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 90 }).addTo(map);

  // Layer toggle + locate (inline-end column) and zoom (inline-start column).
  const tools = new L.Control({ position: 'bottomleft' });
  const zoom = new L.Control({ position: 'bottomright' });
  const rotate = new L.Control({ position: 'bottomright' });
  let layerBtn!: HTMLButtonElement;
  let locBtn!: HTMLButtonElement;
  let zin!: HTMLButtonElement;
  let zout!: HTMLButtonElement;

  let bearing = 0;
  let touchStartAngle: number | null = null;
  let touchStartBearing = 0;
  let panePosition: L.Point | null = null;
  const mapPane = map.getPane('mapPane');
  const originalSetPosition = L.DomUtil.setPosition;
  // Leaflet updates the map pane transform while dragging. Compose the rotation
  // with Leaflet's translate so a one-finger pan cannot reset the bearing.
  (L.DomUtil as typeof L.DomUtil).setPosition = (element: HTMLElement, position: L.Point) => {
    if (element === mapPane) {
      panePosition = position;
      originalSetPosition(element, position);
      applyBearing();
      return;
    }
    originalSetPosition(element, position);
  };
  let appliedTransform = '';
  let applyingTransform = false;
  const applyBearing = () => {
    if (!mapPane) return;
    mapPane.style.transformOrigin = 'center center';
    appliedTransform = `${panePosition ? `translate3d(${panePosition.x}px, ${panePosition.y}px, 0)` : ''} rotate(${bearing}deg) scale(${bearing === 0 ? 1 : 1.42})`;
    applyingTransform = true;
    mapPane.style.transform = appliedTransform;
    queueMicrotask(() => { applyingTransform = false; });
  };
  const transformObserver = new MutationObserver(() => {
    if (!mapPane || applyingTransform || mapPane.style.transform === appliedTransform) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(mapPane).transform);
    panePosition = new L.Point(matrix.e, matrix.f);
    applyBearing();
  });
  transformObserver.observe(mapPane!, { attributes: true, attributeFilter: ['style'] });

  // Two-finger rotation: keep the first finger pair as the gesture anchor so
  // normal one-finger panning and pinch zoom continue to work as usual.
  const touchAngle = (touches: TouchList): number => {
    const a = touches[0];
    const b = touches[1];
    return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
  };
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 2) {
      touchStartAngle = touchAngle(event.touches);
      touchStartBearing = bearing;
    }
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 2 || touchStartAngle === null) return;
    event.preventDefault();
    let delta = touchAngle(event.touches) - touchStartAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    bearing = (touchStartBearing + delta + 360) % 360;
    applyBearing();
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) touchStartAngle = null;
  };
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });

  tools.onAdd = () => {
    const box = L.DomUtil.create('div', 'mc');
    layerBtn = button(box, 'layers');
    locBtn = button(box, 'locate', 'is-locate');
    layerBtn.addEventListener('click', () => setBase(current === 'satellite' ? 'light' : 'satellite'));
    locBtn.addEventListener('click', () => el.dispatchEvent(new CustomEvent('locate-request', { bubbles: true })));
    L.DomEvent.disableClickPropagation(box);
    return box;
  };
  rotate.onAdd = () => {
    const box = L.DomUtil.create('div', 'mc mc-rotate');
    const left = button(box, 'rotate-left');
    const reset = button(box, 'rotate-reset');
    const right = button(box, 'rotate-right');
    left.setAttribute('aria-label', 'تدوير الخريطة عكس عقارب الساعة');
    reset.setAttribute('aria-label', 'إعادة اتجاه الخريطة');
    right.setAttribute('aria-label', 'تدوير الخريطة مع عقارب الساعة');
    left.title = left.getAttribute('aria-label')!;
    reset.title = reset.getAttribute('aria-label')!;
    right.title = right.getAttribute('aria-label')!;
    left.addEventListener('click', () => { bearing = (bearing - 15 + 360) % 360; applyBearing(); });
    reset.addEventListener('click', () => { bearing = 0; applyBearing(); });
    right.addEventListener('click', () => { bearing = (bearing + 15) % 360; applyBearing(); });
    L.DomEvent.disableClickPropagation(box);
    return box;
  };
  rotate.addTo(map);

  zoom.onAdd = () => {
    const box = L.DomUtil.create('div', 'mc');
    const grp = L.DomUtil.create('div', 'mc-zoom', box);
    zin = button(grp, 'plus');
    grp.appendChild(document.createElement('hr'));
    zout = button(grp, 'minus');
    zin.addEventListener('click', () => map.zoomIn());
    zout.addEventListener('click', () => map.zoomOut());
    L.DomEvent.disableClickPropagation(box);
    return box;
  };
  tools.addTo(map);
  zoom.addTo(map);

  function syncLabels() {
    layerBtn.setAttribute('aria-label', t(current === 'satellite' ? 'layer_map' : 'layer_sat'));
    layerBtn.title = layerBtn.getAttribute('aria-label')!;
    locBtn.setAttribute('aria-label', t('gps'));
    locBtn.title = t('gps');
    zin.setAttribute('aria-label', t('zoom_in'));
    zout.setAttribute('aria-label', t('zoom_out'));
  }
  syncLabels();

  // Fit once the container has its final size (stylesheets may still be loading).
  // Refit only if the size changed and the visitor hasn't moved the map yet.
  let fittedSize = '';
  let touched = false;
  const fit = () => {
    map.invalidateSize();
    const size = map.getSize().toString();
    if (touched || size === fittedSize) return;
    fittedSize = size;
    map.fitBounds(HARAM_BOUNDS, { padding: [16, 16], animate: false });
  };
  fit();
  map.once('dragstart zoomstart', () => (touched = true));
  if (document.readyState !== 'complete') window.addEventListener('load', fit, { once: true });

  return { map, setBase, base: () => current, relabel: syncLabels };
}

function button(parent: HTMLElement, ic: Parameters<typeof icon>[0], cls = ''): HTMLButtonElement {
  const b = L.DomUtil.create('button', `mc-btn ${cls}`, parent) as HTMLButtonElement;
  b.type = 'button';
  b.innerHTML = icon(ic, 21);
  return b;
}

export const latLng = (p: Poi): L.LatLngExpression => [p.lat, p.lng];
