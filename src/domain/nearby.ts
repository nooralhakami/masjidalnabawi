import { POIS } from '../data';
import type { Poi } from '../data/types';
import { nearest } from './geo';

const OUTER = POIS.filter((p) => p.subCategory === 'gate_outer');

/** Nearest outer gate (none for an outer gate itself). */
export function nearestOuterGate(p: Poi): { poi: Poi; meters: number } | null {
  if (p.subCategory === 'gate_outer') return null;
  const best = nearest(p, OUTER);
  return best ? { poi: best.item, meters: best.meters } : null;
}

