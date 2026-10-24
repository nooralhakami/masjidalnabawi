import type { FeatureCollection, Point } from 'geojson';
import type { ExpressionSpecification, FilterSpecification, Map as MLMap } from 'maplibre-gl';
import { CAR_ENTRANCES } from '../data-next/car-entrances';
import { POIS, ROUTING } from '../data';
import type { Poi, Status } from '../data/types';
import { isClosed } from '../domain/facilities';
import type { FilterId } from '../domain/filters';
import { FEATURED_IDS } from '../domain/visits';
import { markerLook } from '../presentation/marker-look';
import { mapZoom } from './zoom';

/**
 * The places on the map (ARCHITECTURE §3, map/pois): one GeoJSON source for every place, the layer
 * filters a filter or a search changes, the pop-in, and what a tap lands on. Their layers are drawn
 * in poi-layers.ts. The engine (engine.ts) owns the map and calls these; nothing here runs per frame.
 */

/** Map zoom of a legacy (Leaflet) zoom threshold. */
const at = mapZoom;

export interface PoiView {
  /** The places to show (the live app's visiblePois for the filter and search). */
  ids: readonly number[];
  filter: FilterId;
  /** Must-visit sites stay on the map with any filter, unless a search is running (as in the live app). */
  withFeatured: boolean;
  /** «Hide markers». */
  hidden: boolean;
}

/** The layers a tap can pick a place on. */
const PICK_LAYERS = ['selected', 'featured', 'facilities', 'facility-dots', 'mixed-dots', 'parking', 'outer-chips', 'inner-numbers', 'outer-dots', 'inner-dots'];
/** The markers that pop in on a new filter (the nine must-visit sites and the open card's pin stay). */
const POP_LAYERS = ['inner-dots', 'outer-dots', 'facility-dots', 'mixed-dots', 'facilities', 'parking', 'outer-chips', 'inner-numbers', 'pairs', 'gate-names'];
const POP_MS = 200;
const HIT_PX = 16;

// ---------- data ----------

/** Gate pairs drawn with one number between them: each pair once, from its lower id. */
export const PAIRS: readonly Poi[] = POIS.filter((p) => p.pairNo !== undefined && p.pairWith !== undefined && p.id < p.pairWith);

export function poiFeatures(status: (id: number) => Status | undefined): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: POIS.map((p) => {
      const featured = FEATURED_IDS.has(p.id);
      const look = markerLook(p, featured);
      const plain = featured ? markerLook(p, false) : look;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          kind: look.kind,
          color: look.color,
          // A must-visit site drawn as a plain facility while a search runs: its own look and colour.
          look: plain.look,
          pcolor: plain.color,
          icon: look.icon,
          featured: featured ? 1 : 0,
          closed: isClosed(status(p.id)) ? 1 : 0,
          named: look.named ? 1 : 0,
          sub: look.sub ? 1 : 0,
          z: look.z,
          n: p.id - 900,
        },
      };
    }),
  };
}

export function pairFeatures(): FeatureCollection {
  const by = new Map(POIS.map((p) => [p.id, p]));
  return {
    type: 'FeatureCollection',
    features: PAIRS.map((a) => {
      const b = by.get(a.pairWith!)!;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2] },
        properties: { id: a.id, b: b.id, n: a.pairNo!, color: a.gender === 'men' ? 'cat-men' : 'cat-women' },
      };
    }),
  };
}

/** The new vehicle entrances, open or closed (all closed until the supervisor opens one). */
export function entranceFeatures(open: Record<string, boolean>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: CAR_ENTRANCES.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      properties: { eid: e.id, open: open[e.id] ? 1 : 0 },
    })),
  };
}

export function womenAreas(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (ROUTING.women_prayer_areas ?? []).map((a) => ({
      type: 'Feature',
      properties: { id: a.id },
      geometry: { type: 'Polygon', coordinates: [[...a.polygon, a.polygon[0]].map(([lat, lng]) => [lng, lat])] },
    })),
  };
}

/** Every marker image the places need, so they can be drawn ahead while the browser is idle. */
export function markerImageIds(version: number, status: (id: number) => Status | undefined): string[] {
  const v = version;
  const ids: string[] = [];
  for (const f of poiFeatures(status).features) {
    const p = f.properties as Record<string, string | number>;
    if (p.kind === 'facility' || p.kind === 'featured') ids.push(`fac:${p.look}:${p.closed}@${v}`);
    if (p.pcolor === 'mixed') ids.push(`dot:mixed:${p.closed}@${v}`);
    if (p.kind === 'featured') ids.push(`feat:${p.icon}@${v}`);
    if (p.kind === 'gate-outer') ids.push(`gate:${p.id}@${v}`);
    if (p.kind === 'gate-inner') ids.push(`inum:${p.id}:${p.color}@${v}`);
    if (p.kind === 'gate-inner' && p.named) ids.push(`name:${p.id}@${v}`);
    if (p.kind === 'parking') ids.push(`park:${p.n}:${p.sub}@${v}`);
  }
  for (const f of pairFeatures().features) ids.push(`pair:${f.properties!.n}:${f.properties!.color}@${v}`);
  return [...new Set(ids)];
}

// ---------- what is shown ----------

/** Show these places (a filter, a search, the open card): layer filters only, the data stays as it is. */
export function applyPoiView(m: MLMap, view: PoiView, selected: number | null): void {
  const { ids, filter, withFeatured, hidden } = view;
  const shown = ['in', ['get', 'id'], ['literal', [...ids, ...(withFeatured ? [...FEATURED_IDS] : [])]]] as unknown as ExpressionSpecification;
  const kind = (k: string) => ['==', ['get', 'kind'], k] as ExpressionSpecification;
  const featuredDrawn = (withFeatured ? ['==', ['get', 'featured'], 1] : ['literal', false]) as ExpressionSpecification;
  // With a card open only its place shows (the live app); «hide markers» hides the rest too.
  const off = hidden || selected !== null;
  const set = (layer: string, f: ExpressionSpecification) => m.setFilter(layer, (off ? ['literal', false] : ['all', shown, f]) as FilterSpecification);
  m.setFilter('selected', (selected === null ? ['literal', false] : ['==', ['get', 'id'], selected]) as FilterSpecification);
  set('inner-dots', kind('gate-inner'));
  set('outer-dots', kind('gate-outer'));
  set('outer-chips', kind('gate-outer'));
  set('inner-numbers', kind('gate-inner'));
  const named = ['all', kind('gate-inner'), ['==', ['get', 'named'], 1]] as ExpressionSpecification;
  // The chosen gate keeps its name beside it (from 19, as the live app), even with «hide markers».
  if (selected !== null) m.setFilter('gate-names', ['all', named, ['==', ['get', 'id'], selected]] as FilterSpecification);
  else set('gate-names', named);
  set('parking', kind('parking'));
  const facility = ['any', kind('facility'), ['all', kind('featured'), ['!', featuredDrawn]]] as ExpressionSpecification;
  const mixed = ['==', ['get', 'pcolor'], 'mixed'] as ExpressionSpecification;
  set('facilities', facility);
  set('facility-dots', ['all', facility, ['!', mixed]] as ExpressionSpecification);
  set('mixed-dots', ['all', facility, mixed] as ExpressionSpecification);
  set('featured', ['all', kind('featured'), featuredDrawn] as ExpressionSpecification);
  // The number between a pair's two markers, only while both are on the map.
  const both = ['all', ['in', ['get', 'id'], ['literal', [...ids]]], ['in', ['get', 'b'], ['literal', [...ids]]]] as unknown as ExpressionSpecification;
  m.setFilter('pairs', (off ? ['literal', false] : both) as FilterSpecification);
  // The new vehicle entrances show with the car parks' pill, like the car parks themselves.
  m.setLayoutProperty('car-entrances', 'visibility', filter === 'parking' && !off ? 'visible' : 'none');
  // Zoomed out (≤ 16) with «All», inner gates wait until 17; a gates filter shows them at any zoom (visibleAtZoom).
  m.setLayerZoomRange('inner-dots', filter === 'all' ? at(17) : 0, 24);
}

/**
 * The markers fade in over 200 ms (the live app's .mk-pop): their opacity drops to 0 for one frame,
 * then rises with a paint transition. `current` is false once the theme has been redrawn meanwhile.
 */
export function popMarkers(m: MLMap, current: () => boolean): void {
  const props = (l: string) => (m.getLayer(l)?.type === 'circle' ? ['circle-opacity', 'circle-stroke-opacity'] : ['icon-opacity', 'text-opacity']);
  // A paint property, or its `-transition` (MapLibre's types list only the plain names).
  type Paint = Parameters<MLMap['setPaintProperty']>[1];
  const each = (fn: (l: string, p: string) => void) => {
    for (const l of POP_LAYERS) if (m.getLayer(l)) for (const p of props(l)) fn(l, p);
  };
  each((l, p) => {
    m.setPaintProperty(l, `${p}-transition` as Paint, { duration: 0, delay: 0 });
    m.setPaintProperty(l, p as Paint, 0);
  });
  m.once('render', () => {
    if (!current()) return;
    each((l, p) => {
      m.setPaintProperty(l, `${p}-transition` as Paint, { duration: POP_MS, delay: 0 });
      m.setPaintProperty(l, p as Paint, 1);
    });
  });
  m.triggerRepaint();
}

// ---------- picking ----------

/** The rendered features of these layers within 16 px of a tap (the live app's 32 px hit area). */
const near = (m: MLMap, x: number, y: number, layers: string[]) =>
  m.queryRenderedFeatures(
    [
      [x - HIT_PX, y - HIT_PX],
      [x + HIT_PX, y + HIT_PX],
    ],
    { layers },
  );

/** The new vehicle entrance under a tap, if its layer is on the map. */
export function entranceAt(m: MLMap, x: number, y: number): string | null {
  if (!m.getLayer('car-entrances')) return null;
  const ent = near(m, x, y, ['car-entrances']);
  return ent.length ? String(ent[0].properties.eid) : null;
}

/** The place under a tap: the nearest marker within 16 px, or null. */
export function placeAt(m: MLMap, x: number, y: number): number | null {
  const hits = near(m, x, y, PICK_LAYERS.filter((l) => m.getLayer(l)));
  let best: { id: number; d: number } | null = null;
  for (const f of hits) {
    const [lng, lat] = (f.geometry as Point).coordinates;
    const q = m.project([lng, lat]);
    const d = Math.hypot(q.x - x, q.y - y);
    if (!best || d < best.d) best = { id: Number(f.properties.id), d };
  }
  return best ? best.id : null;
}
