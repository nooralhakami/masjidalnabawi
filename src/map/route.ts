import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { LatLng, Poi } from '../data/types';
import { parkingAccess } from '../domain/parking';
import { ARROW_EVERY_M, arrowsAlong, boundsOf, pointAlong, routeSummary, stepMarks, type RouteSummary, type StepTurn } from '../presentation/route-view';
import { fullPath, type Plan } from '../routing/plan';
import type { ShortcutKind, ShortcutResult } from '../routing/walk';
import type { Palette } from './images';

/**
 * A trip on the GPU map (the live app's map/route-layer.ts, SPEC N7, N8): walking legs in green with
 * gold dashes, the drive in blue, the stretch in the underground car park as a tunnel (dashed), the
 * level-A way and the ramps edged yellow (up) and green (down); arrows every 55 m, the start and end,
 * and the car park marks (P at the ramp in, «P 9A» where the car turns into its lot, ↑A / ↓B on the
 * ramps, the lot's entrances when walking to it). The other routes (up to two) are faint, each with
 * its time, and a tap chooses one.
 *
 * How it stays cheap: a route is a handful of GeoJSON features set once per route; the arrows are
 * placed in metres once (a zoom does not move them); the draw-in animates one paint property for
 * 600 ms, by share of the line (line-progress), so a zoom during it cannot hide part of the line.
 */

export interface RouteInfo extends RouteSummary {
  bounds: [[number, number], [number, number]];
}

export interface RouteText {
  /** «7 min» on an alternative's label. */
  minutes(m: number): string;
  /** «الدور A» on the level-A way. */
  level(l: 'A'): string;
  /** A car park entrance's name, on the nearest one when walking to a lot. */
  entrance(p: Poi): string;
  /** The short note on a numbered step underground: «turn right», «up to level A», «into lot 9». */
  step(turn: StepTurn, lot: number | null): string;
}

/** Layers of the route, bottom to top (all under the selected place's pin). */
const LINE_LAYERS = ['route-alt', 'route-shortcut-casing', 'route-shortcut', 'route-casing', 'route-edge', 'route-walk', 'route-flow', 'route-car', 'route-garage-dash'] as const;
const BASE_LAYERS = ['route-casing', 'route-edge', 'route-walk', 'route-flow', 'route-car', 'route-garage-dash'] as const;
const FOCUS_LAYERS = ['route-focus-casing', 'route-focus'] as const;
const TOP_LAYERS = [...FOCUS_LAYERS, 'route-arrows', 'route-marks'] as const;
export const ROUTE_LAYERS = [...LINE_LAYERS, ...TOP_LAYERS];
const SOURCES = ['route-lines', 'route-alts', 'route-shortcut', 'route-focus', 'route-arrows', 'route-marks'] as const;

/** The route draws itself from the visitor to the place (UI plan phase 4: about 600 ms). */
const DRAW_MS = 600;
/** MapLibre zoom from which the numbered steps underground show (below it they would pile on each other). */
const STEPS_ZOOM = 15.5;
const FADED = 0.35;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];
const line = (path: readonly LatLng[], properties: Record<string, unknown>): Feature<LineString> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: path.map(lngLat) },
  properties,
});
const point = (at: LatLng, properties: Record<string, unknown>): Feature<Point> => ({ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat(at) }, properties });

/** Faded secondary shortcut line appearance so it never visually competes with the primary route (D15). */
export const SHORTCUT_PAINT = {
  casingOpacity: 0.24,
  casingWidth: 3.6,
  lineOpacity: 0.42,
  lineWidth: 2.0,
  dasharray: [2, 1.8] as [number, number],
} as const;

export function shortcutBadgeMeta(kind: ShortcutKind): { glyph: string; label: string; color: string } {
  if (kind === 'interior') return { glyph: '♂', label: 'للرجال', color: '#2563eb' };
  if (kind === 'women_rawdah') return { glyph: '♀', label: 'للنساء · باب ٢١', color: '#c026d3' };
  return { glyph: '⇣', label: 'ممر فرعي', color: '#10b981' };
}

interface Mark {
  kind: 'alt' | 'ramp' | 'lot-gate' | 'level-ramp' | 'level-label' | 'entrance' | 'entrance-label' | 'step' | 'shortcut-badge' | 'start' | 'end';
  shortcutKind?: ShortcutKind;
  /** A numbered step: its number (the note is `text`). */
  n?: number;
  /** Drawn under its point rather than over it (a step that ends at the place, whose pin stands over the point). */
  below?: boolean;
  at: LatLng;
  img?: string;
  text?: string;
  /** For an alternative's label: which plan, and its line (the label slides along it). */
  alt?: number;
  path?: LatLng[];
  z: number;
}

export class RouteLayer {
  private plans: Plan[] = [];
  private chosen = 0;
  private path: LatLng[] = [];
  private shortcutPath: LatLng[] = [];
  private shortcutKind: ShortcutKind = 'aisle';
  private others: { i: number; path: LatLng[] }[] = [];
  private marks: Mark[] = [];
  private images: string[] = [];
  private focused = false;
  private frame = 0;
  private version = 0;
  private onPick?: (i: number) => void;

  constructor(
    private map: MLMap,
    private palette: Palette,
    private text: RouteText,
    private ratio = Math.min(3, Math.max(1, devicePixelRatio || 1)),
  ) {
    map.on('moveend', () => this.placeLabels());
  }

  private before?: string;

  /**
   * Where the route's layers go (under `before`). They exist only while a route is drawn: even
   * empty, sixteen more layers cost about 3 ms of every frame (measured, docs/PERF.md), so with no
   * route the map carries none of them. After a theme change they are added again.
   */
  install(before?: string): void {
    this.before = before;
    if (!this.plans.length) return;
    this.addLayers();
    this.render(false);
  }

  private uninstall() {
    for (const id of ROUTE_LAYERS) if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of SOURCES) if (this.map.getSource(id)) this.map.removeSource(id);
  }

  /**
   * Only the layers this route needs: every layer costs each frame, drawn or empty (docs/PERF.md),
   * so a walk carries no car layers, level B no yellow edge, and the stretch ahead is added only
   * while navigating (focus()).
   */
  private addLayers(): void {
    const m = this.map;
    for (const id of ROUTE_LAYERS) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'route-lines' ? { lineMetrics: true } : {}) });
    const plan = this.plans[this.chosen];
    const kinds = new Set(plan.legs.filter((l) => l.path.length > 1).map((l) => l.kind));
    const edged = plan.legs.some((l) => (l.parts ?? []).some((p) => p.on !== 'B' && p.path.length > 1));
    const c = (t: string) => this.palette.get(t);
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    const part = (...p: string[]) => ['in', ['get', 'part'], ['literal', p]] as unknown as ExpressionSpecification;
    const add = (spec: Parameters<MLMap['addLayer']>[0]) => m.addLayer(spec, this.below());
    // The other routes: barely there (a faint trace); a tap near one chooses it (hitAlternative).
    if (this.plans.length > 1)
      add({ id: 'route-alt', type: 'line', source: 'route-alts', layout: round, paint: { 'line-color': c('muted'), 'line-opacity': 0.16, 'line-width': 6 } });
    // Secondary dynamic shortcut route (`مسار فرعي`) through inter-carpet aisles / permitted corridors:
    // deliberately faded and thin so the primary exterior route remains dominant (`D15`).
    add({
      id: 'route-shortcut-casing',
      type: 'line',
      source: 'route-shortcut',
      layout: round,
      paint: { 'line-color': '#ffffff', 'line-opacity': SHORTCUT_PAINT.casingOpacity, 'line-width': SHORTCUT_PAINT.casingWidth },
    });
    add({
      id: 'route-shortcut',
      type: 'line',
      source: 'route-shortcut',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'kind'], 'interior', '#2563eb', 'women_rawdah', '#c026d3', '#10b981'],
        'line-opacity': SHORTCUT_PAINT.lineOpacity,
        'line-width': SHORTCUT_PAINT.lineWidth,
        'line-dasharray': [...SHORTCUT_PAINT.dasharray],
      },
    });
    add({
      id: 'route-casing',
      type: 'line',
      source: 'route-lines',
      filter: part('walk', 'drive', 'garage'),
      layout: round,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.95, 'line-width': ['match', ['get', 'part'], 'drive', 12, 11] },
    });
    if (edged)
      add({
        id: 'route-edge',
        type: 'line',
        source: 'route-lines',
        filter: part('edge-a', 'edge-up', 'edge-down'),
        layout: round,
        paint: { 'line-color': ['match', ['get', 'part'], 'edge-down', c('ramp-down'), c('ramp-up')], 'line-width': 14 },
      });
    if (kinds.has('walk')) {
      add({ id: 'route-walk', type: 'line', source: 'route-lines', filter: part('walk'), layout: round, paint: { 'line-width': 6, 'line-gradient': this.drawn(1) } });
      add({
        id: 'route-flow',
        type: 'line',
        source: 'route-lines',
        filter: part('walk'),
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': c('gold-500'), 'line-width': 2, 'line-dasharray': [0.5, 6] },
      });
    }
    // The drive and the car park in one layer (both blue); the car park's tunnel dashes over it.
    if (kinds.has('drive') || kinds.has('garage'))
      add({
        id: 'route-car',
        type: 'line',
        source: 'route-lines',
        filter: part('drive', 'garage'),
        layout: round,
        paint: { 'line-color': c('route-drive'), 'line-width': ['match', ['get', 'part'], 'drive', 7, 6] },
      });
    if (kinds.has('garage'))
      add({
        id: 'route-garage-dash',
        type: 'line',
        source: 'route-lines',
        filter: part('garage'),
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': 2, 'line-dasharray': [2, 3.5] },
      });
    add({
      id: 'route-arrows',
      type: 'symbol',
      source: 'route-arrows',
      layout: {
        'icon-image': `rt-arrow@${this.version}`,
        'icon-rotate': ['-', ['get', 'b'], 90],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    // Start, end, labels and car park marks: one symbol layer of small images.
    add({
      id: 'route-marks',
      type: 'symbol',
      source: 'route-marks',
      layout: {
        'icon-image': ['get', 'img'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
        // A numbered step sits just over its point, clear of the line; one ending at the place sits under it, clear of the place's pin.
        'icon-offset': [
          'case',
          ['==', ['get', 'below'], true],
          ['literal', [0, 22]],
          ['match', ['get', 'kind'], 'entrance-label', ['literal', [0, -27]], 'step', ['literal', [0, -22]], ['literal', [0, 0]]],
        ],
      },
      // The numbered steps show once the car park is close enough to read them apart.
      paint: { 'icon-opacity': ['step', ['zoom'], ['match', ['get', 'kind'], 'step', 0, 1], STEPS_ZOOM, 1] },
    });
    this.addArrowImage();
    this.setFaded(this.focused);
  }

  /** Under the chosen place's pin (and anything else given as `before`). */
  private below(): string | undefined {
    return this.before && this.map.getLayer(this.before) ? this.before : undefined;
  }

  /** The theme or language changed: colours are read again and the images drawn again at the next install. */
  restyle(): void {
    this.dropImages();
    if (this.map.hasImage(`rt-arrow@${this.version}`)) this.map.removeImage(`rt-arrow@${this.version}`);
    this.version++;
  }

  get active(): boolean {
    return this.path.length > 0;
  }

  /** The route being followed, start to end. */
  get latLngs(): LatLng[] {
    return this.path;
  }

  /** The optional dynamic secondary shortcut route (`مسار فرعي`), start to end. */
  get shortcut(): LatLng[] {
    return this.shortcutPath;
  }

  /** Update the optional secondary shortcut route (`مسار فرعي`) in place as the visitor moves. */
  setShortcut(input: ShortcutResult | LatLng[] | null): void {
    if (Array.isArray(input)) {
      this.shortcutPath = input.length > 1 ? input : [];
      this.shortcutKind = 'aisle';
    } else if (input && input.path.length > 1) {
      this.shortcutPath = input.path;
      this.shortcutKind = input.kind;
    } else {
      this.shortcutPath = [];
      this.shortcutKind = 'aisle';
    }
    this.set(
      'route-shortcut',
      this.shortcutPath.length > 1 ? [line(this.shortcutPath, { part: 'shortcut', kind: this.shortcutKind })] : [],
    );
    if (!this.plans.length) return;
    this.marks = this.marks.filter((m) => m.kind !== 'shortcut-badge');
    if (this.shortcutPath.length > 1) {
      this.marks.push({
        kind: 'shortcut-badge',
        shortcutKind: this.shortcutKind,
        at: pointAlong(this.shortcutPath, 0.5),
        z: 960,
        img: this.shortcutBadgeImage(this.shortcutKind),
      });
    }
    this.writeMarks();
  }

  /** The alternative routes on the map, in plan order without the chosen one (as the live app). */
  get alternatives(): LatLng[][] {
    return this.others.map((o) => o.path);
  }

  /** For the tests: what the route shows besides its lines (labels and car park marks). */
  get shownMarks(): { kind: string; text?: string }[] {
    return this.marks.map(({ kind, text }) => ({ kind, text }));
  }

  get isFocused(): boolean {
    return this.focused;
  }

  /**
   * Draw `plans[chosen]` as the route and the other plans as alternatives. `animate: false` (a switch
   * or a re-route while walking) redraws without the draw-in, so nothing jumps at the visitor.
   */
  show(plans: Plan[], chosen = 0, opts: { animate?: boolean; onPick?: (i: number) => void } = {}): RouteInfo {
    this.clear();
    this.plans = plans;
    this.chosen = chosen;
    this.onPick = opts.onPick;
    const reduce = opts.animate === false || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.addLayers();
    this.render(!reduce);
    return { ...routeSummary(plans, chosen), bounds: boundsOf([this.path, ...this.others.map((o) => o.path)]) };
  }

  private render(animate: boolean) {
    const plan = this.plans[this.chosen];
    this.path = fullPath(plan);
    this.others = this.plans.flatMap((p, i) => (i === this.chosen ? [] : [{ i, path: fullPath(p) }]));
    this.dropImages();
    const lines: Feature<LineString>[] = [];
    const marks: Mark[] = [];
    const legPaths: LatLng[][] = [];
    for (const leg of plan.legs) {
      if (leg.path.length < 2) continue;
      legPaths.push(leg.path);
      lines.push(line(leg.path, { part: leg.kind }));
      if (leg.kind !== 'garage') continue;
      // Level A (above) gets a yellow edge, the ramps yellow (up) and green (down); B keeps the white one.
      for (const p of leg.parts ?? []) {
        if (p.on === 'B' || p.path.length < 2) continue;
        lines.push(line(p.path, { part: p.on === 'A' ? 'edge-a' : `edge-${p.on}` }));
        if (p.on === 'A' && !marks.some((m) => m.kind === 'level-label')) marks.push({ kind: 'level-label', at: pointAlong(p.path, 0.5), text: this.text.level('A'), z: 1000 });
      }
      // The ramp in from the streets (not the way out, nor a car already in the car park).
      if (!plan.exit && plan.legs[0]?.kind === 'drive') marks.push({ kind: 'ramp', at: leg.path[0], text: 'P', z: 1001 });
    }
    if (plan.gate && plan.lot) marks.push({ kind: 'lot-gate', at: plan.gate, text: `${plan.lot.id - 900}${plan.level ?? ''}`, z: 1001 });
    for (const r of plan.ramps ?? []) marks.push({ kind: 'level-ramp', at: r.at, text: `${r.to === 'A' ? '↑' : '↓'}${r.to}`, z: 1001 });
    if (plan.entrances && plan.nearest) {
      const sub = parkingAccess(plan.nearest) === 'subscribers';
      for (const e of plan.entrances)
        marks.push({
          kind: 'entrance',
          at: [e.lat, e.lng],
          text: e.id === plan.nearest.id ? 'nearest' : '',
          z: e.id === plan.nearest.id ? 900 : 899,
          img: this.entranceImage(e.id === plan.nearest.id, sub),
        });
      marks.push({ kind: 'entrance-label', at: [plan.nearest.lat, plan.nearest.lng], text: this.text.entrance(plan.nearest), z: 1002 });
    }
    // Numbered steps underground (owner, 2026-11-07), counted on from one leg to the next.
    let n = 1;
    for (const leg of plan.legs) {
      if (!leg.steps?.length) continue;
      for (const s of stepMarks(leg.steps, n)) {
        marks.push({ kind: 'step', at: s.at, n: s.n, below: s.turn === 'stairs', text: this.text.step(s.turn, plan.lot ? plan.lot.id - 900 : null), z: 1100 - s.n });
        n = s.n + 1;
      }
    }
    for (const o of this.others) marks.push({ kind: 'alt', at: pointAlong(o.path, 0.5), text: this.text.minutes(this.plans[o.i].minutes), alt: o.i, path: o.path, z: 950 });
    if (this.shortcutPath.length > 1) {
      marks.push({
        kind: 'shortcut-badge',
        shortcutKind: this.shortcutKind,
        at: pointAlong(this.shortcutPath, 0.5),
        z: 960,
        img: this.shortcutBadgeImage(this.shortcutKind),
      });
    }
    marks.push({ kind: 'start', at: this.path[0], z: 0 }, { kind: 'end', at: this.path[this.path.length - 1], z: 0 });
    for (const mk of marks) {
      mk.img ??=
        mk.kind === 'start' || mk.kind === 'end'
          ? this.endImage(mk.kind)
          : mk.kind === 'step'
            ? this.stepImage(mk)
            : mk.kind === 'shortcut-badge'
              ? this.shortcutBadgeImage(mk.shortcutKind ?? 'aisle')
              : this.chip(mk);
    }
    this.marks = marks;
    this.set('route-lines', lines);
    this.set(
      'route-shortcut',
      this.shortcutPath.length > 1 ? [line(this.shortcutPath, { part: 'shortcut', kind: this.shortcutKind })] : [],
    );
    this.set(
      'route-alts',
      this.others.map((o) => line(o.path, { i: o.i })),
    );
    this.set(
      'route-arrows',
      arrowsAlong(legPaths, ARROW_EVERY_M).map((a) => point(a.at, { b: a.bearing })),
    );
    this.placeLabels(false);
    this.writeMarks();
    if (animate) this.drawIn();
    else if (this.map.getLayer('route-walk')) this.map.setPaintProperty('route-walk', 'line-gradient', this.drawn(1));
  }

  /** The visitor tapped this point: the alternative under it, if any. */
  hitAlternative(x: number, y: number): number | null {
    if (!this.others.length) return null;
    const hits = this.map.queryRenderedFeatures(
      [
        [x - 10, y - 10],
        [x + 10, y + 10],
      ],
      { layers: ['route-marks', 'route-alt'].filter((l) => this.map.getLayer(l)) },
    );
    for (const f of hits) {
      const i = f.properties.alt ?? f.properties.i;
      if (i !== undefined && i !== null) return Number(i);
    }
    return null;
  }

  /** A tap chose an alternative. */
  pick(i: number): void {
    this.onPick?.(i);
  }

  /**
   * Colour in full only the stretch ahead of the visitor (owner, 2026-10-13): the rest of the route
   * stays drawn, faint. `null` shows the whole route in full again.
   */
  focus(path: LatLng[] | null, mode: 'walk' | 'drive' = 'walk'): void {
    const on = !!path && path.length > 1 && this.path.length > 0;
    const m = this.map;
    if (on && !m.getLayer('route-focus') && m.getLayer('route-arrows')) {
      const c = (t: string) => this.palette.get(t);
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      // Under the arrows and the marks, over the faded route.
      m.addLayer({ id: 'route-focus-casing', type: 'line', source: 'route-focus', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 13 } }, 'route-arrows');
      m.addLayer(
        {
          id: 'route-focus',
          type: 'line',
          source: 'route-focus',
          layout: round,
          paint: { 'line-color': ['match', ['get', 'mode'], 'drive', c('route-drive'), c('route-walk')], 'line-width': 8 },
        },
        'route-arrows',
      );
    }
    this.set('route-focus', on ? [line(path!, { mode })] : []);
    if (!on) for (const id of FOCUS_LAYERS) if (m.getLayer(id)) m.removeLayer(id);
    if (on !== this.focused) this.setFaded(on);
  }

  clear(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.focus(null);
    this.uninstall();
    this.dropImages();
    this.plans = [];
    this.path = [];
    this.shortcutPath = [];
    this.shortcutKind = 'aisle';
    this.others = [];
    this.marks = [];
  }

  // ---------- drawing ----------

  private set(id: string, features: Feature[]) {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  private setFaded(on: boolean) {
    this.focused = on;
    for (const id of BASE_LAYERS) {
      if (!this.map.getLayer(id)) continue;
      const base = id === 'route-casing' ? 0.95 : id === 'route-garage-dash' ? 0.85 : 1;
      this.map.setPaintProperty(id, 'line-opacity', on ? base * FADED : base);
    }
  }

  /** The walking line drawn up to a share of its length (line-progress: the share, not metres). */
  private drawn(share: number): ExpressionSpecification {
    const color = this.palette.get('route-walk');
    if (share >= 1) return ['step', ['line-progress'], color, 2, color] as ExpressionSpecification;
    return ['step', ['line-progress'], color, Math.max(0.0001, share), 'rgba(0,0,0,0)'] as ExpressionSpecification;
  }

  private drawIn() {
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / DRAW_MS);
      const e = 1 - (1 - k) ** 3;
      if (this.map.getLayer('route-walk')) this.map.setPaintProperty('route-walk', 'line-gradient', this.drawn(k >= 1 ? 1 : e));
      this.frame = k < 1 ? requestAnimationFrame(tick) : 0;
    };
    if (this.map.getLayer('route-walk')) this.map.setPaintProperty('route-walk', 'line-gradient', this.drawn(0));
    this.frame = requestAnimationFrame(tick);
  }

  /**
   * Slide each alternative's time label along its line to where it is clearest on screen: away from
   * the side edges, where the map buttons are (a handful of points per label, after each move).
   */
  private placeLabels(write = true) {
    const alts = this.marks.filter((m) => m.kind === 'alt');
    if (!alts.length) return;
    const c = this.map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    for (const mk of alts) {
      let best: { at: LatLng; score: number } | null = null;
      for (let s = 0.2; s <= 0.81; s += 0.1) {
        const at = pointAlong(mk.path!, s);
        const pt = this.map.project(lngLat(at));
        const score = pt.y < 0 || pt.y > h ? -1 : Math.min(pt.x, w - pt.x);
        if (!best || score > best.score) best = { at, score };
      }
      if (best) mk.at = best.at;
    }
    if (write) this.writeMarks();
  }

  private writeMarks() {
    this.set(
      'route-marks',
      this.marks.map((m) =>
        point(m.at, { kind: m.kind, z: m.z, ...(m.img ? { img: m.img } : {}), ...(m.alt !== undefined ? { alt: m.alt } : {}), ...(m.below ? { below: true } : {}) }),
      ),
    );
  }

  private dropImages() {
    for (const id of this.images) if (this.map.hasImage(id)) this.map.removeImage(id);
    this.images = [];
  }

  private add(id: string, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    if (this.map.hasImage(id)) this.map.removeImage(id);
    this.map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: this.ratio });
    this.images.push(id);
    return id;
  }

  private canvas(w: number, h: number) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * this.ratio);
    cv.height = Math.ceil(h * this.ratio);
    const ctx = cv.getContext('2d')!;
    ctx.scale(this.ratio, this.ratio);
    return { cv, ctx };
  }

  /** A chip with text (the live app's divIcons), drawn with the app's own font for correct Arabic. */
  private chip(mk: Mark): string {
    const c = (t: string) => this.palette.get(t);
    const look: Record<string, { bg: string; fg: string; edge: string; edgeW: number; r: number; h: number; font: string; alpha?: number; minW?: number }> = {
      alt: { bg: c('surface-2'), fg: c('ink'), edge: c('line-strong'), edgeW: 1, r: 12, h: 24, font: '700 12px', alpha: 0.55 },
      ramp: { bg: c('route-drive'), fg: '#ffffff', edge: '#ffffff', edgeW: 2, r: 7, h: 24, font: '700 13px', minW: 24 },
      'lot-gate': { bg: '#ffffff', fg: c('route-drive'), edge: c('route-drive'), edgeW: 2, r: 7, h: 22, font: '700 12px' },
      'level-ramp': {
        bg: mk.text?.startsWith('↑') ? c('ramp-up') : c('ramp-down'),
        fg: mk.text?.startsWith('↑') ? '#1e2a26' : '#ffffff',
        edge: '#ffffff',
        edgeW: 2,
        r: 7,
        h: 22,
        font: '700 12px',
        minW: 36,
      },
      'level-label': { bg: c('ramp-up'), fg: '#1e2a26', edge: '#ffffff', edgeW: 2, r: 11, h: 22, font: '700 12px' },
      'entrance-label': { bg: c('surface-2'), fg: c('ink'), edge: c('gold-line'), edgeW: 1, r: 5, h: 18, font: '600 10px' },
    };
    const k = look[mk.kind];
    const text = mk.kind === 'lot-gate' ? `P ${mk.text}` : (mk.text ?? '');
    const font = `${k.font} "IBM Plex Sans Arabic", system-ui, sans-serif`;
    const probe = this.canvas(1, 1).ctx;
    probe.font = font;
    const tw = Math.min(180, probe.measureText(text).width);
    const pad = 4;
    const w = Math.max(k.minW ?? 0, Math.ceil(tw) + (mk.kind === 'alt' ? 18 : 12)) + 2 * pad;
    const h = k.h + 2 * pad;
    const { cv, ctx } = this.canvas(w, h);
    ctx.globalAlpha = k.alpha ?? 1;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.roundRect(pad + k.edgeW / 2, pad + k.edgeW / 2, w - 2 * pad - k.edgeW, k.h - k.edgeW, k.r);
    ctx.fillStyle = k.bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = k.edgeW;
    ctx.strokeStyle = k.edge;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = k.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Numbers and «P 9A» read left to right in every language; names take their own direction.
    ctx.direction = mk.kind === 'entrance-label' || mk.kind === 'alt' || mk.kind === 'level-label' ? 'inherit' : 'ltr';
    ctx.fillText(text, w / 2, pad + k.h / 2 + 0.5, w - 2 * pad - 8);
    return this.add(`rt:${mk.kind}:${this.images.length}@${this.version}`, cv);
  }

  /**
   * A numbered step: the number in a green disc, then its short note, on the card colour with a
   * gold thread (DESIGN §1-ب). The number reads the same in every language; the note takes the
   * page's direction, so the disc sits at the start of the line (right in Arabic).
   */
  private stepImage(mk: Mark): string {
    const c = (t: string) => this.palette.get(t);
    const font = '600 12px "IBM Plex Sans Arabic", system-ui, sans-serif';
    const numFont = '700 13px "IBM Plex Sans Arabic", system-ui, sans-serif';
    const text = mk.text ?? '';
    const probe = this.canvas(1, 1).ctx;
    probe.font = font;
    const tw = Math.min(170, Math.ceil(probe.measureText(text).width));
    const pad = 4;
    const h = 28;
    const disc = 22;
    const w = 3 + disc + 6 + tw + 10 + 2 * pad;
    const { cv, ctx } = this.canvas(w, h + 2 * pad);
    const rtl = document.documentElement.dir === 'rtl';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.roundRect(pad + 0.5, pad + 0.5, w - 2 * pad - 1, h - 1, h / 2);
    ctx.fillStyle = c('surface-2');
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c('gold-500');
    ctx.stroke();
    const cx = rtl ? w - pad - 3 - disc / 2 : pad + 3 + disc / 2;
    const cy = pad + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, disc / 2, 0, Math.PI * 2);
    ctx.fillStyle = c('accent');
    ctx.fill();
    ctx.font = numFont;
    ctx.fillStyle = c('accent-ink');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    ctx.fillText(String(mk.n ?? ''), cx, cy + 0.5);
    ctx.font = font;
    ctx.fillStyle = c('ink');
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'start';
    ctx.fillText(text, rtl ? w - pad - 3 - disc - 6 : pad + 3 + disc + 6, cy + 0.5, tw);
    return this.add(`rt:step:${this.images.length}@${this.version}`, cv);
  }

  /** The route's start (the visitor's blue) and end (gold), ringed white (the live app's circle markers). */
  private endImage(kind: 'start' | 'end'): string {
    const id = `rt:${kind}@${this.version}`;
    if (this.images.includes(id)) return id;
    const r = kind === 'end' ? 7 : 6;
    const size = 2 * (r + 3) + 2;
    const { cv, ctx } = this.canvas(size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.palette.get(kind === 'end' ? 'gold-500' : 'me');
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    return this.add(id, cv);
  }

  /** A car park entrance: an arrow in the lot's colour; the nearest one bigger, edged gold. */
  private entranceImage(nearest: boolean, sub: boolean): string {
    const id = `rt:entrance:${nearest ? 1 : 0}:${sub ? 1 : 0}@${this.version}`;
    if (this.images.includes(id)) return id;
    const size = nearest ? 30 : 22;
    const { cv, ctx } = this.canvas(size + 6, size + 6);
    const color = this.palette.get(sub ? 'cat-park-sub' : 'cat-men');
    const r = size / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.arc(r + 3, r + 3, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = mix(color, 0.18);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = nearest ? this.palette.get('gold-500') : '#ffffff';
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `800 ${nearest ? 17 : 14}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➜', r + 3, r + 4);
    return this.add(id, cv);
  }

  /** Faded secondary shortcut pill showing men/women/aisle access icon (`D15`). */
  private shortcutBadgeImage(kind: ShortcutKind): string {
    const id = `rt:shortcut-badge:${kind}@${this.version}`;
    if (this.images.includes(id) && this.map.hasImage(id)) return id;
    const meta = shortcutBadgeMeta(kind);
    const label = `${meta.glyph} ${meta.label}`;
    const font = '600 11px "IBM Plex Sans Arabic", system-ui, sans-serif';
    const probe = this.canvas(1, 1).ctx;
    probe.font = font;
    const tw = Math.ceil(probe.measureText(label).width);
    const pad = 4;
    const h = 21;
    const w = Math.max(58, tw + 16) + 2 * pad;
    const { cv, ctx } = this.canvas(w, h + 2 * pad);
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.roundRect(pad + 0.5, pad + 0.5, w - 2 * pad - 1, h - 1, h / 2);
    ctx.fillStyle = mix(meta.color, 0.14);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = meta.color;
    ctx.stroke();
    ctx.font = font;
    ctx.fillStyle = meta.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(label, w / 2, pad + h / 2 + 0.5, w - 2 * pad - 8);
    return this.add(id, cv);
  }

  /** The white chevron of the arrows (pointing east; each arrow is turned to its bearing). */
  private addArrowImage() {
    const id = `rt-arrow@${this.version}`;
    if (this.map.hasImage(id)) return;
    const { cv, ctx } = this.canvas(14, 14);
    ctx.shadowColor = 'rgba(14,77,58,0.6)';
    ctx.shadowBlur = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, 3);
    ctx.lineTo(9, 7);
    ctx.lineTo(4, 11);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    this.map.addImage(id, ctx.getImageData(0, 0, cv.width, cv.height), { pixelRatio: this.ratio });
  }
}

/** A colour at `k` over white (the live app's color-mix(… 18%, white); canvas has no color-mix). */
function mix(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k + 255 * (1 - k));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
