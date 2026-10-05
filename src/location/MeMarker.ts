import L from 'leaflet';
import { t } from '../i18n';

const GLIDE_MS = 900;

/**
 * The visitor's marker: a blue dot with an accuracy circle, plus a direction cone when the heading
 * is known. It glides between readings instead of jumping, and the cone compensates map rotation.
 */
export class MeMarker {
  private marker: L.Marker | null = null;
  private circle: L.Circle | null = null;
  private from: L.LatLng | null = null;
  private to: L.LatLng | null = null;
  private startedAt = 0;
  private frame = 0;
  private heading: number | null = null;

  constructor(private map: L.Map) {
    map.on('rotate', () => this.paintHeading());
  }

  get position(): L.LatLng | null {
    return this.to;
  }

  update(lat: number, lng: number, accuracy: number, heading: number | null): void {
    const target = L.latLng(lat, lng);
    if (!this.marker) {
      this.circle = L.circle(target, { radius: accuracy, className: 'me-accuracy', interactive: false, weight: 1 }).addTo(this.map);
      this.marker = L.marker(target, {
        icon: L.divIcon({ className: 'me', html: '<span class="me-cone"></span><span class="me-pulse"></span><span class="me-dot"></span>', iconSize: [22, 22] }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 2000,
        title: t('you'),
      }).addTo(this.map);
      this.from = this.to = target;
    } else {
      this.from = this.marker.getLatLng();
      this.to = target;
      this.startedAt = performance.now();
      cancelAnimationFrame(this.frame);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) this.place(target);
      else this.frame = requestAnimationFrame(() => this.glide());
    }
    this.circle!.setRadius(Math.min(accuracy, 150));
    if (!this.frame) this.circle!.setLatLng(target);
    this.heading = heading;
    this.paintHeading();
  }

  private glide() {
    if (!this.from || !this.to) return;
    const k = Math.min(1, (performance.now() - this.startedAt) / GLIDE_MS);
    const e = 1 - (1 - k) ** 3; // ease-out
    this.place(L.latLng(this.from.lat + (this.to.lat - this.from.lat) * e, this.from.lng + (this.to.lng - this.from.lng) * e));
    this.frame = k < 1 ? requestAnimationFrame(() => this.glide()) : 0;
  }

  private place(ll: L.LatLng) {
    this.marker?.setLatLng(ll);
    this.circle?.setLatLng(ll);
  }

  private paintHeading() {
    const el = this.marker?.getElement();
    if (!el) return;
    el.classList.toggle('has-heading', this.heading !== null);
    if (this.heading !== null) el.style.setProperty('--heading', `${this.heading - (this.map.getBearing?.() ?? 0)}deg`);
  }

  remove(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.marker?.remove();
    this.circle?.remove();
    this.marker = this.circle = null;
    this.from = this.to = null;
  }
}
