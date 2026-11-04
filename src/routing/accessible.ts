import type { LatLng, Poi } from '../data/types';
import { VERTICAL_NODES, type VerticalNode } from '../data-next/vertical-nodes';
import { haversine } from '../domain/geo';

/** Comfortable walking pace for seniors and visitors with disabilities (60 m/min vs 80 m/min standard). */
export const ACCESSIBLE_WALK_M_PER_MIN = 60;

export interface AccessibleNodeInfo {
  id: number;
  kind: 'elevator' | 'escalator';
  lat: number;
  lng: number;
  /** Distance in metres from the destination or entrance to this vertical transit node. */
  meters: number;
}

/**
 * Find the best step-free vertical transit node (elevator or escalator from `vertical_nodes.geojson`)
 * near `at`. Elevators are preferred when one stands within 35 m (or within 15 m of the nearest escalator).
 */
export function nearestVerticalNode(at: LatLng, opts: { kind?: 'elevator' | 'escalator'; venueId?: number; maxMeters?: number } = {}): AccessibleNodeInfo | null {
  const maxM = opts.maxMeters ?? 120;
  const candidates = VERTICAL_NODES.filter(
    (n): n is VerticalNode & { type: 'elevator' | 'escalator' } =>
      !n.closed && (n.type === 'elevator' || n.type === 'escalator') && (!opts.kind || n.type === opts.kind) && (!opts.venueId || n.venueId === opts.venueId),
  )
    .map((n) => ({ node: n, d: haversine(at, [n.lat, n.lng]) }))
    .filter((x) => x.d <= maxM)
    .sort((a, b) => a.d - b.d);

  if (!candidates.length) return null;
  const bestElev = candidates.find((c) => c.node.type === 'elevator');
  const chosen = bestElev && (bestElev.d <= 35 || bestElev.d <= candidates[0].d + 15) ? bestElev : candidates[0];
  return {
    id: chosen.node.id,
    kind: chosen.node.type,
    lat: chosen.node.lat,
    lng: chosen.node.lng,
    meters: Math.max(1, Math.round(chosen.d)),
  };
}

/**
 * Among a parking lot's surrounding entrances, pick the best step-free entrance (favouring one with
 * an elevator in `vertical_nodes.geojson`, then an escalator) and return its vertical node.
 */
export function pickAccessibleEntrance(
  from: LatLng,
  entrances: readonly Poi[],
  walkDistance: (a: LatLng, b: LatLng) => number,
): { entrance: Poi; node: AccessibleNodeInfo | null } | null {
  if (!entrances.length) return null;
  const scored = entrances.map((e) => {
    const pt: LatLng = [e.lat, e.lng];
    const node = nearestVerticalNode(pt, { venueId: 20, maxMeters: 40 });
    const walkM = walkDistance(from, pt);
    // Favour entrances equipped with an elevator (bonus 80 m) or escalator (bonus 30 m).
    const bonus = node?.kind === 'elevator' ? 80 : node?.kind === 'escalator' ? 30 : 0;
    return { entrance: e, node, score: walkM - bonus };
  });
  scored.sort((a, b) => a.score - b.score);
  return { entrance: scored[0].entrance, node: scored[0].node };
}

/**
 * Resolve the step-free vertical transit node (`elevator` or `escalator`) serving a destination POI,
 * and an optional intermediate waypoint when the vertical node stands right beside the destination.
 */
export function accessibleNodeForPoi(to: Poi): { node: AccessibleNodeInfo; via?: LatLng } | null {
  const pt: LatLng = [to.lat, to.lng];
  const venueId = to.subCategory === 'gate_inner' ? 4 : to.category === 'toilets' || to.category === 'parking' ? 20 : undefined;
  const node = nearestVerticalNode(pt, { venueId, maxMeters: 80 }) ?? nearestVerticalNode(pt, { maxMeters: 250 });
  if (!node) return null;
  const via: LatLng | undefined = node.meters >= 4 && node.meters <= 35 ? [node.lat, node.lng] : undefined;
  return { node, via };
}
