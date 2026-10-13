import garageJson from '../../data/garage.json';
import type { LatLng, Poi } from '../data/types';
import { parkingEntrances } from '../domain/parking';
import { fromM, toM, type XY } from './walk';

/**
 * The roads of the underground car park, from the owner's drawing (2026-10-13,
 * docs/routes/garage-2026-10-13.json → data/garage.json). Pure.
 *
 *  - Two entrances (Quba in the south-west, Sultana in the north-west via Al-Salam road) and two
 *    exits (Quba, the main one, and Sultana).
 *  - Entry roads run round the car park under the plazas; every road is two-way and traffic keeps
 *    to the right, so a route is drawn on the right-hand side of the road it follows.
 *  - Each of the 13 lots is entered from its road right after its first facility (the arrow in the
 *    drawing) and has four rows of bays: two in the middle, back to back along a kerb, and one on
 *    each side, with an aisle between the middle pair and each side row.
 */

export type EntranceId = 'quba' | 'sultana';
type LaneKind = 'entry' | 'exit' | 'link' | 'shared' | 'ramp_up' | 'ramp_down';
interface Lane {
  id: string;
  kind: LaneKind;
  /** False where the owner is not sure of the drawing yet (the east side). */
  certain: boolean;
  path: LatLng[];
}
interface Lot {
  id: number;
  side: 'north' | 'east' | 'south' | 'west';
  entry: LatLng;
  entry_lane: string;
  exit: LatLng;
  exit_lane: string;
  certain: boolean;
}
export interface GarageData {
  lanes: Lane[];
  entrances: { id: EntranceId; lane: string; street: LatLng }[];
  exits: { id: EntranceId; lane: string; street: LatLng }[];
  lots: Lot[];
}

export const GARAGE = garageJson as unknown as GarageData;
export const ENTRANCES = GARAGE.entrances;

/** A route keeps this far right of the middle of the road (it is two-way). */
export const KEEP_RIGHT_M = 2.5;
/** Points this close are one junction; a road ending this close to another joins it. */
const MERGE_M = 1.5;
const JOIN_M = 4;
/** Inside a lot: how far in from its edge the first turn is, and the aisles' ends. */
const LOT_INSET_M = 6;

const d2 = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function project(p: XY, a: XY, b: XY): { q: XY; u: number; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
  const q: XY = [a[0] + dx * u, a[1] + dy * u];
  return { q, u, d: d2(p, q) };
}

/** Insert a point into a polyline at its nearest place; returns the new polyline. */
function insertInto(line: XY[], p: XY): XY[] {
  let best = { i: 0, q: line[0], d: Infinity };
  for (let i = 1; i < line.length; i++) {
    const pr = project(p, line[i - 1], line[i]);
    if (pr.d < best.d) best = { i, q: pr.q, d: pr.d };
  }
  if (line.some((v) => d2(v, best.q) < MERGE_M)) return line;
  return [...line.slice(0, best.i), best.q, ...line.slice(best.i)];
}

interface Graph {
  nodes: XY[];
  adj: [number, number][][];
}

/**
 * The entry roads (and the shared bits that link them) as one two-way graph, with a node where each
 * entrance road leaves the street and where each lot is entered.
 */
function buildGraph(data: GarageData): Graph {
  const lanes = data.lanes.filter((l) => l.kind === 'entry' || l.kind === 'shared');
  const lines = new Map(lanes.map((l) => [l.id, l.path.map(toM)]));
  const add = (id: string, p: XY) => lines.has(id) && lines.set(id, insertInto(lines.get(id)!, p));
  for (const e of data.entrances) add(e.lane, toM(e.street));
  for (const lot of data.lots) add(lot.entry_lane, toM(lot.entry));
  // A road that ends on another road (not at one of its corners) joins it there.
  for (const [id, pts] of lines) {
    for (const end of [pts[0], pts[pts.length - 1]]) {
      for (const [other, opts] of lines) {
        if (other === id || opts.some((v) => d2(v, end) < MERGE_M)) continue;
        const near = opts.slice(1).some((b, i) => project(end, opts[i], b).d < JOIN_M);
        if (near) lines.set(other, insertInto(opts, end));
      }
    }
  }
  const nodes: XY[] = [];
  const node = (p: XY) => {
    const k = nodes.findIndex((n) => d2(n, p) < MERGE_M);
    if (k >= 0) return k;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: [number, number][] = [];
  for (const pts of lines.values()) {
    const ids = pts.map(node);
    for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) edges.push([ids[i - 1], ids[i]]);
  }
  const adj: [number, number][][] = nodes.map(() => []);
  for (const [a, b] of edges) {
    const l = d2(nodes[a], nodes[b]);
    adj[a].push([b, l]);
    adj[b].push([a, l]);
  }
  return { nodes, adj };
}

let graph: Graph | null = null;
const G = () => (graph ??= buildGraph(GARAGE));

function nearestNode(p: XY): number {
  const { nodes } = G();
  let best = 0;
  for (let i = 1; i < nodes.length; i++) if (d2(nodes[i], p) < d2(nodes[best], p)) best = i;
  return best;
}

/** Shortest way along the graph (Dijkstra; the graph has under a hundred nodes). */
function shortest(from: number, to: number): XY[] | null {
  const { nodes, adj } = G();
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let k = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (k < 0 || dist[i] < dist[k])) k = i;
    if (k < 0 || k === to) break;
    done[k] = true;
    for (const [j, w] of adj[k]) {
      if (dist[k] + w < dist[j]) {
        dist[j] = dist[k] + w;
        prev[j] = k;
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const out: XY[] = [];
  for (let k = to; k >= 0; k = prev[k]) out.unshift(nodes[k]);
  return out;
}

/** The path moved `m` metres to its right (traffic keeps right on two-way roads). */
export function keepRight(pts: XY[], m = KEEP_RIGHT_M): XY[] {
  if (pts.length < 2) return pts;
  const normal = (a: XY, b: XY): XY => {
    const l = d2(a, b) || 1;
    // Right of the direction of travel, with y pointing north.
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  };
  return pts.map((p, i) => {
    const n0 = i > 0 ? normal(pts[i - 1], p) : null;
    const n1 = i < pts.length - 1 ? normal(p, pts[i + 1]) : null;
    let n: XY = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 ?? n1)!;
    const len = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / len, n[1] / len];
    // Mitre: keep the same distance from both roads at a corner (capped for sharp turns).
    const cos = n0 && n1 ? Math.max(0.5, n[0] * n0[0] + n[1] * n0[1]) : 1;
    return [p[0] + (n[0] * m) / cos, p[1] + (n[1] * m) / cos];
  });
}

const lotData = (lot: Poi) => GARAGE.lots.find((l) => l.id === lot.id);

/** The lot's area: the rectangle between its four facilities (its entrances on the plaza above). */
export function lotRect(lot: Poi): { x0: number; x1: number; y0: number; y1: number } | null {
  const f = parkingEntrances(lot).map((p) => toM([p.lat, p.lng]));
  if (f.length < 4) return null;
  const xs = f.map((p) => p[0]);
  const ys = f.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Inside a lot, from where its road turns in to the bay nearest `towards` (the stairs to be used,
 * or the middle of the lot): in at the edge, then along the aisle on that side of the middle rows.
 * The aisles run the length of the lot, a quarter of its width in from each long side.
 */
export function insideLot(lot: Poi, from: XY, towards: XY | null): { gate: XY; path: XY[] } | null {
  const r = lotRect(lot);
  if (!r) return null;
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const alongX = w >= h; // aisles run east–west
  const clamp = (v: number, a: number, b: number) => Math.max(a + LOT_INSET_M, Math.min(b - LOT_INSET_M, v));
  // The gate: the nearest point of the lot's edge, kept clear of its corners.
  const edges: { p: XY; inward: XY }[] = [
    { p: [clamp(from[0], r.x0, r.x1), r.y0], inward: [0, 1] },
    { p: [clamp(from[0], r.x0, r.x1), r.y1], inward: [0, -1] },
    { p: [r.x0, clamp(from[1], r.y0, r.y1)], inward: [1, 0] },
    { p: [r.x1, clamp(from[1], r.y0, r.y1)], inward: [-1, 0] },
  ];
  const e = edges.reduce((a, b) => (d2(b.p, from) < d2(a.p, from) ? b : a));
  const gate = e.p;
  const inside: XY = [gate[0] + e.inward[0] * LOT_INSET_M, gate[1] + e.inward[1] * LOT_INSET_M];
  const target: XY = towards ?? [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  // The two aisles, and the one on the target's side.
  const aisles = alongX ? [r.y0 + h / 4, r.y0 + (3 * h) / 4] : [r.x0 + w / 4, r.x0 + (3 * w) / 4];
  const across = alongX ? target[1] : target[0];
  const aisle = Math.abs(aisles[0] - across) <= Math.abs(aisles[1] - across) ? aisles[0] : aisles[1];
  const onAisle = (along: number): XY => (alongX ? [clamp(along, r.x0, r.x1), aisle] : [aisle, clamp(along, r.y0, r.y1)]);
  const turn = onAisle(alongX ? inside[0] : inside[1]);
  const bay = onAisle(alongX ? target[0] : target[1]);
  const path: XY[] = [gate, inside, turn, bay].filter((p, i, a) => i === 0 || d2(p, a[i - 1]) > 0.5);
  return { gate, path };
}

export interface GarageRoute {
  entrance: EntranceId;
  /** From the street at the entrance ramp to the bay (keeping right on the roads). */
  path: LatLng[];
  /** Where the car turns into the lot. */
  gate: LatLng;
  /** The bay: where the car is left. */
  bay: LatLng;
  /** Metres driven inside the car park. */
  meters: number;
  /** Whether every road on the way is one the owner is sure of. */
  certain: boolean;
}

/**
 * The drive inside the car park: from an entrance to a lot, then to the bay nearest `towards`.
 * Null if that lot is not in the drawing.
 */
export function garageRoute(entrance: EntranceId, lot: Poi, towards: LatLng | null = null): GarageRoute | null {
  const ent = ENTRANCES.find((e) => e.id === entrance);
  const l = lotData(lot);
  if (!ent || !l) return null;
  const roads = shortest(nearestNode(toM(ent.street)), nearestNode(toM(l.entry)));
  if (!roads) return null;
  const inLot = insideLot(lot, roads[roads.length - 1], towards ? toM(towards) : null);
  if (!inLot) return null;
  const driven: XY[] = [toM(ent.street), ...keepRight(roads), ...inLot.path];
  const meters = driven.reduce((s, p, i) => (i ? s + d2(driven[i - 1], p) : 0), 0);
  // The east side of the drawing is not certain yet: say so where the route uses it.
  const lanesOnWay = GARAGE.lanes.filter((ln) => (ln.kind === 'entry' || ln.kind === 'shared') && !ln.certain);
  const uncertain = !l.certain || roads.some((p) => lanesOnWay.some((ln) => ln.path.map(toM).some((q, i, a) => i > 0 && project(p, a[i - 1], q).d < 1)));
  return {
    entrance,
    path: driven.map(fromM),
    gate: fromM(inLot.gate),
    bay: fromM(inLot.path[inLot.path.length - 1]),
    meters,
    certain: !uncertain,
  };
}
