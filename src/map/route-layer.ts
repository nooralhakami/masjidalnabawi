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
  drive?: { meters: number; lot?: number; walkMeters: number; entrance?: 'quba' | 'sultana'; unsure?: boolean; level?: 'A' | 'B'; exit?: 'quba' | 'sultana'; carPark?: boolean };
  /** Every route offered (the chosen one included), and which one is chosen. */
  options: { minutes: number; meters: number }[];
  chosen: number;
}

const ARROW_EVERY_M = 55;

function bearing(a: L.Point, b: L.Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Point at a share (0–1) of a path's length, for a label on it. */
function pointAlong(path: LatLng[], share: number): LatLng {
  const pts = path.map((p) => L.latLng(p));
  const total = pts.reduce((s, p, i) => (i ? s + pts[i - 1].distanceTo(p) : 0), 0);
  let left = total * share;
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i - 1].distanceTo(pts[i]);
    if (left <= seg && seg > 0) {
      const f = left / seg;
      return [pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f];
    }
    left -= seg;
  }
  return path[path.length - 1];
}

/**
 * Draws a trip: walking legs as a green line with gold flow dashes, the drive in blue, the stretch
 * inside the underground car park dashed; direction arrows, start/end dots and car-park markers.
 * Alternative routes are drawn underneath in grey, each with its time; tapping one chooses it.
 */
export class RouteLayer {
  private group = L.featureGroup();
  private path: LatLng[] = [];
  /** Each leg's own path: arrows follow the legs, never the gap between parking and the stairs. */
  private legPaths: LatLng[][] = [];
  private others: LatLng[][] = [];
  private labels: { marker: L.Marker; path: LatLng[] }[] = [];

  constructor(private map: L.Map) {
    map.on('zoomend', () => this.path.length && this.drawArrows());
    map.on('moveend', () => this.placeLabels());
  }

  /**
   * Slide each alternative's time label along its line to where it is clearest on screen: away from
   * the side edges, where the map controls are (a handful of points per label, after each move).
   */
  private placeLabels() {
    if (!this.labels.length) return;
    const size = this.map.getSize();
    for (const { marker, path } of this.labels) {
      let best: { ll: LatLng; score: number } | null = null;
      for (let s = 0.2; s <= 0.81; s += 0.1) {
        const ll = pointAlong(path, s);
        const pt = this.map.latLngToContainerPoint(ll);
        const score = pt.y < 0 || pt.y > size.y ? -1 : Math.min(pt.x, size.x - pt.x);
        if (!best || score > best.score) best = { ll, score };
      }
      if (best) marker.setLatLng(best.ll);
    }
  }

  get active(): boolean {
    return this.path.length > 0;
  }

  get latLngs(): L.LatLng[] {
    return this.path.map((p) => L.latLng(p));
  }

  /** The alternative routes on the map, in plan order without the chosen one. */
  get alternatives(): L.LatLng[][] {
    return this.others.map((path) => path.map((p) => L.latLng(p)));
  }

  /**
   * Draw `plans[chosen]` as the route and the other plans as alternatives. `animate: false` (a switch
   * or a re-route while walking) redraws without the draw-in, so nothing jumps at the visitor.
   */
  show(plans: Plan[], chosen = 0, opts: { animate?: boolean; onPick?: (i: number) => void } = {}): RouteInfo {
    this.clear();
    const plan = plans[chosen];
    this.path = fullPath(plan);
    this.legPaths = plan.legs.map((l) => l.path).filter((p) => p.length > 1);
    const from = this.path[0];
    const to = this.path[this.path.length - 1];
    const reduce = opts.animate === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    plans.forEach((other, i) => {
      if (i === chosen) return;
      const path = fullPath(other);
      this.others.push(path);
      const pick = (e: L.LeafletEvent) => {
        L.DomEvent.stop(e as L.LeafletMouseEvent);
        opts.onPick?.(i);
      };
      const casing = L.polyline(path, { className: 'route-alt-casing', weight: 16, opacity: 0, bubblingMouseEvents: false });
      const under = L.polyline(path, { className: 'route-alt-under', weight: 10, interactive: false });
      const line = L.polyline(path, { className: 'route-alt', weight: 6, interactive: false });
      const label = L.marker(pointAlong(path, 0.5), {
        icon: L.divIcon({ className: 'route-alt-label-wrap', html: `<span class="route-alt-label">${esc(t('r_min', { t: other.minutes }))}</span>`, iconSize: [64, 24], iconAnchor: [32, 12] }),
        keyboard: false,
        bubblingMouseEvents: false,
        zIndexOffset: 900,
      });
      casing.on('click', pick);
      label.on('click', pick);
      this.labels.push({ marker: label, path });
      this.group.addLayer(under).addLayer(line).addLayer(casing).addLayer(label);
    });
    let line: L.Polyline | null = null;
    for (const leg of plan.legs) {
      if (leg.path.length < 2) continue;
      if (leg.kind === 'walk') {
        const walk = L.polyline(leg.path, { className: `route-line route-base${reduce ? '' : ' is-drawing'}`, weight: 6, interactive: false });
        this.group
          .addLayer(L.polyline(leg.path, { className: 'route-casing route-base', weight: 11, interactive: false }))
          .addLayer(walk)
          .addLayer(L.polyline(leg.path, { className: 'route-flow route-base', weight: 2, interactive: false }));
        line ??= walk;
      } else if (leg.kind === 'drive') {
        this.group
          .addLayer(L.polyline(leg.path, { className: 'route-casing route-base', weight: 12, interactive: false }))
          .addLayer(L.polyline(leg.path, { className: 'route-drive route-base', weight: 7, interactive: false }));
      } else {
        // Underground: a solid line with light dashes along it (a tunnel), cased like the other legs.
        this.group.addLayer(L.polyline(leg.path, { className: 'route-casing route-base', weight: 11, interactive: false }));
        // Level A (above) gets a yellow edge, the colour of the ramp up in the owner's drawing; the
        // ramps themselves are edged yellow (up) and green (down). Level B keeps the white edge.
        let labelled = false;
        for (const part of leg.parts ?? []) {
          if (part.on === 'B') continue;
          this.group.addLayer(L.polyline(part.path, { className: `route-base route-casing-${part.on === 'A' ? 'level-a' : `ramp-${part.on}`}`, weight: 14, interactive: false }));
          if (part.on === 'A' && !labelled && part.path.length > 1) {
            labelled = true;
            this.group.addLayer(
              L.marker(pointAlong(part.path, 0.5), {
                icon: L.divIcon({ className: 'route-level-label', html: `<span>${esc(t('lvl_name', { l: 'A' }))}</span>`, iconSize: [72, 22] }),
                interactive: false,
                keyboard: false,
                zIndexOffset: 1000,
              }),
            );
          }
        }
        this.group
          .addLayer(L.polyline(leg.path, { className: 'route-garage route-base', weight: 6, interactive: false }))
          .addLayer(L.polyline(leg.path, { className: 'route-garage-dash route-base', weight: 2, interactive: false }));
        // The entrance ramp (the way in only: the way out starts at the parked car).
        if (!plan.exit) {
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
    }
    // Where the car turns into its lot (right after the lot's first facility, as in the owner's drawing).
    if (plan.gate && plan.lot) {
      this.group.addLayer(
        L.marker(plan.gate, {
          icon: L.divIcon({ className: 'route-lot-gate', html: `<span>P${plan.lot.id - 900}${plan.level ?? ''}</span>`, iconSize: [38, 22] }),
          title: plan.level ? t('r_lot_level', { n: plan.lot.id - 900, l: plan.level }) : t('r_lot', { n: plan.lot.id - 900 }),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1001,
        }),
      );
    }
    // The ramps between the car park's levels on the way: up to A (yellow in the owner's drawing), down to B (green).
    for (const r of plan.ramps ?? []) {
      this.group.addLayer(
        L.marker(r.at, {
          icon: L.divIcon({ className: `route-level-ramp is-${r.to === 'A' ? 'up' : 'down'}`, html: `<span>${r.to === 'A' ? '↑' : '↓'}${r.to}</span>`, iconSize: [36, 22] }),
          title: t(r.to === 'A' ? 'g_up' : 'g_down'),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1001,
        }),
      );
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
      // Frame every offered route, so the alternatives can be seen (and tapped) too.
      bounds: L.latLngBounds([...this.path, ...this.others.flat()]),
      ...(parking ? { nearestEntrance: parking.nearest.id } : {}),
      ...(plan.mode === 'drive'
        ? {
            drive: {
              meters: plan.driveM,
              lot: plan.lot ? plan.lot.id - 900 : undefined,
              walkMeters: plan.walkM,
              entrance: plan.entrance,
              exit: plan.exit,
              level: plan.level,
              carPark: plan.carPark,
              unsure: plan.garageCertain === false,
            },
          }
        : {}),
      options: plans.map((p) => ({ minutes: p.minutes, meters: p.walkM + p.driveM })),
      chosen,
    };
  }

  private arrows = L.layerGroup();

  /** Light chevrons along the route, spaced in metres and pointing the way. */
  private drawArrows() {
    this.arrows.clearLayers();
    this.arrows.addTo(this.map);
    let carry = ARROW_EVERY_M / 2;
    const segments = this.legPaths.flatMap((leg) => leg.slice(1).map((p, k) => [leg[k], p] as const));
    for (const [from, to] of segments) {
      const a = L.latLng(from);
      const b = L.latLng(to);
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

  private focusLayer = L.layerGroup();

  /**
   * Colour in full only the stretch ahead of the visitor (owner, 2026-10-13): the rest of the route
   * stays drawn, faint. `null` shows the whole route in full again.
   */
  focus(path: LatLng[] | null, mode: 'walk' | 'drive' = 'walk'): void {
    this.focusLayer.clearLayers();
    const on = !!path && path.length > 1 && this.path.length > 0;
    this.map.getContainer().classList.toggle('is-route-focus', on);
    if (!on) return;
    this.focusLayer
      .addLayer(L.polyline(path, { className: 'route-focus-casing', weight: 13, interactive: false }))
      .addLayer(L.polyline(path, { className: `route-focus is-${mode}`, weight: 8, interactive: false }))
      .addTo(this.map);
  }

  clear(): void {
    this.focus(null);
    this.group.clearLayers();
    this.group.remove();
    this.arrows.clearLayers();
    this.arrows.remove();
    this.path = [];
    this.legPaths = [];
    this.others = [];
    this.labels = [];
  }
}
