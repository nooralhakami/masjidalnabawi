import { AttributionControl, Map as MLMap, ScaleControl, setWorkerUrl, type GeoJSONSource, type SkySpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SITE } from '../config/site.config';
import { POIS, RULES } from '../data';
import { alharamainPlaza } from '../data-next/alharamain-3d';
import { rugLayout } from './rug-layout';
import { sunPosition } from '../domain/daylight';
import type { Poi, Status } from '../data/types';
import { isHidden } from '../domain/filters';
import { isTapName } from '../domain/route-hint';
import { FEATURED_IDS } from '../domain/visits';
import { lookOf } from '../presentation/markers';
import type { IconName } from '../presentation/icons';
import { CrowdLayer } from './crowd-layer';
import { RugLayer } from './rug-layer';
import { greetingBarriers, queueRails, womenBarriers } from './women-barriers';
import { HaramGlbLayer } from './glb-layer';
import { IconAtlas, createDrawer, cssPalette, type Drawer } from './images';
import { LampGlowLayer } from './lamp-glow-layer';
import { MeMarker } from './me';
import { PlazaMarbleLayer } from './plaza-layer';
import { addHintLayer, EMPTY_HINTS, HintLayer } from './hints';
import { addPoiLayers } from './poi-layers';
import { applyPoiView, entranceAt, entranceFeatures, markerImageIds, markerNear, pairFeatures, placesAt, poiFeatures, popMarkers, womenAreas, type PoiView } from './pois';
import { RouteLayer, type RouteText } from './route';
import { sceneLight, sceneOverride, type SceneLight } from './scene-light';
import { TerrainLayer } from './terrain-layer';
import { LEGACY_MAX, LEGACY_MIN, fitView, haramBounds, legacyZoom, mapZoom } from './zoom';
import { SelectPulse } from './pulse';
import { TAP_ZOOM_STEP, tapChoice } from '../presentation/tap';

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
/** How close the 3D view may come (MapLibre zoom; the flat map stops at the live app's 19, MapLibre 18). */
export const MAX_ZOOM_3D = 22;

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
  private mode3d = false;
  /** The 3D models' layer while 3D is on, and the minute timer that follows the sun meanwhile. */
  private models: HaramGlbLayer | null = null;
  private crowd: CrowdLayer | null = null;
  private rugs: RugLayer | null = null;
  private terrain: TerrainLayer | null = null;
  private marble: PlazaMarbleLayer | null = null;
  private glow: LampGlowLayer | null = null;
  private lightTimer: ReturnType<typeof setInterval> | null = null;
  /** Where the canopies' lanterns stand (read from their file once). */
  private lamps: [number, number][] | null = null;
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
      // Flat until 3D mode unlocks pitch up to 85° (SPEC-3D.md §1); map-main opens in 3D (owner, 2026-11-06).
      maxPitch: 0,
      // A right-button (or Ctrl) drag turns and tilts, as in other 3D maps; flat (max pitch 0), the
      // tilt has nowhere to go, so the 2D map only turns (owner, 2026-11-07).
      pitchWithRotate: true,
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
    this.desktopGestures();
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
    this.pulse = new SelectPulse(this.map, this.palette);
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
    if (this.mode3d) this.sync3DLayer();
    addHintLayer(m, this.version);
    // The route and the visitor's dot under the chosen place's pin.
    this.route.install('selected');
    this.me.install('selected');
    this.applyView();
    this.prewarm();
  }

  /**
   * Dress the map as the Al-Haramain 3D view: the plaza's coloured areas, the 3D files, and the light
   * of this moment in Madinah (scene-light.ts): a sky with a horizon, the imagery dimmed as the sun
   * goes down, and the lamps of the plaza and the Mosque lit at night. All of it comes off in 2D, so
   * panning, zooming and rotating pay nothing (PERF.md).
   */
  private sync3DLayer(): void {
    const m = this.map;
    const before = m.getLayer('inner-dots') ? 'inner-dots' : undefined;
    const on = this.mode3d;
    if (on) {
      // Under everything: the ground's colour of the hour, where no imagery has loaded yet.
      if (!m.getLayer('alharamain-3d-ground')) m.addLayer({ id: 'alharamain-3d-ground', type: 'background' }, m.getLayer('esri') ? 'esri' : undefined);
      if (!m.getSource('alharamain-plaza')) m.addSource('alharamain-plaza', { type: 'geojson', data: alharamainPlaza() });
      if (!m.getLayer('alharamain-3d-plaza')) {
        m.addLayer(
          {
            id: 'alharamain-3d-plaza',
            type: 'fill',
            source: 'alharamain-plaza',
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
          },
          before,
        );
      }
      if (!m.getSource('alharamain-lamps')) m.addSource('alharamain-lamps', { type: 'geojson', data: lampFeatures(this.lamps ?? []) });
      if (!m.getLayer('alharamain-3d-lamps')) {
        m.addLayer(
          {
            id: 'alharamain-3d-lamps',
            type: 'circle',
            source: 'alharamain-lamps',
            paint: {
              // A pool of light about 12 m across under each lantern, lying on the ground.
              'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, 2.8, 22, 707],
              'circle-color': '#fff7ea',
              'circle-blur': 1,
              'circle-opacity': 0,
              'circle-pitch-alignment': 'map',
              'circle-pitch-scale': 'map',
            },
          },
          before,
        );
      }
      // The plazas' marble, over their official colours and under the lamps' pools of light.
      if (!m.getLayer('alharamain-3d-marble')) {
        this.marble = new PlazaMarbleLayer(this.currentLight());
        m.addLayer(this.marble, 'alharamain-3d-lamps');
      }
      // The prayer carpets, laid whole on the paving (owner, 2026-11-07).
      if (!m.getLayer('alharamain-3d-rugs')) {
        this.rugs = new RugLayer(this.currentLight());
        if (this.lamps) this.rugs.setColumns(this.lamps);
        m.addLayer(this.rugs, 'alharamain-3d-lamps');
      }
      // The green barriers round the courtyards' prayer areas (owner, 2026-11-06), about a metre high.
      // Laid once the canopies' file has said where the columns stand (the carpets keep clear of them).
      if (!m.getSource('alharamain-barriers'))
        m.addSource('alharamain-barriers', { type: 'geojson', data: this.lamps ? rugLayout(this.lamps).barriers : { type: 'FeatureCollection', features: [] } });
      if (!m.getLayer('alharamain-3d-barriers')) {
        m.addLayer(
          {
            id: 'alharamain-3d-barriers',
            type: 'fill-extrusion',
            source: 'alharamain-barriers',
            minzoom: 16,
            paint: { 'fill-extrusion-color': '#1f9a72', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.95 },
          },
          before,
        );
      }
      // The beige panels round the women's areas (owner, 2026-11-07), 1.1 m high.
      if (!m.getSource('alharamain-women-barriers')) m.addSource('alharamain-women-barriers', { type: 'geojson', data: womenBarriers() });
      if (!m.getLayer('alharamain-3d-women-barriers')) {
        m.addLayer(
          {
            id: 'alharamain-3d-women-barriers',
            type: 'fill-extrusion',
            source: 'alharamain-women-barriers',
            minzoom: 16,
            paint: { 'fill-extrusion-color': '#d9c4a0', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.97 },
          },
          before,
        );
      }
      // The metal rails of the Rawdah's queues (owner, 2026-11-08), 1 m high.
      if (!m.getSource('alharamain-queue-rails')) m.addSource('alharamain-queue-rails', { type: 'geojson', data: queueRails() });
      if (!m.getLayer('alharamain-3d-queue-rails')) {
        m.addLayer(
          {
            id: 'alharamain-3d-queue-rails',
            type: 'fill-extrusion',
            source: 'alharamain-queue-rails',
            minzoom: 16,
            paint: { 'fill-extrusion-color': '#a7adb3', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.97 },
          },
          before,
        );
      }
      // The green barriers ordering the greeting at the Prophet's chamber (owner, 2026-11-08).
      if (!m.getSource('alharamain-greeting-barriers')) m.addSource('alharamain-greeting-barriers', { type: 'geojson', data: greetingBarriers() });
      if (!m.getLayer('alharamain-3d-greeting-barriers')) {
        m.addLayer(
          {
            id: 'alharamain-3d-greeting-barriers',
            type: 'fill-extrusion',
            source: 'alharamain-greeting-barriers',
            minzoom: 16,
            paint: { 'fill-extrusion-color': '#1f9a72', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.95 },
          },
          before,
        );
      }
      // The mountains of Madinah on the horizon, under the Mosque's own models.
      if (!m.getLayer('alharamain-3d-terrain')) {
        this.terrain = new TerrainLayer(this.currentLight());
        m.addLayer(this.terrain, before);
      }
      if (!m.getLayer('alharamain-3d-models')) {
        this.models = new HaramGlbLayer(this.currentLight(), (lamps) => {
          this.lamps = lamps;
          (m.getSource('alharamain-lamps') as GeoJSONSource | undefined)?.setData(lampFeatures(lamps));
          this.glow?.setLamps(lamps);
          this.crowd?.setColumns(lamps);
          this.rugs?.setColumns(lamps);
          (m.getSource('alharamain-barriers') as GeoJSONSource | undefined)?.setData(rugLayout(lamps).barriers);
        });
        m.addLayer(this.models, before);
      }
      // People walking the courtyards, after the models so they share their depth (owner, 2026-11-06).
      if (!m.getLayer('alharamain-3d-crowd')) {
        this.crowd = new CrowdLayer(this.currentLight());
        if (this.lamps) this.crowd.setColumns(this.lamps);
        m.addLayer(this.crowd, before);
      }
      // The lanterns' glow, after the models so the Mosque hides those behind it.
      if (!m.getLayer('alharamain-3d-glow')) {
        this.glow = new LampGlowLayer(this.currentLight());
        if (this.lamps) this.glow.setLamps(this.lamps);
        m.addLayer(this.glow, before);
      }
      this.applyLight();
      if (!this.lightTimer) this.lightTimer = setInterval(() => this.applyLight(), 60_000);
    } else {
      if (this.lightTimer) clearInterval(this.lightTimer);
      this.lightTimer = null;
      this.models = null;
      this.crowd = null;
      this.rugs = null;
      this.terrain = null;
      this.marble = null;
      this.glow = null;
      for (const id of [
        'alharamain-3d-models',
        'alharamain-3d-crowd',
        'alharamain-3d-barriers',
        'alharamain-3d-women-barriers',
        'alharamain-3d-queue-rails',
        'alharamain-3d-greeting-barriers',
        'alharamain-3d-glow',
        'alharamain-3d-terrain',
        'alharamain-3d-lamps',
        'alharamain-3d-rugs',
        'alharamain-3d-marble',
        'alharamain-3d-plaza',
        'alharamain-3d-ground',
      ]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      for (const id of ['esri', 'light']) {
        if (!m.getLayer(id)) continue;
        m.setPaintProperty(id, 'raster-saturation', 0);
        m.setPaintProperty(id, 'raster-contrast', 0);
        m.setPaintProperty(id, 'raster-brightness-min', 0);
        m.setPaintProperty(id, 'raster-brightness-max', 1);
      }
      // No sky in 2D (MapLibre accepts no value to remove it, though its type asks for one).
      m.setSky(undefined as unknown as SkySpecification);
    }
  }

  /** The light now: the sun over Madinah, or the moment a preview link names (`?scene=night`). */
  private currentLight(): SceneLight {
    return sceneLight(sceneOverride(location.search) ?? sunPosition(new Date()));
  }

  /** Light the 3D scene as it is now (called on entering 3D, then once a minute). */
  private applyLight(): void {
    const m = this.map;
    if (!this.mode3d) return;
    const light = this.currentLight();
    this.models?.setLight(light);
    this.crowd?.setLight(light);
    this.rugs?.setLight(light);
    this.terrain?.setLight(light);
    this.marble?.setLight(light);
    this.glow?.setLight(light);
    for (const id of ['esri', 'light']) {
      if (!m.getLayer(id)) continue;
      m.setPaintProperty(id, 'raster-saturation', light.raster.saturation);
      m.setPaintProperty(id, 'raster-contrast', light.raster.contrast);
      m.setPaintProperty(id, 'raster-brightness-min', light.raster.brightnessMin);
      m.setPaintProperty(id, 'raster-brightness-max', light.raster.brightnessMax);
    }
    // Lit plazas stand out of the dark city: their areas grow brighter as night falls.
    if (m.getLayer('alharamain-3d-plaza')) m.setPaintProperty('alharamain-3d-plaza', 'fill-opacity', ['min', 0.9, ['*', ['get', 'opacity'], 1 + 0.35 * light.night]]);
    if (m.getLayer('alharamain-3d-ground')) m.setPaintProperty('alharamain-3d-ground', 'background-color', light.ground);
    if (m.getLayer('alharamain-3d-lamps')) m.setPaintProperty('alharamain-3d-lamps', 'circle-opacity', 0.7 * light.night);
    m.setSky(light.sky);
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

  /** Every place a visitor can find (hidden sub-categories aside: data/hidden.ts). */
  get allIds(): number[] {
    return POIS.filter((p) => !isHidden(p)).map((p) => p.id);
  }

  /**
   * Where a drawn marker is on screen (page px), the one nearest the middle of the free part of the
   * map between `top` and `bottom` (page px): for the first-visit hint. Null when none shows there.
   */
  markerOnScreen(top: number, bottom: number): { x: number; y: number } | null {
    const r = this.map.getContainer().getBoundingClientRect();
    const t = Math.max(0, top - r.top);
    const b = Math.min(r.height, bottom - r.top);
    if (b - t < 40) return null;
    // Room above the marker for the hint's bubble; a fingertip's room at the sides and below.
    const pad = 24;
    const q = markerNear(this.map, { x: r.width / 2, y: (t + b) / 2 }, [
      [pad, t + 88],
      [r.width - pad, b - pad],
    ]);
    return q && { x: r.left + q.x, y: r.top + q.y };
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
    const changed = id !== this.selected;
    this.selected = id;
    if (this.map.getLayer('facilities')) this.applyView();
    // A short gold ring on the newly chosen marker: «this one» (UI plan phase 3).
    const p = id !== null && changed ? this.poi(id) : undefined;
    if (p && this.map.getLayer('selected')) this.pulse.play(p.lng, p.lat);
    else if (id === null) this.pulse.stop();
  }

  /** The chosen marker's gold ring (UI plan phase 3). */
  readonly pulse: SelectPulse;

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
      'alharamain-3d-glow',
      'alharamain-3d-models',
      'alharamain-3d-terrain',
      'alharamain-3d-lamps',
      'alharamain-3d-marble',
      'alharamain-3d-plaza',
      'alharamain-3d-ground',
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

  // ---------- base map, camera, 3D mode ----------

  setBase(kind: BaseLayer): void {
    this.base = kind;
    if (!this.map.getLayer('esri')) return;
    this.map.setLayoutProperty('esri', 'visibility', kind === 'satellite' ? 'visible' : 'none');
    this.map.setLayoutProperty('light', 'visibility', kind === 'light' ? 'visible' : 'none');
  }

  get baseLayer(): BaseLayer {
    return this.base;
  }

  /**
   * Toggle 3D mode (SPEC-3D.md §1): tilts to pitch 45° and bearing 22° over 1000 ms (or 0 ms with
   * reduced motion) and shows the 3D fill-extrusion layer; returns to flat pitch 0° / bearing 0°
   * over 800 ms when turned off.
   */
  toggle3DMode(enabled = !this.mode3d, opts: { instant?: boolean } = {}): boolean {
    this.mode3d = enabled;
    const instant = opts.instant || reduce();
    if (enabled) {
      this.map.setMaxPitch(85);
      // Close enough to see the models' detail (owner, 2026-11-07); the flat map keeps the live app's limit.
      this.map.setMaxZoom(MAX_ZOOM_3D);
      this.map.touchPitch.enable();
      this.sync3DLayer();
      this.map.easeTo({ pitch: 45, bearing: 22, duration: instant ? 0 : 1000 });
    } else {
      this.map.touchPitch.disable();
      this.sync3DLayer();
      const flatMax = at(LEGACY_MAX);
      this.map.easeTo({ pitch: 0, bearing: 0, zoom: Math.min(this.map.getZoom(), flatMax), duration: instant ? 0 : 800 });
      const lockFlat = () => {
        if (this.mode3d) return;
        this.map.setMaxPitch(0);
        this.map.setMaxZoom(flatMax);
      };
      if (instant) lockFlat();
      else this.map.once('moveend', lockFlat);
    }
    return this.mode3d;
  }

  get is3D(): boolean {
    return this.mode3d;
  }

  /**
   * The laptop's ways to turn and tilt the 3D view (owner, 2026-11-07), besides a right-button or
   * Ctrl drag: Option/Alt with a two-finger scroll tilts (up and down) and turns (left and right);
   * Safari's two-finger turn on the trackpad turns the map. A plain scroll still zooms, and touch
   * screens keep their own gestures untouched.
   */
  private desktopGestures(): void {
    const el = this.map.getCanvasContainer();
    el.addEventListener(
      'wheel',
      (e) => {
        if (!e.altKey || !this.mode3d) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const k = e.deltaMode === 1 ? 16 : 1;
        this.map.jumpTo({
          pitch: Math.max(0, Math.min(this.map.getMaxPitch(), this.map.getPitch() - e.deltaY * k * 0.12)),
          bearing: this.map.getBearing() + e.deltaX * k * 0.2,
        });
      },
      { capture: true, passive: false },
    );
    let last = 0;
    type Gesture = Event & { rotation: number };
    el.addEventListener('gesturestart', (e) => {
      last = (e as Gesture).rotation;
    });
    el.addEventListener('gesturechange', (e) => {
      const r = (e as Gesture).rotation;
      if (this.mode3d) this.map.setBearing(this.map.getBearing() - (r - last));
      last = r;
    });
  }

  /** Tilt the 3D view by `deg` (+ more toward the horizon), as the tilt buttons do. */
  tilt(deg: number): void {
    const pitch = Math.max(0, Math.min(this.map.getMaxPitch(), this.map.getPitch() + deg));
    this.map.easeTo({ pitch, duration: reduce() ? 0 : 250 });
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
    // Markers stay where they are (owner); a tap on a tight group zooms in there until they part.
    const max = this.map.getMaxZoom();
    const choice = tapChoice(placesAt(this.map, x, y), this.map.getZoom() < max - 0.5);
    if ('zoomIn' in choice) {
      const around = this.map.unproject([x, y]);
      const zoom = Math.min(max, this.map.getZoom() + TAP_ZOOM_STEP);
      if (reduce()) this.map.jumpTo({ center: around, zoom });
      else this.map.easeTo({ center: around, zoom, duration: 300 });
      return;
    }
    const place = choice.open;
    // In 3D, a tap on no place but on a canopy opens or closes it (owner, 2026-11-06).
    if (place === null && this.mode3d && this.models?.toggleCanopyAt(x, y)) return;
    this.opts.onPick?.(place);
  }
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The canopies' lanterns as points, for the pools of light under them. */
function lampFeatures(lngLats: [number, number][]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: 'FeatureCollection', features: lngLats.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } })) };
}
