import L from 'leaflet';
import type { Poi } from '../data/types';
import type { Facilities } from '../domain/facilities';
import type { FilterId } from '../domain/filters';
import { nm } from '../i18n';
import { esc } from '../ui/dom';
import { HIT, chipSize, gateLabelVisible, markerSpec, overlaps, tierOf, visibleAtZoom, zoomClass } from './markers';

/**
 * Draws the visible POIs. Only markers inside the viewport (+25%) are created,
 * and the layer redraws on moveend/zoomend.
 */
export class PoiLayer {
  private group = L.layerGroup();
  private pois: readonly Poi[] = [];
  private filter: FilterId = 'all';
  private selected: number | null = null;
  private hidden = false;

  constructor(
    private map: L.Map,
    private fac: Facilities,
    private onPick: (p: Poi) => void,
  ) {
    this.group.addTo(map);
    map.on('moveend zoomend', () => this.draw());
    fac.onChange(() => this.draw());
  }

  set(pois: readonly Poi[], filter: FilterId, hidden = false): void {
    // A new filter (or showing markers again) pops the markers in; plain panning doesn't.
    if (filter !== this.filter || hidden !== this.hidden) this.pop();
    this.pois = pois;
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

  draw(): void {
    this.group.clearLayers();
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
      const spec = markerSpec(p, tier, this.fac.status(p.id), sel, compact);
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ html: spec.html, className: spec.className, iconSize: spec.size ?? [HIT, HIT], iconAnchor: spec.anchor ?? [HIT / 2, HIT / 2] }),
        zIndexOffset: spec.zIndex,
        keyboard: true,
        title: nm(p),
        alt: nm(p),
        riseOnHover: true,
      });
      m.on('click', () => this.onPick(p));
      this.group.addLayer(m);
      if (gateLabelVisible(p, this.map.getZoom())) {
        const pt = this.map.latLngToContainerPoint([p.lat, p.lng]);
        const label = nm(p);
        const w = Math.max(44, Math.min(190, label.length * 7 + 18));
        const box = { x: pt.x + 26 + w / 2, y: pt.y, w, h: 24 };
        if (!placed.some((b) => overlaps(b, box))) {
          placed.push(box);
          const labelMarker = L.marker([p.lat, p.lng], {
            icon: L.divIcon({ html: `<span class="gate-label" dir="auto">${esc(label)}</span>`, className: 'gate-label-wrap', iconSize: [w, 24], iconAnchor: [-26, 12] }),
            zIndexOffset: sel ? 1001 : 51,
            keyboard: false,
            interactive: false,
          });
          this.group.addLayer(labelMarker);
        }
      }
    }
  }

}
