// The occlusion fade of the urban 3D layer (owner, 2026-11-10, plan §1.3): a tower that stands
// between the visitor's camera and the Mosque fades to 30% so the sacred landmark stays visible
// while the scene turns. This is the pure geometry of that test — no MapLibre, no DOM — so it runs
// in the node unit tests. The controller (urban-layer.ts) feeds it the camera eye and the buildings'
// footprints in the Mosque's metre frame (glb-layer.metresFromOrigin: x east, z south, y up).

/** One approved building: its footprint ring in metres (east, south) and its verified height. */
export interface UrbanBuilding {
  id: string;
  height: number;
  ring: [number, number][];
}

type Vec2 = [number, number];
type Vec3 = [number, number, number];

function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Where the segment p→q crosses the edge a→b, as a fraction of p→q, or null when they do not cross. */
function crossT(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const apx = a[0] - p[0];
  const apy = a[1] - p[1];
  const t = (apx * sy - apy * sx) / denom;
  const u = (apx * ry - apy * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Does this building's prism (its footprint extruded from the ground to `height`) block the view
 * from `eye` to `target`? The ground segment is clipped to the footprint; over the part inside, the
 * sight line's height must dip into the building's 0…height for it to stand in the way.
 */
export function blocksView(b: UrbanBuilding, eye: Vec3, target: Vec3): boolean {
  const p: Vec2 = [eye[0], eye[2]];
  const q: Vec2 = [target[0], target[2]];
  const cuts = [0, 1];
  for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
    const t = crossT(p, q, b.ring[j], b.ring[i]);
    if (t !== null) cuts.push(t);
  }
  cuts.sort((a, c) => a - c);
  const dy = target[1] - eye[1];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ta = cuts[i];
    const tb = cuts[i + 1];
    if (tb - ta < 1e-9) continue;
    const tm = (ta + tb) / 2;
    if (!pointInRing([p[0] + (q[0] - p[0]) * tm, p[1] + (q[1] - p[1]) * tm], b.ring)) continue;
    const ya = eye[1] + dy * ta;
    const yb = eye[1] + dy * tb;
    if (Math.min(ya, yb) <= b.height && Math.max(ya, yb) >= 0) return true;
  }
  return false;
}

/** The ids of the buildings that block the camera's view of any of the targets (the Mosque and its courts). */
export function occludedIds(buildings: UrbanBuilding[], eye: Vec3, targets: Vec3[]): Set<string> {
  const out = new Set<string>();
  for (const b of buildings) {
    if (b.height > 0 && targets.some((t) => blocksView(b, eye, t))) out.add(b.id);
  }
  return out;
}
