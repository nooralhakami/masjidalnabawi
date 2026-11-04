/** Small polygon helpers for the 3D view's flat layers (pure, no WebGL). */

/** Twice the signed area of a ring in the x/z plane (shoelace): positive when its turns are left turns. */
function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a;
}

/**
 * Triangulate a simple polygon by ear clipping (plaza outlines: a handful of corners, so the
 * quadratic cost does not matter). Returns indices into `pts`; a ring it cannot clip falls back to a fan.
 */
export function triangulate(pts: [number, number][]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = signedArea(pts) > 0;
  const idx = [...Array(n).keys()];
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  // A corner is an ear candidate when it turns the same way as the whole ring.
  const convex = (a: number, b: number, c: number) => (ccw ? cross(a, b, c) > 0 : cross(a, b, c) < 0);
  const inside = (p: number, a: number, b: number, c: number) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (!convex(a, b, c)) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
  return out;
}
