import type { FeatureCollection, Point } from 'geojson';

/**
 * Vertical transit nodes (99 nodes: 16 elevators, 80 escalators, 3 accessible gates) extracted from
 * Al-Haramain navQ (`vertical_nodes.geojson`) for step-free accessible routing (SPEC-3D.md §2-a).
 */
export type VerticalNodeType = 'elevator' | 'escalator' | 'gate';

export interface VerticalNode {
  id: number;
  type: VerticalNodeType;
  venueId: number;
  floorId: number;
  lat: number;
  lng: number;
  closed: boolean;
}

type RawNode = readonly [id: number, type: VerticalNodeType, venueId: number, floorId: number, lng: number, lat: number];

const RAW_NODES: readonly RawNode[] = [
  [4705, 'elevator', 4, 24, 39.613025, 24.468534],
  [4706, 'elevator', 4, 24, 39.609256, 24.468572],
  [4933, 'escalator', 20, 95, 39.608138, 24.467185],
  [4934, 'escalator', 20, 95, 39.60849, 24.467187],
  [4935, 'escalator', 20, 95, 39.608141, 24.469011],
  [4936, 'escalator', 20, 95, 39.608489, 24.469008],
  [4937, 'escalator', 20, 95, 39.608137, 24.468106],
  [4938, 'escalator', 20, 95, 39.608485, 24.468102],
  [4941, 'escalator', 20, 95, 39.610645, 24.470411],
  [4942, 'escalator', 20, 95, 39.610645, 24.470727],
  [4943, 'escalator', 20, 95, 39.608669, 24.470408],
  [4944, 'escalator', 20, 95, 39.609658, 24.470731],
  [5123, 'escalator', 20, 94, 39.609639, 24.466387],
  [5126, 'escalator', 20, 94, 39.608517, 24.467218],
  [5127, 'escalator', 20, 94, 39.608177, 24.467215],
  [5128, 'escalator', 20, 94, 39.608517, 24.468117],
  [5132, 'escalator', 20, 94, 39.608529, 24.469909],
  [5137, 'escalator', 20, 94, 39.609678, 24.470414],
  [5139, 'escalator', 20, 94, 39.610657, 24.470415],
  [5140, 'escalator', 20, 94, 39.61165, 24.470733],
  [5141, 'escalator', 20, 94, 39.611632, 24.470416],
  [5142, 'escalator', 20, 94, 39.61261, 24.470729],
  [5143, 'escalator', 20, 94, 39.612606, 24.470421],
  [5145, 'escalator', 20, 94, 39.613586, 24.470425],
  [5148, 'escalator', 20, 94, 39.614043, 24.468769],
  [5149, 'escalator', 20, 94, 39.61357, 24.46877],
  [5150, 'elevator', 20, 94, 39.614021, 24.470425],
  [5151, 'elevator', 20, 94, 39.613622, 24.470425],
  [5153, 'elevator', 20, 94, 39.613593, 24.469325],
  [5154, 'elevator', 20, 94, 39.614016, 24.468769],
  [5155, 'elevator', 20, 94, 39.61359, 24.46877],
  [4204, 'escalator', 4, 24, 39.609254, 24.46897],
  [4196, 'escalator', 4, 12, 39.609349, 24.467913],
  [4197, 'escalator', 4, 12, 39.61279, 24.467841],
  [4960, 'elevator', 20, 95, 39.61367, 24.468678],
  [4961, 'escalator', 20, 95, 39.614074, 24.468676],
  [5134, 'escalator', 20, 94, 39.608699, 24.470409],
  [5135, 'escalator', 20, 94, 39.608704, 24.470724],
  [5144, 'escalator', 20, 94, 39.614058, 24.470425],
  [5146, 'escalator', 20, 94, 39.614069, 24.469327],
  [5133, 'escalator', 20, 94, 39.608189, 24.469906],
  [4577, 'gate', 4, 12, 39.612732, 24.467844],
  [5147, 'escalator', 20, 94, 39.613559, 24.469325],
  [5152, 'elevator', 20, 94, 39.61403, 24.469328],
  [3505, 'gate', 4, 12, 39.609289, 24.468867],
  [4945, 'escalator', 20, 95, 39.609657, 24.470409],
  [4946, 'escalator', 20, 95, 39.608672, 24.47074],
  [4949, 'escalator', 20, 95, 39.612624, 24.470712],
  [4950, 'escalator', 20, 95, 39.612621, 24.470395],
  [4951, 'escalator', 20, 95, 39.613609, 24.470384],
  [4952, 'elevator', 20, 95, 39.613685, 24.470384],
  [4953, 'escalator', 20, 95, 39.614082, 24.470383],
  [4954, 'elevator', 20, 95, 39.614009, 24.470383],
  [4955, 'elevator', 20, 95, 39.614039, 24.469282],
  [4957, 'escalator', 20, 95, 39.613596, 24.46929],
  [4958, 'elevator', 20, 95, 39.613645, 24.469288],
  [4959, 'escalator', 20, 95, 39.613598, 24.468679],
  [4962, 'elevator', 20, 95, 39.613995, 24.468678],
  [4964, 'escalator', 20, 95, 39.612593, 24.466339],
  [4965, 'escalator', 20, 95, 39.611608, 24.466342],
  [4967, 'escalator', 20, 95, 39.610618, 24.46667],
  [4968, 'escalator', 20, 95, 39.610618, 24.466353],
  [4971, 'escalator', 20, 95, 39.608644, 24.46667],
  [4972, 'escalator', 20, 95, 39.608641, 24.466364],
  [4966, 'escalator', 20, 95, 39.61161, 24.466669],
  [4963, 'escalator', 20, 95, 39.612596, 24.46666],
  [5136, 'escalator', 20, 94, 39.609695, 24.470726],
  [5138, 'escalator', 20, 94, 39.610662, 24.47073],
  [5116, 'escalator', 20, 94, 39.612576, 24.466717],
  [5118, 'escalator', 20, 94, 39.611597, 24.466711],
  [5119, 'escalator', 20, 94, 39.611597, 24.466398],
  [5120, 'escalator', 20, 94, 39.610618, 24.466712],
  [5121, 'escalator', 20, 94, 39.610617, 24.466391],
  [5124, 'escalator', 20, 94, 39.608663, 24.466697],
  [5125, 'escalator', 20, 94, 39.608663, 24.466386],
  [5130, 'escalator', 20, 94, 39.608525, 24.469011],
  [5131, 'escalator', 20, 94, 39.60818, 24.46901],
  [4956, 'escalator', 20, 95, 39.614103, 24.469282],
  [4206, 'escalator', 4, 24, 39.609522, 24.467912],
  [4207, 'escalator', 4, 24, 39.612888, 24.467909],
  [4209, 'escalator', 4, 24, 39.612976, 24.468954],
  [4201, 'escalator', 4, 12, 39.609385, 24.469841],
  [4203, 'escalator', 4, 12, 39.61284, 24.469741],
  [5117, 'escalator', 20, 94, 39.612573, 24.466402],
  [5122, 'escalator', 20, 94, 39.609638, 24.466709],
  [5129, 'escalator', 20, 94, 39.608171, 24.468113],
  [4947, 'escalator', 20, 95, 39.611634, 24.47072],
  [4948, 'escalator', 20, 95, 39.611633, 24.4704],
  [4939, 'escalator', 20, 95, 39.608495, 24.469913],
  [4940, 'escalator', 20, 95, 39.60816, 24.469915],
  [4969, 'escalator', 20, 95, 39.60963, 24.466676],
  [4970, 'escalator', 20, 95, 39.609629, 24.466356],
  [3482, 'gate', 4, 12, 39.613033, 24.469316],
  [4199, 'escalator', 4, 12, 39.613069, 24.468922],
  [4200, 'escalator', 4, 12, 39.609196, 24.468997],
  [4635, 'escalator', 4, 12, 39.613073, 24.468753],
  [4644, 'escalator', 4, 12, 39.609193, 24.468789],
  [4703, 'elevator', 4, 12, 39.613018, 24.468544],
  [4704, 'elevator', 4, 12, 39.60925, 24.468573],
];

export const VERTICAL_NODES: readonly VerticalNode[] = RAW_NODES.map(([id, type, venueId, floorId, lng, lat]) => ({
  id,
  type,
  venueId,
  floorId,
  lat,
  lng,
  closed: false,
}));

export function verticalNodesGeoJson(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: VERTICAL_NODES.map((n) => ({
      type: 'Feature',
      id: n.id,
      geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
      properties: { id: n.id, type: n.type, venue_id: n.venueId, floor_id: n.floorId, direction: 'both', is_closed: n.closed },
    })),
  };
}
