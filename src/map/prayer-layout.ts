import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { ALHARAMAIN_MODELS } from '../data-next/alharamain-3d';
import { ALHARAMAIN_PRAYERS } from '../data-next/alharamain-prayers';
import { lngLatFromMetres, metresFromOrigin } from './glb-layer';

type XY = readonly [number, number];

/**
 * The Mosque's footprint, measured from `haram-3d.glb` (its walls between 4 and 30 m high, in the
 * models' frame): the main block x −263.4…143.5, z −353.3…−110.6, and the southern block (the old
 * Mosque) x −109.6…−11.4, z −110.6…−57.0. As boxes: centre x, z, half width, half depth.
 */
export const MOSQUE_MAIN: [number, number, number, number] = [(-263.4 + 143.5) / 2, (-353.3 + -110.6) / 2, (143.5 + 263.4) / 2, (353.3 - 110.6) / 2];
export const MOSQUE_SOUTH: [number, number, number, number] = [(-109.6 + -11.4) / 2, (-110.6 + -57.0) / 2, (109.6 - 11.4) / 2, (110.6 - 57.0) / 2];

/** How deep the visitors' walkway is in front of a restroom block, toward the Haram (owner, 2026-11-06). */
export const WALKWAY_M = 10;

/** The restroom blocks' files: the block's centre from its anchor, and its half length and half width. */
const BLOCKS = {
  a: { centre: [-2.415, -41.918], half: [11.5, 7] },
  b: { centre: [-2.355, -82.929], half: [7, 11.6] },
} as const;

/**
 * In front of each restroom block, on its face toward the Mosque, a walkway 10 m deep along the
 * whole face, kept clear of carpets and barriers (owner, 2026-11-06): four corners each, in the
 * models' metres (x east, z south).
 */
export function restroomWalkways(): XY[][] {
  const out: XY[][] = [];
  for (const model of ALHARAMAIN_MODELS) {
    const kind = model.url.includes('restroom-a') ? 'a' : model.url.includes('restroom-b') ? 'b' : null;
    if (!kind) continue;
    const { centre, half } = BLOCKS[kind];
    const t = (model.rotation * Math.PI) / 180;
    const ex: XY = [Math.cos(t), Math.sin(t)];
    const ez: XY = [-Math.sin(t), Math.cos(t)];
    for (const anchor of model.anchors) {
      const [ax, az] = metresFromOrigin(anchor as [number, number]);
      const c: XY = [ax + centre[0] * ex[0] + centre[1] * ez[0], az + centre[0] * ex[1] + centre[1] * ez[1]];
      // The nearest point of the Mosque: the face looking most toward it is the block's front to it.
      const near = [MOSQUE_MAIN, MOSQUE_SOUTH]
        .map(([bx, bz, hw, hd]) => [Math.max(bx - hw, Math.min(bx + hw, c[0])), Math.max(bz - hd, Math.min(bz + hd, c[1]))] as XY)
        .sort((p, q) => Math.hypot(p[0] - c[0], p[1] - c[1]) - Math.hypot(q[0] - c[0], q[1] - c[1]))[0];
      const d: XY = [near[0] - c[0], near[1] - c[1]];
      const dx = d[0] * ex[0] + d[1] * ex[1];
      const dz = d[0] * ez[0] + d[1] * ez[1];
      const alongX = Math.abs(dx) > Math.abs(dz);
      const n: XY = alongX ? [ex[0] * Math.sign(dx), ex[1] * Math.sign(dx)] : [ez[0] * Math.sign(dz), ez[1] * Math.sign(dz)];
      const side: XY = alongX ? ez : ex;
      const off = alongX ? half[0] : half[1];
      const len = alongX ? half[1] : half[0];
      const at = (o: number, s: number): XY => [c[0] + n[0] * o + side[0] * s, c[1] + n[1] * o + side[1] * s];
      out.push([at(off, -len), at(off, len), at(off + WALKWAY_M, len), at(off + WALKWAY_M, -len)]);
    }
  }
  return out;
}

function inside([x, y]: XY, ring: readonly XY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  }
  return c;
}

/**
 * The green barriers round the courtyards' prayer areas, as the owner describes them: 2 m sections
 * with a hand's gap between them, 0.3 m outside each edge, 12 cm thick, as polygons to extrude.
 * Where a restroom's walkway cuts an area, the barrier leaves the walkway open and runs along it.
 */
export function prayerBarriers(): FeatureCollection<Polygon, { height: number }> {
  const areas = ALHARAMAIN_PRAYERS.map((r) => r.map((ll) => metresFromOrigin(ll as [number, number]) as XY));
  const walks = restroomWalkways();
  const inWalk = (p: XY) => walks.some((w) => inside(p, w));
  const inArea = (p: XY) => areas.some((a) => inside(p, a));
  const features: Feature<Polygon, { height: number }>[] = [];
  /** Sections along a→b, `side` (+1 right, −1 left of a→b, the models' frame being x east, z south) out. */
  const run = (a: XY, b: XY, side: number, keep: (mid: XY) => boolean) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) return;
    const u: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const nrm: XY = [-u[1] * side, u[0] * side];
    const pieces = Math.max(1, Math.round(len / 2.1));
    const step = len / pieces;
    for (let s = 0; s < pieces; s++) {
      const t0 = s * step + 0.05;
      const t1 = (s + 1) * step - 0.05;
      const at = (t: number, off: number): XY => [a[0] + u[0] * t + nrm[0] * off, a[1] + u[1] * t + nrm[1] * off];
      if (!keep(at((t0 + t1) / 2, 0.36))) continue;
      const corners = [at(t0, 0.3), at(t1, 0.3), at(t1, 0.42), at(t0, 0.42)].map((p) => lngLatFromMetres(p));
      features.push({ type: 'Feature', properties: { height: 1.05 }, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
    }
  };
  const area2 = (r: readonly XY[]) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0);
  for (const ring of areas) {
    // Outside the area, whichever way navQ wound it: the side away from its interior.
    const side = area2(ring) > 0 ? -1 : 1;
    for (let i = 0; i < ring.length; i++) run(ring[i], ring[(i + 1) % ring.length], side, (m) => !inWalk(m));
  }
  for (const w of walks) {
    const side = area2(w) > 0 ? -1 : 1;
    for (let i = 0; i < w.length; i++) run(w[i], w[(i + 1) % w.length], side, (m) => inArea(m) && !inWalk(m));
  }
  return { type: 'FeatureCollection', features };
}
