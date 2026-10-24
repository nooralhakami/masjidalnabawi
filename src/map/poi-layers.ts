import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl';
import { ICON_FROM, INNER_NUMBER_FROM, OUTER_CHIP_FROM, PAIR_NUMBER_FROM, GATE_NAME_FROM } from '../presentation/marker-look';
import type { Palette } from './images';
import { mapZoom } from './zoom';

/** Map zoom of a legacy (Leaflet) zoom threshold. */
const at = mapZoom;
const SELECTED_SCALE = 1.35;

/**
 * Add the places' layers over the base imagery: the women's areas, the gates, the facilities, the
 * car parks, the chosen place's pin, the must-visit sites and the new vehicle entrances.
 * `version` names this theme's marker images (they are drawn again when it changes).
 */
export function addPoiLayers(m: MLMap, palette: Palette, version: number): void {
  const img = (...parts: (string | ExpressionSpecification)[]) => ['concat', ...parts, `@${version}`] as ExpressionSpecification;
  /** A colour token on a feature, as a paint colour (read from tokens.css). */
  const colorOf = (get: ExpressionSpecification): ExpressionSpecification => {
    const tokens = ['dir-south', 'dir-west', 'dir-north', 'dir-east', 'cat-women', 'cat-men', 'cat-acc', 'cat-hotel', 'cat-food', 'cat-land', 'cat-emg', 'cat-shop', 'cat-hist', 'cat-park-sub', 'cat-gray'];
    return ['match', get, ...tokens.flatMap((t) => [t, palette.get(t)]), palette.get('cat-land')] as unknown as ExpressionSpecification;
  };
  const white = '#ffffff';
  const symbol = { 'icon-allow-overlap': true, 'icon-ignore-placement': true } as const;
  m.addLayer({ id: 'women-fill', type: 'fill', source: 'women', paint: { 'fill-color': palette.get('women-area-solid'), 'fill-opacity': 0.22 } });
  m.addLayer({ id: 'women-line', type: 'line', source: 'women', paint: { 'line-color': palette.get('women-area-solid'), 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [4, 2.7] } });
  // Gates zoomed out: small dots in the side colour (the live app's .mk-gdot; 3 px at 15 and below).
  m.addLayer({
    id: 'inner-dots',
    type: 'circle',
    source: 'pois',
    paint: { 'circle-radius': ['step', ['zoom'], 1.5, at(16), 4], 'circle-color': colorOf(['get', 'color']), 'circle-stroke-color': white, 'circle-stroke-width': ['step', ['zoom'], 0.75, at(16), 1] },
  });
  m.addLayer({
    id: 'outer-dots',
    type: 'circle',
    source: 'pois',
    paint: { 'circle-radius': ['step', ['zoom'], 1.5, at(16), 3], 'circle-color': colorOf(['get', 'color']), 'circle-stroke-color': white, 'circle-stroke-width': ['step', ['zoom'], 0.75, at(16), 1] },
  });
  // Facilities up to 16: plain dots, 4 / 5 / 8 px with a white ring (1 / 1 / 1.5 px), drawn as GPU
  // circles (no symbol placement, the cheapest layer there is). Mixed restrooms are half blue, half
  // purple, which a circle cannot draw: those few stay images.
  m.addLayer({
    id: 'facility-dots',
    type: 'circle',
    source: 'pois',
    maxzoom: at(ICON_FROM),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], at(14), 2, at(15), 2.5, at(16), 4],
      'circle-color': ['case', ['==', ['get', 'closed'], 1], palette.get('cat-gray'), colorOf(['get', 'pcolor'])],
      'circle-stroke-color': white,
      'circle-stroke-width': ['step', ['zoom'], 1, at(16), 1.5],
    },
  });
  m.addLayer({
    id: 'mixed-dots',
    type: 'symbol',
    source: 'pois',
    maxzoom: at(ICON_FROM),
    layout: { ...symbol, 'icon-image': img('dot:mixed:', ['to-string', ['get', 'closed']]), 'icon-size': ['interpolate', ['linear'], ['zoom'], at(14), 0.5, at(15), 0.625, at(16), 1] },
  });
  // From 17: the disc with its icon, 14 px (20 px at 19).
  m.addLayer({
    id: 'facilities',
    type: 'symbol',
    source: 'pois',
    minzoom: at(ICON_FROM),
    layout: {
      ...symbol,
      'symbol-sort-key': ['get', 'z'],
      'icon-image': img('fac:', ['get', 'look'], ':', ['to-string', ['get', 'closed']]),
      'icon-size': ['interpolate', ['linear'], ['zoom'], at(17), 0.7, at(18), 0.7, at(19), 1],
    },
  });
  m.addLayer({
    id: 'parking',
    type: 'symbol',
    source: 'pois',
    layout: { ...symbol, 'icon-image': img('park:', ['to-string', ['get', 'n']], ':', ['to-string', ['get', 'sub']]), 'icon-size': ['step', ['zoom'], 0.7, at(16), 1], 'icon-anchor': 'center' },
  });
  // Outer-gate number chips from 17; one that would overlap another stays a dot (the live app's «compact»).
  m.addLayer({
    id: 'outer-chips',
    type: 'symbol',
    source: 'pois',
    minzoom: at(OUTER_CHIP_FROM),
    layout: { 'icon-image': img('gate:', ['to-string', ['get', 'id']]), 'icon-size': ['step', ['zoom'], 17 / 19, at(19), 1], 'icon-padding': 1, 'symbol-sort-key': ['get', 'id'] },
  });
  m.addLayer({
    id: 'inner-numbers',
    type: 'symbol',
    source: 'pois',
    minzoom: at(INNER_NUMBER_FROM),
    layout: { ...symbol, 'icon-image': img('inum:', ['to-string', ['get', 'id']], ':', ['get', 'color']) },
  });
  m.addLayer({
    id: 'pairs',
    type: 'symbol',
    source: 'pairs',
    minzoom: at(PAIR_NUMBER_FROM),
    layout: { ...symbol, 'icon-image': img('pair:', ['to-string', ['get', 'n']], ':', ['get', 'color']) },
  });
  // Named gates' labels at 19, beside the number, never on top of a chip or another label.
  m.addLayer({
    id: 'gate-names',
    type: 'symbol',
    source: 'pois',
    minzoom: at(GATE_NAME_FROM),
    layout: { 'icon-image': img('name:', ['to-string', ['get', 'id']]), 'icon-anchor': 'left', 'icon-offset': [26, 0], 'icon-padding': 2, 'symbol-sort-key': ['get', 'id'] },
  });
  // The chosen place: a pin for a facility or site (48 × 60, its tip on the spot), the chip or
  // number of a gate or car park — at any zoom, and even with «hide markers» on.
  m.addLayer({
    id: 'selected',
    type: 'symbol',
    source: 'pois',
    filter: ['literal', false],
    layout: {
      ...symbol,
      'icon-image': [
        'match',
        ['get', 'kind'],
        'gate-outer',
        img('gate:', ['to-string', ['get', 'id']]),
        'gate-inner',
        img('inum:', ['to-string', ['get', 'id']], ':', ['get', 'color']),
        'parking',
        img('park:', ['to-string', ['get', 'n']], ':', ['to-string', ['get', 'sub']]),
        img('pin:', ['get', 'look'], ':', ['to-string', ['get', 'closed']]),
      ] as unknown as ExpressionSpecification,
      'icon-anchor': ['match', ['get', 'kind'], ['gate-outer', 'gate-inner', 'parking'], 'center', 'bottom'] as unknown as ExpressionSpecification,
      // A chosen gate or car park: its own chip, 1.35 times larger (the live app's .mk.is-selected).
      'icon-size': ['match', ['get', 'kind'], ['gate-outer', 'gate-inner', 'parking'], SELECTED_SCALE, 1] as unknown as ExpressionSpecification,
    },
  });
  // Must-visit sites on top: same size at every zoom (30 px at 19), with their halo.
  m.addLayer({
    id: 'featured',
    type: 'symbol',
    source: 'pois',
    layout: { ...symbol, 'icon-image': img('feat:', ['get', 'icon']), 'icon-size': ['step', ['zoom'], 1, at(19), 30 / 24] },
  });
  // The new vehicle entrances (with the car parks' pill only), under the chosen place's pin.
  const rtl = document.documentElement.dir === 'rtl';
  m.addLayer(
    {
      id: 'car-entrances',
      type: 'symbol',
      source: 'carEntrances',
      layout: {
        ...symbol,
        'icon-image': img('cent:', ['get', 'eid'], ':', ['to-string', ['get', 'open']]),
        // The car disc on the spot, the words beside it, after it in the reading direction
        // (images.ts: the disc's centre is 18 px in from its side).
        'icon-anchor': rtl ? 'right' : 'left',
        'icon-offset': [rtl ? 18 : -18, 0],
        visibility: 'none',
      },
    },
    'selected',
  );
}
