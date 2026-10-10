import L from 'leaflet';
import 'leaflet-rotate';
import { POIS, ROUTING, RULES } from '../data';
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
    rotate: true,
    bearing: 0,
    touchRotate: true,
    touchZoom: true,
    shiftKeyRotate: false,
    rotateControl: false,
  });

  const satellite = L.tileLayer(cfg.tiles.satellite, {
    maxZoom: cfg.max_zoom,
    maxNativeZoom: 19,
    // Keep more tiles round the view (fewer empty squares while panning) and don't fetch tiles in the
    // middle of a zoom animation (SPEC F13).
    keepBuffer: 4,
    updateWhenZooming: false,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  });
  const light = SITE.LIGHT_TILES
    ? L.tileLayer(SITE.LIGHT_TILES, { maxZoom: cfg.max_zoom, maxNativeZoom: 19, keepBuffer: 4, updateWhenZooming: false, attribution: SITE.LIGHT_ATTRIBUTION })
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

  // Women's prayer areas inside the mosque: a soft pink wash under routes and markers.
  // (inside leaflet-rotate's pane, like the overlay pane, so it turns and zooms with the map)
  map.createPane('women-areas', map.getPane('rotatePane') ?? undefined).style.zIndex = '350';
  for (const area of ROUTING.women_prayer_areas ?? []) {
    L.polygon(area.polygon, { pane: 'women-areas', className: 'women-area', interactive: false, weight: 1.5, smoothFactor: 0 }).addTo(map);
  }

  // Walking and driving routes beyond the plazas use OpenStreetMap streets (ODbL).
  map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>');
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 90 }).addTo(map);

  // Layer toggle + locate (inline-end column) and zoom (inline-start column).
  const tools = new L.Control({ position: 'bottomleft' });
  const zoom = new L.Control({ position: 'bottomright' });
  let layerBtn!: HTMLButtonElement;
  let locBtn!: HTMLButtonElement;
  let zin!: HTMLButtonElement;
  let zout!: HTMLButtonElement;
  let rotLeft: HTMLButtonElement | undefined;
  let rotReset: HTMLButtonElement | undefined;
  let rotRight: HTMLButtonElement | undefined;


  tools.onAdd = () => {
    const box = L.DomUtil.create('div', 'mc');
    layerBtn = button(box, 'layers');
    locBtn = button(box, 'locate', 'is-locate');
    layerBtn.addEventListener('click', () => setBase(current === 'satellite' ? 'light' : 'satellite'));
    locBtn.addEventListener('click', () => el.dispatchEvent(new CustomEvent('locate-request', { bubbles: true })));
    L.DomEvent.disableClickPropagation(box);
    return box;
  };
  // One column: zoom (+/−), then rotation (↺ · compass · ↻). The compass needle always points to true north.
  zoom.onAdd = () => {
    const box = L.DomUtil.create('div', 'mc mc-right');
    const grp = L.DomUtil.create('div', 'mc-zoom', box);
    zin = button(grp, 'plus');
    grp.appendChild(document.createElement('hr'));
    zout = button(grp, 'minus');
    zin.addEventListener('click', () => map.zoomIn());
    zout.addEventListener('click', () => map.zoomOut());

    const rot = L.DomUtil.create('div', 'mc-zoom mc-rotate', box);
    rotRight = button(rot, 'rotate-right');
    rot.appendChild(document.createElement('hr'));
    rotReset = button(rot, 'rotate-reset', 'mc-compass');
    rot.appendChild(document.createElement('hr'));
    rotLeft = button(rot, 'rotate-left');
    rotLeft.addEventListener('click', () => map.setBearing(map.getBearing() - 15));
    rotRight.addEventListener('click', () => map.setBearing(map.getBearing() + 15));
    rotReset.addEventListener('click', () => map.setBearing(0));
    const syncCompass = () => {
      const bearing = map.getBearing?.() ?? 0;
      rotReset!.style.setProperty('--bearing', `${-bearing}deg`);
      rotReset!.classList.toggle('is-rotated', Math.abs(((bearing % 360) + 360) % 360) > 0.5);
    };
    map.on('rotate', syncCompass);
    syncCompass();
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
    for (const [b, k] of [[rotLeft, 'rot_left'], [rotReset, 'rot_reset'], [rotRight, 'rot_right']] as const) {
      if (!b) continue;
      b.setAttribute('aria-label', t(k));
      b.title = t(k);
    }
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
