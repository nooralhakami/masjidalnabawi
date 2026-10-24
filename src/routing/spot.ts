import { ROUTING } from '../data';
import type { LatLng } from '../data/types';
import { inHaram } from './plan';
import { toM } from './walk';

/**
 * Where a visitor stands above the underground car park (owner, 2026-10-24): inside the mosque
 * building, in the Haram's plazas, or in a street beside the car park. Pure; it only decides which
 * words the car park question uses for «I am not in the car park».
 */
export type Spot = 'mosque' | 'plaza' | 'street';

const MOSQUE = (() => {
  const pts = ROUTING.obstacles.mosque_building.map(toM);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
})();

export function spotOf(ll: LatLng): Spot {
  const [x, y] = toM(ll);
  if (x > MOSQUE.x0 && x < MOSQUE.x1 && y > MOSQUE.y0 && y < MOSQUE.y1) return 'mosque';
  return inHaram(ll) ? 'plaza' : 'street';
}
