import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl';

/** How long a tapped place's name stays, clear (owner, 2026-10-25). */
export const TAP_NAME_MS = 2000;

export const EMPTY_HINTS: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The layer over the places' markers: the name of the place the visitor goes by (faint), and of the one they tapped (clear). */
export function addHintLayer(m: MLMap, version: number): void {
  if (m.getLayer('hints')) return;
  m.addLayer({
    id: 'hints',
    type: 'symbol',
    source: 'hints',
    layout: {
      'icon-image': ['concat', 'hint:', ['to-string', ['get', 'id']], ':', ['get', 'look'], `@${version}`] as ExpressionSpecification,
      // Over the place: the label's bottom edge sits a little above the marker (a clear one a little higher).
      'icon-anchor': 'bottom',
      'icon-offset': ['match', ['get', 'look'], 's', ['literal', [0, -16]], ['literal', [0, -13]]] as ExpressionSpecification,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // The clear one above the faint one.
      'symbol-sort-key': ['match', ['get', 'look'], 's', 2, 1] as ExpressionSpecification,
    },
  });
}

/**
 * The two names on the map while a route is followed (owner, 2026-10-25): `setNear` the faint one for
 * the place the visitor is going by, `flash` the clear one for a place they tapped. One source of at
 * most two features; nothing is redrawn per frame, and nothing moves (no fade), so reduced motion needs no case.
 */
export class HintLayer {
  private near: number | null = null;
  private tapped: number | null = null;
  private timer = 0;

  constructor(
    private map: MLMap,
    private placeOf: (id: number) => { lat: number; lng: number } | undefined,
  ) {}

  setNear(id: number | null): void {
    if (id === this.near) return;
    this.near = id;
    this.paint();
  }

  /** The tapped place's name, clear, for `ms` (a second tap restarts it). */
  flash(id: number, ms = TAP_NAME_MS): void {
    window.clearTimeout(this.timer);
    this.tapped = id;
    this.paint();
    this.timer = window.setTimeout(() => {
      this.tapped = null;
      this.paint();
    }, ms);
  }

  /** The route ended: no names. */
  clear(): void {
    window.clearTimeout(this.timer);
    this.near = this.tapped = null;
    this.paint();
  }

  /** The ids on the map now (for the tests). */
  get shown(): { near: number | null; tapped: number | null } {
    return { near: this.near, tapped: this.tapped };
  }

  private paint(): void {
    const feature = (id: number, look: 'f' | 's') => {
      const p = this.placeOf(id);
      return p ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }, properties: { id, look } }] : [];
    };
    // While a tapped name is up the faint one waits, so two labels never pile on each other.
    const features = this.tapped !== null ? feature(this.tapped, 's') : this.near !== null ? feature(this.near, 'f') : [];
    (this.map.getSource('hints') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }
}
