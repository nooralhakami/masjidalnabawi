import type { LatLng, Poi } from '../data/types';

const R = 6_371_000;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * RAD;
  const dLng = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const ll = (p: Pick<Poi, 'lat' | 'lng'>): LatLng => [p.lat, p.lng];

export function distance(a: Pick<Poi, 'lat' | 'lng'>, b: Pick<Poi, 'lat' | 'lng'>): number {
  return haversine(ll(a), ll(b));
}

/** Closest item to `from` among `candidates`, with its distance. */
export function nearest<T extends Pick<Poi, 'lat' | 'lng'>>(
  from: Pick<Poi, 'lat' | 'lng'>,
  candidates: Iterable<T>,
): { item: T; meters: number } | null {
  let best: { item: T; meters: number } | null = null;
  for (const c of candidates) {
    const m = distance(from, c);
    if (!best || m < best.meters) best = { item: c, meters: m };
  }
  return best;
}
