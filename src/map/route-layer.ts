import L from 'leaflet';
import type { LatLng, Poi } from '../data/types';
import { parkingAccess } from '../domain/parking';
import { nm } from '../i18n';
import { esc } from '../ui/dom';
import { pathLength, walkMinutes, walkPath } from '../routing/walk';

export interface RouteInfo {
  meters: number;
  minutes: number;
  bounds: L.LatLngBounds;
}

const ARROW_EVERY_M = 55;

function bearing(a: L.Point, b: L.Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Draws a walking route: white casing, green line, gold flow dashes, direction arrows, start/end dots. */
export class RouteLayer {
  private group = L.featureGroup();
  private path: LatLng[] = [];

  constructor(private map: L.Map) {
    map.on('zoomend', () => this.path.length && this.drawArrows());
  }

  get active(): boolean {
    return this.path.length > 0;
  }

  get latLngs(): L.LatLng[] {
    return this.path.map((p) => L.latLng(p));
  }

  show(from: LatLng, to: LatLng, parking?: { entrances: Poi[]; nearest: Poi }): RouteInfo & { nearestEntrance?: number } {
    this.clear();
    this.path = walkPath(from, to);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const casing = L.polyline(this.path, { className: 'route-casing', weight: 11, interactive: false });
    const line = L.polyline(this.path, { className: `route-line${reduce ? '' : ' is-drawing'}`, weight: 6, interactive: false });
    const flow = L.polyline(this.path, { className: 'route-flow', weight: 2, interactive: false });
    const start = L.circleMarker(from, { className: 'route-start', radius: 6, weight: 3, interactive: false });
    const end = L.circleMarker(to, { className: 'route-end', radius: 7, weight: 3, interactive: false });
    this.group.addLayer(casing).addLayer(line).addLayer(flow).addLayer(start).addLayer(end).addTo(this.map);
    if (parking) {
      const color = parkingAccess(parking.nearest) === 'subscribers' ? 'var(--cat-park-sub)' : 'var(--cat-men)';
      for (const entrance of parking.entrances) {
        const nearest = entrance.id === parking.nearest.id;
        const marker = L.marker([entrance.lat, entrance.lng], {
          icon: L.divIcon({ className: `parking-entrance${nearest ? ' is-nearest' : ''}`, html: `<span style="--c:${color}">➜</span>`, iconSize: [nearest ? 30 : 22, nearest ? 30 : 22], iconAnchor: [nearest ? 15 : 11, nearest ? 15 : 11] }),
          title: `Parking entrance · Facility ${entrance.id}`,
          interactive: false,
          keyboard: false,
        });
        this.group.addLayer(marker);
        if (nearest) {
          const label = L.marker([entrance.lat, entrance.lng], {
            icon: L.divIcon({
              className: 'parking-entrance-label-wrap',
              html: `<span class="parking-entrance-label" dir="auto">${esc(nm(entrance))}</span>`,
              iconSize: [180, 22],
              iconAnchor: [90, 39],
            }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1002,
          });
          this.group.addLayer(label);
        }
      }
    }
    // Progressive draw: dash the line by its own length and animate the offset to 0.
    const el = line.getElement() as SVGPathElement | undefined;
    if (el && !reduce) {
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = `${len}`;
      requestAnimationFrame(() => (el.style.strokeDashoffset = '0'));
      el.addEventListener('transitionend', () => (el.style.strokeDasharray = 'none'), { once: true });
    }
    this.drawArrows();
    const meters = pathLength(this.path);
    return { meters, minutes: walkMinutes(meters), bounds: L.latLngBounds(this.path), ...(parking ? { nearestEntrance: parking.nearest.id } : {}) };
  }

  private arrows = L.layerGroup();

  /** Light chevrons along the route, spaced in metres and pointing the way. */
  private drawArrows() {
    this.arrows.clearLayers();
    this.arrows.addTo(this.map);
    let carry = ARROW_EVERY_M / 2;
    for (let i = 1; i < this.path.length; i++) {
      const a = L.latLng(this.path[i - 1]);
      const b = L.latLng(this.path[i]);
      const seg = a.distanceTo(b);
      let s = carry;
      while (s < seg) {
        const f = s / seg;
        const p = L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
        const ang = bearing(this.map.latLngToLayerPoint(a), this.map.latLngToLayerPoint(b));
        this.arrows.addLayer(
          L.marker(p, {
            icon: L.divIcon({
              className: 'route-arrow',
              html: `<svg viewBox="0 0 12 12" width="12" height="12" style="transform:rotate(${ang}deg)"><path d="M3 2l5 4-5 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
              iconSize: [12, 12],
            }),
            interactive: false,
            keyboard: false,
          }),
        );
        s += ARROW_EVERY_M;
      }
      carry = s - seg;
    }
  }

  clear(): void {
    this.group.clearLayers();
    this.group.remove();
    this.arrows.clearLayers();
    this.arrows.remove();
    this.path = [];
  }
}
