import { POIS } from '../data';
import { alharamainPlaza } from '../data-next/alharamain-3d';
import { PRAYER_CLEARINGS } from '../data-next/alharamain-prayers';
import { WOMEN_AREAS } from '../data-next/women-areas';
import type { CrowdInput, XY } from './crowd-sim';
import { metresFromOrigin } from './glb-layer';
import { MOSQUE_MAIN, MOSQUE_SOUTH, restroomFootprints, restroomWalkways } from './prayer-layout';
import { rugLayout } from './rug-layout';

const m = (ll: readonly [number, number]): XY => metresFromOrigin(ll as [number, number]);
/** The women's areas are drawn as [lat, lng]. */
const mLatLng = ([lat, lng]: readonly [number, number]): XY => metresFromOrigin([lng, lat]);

/** Points about 25 m apart inside a ring: where women walk to in their areas. */
function inside(ring: readonly XY[], step = 25): XY[] {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  const out: XY[] = [];
  for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      let inn = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [ax, az] = ring[a];
        const [bx, bz] = ring[b];
        if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inn = !inn;
      }
      if (inn) out.push([x, z]);
    }
  }
  return out;
}

/**
 * Where the courtyards' walkers may go, built from the map's own data (owner, 2026-11-06): the
 * plazas (the five sectors and the western annex); not the prayer carpets (the courtyards' and the
 * annex's), the Mosque or the restroom blocks (with half a metre round them), but the walkways in
 * front of the blocks; round the canopy and lamp columns (`columns`, as `[lng, lat]`, once the
 * canopies' file has said where they stand); toward the Mosque's doors and the outer gates. The
 * women's areas (owner, 2026-11-07) are for women only, behind their barriers.
 */
export function crowdInput(columns: readonly (readonly [number, number])[]): CrowdInput {
  const plaza = alharamainPlaza().features;
  const ring = (f: (typeof plaza)[number]) => f.geometry.coordinates[0].slice(0, -1).map((ll) => m(ll as [number, number]));
  const box = ([cx, cz, hw, hd]: readonly number[], pad: number): XY[] => [
    [cx - hw - pad, cz - hd - pad],
    [cx + hw + pad, cz - hd - pad],
    [cx + hw + pad, cz + hd + pad],
    [cx - hw - pad, cz + hd + pad],
  ];
  return {
    walkable: plaza.filter((f) => f.properties.kind === 'sector' || f.properties.kind === 'annex').map(ring),
    blocked: [
      // The carpets as laid (whole carpets only, owner 2026-11-07), not the areas' outlines.
      ...rugLayout(columns).blocked,
    ],
    open: [...restroomWalkways(), ...PRAYER_CLEARINGS.map((r) => r.map(m))],
    // Buildings stay closed even where a cleared corridor crosses them.
    solid: [box(MOSQUE_MAIN, 0.5), box(MOSQUE_SOUTH, 0.5), ...restroomFootprints(0.5)],
    columns: columns.map(m),
    goals: POIS.filter((p) => p.category === 'gates').map((p) => m([p.lng, p.lat])),
    womenOnly: WOMEN_AREAS.map((a) => a.zone.map(mLatLng)),
    fences: WOMEN_AREAS.flatMap((a) => a.barriers.map((line) => line.map(mLatLng))),
    womenGoals: WOMEN_AREAS.flatMap((a) => inside(a.zone.map(mLatLng))),
  };
}
