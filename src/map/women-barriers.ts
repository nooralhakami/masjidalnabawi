import type { FeatureCollection, Polygon } from 'geojson';
import { WOMEN_AREAS } from '../data-next/women-areas';
import { lngLatFromMetres, metresFromOrigin } from './glb-layer';
import { GREETING_BARRIERS, QUEUE_RAILS, WOMEN_RAWDAH_CORRIDOR_BARRIERS } from './rawdah-layout';

/** A barrier panel: 2 m long, 0.15 m thick, 1.1 m high, with a hand's gap to the next (owner, 2026-11-07). */
export const PANEL = { length: 2, thick: 0.15, height: 1.1, gap: 0.08 };

/**
 * The beige crowd barriers along the women's areas (owner, 2026-11-07: as the plastic panels in
 * the photograph), panel by panel along each run; the entrances are the gaps between the runs.
 */
export function womenBarriers(): FeatureCollection<Polygon, { height: number }> {
  return panels(
    WOMEN_AREAS.flatMap((area) => area.barriers.map((run) => run.map(([lat, lng]) => metresFromOrigin([lng, lat])))),
    PANEL,
  );
}

/** The metal rails of the Rawdah's queue lanes (owner, 2026-11-08): 1 m high, in 2 m lengths. */
export const RAIL = { length: 2, thick: 0.08, height: 1.0, gap: 0.05 };
export function queueRails(): FeatureCollection<Polygon, { height: number }> {
  return panels(QUEUE_RAILS, RAIL);
}

/** The green barriers that order the greeting at the Prophet's chamber (owner, 2026-11-08): as the prayer areas'. */
export const GREEN_PANEL = { length: 2, thick: 0.15, height: 1.0, gap: 0.08 };
export function greetingBarriers(): FeatureCollection<Polygon, { height: number }> {
  return panels(GREETING_BARRIERS, GREEN_PANEL);
}

/**
 * حواجز العزل الشرقية والغربية التي تغلق الممر المغلق للنساء من باب 21 حتى خلف الروضة الشريفة
 * بحيث لا يدخل هذا النطاق إلا النساء أثناء فترة دخولهن من باب 21.
 */
export function womenRawdahCorridorBarriers(): FeatureCollection<Polygon, { height: number }> {
  return panels(WOMEN_RAWDAH_CORRIDOR_BARRIERS, PANEL);
}

/** Panels along runs given in the models' metres: whole panels, centred on each run. */
function panels(runs: readonly (readonly (readonly [number, number])[])[], kind: typeof PANEL): FeatureCollection<Polygon, { height: number }> {
  const features: FeatureCollection<Polygon, { height: number }>['features'] = [];
  for (const run of runs) {
    for (let k = 0; k + 1 < run.length; k++) {
      const [ax, az] = run[k];
      const [bx, bz] = run[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const count = Math.max(1, Math.round(len / (kind.length + kind.gap)));
      const each = len / count;
      const half = kind.thick / 2;
      for (let p = 0; p < count; p++) {
        const s0 = p * each + kind.gap / 2;
        const s1 = (p + 1) * each - kind.gap / 2;
        const at = (s: number, side: number) => lngLatFromMetres([ax + ux * s - uz * side, az + uz * s + ux * side]);
        const ring = [at(s0, -half), at(s1, -half), at(s1, half), at(s0, half)];
        features.push({
          type: 'Feature',
          properties: { height: kind.height },
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
