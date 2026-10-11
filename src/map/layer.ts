import L from 'leaflet';
import type { Poi } from '../data/types';
import type { Facilities } from '../domain/facilities';
import type { FilterId } from '../domain/filters';
import { VISIT_SITES, FEATURED_IDS } from '../domain/visits';
import { nm } from '../i18n';
import { esc } from '../ui/dom';
import { HIT, chipSize, gateLabelVisible, markerSpec, overlaps, pairLabelSpec, pairLabelVisible, tierOf, visibleAtZoom, zoomClass } from '../ui/markers';

/**
 * Draws the visible POIs. Only markers inside the viewport (+25%) exist, and after each move the
 * layer is reconciled, not rebuilt: a marker whose look is unchanged is kept, only markers that
 * entered or left the view (or changed look) are added or removed. Rebuilding ~250 DOM markers at
 * the end of every drag caused a visible hitch on phones (SPEC F13).
 */
export class PoiLayer {
  private group = L.layerGroup();
  private pois: readonly Poi[] = [];
  private filter: FilterId = 'all';
  private selected: number | null = null;
  private hidden = false;
  /** Must-visit sites stay on the map whatever the filter, unless a search is running. */
  private withFeatured = true;
  /** Markers on the map, by key ("p<id>" for a place, "l<id>" for a gate label), with the look they were made with. */
  private live = new Map<string, { marker: L.Marker; look: string }>();

  constructor(
    private map: L.Map,
    private fac: Facilities,
    private onPick: (p: Poi) => void,
  ) {
    this.group.addTo(map);
    // A zoom also ends with "moveend", so one listener covers pan, zoom and fly.
    map.on('moveend', () => this.draw());
    fac.onChange(() => this.draw());
  }

  set(pois: readonly Poi[], filter: FilterId, hidden = false, withFeatured = true): void {
    // A new filter (or showing markers again) pops the markers in; plain panning doesn't.
    if (filter !== this.filter || hidden !== this.hidden) this.pop();
    this.withFeatured = withFeatured;
    this.pois = withFeatured ? [...pois, ...VISIT_SITES.filter((v) => !pois.includes(v))] : pois;
    this.filter = filter;
    this.hidden = hidden;
    this.draw();
  }

  private popTimer = 0;
  private pop(): void {
    const el = this.map.getContainer();
    el.classList.add('mk-pop');
    clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => el.classList.remove('mk-pop'), 400);
  }

  select(id: number | null): void {
    this.selected = id;
    this.draw();
  }

  /** Keep the marker under `key` if its look is unchanged; otherwise (re)create it. */
  private put(key: string, look: string, make: () => L.Marker, seen: Set<string>): void {
    seen.add(key);
    const cur = this.live.get(key);
    if (cur && cur.look === look) return;
    if (cur) this.group.removeLayer(cur.marker);
    const marker = make();
    this.group.addLayer(marker);
    this.live.set(key, { marker, look });
  }

  draw(): void {
    const seen = new Set<string>();
    const bounds = this.map.getBounds().pad(0.25);
    const zoom = this.map.getZoom();
    const tier = tierOf(zoom);
    const el = this.map.getContainer();
    el.classList.remove('z-far', 'z-mid');
    const zc = zoomClass(zoom);
    if (zc) el.classList.add(zc);
    // Gate chips are placed first so the selected one and lower numbers win ties.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const order = [...this.pois].sort((a, b) => Number(b.id === this.selected) - Number(a.id === this.selected));
    for (const p of order) {
      const sel = p.id === this.selected;
      // Once a destination is selected, keep the map focused on it and hide
      // every other POI until the selection is closed.
      if (this.selected !== null && !sel) continue;
      // "Hide markers" hides everything except a place the visitor has just chosen.
      if (this.hidden && !sel) continue;
      if (!sel && !bounds.contains([p.lat, p.lng])) continue;
      if (!visibleAtZoom(p, tier, this.filter, sel)) continue;
      let compact = false;
      if (p.subCategory === 'gate_outer' && tier !== 's') {
        const pt = this.map.latLngToContainerPoint([p.lat, p.lng]);
        const [w, h] = chipSize(p, tier);
        const box = { x: pt.x, y: pt.y, w, h };
        compact = !sel && placed.some((b) => overlaps(b, box));
        if (!compact) placed.push(box);
      }
      const spec = markerSpec(p, tier, this.fac.status(p.id), sel, compact, this.withFeatured && FEATURED_IDS.has(p.id));
      const name = nm(p);
      const size = spec.size ?? [HIT, HIT];
      const anchor = spec.anchor ?? [HIT / 2, HIT / 2];
      this.put(`p${p.id}`, `${spec.className}|${spec.zIndex}|${size}|${anchor}|${name}|${spec.html}`, () => {
        const m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ html: spec.html, className: spec.className, iconSize: size, iconAnchor: anchor }),
          zIndexOffset: spec.zIndex,
          keyboard: true,
          title: name,
          alt: name,
          riseOnHover: true,
        });
        m.on('click', () => this.onPick(p));
        return m;
      }, seen);
      if (gateLabelVisible(p, this.map.getZoom())) {
        const pt = this.map.latLngToContainerPoint([p.lat, p.lng]);
        const label = nm(p);
        const w = Math.max(44, Math.min(190, label.length * 7 + 18));
        const box = { x: pt.x + 26 + w / 2, y: pt.y, w, h: 24 };
        if (!placed.some((b) => overlaps(b, box))) {
          placed.push(box);
          this.put(`l${p.id}`, `${label}|${w}|${sel}`, () =>
            L.marker([p.lat, p.lng], {
              icon: L.divIcon({ html: `<span class="gate-label" dir="auto">${esc(label)}</span>`, className: 'gate-label-wrap', iconSize: [w, 24], iconAnchor: [-26, 12] }),
              zIndexOffset: sel ? 1001 : 51,
              keyboard: false,
              interactive: false,
            }), seen);
        }
      }
    }
    // The number of a pair of restrooms, between its two markers (only while both are on the map).
    if (this.selected === null && !this.hidden && pairLabelVisible(zoom)) {
      const shown = new Map(this.pois.map((q) => [q.id, q]));
      for (const a of this.pois) {
        const b = a.pairNo !== undefined && a.pairWith !== undefined && a.id < a.pairWith ? shown.get(a.pairWith) : undefined;
        if (!b) continue;
        const mid: [number, number] = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
        if (!bounds.contains(mid)) continue;
        const spec = pairLabelSpec(a);
        this.put(`n${a.id}`, `${a.pairNo}|${spec.className}`, () =>
          L.marker(mid, {
            icon: L.divIcon({ html: spec.html, className: spec.className, iconSize: spec.size, iconAnchor: [spec.size[0] / 2, spec.size[1] / 2] }),
            zIndexOffset: 250,
            keyboard: false,
            interactive: false,
          }), seen);
      }
    }
    // Whatever was not drawn this time has left the view (or the filter): remove it.
    for (const [key, { marker }] of this.live) {
      if (!seen.has(key)) {
        this.group.removeLayer(marker);
        this.live.delete(key);
      }
    }
  }
}
