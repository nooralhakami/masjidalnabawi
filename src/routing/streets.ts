import type { LatLng } from '../data/types';
import { toM, type XY } from './walk';

/**
 * The street network round the Haram (data/streets.json, built from OpenStreetMap by
 * scripts/streets-from-osm.py): one graph for walkers and one for cars, with one-way streets,
 * road tunnels and the underground car-park ramps.
 */

export interface StreetsData {
  nodes: LatLng[];
  /** [mode, oneway, ...node indices]; mode bits: 1 cars, 2 walkers, 4 underground, 8 car-park ramp, 16 walkers only, 32 named. */
  ways: number[][];
  parking_entrances: LatLng[];
}

export type Travel = 'walk' | 'drive';

/**
 * Unnamed walkers-only ways round the Haram are often passages through hotel blocks (mapped without
 * indoor tags), so on a map they cut across buildings. Walking prefers real streets: such a way
 * counts 1.8× its length, and is taken only where it saves a lot. Named pedestrian streets (Quba
 * Avenue, the pedestrianised King Fahd Road) and underpasses are not penalised.
 */
export const FOOTWAY_PENALTY = 1.8;
/** Streets shared with a route already found cost this much more when looking for another way. */
const AVOID_FACTOR = 1.8;
const BIT: Record<Travel, number> = { drive: 1, walk: 2 };

interface Edge {
  a: number;
  b: number;
  l: number;
  /** Cars may only go a → b. */
  oneway: boolean;
}

/** Binary min-heap of [cost, node]. */
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

/** Shortest distances from one point over a street graph, with the way back to it. */
export interface Reach {
  dist: Float64Array;
  prev: Int32Array;
  /** Where the start point joined the graph (the point on the nearest street). */
  joinedAt: XY;
  /** Its distance to that street. */
  offset: number;
}

export class Streets {
  readonly xy: XY[];
  private edges: Record<Travel, Edge[]> = { walk: [], drive: [] };
  /** Outgoing (and for walkers, incoming) arcs per node. */
  private out: Record<Travel, [number, number][][]>;
  /** 1 for nodes in the main connected network of each graph. */
  private main!: Record<Travel, Uint8Array>;
  /** Car-park ramps and the mapped car-park entrances, as car-graph nodes. */
  readonly garageNodes: number[];

  constructor(data: StreetsData) {
    this.xy = data.nodes.map(toM);
    const n = this.xy.length;
    this.out = { walk: Array.from({ length: n }, () => []), drive: Array.from({ length: n }, () => []) };
    const ramps = new Set<number>();
    for (const [mode, oneway, ...ids] of data.ways) {
      for (const t of ['walk', 'drive'] as Travel[]) {
        if (!(mode & BIT[t])) continue;
        const oneWay = t === 'drive' && oneway !== 0;
        for (let i = 1; i < ids.length; i++) {
          let a = ids[i - 1];
          let b = ids[i];
          if (t === 'drive' && oneway === -1) [a, b] = [b, a];
          const metres = Math.hypot(this.xy[a][0] - this.xy[b][0], this.xy[a][1] - this.xy[b][1]);
          const l = t === 'walk' && mode & 16 && !(mode & 4) && !(mode & 32) ? metres * FOOTWAY_PENALTY : metres;
          this.edges[t].push({ a, b, l, oneway: oneWay });
          this.out[t][a].push([b, l]);
          if (!oneWay) this.out[t][b].push([a, l]);
        }
      }
      if (mode & 8 && mode & 1) ids.forEach((i) => ramps.add(i));
    }
    // Only the main network is joined: small fragments (a dead-end one-way service road, a
    // footpath island) would strand the route. Cars need it strongly connected (one-way streets).
    this.main = { walk: this.largest('walk', false), drive: this.largest('drive', true) };
    // A mapped entrance joins the car graph at its nearest drivable node.
    for (const e of data.parking_entrances) {
      const k = this.nearestNode(toM(e), 'drive');
      if (k >= 0) ramps.add(k);
    }
    this.garageNodes = [...ramps].filter((k) => this.main.drive[k]);
  }

  /** Nodes of the largest (strongly, for cars) connected part of a graph. */
  private largest(t: Travel, strong: boolean): Uint8Array {
    const n = this.xy.length;
    const fwd = this.out[t];
    const back: number[][] = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (const [b] of fwd[a]) back[b].push(a);
    // Kosaraju (iterative): finish order on the forward graph, then components on the reverse one.
    const order: number[] = [];
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (seen[s] || !(fwd[s].length || back[s].length)) continue;
      const stack: [number, number][] = [[s, 0]];
      seen[s] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const arcs = strong ? fwd[top[0]].map((x) => x[0]) : [...fwd[top[0]].map((x) => x[0]), ...back[top[0]]];
        if (top[1] < arcs.length) {
          const m = arcs[top[1]++];
          if (!seen[m]) {
            seen[m] = 1;
            stack.push([m, 0]);
          }
        } else {
          order.push(top[0]);
          stack.pop();
        }
      }
    }
    if (!strong) {
      // Undirected: the search above already found whole components; recount them from the order.
      const comp = new Int32Array(n).fill(-1);
      let best = -1;
      let bestSize = 0;
      let c = 0;
      for (const s of order) {
        if (comp[s] >= 0) continue;
        let size = 0;
        const q = [s];
        comp[s] = c;
        while (q.length) {
          const k = q.pop()!;
          size++;
          for (const m of [...fwd[k].map((x) => x[0]), ...back[k]]) if (comp[m] < 0) (comp[m] = c), q.push(m);
        }
        if (size > bestSize) (bestSize = size), (best = c);
        c++;
      }
      return Uint8Array.from(comp, (x) => (x === best ? 1 : 0));
    }
    const comp = new Int32Array(n).fill(-1);
    let best = -1;
    let bestSize = 0;
    let c = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i];
      if (comp[s] >= 0) continue;
      let size = 0;
      const q = [s];
      comp[s] = c;
      while (q.length) {
        const k = q.pop()!;
        size++;
        for (const m of back[k]) if (comp[m] < 0) (comp[m] = c), q.push(m);
      }
      if (size > bestSize) (bestSize = size), (best = c);
      c++;
    }
    return Uint8Array.from(comp, (x) => (x === best ? 1 : 0));
  }

  get size(): number {
    return this.xy.length;
  }

  /** Nearest node that the given traveller can use. */
  nearestNode(p: XY, t: Travel): number {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.xy.length; i++) {
      if (!this.main[t][i]) continue;
      const d = Math.hypot(this.xy[i][0] - p[0], this.xy[i][1] - p[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * The nearest car node within `maxM` metres from which a road leaves in about the given direction
   * (degrees from north, within 50°): picks the right carriageway of a divided road. Falls back to
   * the nearest car node.
   */
  nearestNodeHeading(p: XY, bearing: number, maxM = 40): number {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.xy.length; i++) {
      if (!this.main.drive[i]) continue;
      const d = Math.hypot(this.xy[i][0] - p[0], this.xy[i][1] - p[1]);
      if (d > maxM || d >= bd) continue;
      const ok = this.out.drive[i].some(([j]) => {
        const b = (Math.atan2(this.xy[j][0] - this.xy[i][0], this.xy[j][1] - this.xy[i][1]) * 180) / Math.PI;
        const diff = Math.abs((((b - bearing) % 360) + 540) % 360 - 180);
        return diff <= 50;
      });
      if (ok) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? best : this.nearestNode(p, 'drive');
  }

  /** The point on the nearest street, and the street's two ends. */
  private join(p: XY, t: Travel): { q: XY; d: number; e: Edge; u: number } | null {
    let best: { q: XY; d: number; e: Edge; u: number } | null = null;
    for (const e of this.edges[t]) {
      if (!this.main[t][e.a] || !this.main[t][e.b]) continue;
      const A = this.xy[e.a];
      const B = this.xy[e.b];
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const l2 = dx * dx + dy * dy || 1e-9;
      const u = Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / l2));
      const q: XY = [A[0] + dx * u, A[1] + dy * u];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { q, d, e, u };
    }
    return best;
  }

  /**
   * Distances from `from` to every node. A driver joins the nearest street in its direction of
   * travel; a walker joins it either way. With `reverse`, distances are *to* `from` (for cars this
   * follows one-way streets backwards). With `avoid`, streets between two avoided nodes cost more
   * (to find another way for an alternative route; distances are then not real metres).
   */
  reach(from: LatLng, t: Travel, reverse = false, avoid?: Uint8Array): Reach | null {
    const p = toM(from);
    const j = this.join(p, t);
    if (!j) return null;
    const n = this.xy.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new Heap();
    const seed = (k: number, c: number) => {
      if (c < dist[k]) {
        dist[k] = c;
        heap.push([c, k]);
      }
    };
    const toA = j.u * j.e.l;
    const toB = (1 - j.u) * j.e.l;
    // Joining a one-way street: forwards you can only drive on to its end, backwards only from its start.
    if (!j.e.oneway || reverse) seed(j.e.a, toA);
    if (!j.e.oneway || !reverse) seed(j.e.b, toB);
    let arcs = this.out[t];
    if (reverse && t === 'drive') {
      arcs = Array.from({ length: n }, () => [] as [number, number][]);
      for (const e of this.edges.drive) {
        arcs[e.b].push([e.a, e.l]);
        if (!e.oneway) arcs[e.a].push([e.b, e.l]);
      }
    }
    while (heap.size) {
      const [c, k] = heap.pop();
      if (c > dist[k]) continue;
      for (const [m, l0] of arcs[k]) {
        const l = avoid && avoid[k] && avoid[m] ? l0 * AVOID_FACTOR : l0;
        if (c + l < dist[m]) {
          dist[m] = c + l;
          prev[m] = k;
          heap.push([dist[m], m]);
        }
      }
    }
    return { dist, prev, joinedAt: j.q, offset: j.d };
  }

  /** Node indices from the start of `r` to node `k`. */
  nodesTo(r: Reach, k: number): number[] {
    const out: number[] = [];
    for (let i = k; i >= 0; i = r.prev[i]) out.unshift(i);
    return out;
  }

  /** Node chain from the start of `r` to node `k`, as metric points. */
  chain(r: Reach, k: number): XY[] {
    const out: XY[] = [];
    for (let i = k; i >= 0; i = r.prev[i]) out.unshift(this.xy[i]);
    return [r.joinedAt, ...out];
  }
}

let loaded: Promise<Streets | null> | null = null;

/** The street network, loaded on first use (it is only needed for trips beyond the plazas). */
export function loadStreets(): Promise<Streets | null> {
  loaded ??= import('../../data/streets.json')
    .then((m) => new Streets((m.default ?? m) as unknown as StreetsData))
    .catch(() => {
      loaded = null;
      return null;
    });
  return loaded;
}
