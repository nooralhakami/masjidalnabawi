import L from 'leaflet';
import type { Poi } from '../data/types';
import type { Facilities } from '../domain/facilities';
import type { FilterId } from '../domain/filters';
import { nm } from '../i18n';
import { HIT, chipSize, markerSpec, overlaps, tierOf, visibleAtZoom } from './markers';

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
    this.pois = pois;
    this.filter = filter;
    this.hidden = hidden;
    this.draw();
  }

  select(id: number | null): void {
    this.selected = id;
    this.draw();
  }

  draw(): void {
    this.group.clearLayers();
    if (this.hidden) return;
    const bounds = this.map.getBounds().pad(0.25);
    const tier = tierOf(this.map.getZoom());
    // Gate chips are placed first so the selected one and lower numbers win ties.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const order = [...this.pois].sort((a, b) => Number(b.id === this.selected) - Number(a.id === this.selected));
    for (const p of order) {
      const sel = p.id === this.selected;
      // Once a destination is selected, keep the map focused on it and hide
      // every other POI until the selection is closed.
      if (this.selected !== null && !sel) continue;
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
        icon: L.divIcon({ html: spec.html, className: spec.className, iconSize: [HIT, HIT], iconAnchor: [HIT / 2, HIT / 2] }),
        zIndexOffset: spec.zIndex,
        keyboard: true,
        title: nm(p),
        alt: nm(p),
        riseOnHover: true,
      });
      m.on('click', () => this.onPick(p));
      this.group.addLayer(m);
    }
  }
}
