import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { Marker } from 'maplibre-gl';

const GLIDE_MS = 900;
/** The accuracy circle is not drawn wider than this (the live app's cap). */
const MAX_ACCURACY_M = 150;
const EARTH_M = 40_075_016.686;

/**
 * The visitor's dot (the live app's location/MeMarker.ts): a blue dot with a soft pulse, the
 * accuracy circle around it, and a cone the way they face when the heading is known. It glides
 * between readings instead of jumping.
 *
 * It is the one DOM element over the map that moves with it (CLAUDE.md): MapLibre places it with a
 * transform. The accuracy circle is a GPU circle layer whose radius follows the zoom by expression,
 * and the cone turns with the map by itself (rotation aligned to the map), so nothing is redone per
 * frame while the visitor pans, zooms or turns the map.
 */
export class MeMarker {
  private marker: Marker | null = null;
  private el: HTMLElement | null = null;
  private from: [number, number] | null = null;
  private to: [number, number] | null = null;
  private startedAt = 0;
  private frame = 0;
  private accuracy = 0;

  constructor(
    private map: MLMap,
    private label: () => string,
    private color: () => string,
  ) {}

  private before?: string;

  /** Where the accuracy circle's layer goes (under `before`); it exists only while the dot is shown (a layer costs every frame). */
  install(before?: string): void {
    this.before = before;
    if (this.marker) this.addLayer();
  }

  private addLayer(): void {
    const m = this.map;
    const before = this.before;
    if (!m.getSource('me')) m.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (m.getLayer('me-accuracy')) m.removeLayer('me-accuracy');
    m.addLayer(
      { id: 'me-accuracy', type: 'circle', source: 'me', paint: { 'circle-color': this.color(), 'circle-opacity': 0.12, 'circle-stroke-color': this.color(), 'circle-stroke-opacity': 0.35, 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map' } },
      before && m.getLayer(before) ? before : undefined,
    );
    if (this.to) {
      this.place(this.shown());
      this.paintAccuracy(this.to[0]);
    }
  }

  get position(): [number, number] | null {
    return this.to;
  }

  update(lat: number, lng: number, accuracy: number, heading: number | null): void {
    const target: [number, number] = [lat, lng];
    this.accuracy = Math.min(accuracy, MAX_ACCURACY_M);
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'me';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', this.label());
      el.title = this.label();
      el.innerHTML = '<span class="me-cone"></span><span class="me-pulse"></span><span class="me-dot"></span>';
      this.el = el;
      this.marker = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([lng, lat]).addTo(this.map);
      this.from = this.to = target;
      this.place(target);
    } else {
      this.from = this.shown();
      this.to = target;
      this.startedAt = performance.now();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.place(target);
      else this.frame = requestAnimationFrame(() => this.glide());
    }
    if (!this.map.getLayer('me-accuracy')) {
      this.addLayer();
      this.place(this.shown());
    }
    this.paintAccuracy(lat);
    this.el!.classList.toggle('has-heading', heading !== null);
    // Turned with the map: the cone keeps pointing the real way however the map is turned.
    if (heading !== null) this.marker!.setRotation(heading);
  }

  private shown(): [number, number] {
    const p = this.marker!.getLngLat();
    return [p.lat, p.lng];
  }

  private glide() {
    if (!this.from || !this.to) return;
    const k = Math.min(1, (performance.now() - this.startedAt) / GLIDE_MS);
    const e = 1 - (1 - k) ** 3; // ease-out
    this.place([this.from[0] + (this.to[0] - this.from[0]) * e, this.from[1] + (this.to[1] - this.from[1]) * e]);
    this.frame = k < 1 ? requestAnimationFrame(() => this.glide()) : 0;
  }

  private place([lat, lng]: [number, number]) {
    this.marker?.setLngLat([lng, lat]);
    (this.map.getSource('me') as GeoJSONSource | undefined)?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} });
  }

  /** Metres on the ground as pixels at every zoom: one expression, so a zoom costs nothing here. */
  private paintAccuracy(lat: number) {
    if (!this.map.getLayer('me-accuracy')) return;
    const perPx0 = (EARTH_M * Math.cos((lat * Math.PI) / 180)) / 512;
    const r = (z: number) => this.accuracy / (perPx0 / 2 ** z);
    this.map.setPaintProperty('me-accuracy', 'circle-radius', ['interpolate', ['exponential', 2], ['zoom'], 0, r(0), 24, r(24)]);
  }

  remove(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.marker?.remove();
    this.marker = null;
    this.el = null;
    this.from = this.to = null;
    if (this.map.getLayer('me-accuracy')) this.map.removeLayer('me-accuracy');
    if (this.map.getSource('me')) this.map.removeSource('me');
  }
}
