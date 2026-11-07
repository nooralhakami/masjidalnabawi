import type { FeatureCollection, Polygon } from 'geojson';
import { WOMEN_AREAS } from '../data-next/women-areas';
import { lngLatFromMetres, metresFromOrigin } from './glb-layer';

/** A barrier panel: 2 m long, 0.15 m thick, 1.1 m high, with a hand's gap to the next (owner, 2026-11-07). */
export const PANEL = { length: 2, thick: 0.15, height: 1.1, gap: 0.08 };

/**
 * The beige crowd barriers along the women's areas (owner, 2026-11-07: as the plastic panels in
 * the photograph), panel by panel along each run; the entrances are the gaps between the runs.
 */
export function womenBarriers(): FeatureCollection<Polygon, { height: number }> {
  const features: FeatureCollection<Polygon, { height: number }>['features'] = [];
  for (const area of WOMEN_AREAS) {
    for (const run of area.barriers) {
      for (let k = 0; k + 1 < run.length; k++) {
        const [ax, az] = metresFromOrigin([run[k][1], run[k][0]]);
        const [bx, bz] = metresFromOrigin([run[k + 1][1], run[k + 1][0]]);
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.5) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        // Whole panels, centred on the run.
        const count = Math.max(1, Math.round(len / (PANEL.length + PANEL.gap)));
        const each = len / count;
        const half = PANEL.thick / 2;
        for (let p = 0; p < count; p++) {
          const s0 = p * each + PANEL.gap / 2;
          const s1 = (p + 1) * each - PANEL.gap / 2;
          const at = (s: number, side: number) => lngLatFromMetres([ax + ux * s - uz * side, az + uz * s + ux * side]);
          const ring = [at(s0, -half), at(s1, -half), at(s1, half), at(s0, half)];
          features.push({
            type: 'Feature',
            properties: { height: PANEL.height },
            geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
          });
        }
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
