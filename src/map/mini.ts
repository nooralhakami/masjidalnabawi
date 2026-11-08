import { Map as MLMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { POIS, RULES } from '../data';
import { isHidden } from '../domain/filters';
import { markerLook } from '../presentation/marker-look';
import { haramBounds } from './zoom';

setWorkerUrl(workerUrl);

/**
 * The small live map on the landing page (UI plan phase 6, owner 2026-11-07): the real imagery of
 * the Haram with every place as a dot in its category's colour, framed on the ring of outer gates.
 * It does not move: it is a picture of the map that opens it (the whole card is the link). Loaded
 * only after the page has shown, in its own chunk with the map library. Its credit is one small line
 * on the card (landing/view.ts), always shown, as the map library's box would cover the small map.
 */
export function miniMap(container: HTMLElement): { map: MLMap; ready: Promise<void> } {
  const css = getComputedStyle(document.documentElement);
  const color = (token: string) => css.getPropertyValue(`--${token === 'mixed' ? 'cat-men' : token}`).trim() || '#1f64a8';
  const b = haramBounds(POIS);
  const map = new MLMap({
    container,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    bounds: [
      [b.west, b.south],
      [b.east, b.north],
    ],
    fitBoundsOptions: { padding: 12 },
    style: {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tileSize: 256,
          maxzoom: 19,
          tiles: [RULES.map.tiles.satellite],
          attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
        },
        pois: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: POIS.filter((p) => !isHidden(p)).map((p) => ({
              type: 'Feature',
              properties: { c: color(markerLook(p, false).color) },
              geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            })),
          },
        },
      },
      layers: [
        { id: 'esri', type: 'raster', source: 'esri' },
        {
          id: 'dots',
          type: 'circle',
          source: 'pois',
          paint: { 'circle-radius': 3, 'circle-color': ['get', 'c'], 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
        },
      ],
    },
  });
  const ready = new Promise<void>((r) => map.once('idle', () => r()));
  return { map, ready };
}
