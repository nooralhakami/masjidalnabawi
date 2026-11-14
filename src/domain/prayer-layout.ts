import { ALHARAMAIN_MODELS } from '../data-next/alharamain-3d';
import { toModelMetres as metresFromOrigin } from './frames';

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
interface Block {
  c: XY;
  ex: XY;
  ez: XY;
  half: readonly [number, number];
}

/** Every restroom block: its centre, its axes (along x and z of its file, turned) and half sizes. */
function restroomBlocks(): Block[] {
  const out: Block[] = [];
  for (const model of ALHARAMAIN_MODELS) {
    const kind = model.url.includes('restroom-a') ? 'a' : model.url.includes('restroom-b') ? 'b' : null;
    if (!kind) continue;
    const { centre, half } = BLOCKS[kind];
    const t = (model.rotation * Math.PI) / 180;
    const ex: XY = [Math.cos(t), Math.sin(t)];
    const ez: XY = [-Math.sin(t), Math.cos(t)];
    for (const anchor of model.anchors) {
      const [ax, az] = metresFromOrigin(anchor as [number, number]);
      out.push({ c: [ax + centre[0] * ex[0] + centre[1] * ez[0], az + centre[0] * ex[1] + centre[1] * ez[1]], ex, ez, half });
    }
  }
  return out;
}

/** The restroom blocks' footprints with `margin` metres round them, four corners each. */
export function restroomFootprints(margin = 0): XY[][] {
  return restroomBlocks().map(({ c, ex, ez, half }) => {
    const hx = half[0] + margin;
    const hz = half[1] + margin;
    const at = (sx: number, sz: number): XY => [c[0] + ex[0] * sx * hx + ez[0] * sz * hz, c[1] + ex[1] * sx * hx + ez[1] * sz * hz];
    return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  });
}

export function restroomWalkways(): XY[][] {
  const out: XY[][] = [];
  for (const { c, ex, ez, half } of restroomBlocks()) {
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
  return out;
}
