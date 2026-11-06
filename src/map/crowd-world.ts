import { POIS } from '../data';
import { alharamainPlaza } from '../data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS, PRAYER_CLEARINGS } from '../data-next/alharamain-prayers';
import type { CrowdInput, XY } from './crowd-sim';
import { metresFromOrigin } from './glb-layer';
import { MOSQUE_MAIN, MOSQUE_SOUTH, restroomFootprints, restroomWalkways } from './prayer-layout';

const m = (ll: readonly [number, number]): XY => metresFromOrigin(ll as [number, number]);

/**
 * Where the courtyards' walkers may go, built from the map's own data (owner, 2026-11-06): the
 * plazas (the five sectors and the western annex); not the prayer carpets (the courtyards' and the
 * annex's), the Mosque or the restroom blocks (with half a metre round them), but the walkways in
 * front of the blocks; round the canopy and lamp columns (`columns`, as `[lng, lat]`, once the
 * canopies' file has said where they stand); toward the Mosque's doors and the outer gates.
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
      ...ALHARAMAIN_PRAYERS.map((r) => r.map(m)),
      ...plaza.filter((f) => f.properties.kind === 'men' || f.properties.kind === 'women').map(ring),
      box(MOSQUE_MAIN, 0.5),
      box(MOSQUE_SOUTH, 0.5),
      ...restroomFootprints(0.5),
    ],
    open: [...restroomWalkways(), ...PRAYER_CLEARINGS.map((r) => r.map(m))],
    columns: columns.map(m),
    goals: POIS.filter((p) => p.category === 'gates').map((p) => m([p.lng, p.lat])),
  };
}
