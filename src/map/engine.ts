import { AttributionControl, Map as MLMap, ScaleControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SITE } from '../config/site.config';
import { POIS, RULES } from '../data';
import type { Poi, Status } from '../data/types';
import { isTapName } from '../domain/route-hint';
import { FEATURED_IDS } from '../domain/visits';
import { lookOf } from '../presentation/markers';
import type { IconName } from '../presentation/icons';
import { IconAtlas, createDrawer, cssPalette, type Drawer } from './images';
import { MeMarker } from './me';
import { addHintLayer, EMPTY_HINTS, HintLayer } from './hints';
import { addPoiLayers } from './poi-layers';
import { applyPoiView, entranceAt, entranceFeatures, markerImageIds, pairFeatures, placeAt, poiFeatures, popMarkers, womenAreas, type PoiView } from './pois';
import { RouteLayer, type RouteText } from './route';
import { LEGACY_MAX, LEGACY_MIN, fitView, haramBounds, legacyZoom, mapZoom } from './zoom';

export type { PoiView } from './pois';

/** The places a tap on a followed route names: every gate and every restroom block. */
const ROUTE_NAME_IDS = POIS.filter(isTapName).map((p) => p.id);

setWorkerUrl(workerUrl);

export type BaseLayer = 'satellite' | 'light';

export interface MapEngineOptions {
  container: HTMLElement;
  /** Name of a place in the visitor's language (gate labels). */
  nameOf(p: Poi): string;
  status(id: number): Status | undefined;
  /** A tap on the map: the place under it, or null for empty map. */
  onPick?(id: number | null): void;
  attribution?: { satellite: string; osm: string };
  /** Words on the route's labels, in the visitor's language. */
  routeText: RouteText;
  /** The visitor's dot, for screen readers («أنت هنا»). */
  meLabel(): string;
  /** A new car park vehicle entrance's name and state, in the visitor's language (owner, 2026-10-16). */
  entranceText?(id: string, open: boolean): { name: string; state: string } | null;
  /** A tap on one of those entrances. */
  onEntrance?(id: string): void;
}

const DIRS: Record<string, string> = { south: 'dir-south', west: 'dir-west', north: 'dir-north', east: 'dir-east' };

/** Map zoom of a legacy (Leaflet) zoom threshold. */
const at = mapZoom;

/**
 * The map (SPEC F1, N1; ARCHITECTURE §5): Esri imagery (or a light map), one GeoJSON source for every
 * place, drawn by the GPU in a few layers, and the women's prayer areas. Filters change layer
 * filters only: no data is rebuilt while the visitor moves the map, nothing is done per frame for
 * each place, and no class is toggled on <body>.
 */
export class MapEngine {
  readonly map: MLMap;
  /** The trip on the map (phase 5), and the visitor's dot. */
  readonly route: RouteLayer;
  readonly me: MeMarker;
  /** The names over the places a followed route goes by, and over a tapped one. */
  readonly hints: HintLayer;
  private version = 1;
  private view: PoiView = { ids: [], filter: 'all', withFeatured: true, hidden: false };
  /** The place whose card is open: drawn as a pin; every other place is hidden meanwhile (as the live app). */
  private selected: number | null = null;
  private touched = false;
  private base: BaseLayer = 'satellite';
  private palette = cssPalette();
  private icons = new IconAtlas();
  private drawer!: Drawer;

  static async create(opts: MapEngineOptions): Promise<MapEngine> {
    const e = new MapEngine(opts);
    await e.ready;
    return e;
  }

  private ready: Promise<void>;

  private constructor(private opts: MapEngineOptions) {
    const { container } = opts;
    const fit = fitView(haramBounds(POIS), container.clientWidth || innerWidth, container.clientHeight || innerHeight);
    const tiles = RULES.map.tiles;
    this.map = new MLMap({
      container,
      center: [fit.center[1], fit.center[0]],
      zoom: at(fit.legacyZoom),
      minZoom: at(LEGACY_MIN),
      maxZoom: at(LEGACY_MAX),
      // Rotation yes, tilt no (SPEC §9-6): the imagery is flat and tilted routes read badly.
      maxPitch: 0,
      pitchWithRotate: false,
      dragRotate: true,
      touchPitch: false,
      attributionControl: false,
      fadeDuration: 150,
      style: {
        version: 8,
        sources: {
          esri: {
            type: 'raster',
            tileSize: 256,
            maxzoom: 19,
            tiles: [tiles.satellite],
            attribution: opts.attribution?.satellite ?? 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
          },
          // The light map is OpenStreetMap: its credit is the OpenStreetMap line that always shows (below).
          light: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [SITE.LIGHT_TILES] },
          // Default data tiles (to zoom 18: positions kept to under a centimetre). Larger tiles (maxzoom
          // 14–15) were measured and gave no gain beyond noise (docs/PERF.md), so the places are not rounded.
          women: { type: 'geojson', data: womenAreas() },
          pois: { type: 'geojson', data: poiFeatures(opts.status), promoteId: 'id' },
          pairs: { type: 'geojson', data: pairFeatures() },
          carEntrances: { type: 'geojson', data: entranceFeatures({}) },
          hints: { type: 'geojson', data: EMPTY_HINTS },
        },
        layers: [],
      },
    });
    this.map.touchZoomRotate.enableRotation();
    this.map.keyboard.enable();
    // Esri's line whenever its imagery shows; OpenStreetMap's always (the streets and routes come from it).
    this.map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: opts.attribution?.osm ?? '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
      }),
      'bottom-left',
    );
    this.map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-left');
    const ratio = Math.min(3, Math.max(1, devicePixelRatio || 1));
    this.route = new RouteLayer(this.map, this.palette, opts.routeText, ratio);
    this.hints = new HintLayer(this.map, (id) => POIS.find((p) => p.id === id));
    this.me = new MeMarker(
      this.map,
      () => opts.meLabel(),
      () => this.palette.get('me'),
    );
    const drawer = (this.drawer = createDrawer({
      palette: this.palette,
      icons: this.icons,
      ratio,
      labelOf: (id) => this.opts.nameOf(POIS.find((p) => p.id === id)!),
      dirOf: (id) => DIRS[POIS.find((p) => p.id === id)!.direction],
      entranceOf: (id, open) => this.opts.entranceText?.(id, open) ?? null,
    }));
    // Marker images are drawn the first time the map needs one (images.ts). MapLibre 6 resolves a
    // missing image through this hook; the styleimagemissing event can no longer supply it.
    this.map.setMissingStyleImageResolver((id) => {
      const img = drawer.draw(id);
      if (img && !this.map.hasImage(id)) this.map.addImage(id, img.data, { pixelRatio: img.pixelRatio });
    });
    this.map.once('dragstart', () => (this.touched = true));
    this.map.once('zoomstart', (e) => e.originalEvent && (this.touched = true));
    this.map.on('click', (e) => this.pick(e.point.x, e.point.y));

    const icons = [...new Set(POIS.map((p) => lookOf(p).icon)), 'lock', 'car'] as IconName[];
    this.ready = Promise.all([
      this.icons.load(icons, ['#ffffff', this.palette.get('ink-800')]),
      document.fonts?.load(`600 11px "IBM Plex Sans Arabic"`).catch(() => undefined),
      new Promise<void>((r) => (this.map.loaded() ? r() : this.map.once('load', () => r()))),
    ]).then(() => this.addLayers());
  }

  // ---------- data ----------

  /** Which new vehicle entrances are open (all closed until the supervisor opens one). */
  private entranceState: Record<string, boolean> = {};

  /** The supervisor opened or closed one: three features, redrawn at once. */
  setEntrances(open: Record<string, boolean>): void {
    this.entranceState = { ...open };
    (this.map.getSource('carEntrances') as GeoJSONSource | undefined)?.setData(entranceFeatures(this.entranceState));
  }

  // ---------- layers ----------

  private addLayers() {
    const m = this.map;
    // Measurement only (scripts/perf.mjs): ?layers=base draws the imagery alone, to find MapLibre's own floor.
    if (navigator.webdriver && new URLSearchParams(location.search).get('layers') === 'base') {
      m.addLayer({ id: 'esri', type: 'raster', source: 'esri' });
      m.addLayer({ id: 'light', type: 'raster', source: 'light', layout: { visibility: 'none' } });
      for (const id of ['facilities']) m.addLayer({ id, type: 'circle', source: 'pois', filter: ['literal', false] });
      return;
    }
    m.addLayer({ id: 'esri', type: 'raster', source: 'esri' });
    m.addLayer({ id: 'light', type: 'raster', source: 'light', layout: { visibility: 'none' } });
    addPoiLayers(m, this.palette, this.version);
    addHintLayer(m, this.version);
    // The route and the visitor's dot under the chosen place's pin.
    this.route.install('selected');
    this.me.install('selected');
    this.applyView();
    this.prewarm();
  }

  /**
   * Draw the marker images ahead, a few at a time while the browser is idle, so that zooming past 17
   * or 19 does not draw a hundred of them in one go (a long task the visitor would feel).
   */
  private prewarm() {
    const v = this.version;
    const queue = markerImageIds(v, this.opts.status);
    const idle: (cb: (d: { timeRemaining(): number }) => void) => void =
      (window as unknown as { requestIdleCallback?: typeof idle }).requestIdleCallback ?? ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 16));
    const step = (d: { timeRemaining(): number }) => {
      if (v !== this.version) return;
      while (queue.length && d.timeRemaining() > 2) {
        const id = queue.shift()!;
        if (this.map.hasImage(id)) continue;
        const img = this.drawer.draw(id);
        if (img) this.map.addImage(id, img.data, { pixelRatio: img.pixelRatio });
      }
      if (queue.length) idle(step);
    };
    idle(step);
  }

  // ---------- what is shown ----------

  /** The places on the map now, must-visit sites included (for the tests and the app). */
  get shownIds(): number[] {
    return this.view.hidden ? [] : [...new Set([...this.view.ids, ...(this.view.withFeatured ? FEATURED_IDS : [])])];
  }

  /** Every place a visitor can find (the hidden wheelchair areas aside). */
  get allIds(): number[] {
    return POIS.filter((p) => p.subCategory !== 'wheelchair_zone').map((p) => p.id);
  }

  poi(id: number): Poi | undefined {
    return POIS.find((p) => p.id === id);
  }

  /** Show these places (a filter, a search): layer filters only, the data stays as it is. */
  setView(v: PoiView): void {
    // A new filter (or the markers shown again) pops them in; a search or panning doesn't (the live app's layer.ts).
    const pop = v.filter !== this.view.filter || (this.view.hidden && !v.hidden);
    this.view = v;
    if (!this.map.getLayer('facilities')) return;
    this.applyView();
    if (pop && !v.hidden) this.pop();
  }

  /** The markers fade in over 200 ms, once per filter tap, never during a gesture (pois.ts). */
  private pop() {
    if (reduce()) return;
    const version = this.version;
    popMarkers(this.map, () => version === this.version);
  }

  private applyView() {
    applyPoiView(this.map, this.view, this.selected, this.routeNames ? ROUTE_NAME_IDS : null);
  }

  /** On a followed route the gates and restroom blocks show again, to be tapped for their name (owner, 2026-10-25). */
  private routeNames = false;
  setRouteNames(on: boolean): void {
    if (on === this.routeNames) return;
    this.routeNames = on;
    if (this.map.getLayer('facilities')) this.applyView();
  }

  /** Open (or, with null, close) a place's card on the map: its pin, and nothing else, shows. */
  select(id: number | null): void {
    this.selected = id;
    if (this.map.getLayer('facilities')) this.applyView();
  }

  get selection(): number | null {
    return this.selected;
  }

  /**
   * Bring a place into the part of the map left visible between the top bar (`top` px) and the sheet
   * (`bottom` px): a flight when it was chosen from a list or a link, a short glide after a tap on
   * the map (the live app's focus()). Zoom is in Leaflet levels.
   */
  focus(id: number, opts: { legacyZoom?: number; fly: boolean; top: number; bottom: number }): void {
    const p = this.poi(id);
    if (!p) return;
    const zoom = opts.legacyZoom !== undefined ? at(Math.min(LEGACY_MAX, opts.legacyZoom)) : this.map.getZoom();
    const padding = { top: opts.top, bottom: opts.bottom, left: 0, right: 0 };
    if (reduce()) this.map.jumpTo({ center: [p.lng, p.lat], zoom, padding });
    else if (opts.fly) this.map.flyTo({ center: [p.lng, p.lat], zoom, padding, duration: 800, essential: true });
    else this.map.easeTo({ center: [p.lng, p.lat], zoom, padding, duration: 300 });
  }

  /** A facility opened or closed (admin simulator): its look is in the data, so the data is refreshed once. */
  refreshStatus(): void {
    (this.map.getSource('pois') as GeoJSONSource | undefined)?.setData(poiFeatures(this.opts.status));
  }

  /** Theme or language changed: colours and labels are drawn again, lazily. */
  restyle(): void {
    this.palette.reset();
    const old = this.version;
    this.version++;
    if (!this.map.getLayer('facilities')) return;
    this.map.removeLayer('featured');
    this.map.removeLayer('selected');
    for (const id of [
      'car-entrances',
      'esri',
      'light',
      'women-fill',
      'women-line',
      'inner-dots',
      'outer-dots',
      'facility-dots',
      'mixed-dots',
      'facilities',
      'parking',
      'outer-chips',
      'inner-numbers',
      'pairs',
      'gate-names',
      'hints',
    ])
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of this.map.listImages()) if (id.endsWith(`@${old}`) && !id.startsWith('rt')) this.map.removeImage(id);
    this.route.restyle();
    this.addLayers();
    this.setBase(this.base);
  }

  // ---------- base map, camera ----------

  setBase(kind: BaseLayer): void {
    this.base = kind;
    if (!this.map.getLayer('esri')) return;
    this.map.setLayoutProperty('esri', 'visibility', kind === 'satellite' ? 'visible' : 'none');
    this.map.setLayoutProperty('light', 'visibility', kind === 'light' ? 'visible' : 'none');
  }

  get baseLayer(): BaseLayer {
    return this.base;
  }

  /** The visitor's turn of the map, as the live app's buttons: +15° turns the map clockwise. */
  turn(deg: number): void {
    this.map.rotateTo(this.map.getBearing() - deg, { duration: reduce() ? 0 : 250 });
  }

  resetNorth(): void {
    this.map.rotateTo(0, { duration: reduce() ? 0 : 300 });
  }

  zoomBy(step: number): void {
    this.map.zoomTo(Math.round(this.map.getZoom()) + step, { duration: reduce() ? 0 : 250 });
  }

  /** Where true north points on screen, in degrees clockwise (for the compass needle). */
  get north(): number {
    return -this.map.getBearing();
  }

  get legacyZoom(): number {
    return legacyZoom(this.map.getZoom());
  }

  /** After a resize, fit the Haram again — unless the visitor has already moved the map (as the live app). */
  refit(): void {
    if (this.touched) return;
    const c = this.map.getContainer();
    const fit = fitView(haramBounds(POIS), c.clientWidth, c.clientHeight);
    this.map.jumpTo({ center: [fit.center[1], fit.center[0]], zoom: at(fit.legacyZoom) });
  }

  // ---------- picking ----------

  /** The place under a tap: the nearest marker within 16 px (the live app's 32 px hit area). */
  private pick(x: number, y: number) {
    // An alternative route (its line or its time label) is chosen before any place.
    const alt = this.route.hitAlternative(x, y);
    if (alt !== null) {
      this.route.pick(alt);
      return;
    }
    const ent = entranceAt(this.map, x, y);
    if (ent !== null) {
      this.opts.onEntrance?.(ent);
      return;
    }
    this.opts.onPick?.(placeAt(this.map, x, y));
  }
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
