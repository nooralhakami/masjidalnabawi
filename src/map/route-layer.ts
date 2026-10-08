import L from 'leaflet';
import type { LatLng } from '../data/types';
import { parkingAccess } from '../domain/parking';
import { nm, t } from '../i18n';
import { esc } from '../ui/dom';
import { fullPath, type Plan } from '../routing/plan';

export interface RouteInfo {
  meters: number;
  minutes: number;
  bounds: L.LatLngBounds;
  nearestEntrance?: number;
  /** By car: the drive, the lot, and the walk from it. */
  drive?: { meters: number; lot: number; walkMeters: number };
}

const ARROW_EVERY_M = 55;

function bearing(a: L.Point, b: L.Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Draws a trip: walking legs as a green line with gold flow dashes, the drive in blue, the stretch
 * inside the underground car park dashed; direction arrows, start/end dots and car-park markers.
 */
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

  show(plan: Plan): RouteInfo {
    this.clear();
    this.path = fullPath(plan);
    const from = this.path[0];
    const to = this.path[this.path.length - 1];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let line: L.Polyline | null = null;
    for (const leg of plan.legs) {
      if (leg.path.length < 2) continue;
      if (leg.kind === 'walk') {
        const walk = L.polyline(leg.path, { className: `route-line${reduce ? '' : ' is-drawing'}`, weight: 6, interactive: false });
        this.group
          .addLayer(L.polyline(leg.path, { className: 'route-casing', weight: 11, interactive: false }))
          .addLayer(walk)
          .addLayer(L.polyline(leg.path, { className: 'route-flow', weight: 2, interactive: false }));
        line ??= walk;
      } else if (leg.kind === 'drive') {
        this.group
          .addLayer(L.polyline(leg.path, { className: 'route-casing', weight: 12, interactive: false }))
          .addLayer(L.polyline(leg.path, { className: 'route-drive', weight: 7, interactive: false }));
      } else {
        this.group.addLayer(L.polyline(leg.path, { className: 'route-garage', weight: 5, interactive: false }));
        this.group.addLayer(
          L.marker(leg.path[0], {
            icon: L.divIcon({ className: 'route-ramp', html: '<span>P</span>', iconSize: [24, 24] }),
            title: t('drive_ramp'),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1001,
          }),
        );
      }
    }
    const start = L.circleMarker(from, { className: 'route-start', radius: 6, weight: 3, interactive: false });
    const end = L.circleMarker(to, { className: 'route-end', radius: 7, weight: 3, interactive: false });
    this.group.addLayer(start).addLayer(end).addTo(this.map);
    const parking = plan.entrances && plan.nearest ? { entrances: plan.entrances, nearest: plan.nearest } : null;
    if (parking) {
      const color = parkingAccess(parking.nearest) === 'subscribers' ? 'var(--cat-park-sub)' : 'var(--cat-men)';
      for (const entrance of parking.entrances) {
        const nearest = entrance.id === parking.nearest.id;
        const marker = L.marker([entrance.lat, entrance.lng], {
          icon: L.divIcon({ className: `parking-entrance${nearest ? ' is-nearest' : ''}`, html: `<span style="--c:${color}">➜</span>`, iconSize: [nearest ? 30 : 22, nearest ? 30 : 22], iconAnchor: [nearest ? 15 : 11, nearest ? 15 : 11] }),
          title: t('park_entrance', { n: entrance.id }),
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
    // Progressive draw: dash the line by its own length and animate the offset to 0. The length is
    // normalised (pathLength = 1) so a zoom right after drawing (fitBounds) cannot leave part of the
    // line hidden; the dash is removed when the transition ends, or after it at the latest.
    const el = line?.getElement() as SVGPathElement | undefined;
    if (el && !reduce) {
      el.setAttribute('pathLength', '1');
      el.style.strokeDasharray = '1';
      el.style.strokeDashoffset = '1';
      requestAnimationFrame(() => (el.style.strokeDashoffset = '0'));
      const done = () => {
        el.style.strokeDasharray = 'none';
        el.removeAttribute('pathLength');
      };
      el.addEventListener('transitionend', done, { once: true });
      window.setTimeout(done, 1200);
    }
    this.drawArrows();
    return {
      meters: plan.walkM + plan.driveM,
      minutes: plan.minutes,
      bounds: L.latLngBounds(this.path),
      ...(parking ? { nearestEntrance: parking.nearest.id } : {}),
      ...(plan.mode === 'drive' && plan.lot ? { drive: { meters: plan.driveM, lot: plan.lot.id - 900, walkMeters: plan.walkM } } : {}),
    };
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
