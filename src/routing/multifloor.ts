import { POIS } from '../data';
import { assertRoutable } from '../data/provenance';
import type { LatLng } from '../data/types';
import { FLOOR_BY_ID } from '../data-next/floors';
import { VERTICAL_EDGES, type VerticalEdge } from '../data-next/vertical-edges';
import { VERTICAL_NODES, type VerticalNode } from '../data-next/vertical-nodes';
import { parkingAccess, parkingEntrances } from '../domain/parking';
import { fromM, insideRect, network, segmentHits, toM, type XY } from './walk';

assertRoutable('floors');
assertRoutable('vertical-nodes');
assertRoutable('vertical-edges');

/**
 * The multi-floor walking graph (Phase 1, plan §4.2): one graph over the five verified floors, built
 * by composing the ground walkway network (routing/walk.ts, level 0) with the verified floor-to-floor
 * links (data-next/vertical-edges.ts). It is additive — the ground network and every existing
 * ground route are untouched, so the protected behaviour (parity) stands.
 *
 * Levels: 0 ground (the Plaza and the Mosque GF), 1 the Roof (ROF), -1 B1, -2 B2. The Mosque's GF
 * lift and escalator landings join the ground walkways; the roof landings hang off them by the
 * verified links. The car park's B1/B2 landings join each other by their links, and reach the ground
 * at each public lot's entrance facilities — the same nearest verified vertical node the accessible
 * entrance picker uses (routing/accessible.ts). Horizontal walkways on the roof and inside the car
 * park are not in the captured data yet (Phase 2, from the verified floor vectors); until then a
 * floor change ends at the landing itself, never invented.
 *
 * Accessible mode keeps lifts only: every escalator link and every escalator-served entrance is
 * dropped (plan §4.2: «مصاعد/منحدرات فقط، استبعاد الدرج والسلالم الكهربائية عند التفعيل»).
 */

export type MFLevel = 1 | 0 | -1 | -2;

interface MFNode {
  p: XY;
  level: MFLevel;
  floorId: number;
  kind: 'walk' | 'vertical' | 'entrance';
  /** The vertical node id, for a vertical landing. */
  nodeId?: number;
}
interface MFEdge {
  to: number;
  m: number;
  kind: 'walk' | 'vertical' | 'entrance';
  /** A vertical or entrance link's kind: lift (step-free) or escalator. */
  transit?: 'elevator' | 'escalator';
  /** The verified link this edge comes from, for a floor change. */
  link?: VerticalEdge;
}
interface MFGraph {
  nodes: MFNode[];
  out: MFEdge[][];
}

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const levelOfFloor = (floorId: number): MFLevel => FLOOR_BY_ID.get(floorId)!.level as MFLevel;

/** A GF landing joins the ground walkways within this reach (the landings stand on the plaza). */
const GROUND_JOIN_M = 80;
/** A lot entrance reaches its verified vertical node within this (as pickAccessibleEntrance looks). */
const ENTRANCE_JOIN_M = 40;

function build(accessible: boolean): MFGraph {
  const N = network();
  const nodes: MFNode[] = [];
  const out: MFEdge[][] = [];
  const addNode = (n: MFNode): number => {
    nodes.push(n);
    out.push([]);
    return nodes.length - 1;
  };
  const addEdge = (a: number, b: number, e: Omit<MFEdge, 'to'>) => {
    out[a].push({ ...e, to: b });
    out[b].push({ ...e, to: a });
  };

  // 1) The ground walkway network, exactly as walk.ts builds it (level 0).
  const walkBase = nodes.length;
  for (const p of N.nodes) addNode({ p, level: 0, floorId: 11, kind: 'walk' });
  for (const e of N.edges) addEdge(walkBase + e.u, walkBase + e.v, { m: e.l, kind: 'walk' });

  // The nearest ground walkway node a point may join in a straight line, clear of every obstacle.
  const joinGround = (p: XY, maxM: number): number | null => {
    let best = -1;
    let bestD = maxM;
    for (let k = 0; k < N.nodes.length; k++) {
      const d = dist(p, N.nodes[k]);
      if (d > bestD) continue;
      if (N.blocks.some((r) => !insideRect(p, r) && segmentHits(p, N.nodes[k], r))) continue;
      best = walkBase + k;
      bestD = d;
    }
    return best >= 0 ? best : null;
  };

  // 2) The vertical landings, each on its floor's level.
  const vIndex = new Map<number, number>();
  for (const n of VERTICAL_NODES) {
    const p = toM([n.lat, n.lng]);
    const idx = addNode({ p, level: levelOfFloor(n.floorId), floorId: n.floorId, kind: 'vertical', nodeId: n.id });
    vIndex.set(n.id, idx);
    // A ground-floor (GF) landing joins the ground walkways, so the visitor can walk to it.
    if (levelOfFloor(n.floorId) === 0 && n.type !== 'gate') {
      const g = joinGround(p, GROUND_JOIN_M);
      if (g !== null) addEdge(idx, g, { m: dist(p, nodes[g].p), kind: 'walk' });
    }
  }

  // 3) The verified floor-to-floor links. Accessible mode keeps lifts only.
  for (const link of VERTICAL_EDGES) {
    if (accessible && link.type !== 'elevator') continue;
    const a = vIndex.get(link.a)!;
    const b = vIndex.get(link.b)!;
    addEdge(a, b, { m: link.meters, kind: 'vertical', transit: link.type, link });
  }

  // 4) The car park reaches the ground at each public lot's entrance facilities: the entrance stands
  //    on the plaza, and its nearest verified vertical node (venue 20) is the way down — the same
  //    node the accessible entrance picker favours. Accessible mode keeps lift-served entrances only.
  for (const lot of POIS.filter((p) => p.category === 'parking' && parkingAccess(p) === 'public')) {
    for (const ent of parkingEntrances(lot)) {
      const p = toM([ent.lat, ent.lng]);
      let near: { idx: number; d: number; type: 'elevator' | 'escalator' } | null = null;
      for (const n of VERTICAL_NODES) {
        if (n.venueId !== 20 || n.closed || n.type === 'gate') continue;
        if (accessible && n.type !== 'elevator') continue;
        const d = dist(p, toM([n.lat, n.lng]));
        if (d <= ENTRANCE_JOIN_M && (!near || d < near.d)) near = { idx: vIndex.get(n.id)!, d, type: n.type };
      }
      if (!near) continue;
      const eIdx = addNode({ p, level: 0, floorId: 11, kind: 'entrance' });
      const g = joinGround(p, GROUND_JOIN_M);
      if (g !== null) addEdge(eIdx, g, { m: dist(p, nodes[g].p), kind: 'walk' });
      addEdge(eIdx, near.idx, { m: near.d, kind: 'entrance', transit: near.type });
    }
  }

  return { nodes, out };
}

const graphs = new Map<boolean, MFGraph>();
const graph = (accessible: boolean): MFGraph => {
  let g = graphs.get(accessible);
  if (!g) graphs.set(accessible, (g = build(accessible)));
  return g;
};

/** Binary min-heap of [cost, node] (as routing/streets.ts). */
class Heap {
  private h: [number, number][] = [];
  get size() {
    return this.h.length;
  }
  push(x: [number, number]) {
    const h = this.h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] <= h[i][0]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const h = this.h;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface MultifloorRoute {
  path: LatLng[];
  /** The level of each path point (0 ground, 1 roof, -1 B1, -2 B2). */
  levels: MFLevel[];
  /** The verified within-venue floor-to-floor links taken, in order (landing to landing). */
  links: VerticalEdge[];
  /** Every floor change, in order — a captured link or a lot entrance's way down/up. */
  changes: FloorChange[];
  meters: number;
}

/** One floor change: a verified landing-to-landing link, or a lot entrance's way into the car park. */
export interface FloorChange {
  from: MFLevel;
  to: MFLevel;
  transit: 'elevator' | 'escalator';
  /** The verified link, when the change is a captured landing-to-landing edge (not an entrance). */
  link?: VerticalEdge;
}

/** The graph node nearest a point on a given level (a landing, or a ground walkway node). */
function nearestNode(g: MFGraph, p: XY, level: MFLevel): number | null {
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < g.nodes.length; k++) {
    if (g.nodes[k].level !== level) continue;
    const d = dist(p, g.nodes[k].p);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best >= 0 ? best : null;
}

/**
 * A walking route across the floors, from a ground point to a landing on `toLevel` (or a ground
 * point). Returns the path with its levels and the verified links taken, or null when no floor change
 * is needed or none is reachable. Accessible mode uses lifts only.
 */
export function multifloorRoute(from: LatLng, to: LatLng, opts: { accessible?: boolean; fromLevel?: MFLevel; toLevel?: MFLevel } = {}): MultifloorRoute | null {
  const accessible = opts.accessible ?? false;
  const g = graph(accessible);
  const A = toM(from);
  const B = toM(to);
  const fromLevel = opts.fromLevel ?? 0;
  const toLevel = opts.toLevel ?? 0;
  const start = nearestNode(g, A, fromLevel);
  const end = nearestNode(g, B, toLevel);
  if (start === null || end === null) return null;

  const n = g.nodes.length;
  const D = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: (MFEdge | null)[] = new Array(n).fill(null);
  const done = new Uint8Array(n);
  const heap = new Heap();
  D[start] = dist(A, g.nodes[start].p);
  heap.push([D[start], start]);
  while (heap.size) {
    const [d, k] = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === end) break;
    for (const e of g.out[k]) {
      const nd = d + e.m;
      if (nd < D[e.to]) {
        D[e.to] = nd;
        prev[e.to] = k;
        prevEdge[e.to] = e;
        heap.push([nd, e.to]);
      }
    }
  }
  if (!Number.isFinite(D[end])) return null;

  const chain: number[] = [];
  for (let k = end; k !== start && k >= 0; k = prev[k]) chain.unshift(k);
  const idx = [start, ...chain];
  const path: LatLng[] = [from];
  const levels: MFLevel[] = [fromLevel];
  const links: VerticalEdge[] = [];
  const changes: FloorChange[] = [];
  let meters = dist(A, g.nodes[start].p);
  for (let i = 1; i < idx.length; i++) {
    const e = prevEdge[idx[i]]!;
    path.push(fromM(g.nodes[idx[i]].p));
    levels.push(g.nodes[idx[i]].level);
    meters += e.m;
    if (e.link) links.push(e.link);
    if ((e.kind === 'vertical' || e.kind === 'entrance') && e.transit) {
      changes.push({ from: g.nodes[idx[i - 1]].level, to: g.nodes[idx[i]].level, transit: e.transit, ...(e.link ? { link: e.link } : {}) });
    }
  }
  path.push(to);
  levels.push(toLevel);
  meters += dist(g.nodes[end].p, B);
  return { path, levels, links, changes, meters };
}

/** The verified links of the graph (for reports and tests): all, or the step-free subset. */
export const multifloorLinks = (accessible = false): readonly VerticalEdge[] => (accessible ? VERTICAL_EDGES.filter((e) => e.type === 'elevator') : VERTICAL_EDGES);

/**
 * The verified landing on `floorId` nearest a place — the point a cross-floor route ends at. Only
 * lifts and escalators are landings (the GF accessible gates are not); accessible mode keeps lifts.
 * No horizontal walkways on the roof or in the car park are captured yet (Phase 2), so the route
 * ends at the landing itself, never at an invented point.
 */
export function nearestLandingOnFloor(at: LatLng, floorId: number, accessible = false): VerticalNode | null {
  const p = toM(at);
  let best: VerticalNode | null = null;
  let bestD = Infinity;
  for (const n of VERTICAL_NODES) {
    if (n.floorId !== floorId || n.closed || n.type === 'gate') continue;
    if (accessible && n.type !== 'elevator') continue;
    const d = dist(p, toM([n.lat, n.lng]));
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
