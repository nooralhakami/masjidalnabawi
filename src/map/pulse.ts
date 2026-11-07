import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Palette } from './images';

/** Two soft rings, each this long; then it stops (no endless motion over the map, DESIGN §4). */
export const PULSE_RING_MS = 600;
export const PULSE_RINGS = 2;
const FROM_R = 10;
const TO_R = 30;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * The confirmation on a chosen marker (UI plan phase 3): a gold ring that grows from it and fades,
 * twice, about 1.2 s in all, then nothing is drawn. One circle layer with one point; only its
 * radius and opacity change while it plays. With «reduce motion» it does not play at all.
 */
export class SelectPulse {
  private raf = 0;

  constructor(
    private map: MLMap,
    private palette: Palette,
  ) {}

  play(lng: number, lat: number): void {
    this.stop();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const m = this.map;
    if (!m.getSource('select-pulse')) m.addSource('select-pulse', { type: 'geojson', data: EMPTY });
    if (!m.getLayer('select-pulse'))
      m.addLayer(
        {
          id: 'select-pulse',
          type: 'circle',
          source: 'select-pulse',
          paint: { 'circle-radius': FROM_R, 'circle-opacity': 0, 'circle-stroke-opacity': 0, 'circle-stroke-width': 2.5, 'circle-color': 'transparent' },
        },
        m.getLayer('selected') ? 'selected' : undefined,
      );
    m.setPaintProperty('select-pulse', 'circle-stroke-color', this.palette.get('gold-500'));
    (m.getSource('select-pulse') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / PULSE_RING_MS;
      if (t >= PULSE_RINGS) return this.stop();
      const k = t % 1;
      // Ease out: quick to leave the marker, slow to fade.
      const e = 1 - (1 - k) ** 3;
      m.setPaintProperty('select-pulse', 'circle-radius', FROM_R + (TO_R - FROM_R) * e);
      m.setPaintProperty('select-pulse', 'circle-stroke-opacity', 0.9 * (1 - k));
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Whether a ring is on the map now (for the tests). */
  get playing(): boolean {
    return this.raf !== 0;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    (this.map.getSource('select-pulse') as GeoJSONSource | undefined)?.setData(EMPTY);
  }
}
