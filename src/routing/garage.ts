import garageJson from '../../data/garage.json';
import type { LatLng, Poi } from '../data/types';
import { parkingEntrances } from '../domain/parking';
import { fromM, toM, type XY } from './walk';

/**
 * The roads of the underground car park, from the owner's drawings (2026-10-13,
 * docs/routes/garage-*.json → data/garage.json). Pure.
 *
 *  - Two levels with the same roads: B below, A above. Cars come in and go out by B only: in at
 *    Quba (south-west) or Sultana (north-west), out at Quba (the main exit) or Sultana.
 *  - Every road is one-way, in the order of its points; traffic circulates to the right (clockwise).
 *  - Level A is reached by the yellow ramp after lot 11 and left by the green ramp between
 *    facilities 220 and 222. Up there a car heads west on the north road, which leads into the north
 *    lots (the reverse of B); for the others it goes almost a full lap (down the west side, the west
 *    link into the loop). The orange openings, to switch between the way in and the way out, are on
 *    B only and can be crossed either way.
 *  - Each of the 13 lots (on both levels) is entered right after its first facility and left by its
 *    own exit (the arrows in the drawing). A lot has four rows of bays: two in the middle, back to
 *    back along a kerb, one on each side, with an aisle between the middle pair and each side row.
 */

export type EntranceId = 'quba' | 'sultana';
export type Level = 'A' | 'B';
type LaneKind = 'entry' | 'exit' | 'link' | 'shared' | 'ramp_up' | 'ramp_down';
interface Lane {
  id: string;
  kind: LaneKind;
  /** False where the owner is not sure of the drawing yet (the east side). */
  certain: boolean;
  /** False for the orange openings, crossed either way. */
  oneway?: boolean;
  /** The levels the road is on (both when absent): the orange openings are on level B only. */
  levels?: Level[];
  /** Ramps only: the level the ramp leaves and the one it reaches. */
  from_level?: Level;
  to_level?: Level;
  path: LatLng[];
}
interface LotDoors {
  entry: LatLng;
  entry_lane: string;
  exit: LatLng;
  exit_lane: string;
}
interface Lot extends LotDoors {
  id: number;
  side: 'north' | 'east' | 'south' | 'west';
  /** Where a level differs (the north lots on A are entered from the north road, westbound). */
  levels?: Partial<Record<Level, LotDoors>>;
  certain: boolean;
}

/** A lot's entry and exit on a level. */
const doors = (lot: Lot, level: Level): LotDoors => lot.levels?.[level] ?? lot;
export interface GarageData {
  lanes: Lane[];
  /**
   * `street`: where the car park road begins. `approach` (where the owner drew it): the way above
   * ground from the streets to that point, which every car must take (the Sultana side: round the
   * loop at the junction and down the ramp).
   */
  entrances: { id: EntranceId; lane: string; street: LatLng; approach?: LatLng[] }[];
  /** `mouth`: where the exit road leaves the car park; `departure`: the way on to the streets, where drawn. */
  exits: { id: EntranceId; lane: string; street: LatLng; mouth: LatLng; departure?: LatLng[] }[];
  lots: Lot[];
}

export const GARAGE = garageJson as unknown as GarageData;
export const ENTRANCES = GARAGE.entrances;
export const EXITS = GARAGE.exits;
export const LEVELS: readonly Level[] = ['B', 'A'];

/** Points this close are one junction; a road ending (or starting) this close to another joins it. */
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
const lengthOf = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + d2(pts[i - 1], p) : 0), 0);

/** Insert a point into a polyline at its nearest place (keeping its direction); returns the new polyline. */
function insertInto(line: XY[], p: XY): XY[] {
  let best = { i: 0, q: line[0], d: Infinity };
  for (let i = 1; i < line.length; i++) {
    const pr = project(p, line[i - 1], line[i]);
    if (pr.d < best.d) best = { i, q: pr.q, d: pr.d };
  }
  if (line.some((v) => d2(v, best.q) < MERGE_M)) return line;
  return [...line.slice(0, best.i), best.q, ...line.slice(best.i)];
}

interface Edge {
  to: number;
  /** Points along the way, after the start node and up to (including) the end node. */
  via: XY[];
  m: number;
  lane: string;
}
interface Graph {
  nodes: { p: XY; level: Level }[];
  out: Edge[][];
}

/**
 * Both levels as one directed graph. On each level: every road (not the ramps), one-way in the order
 * of its points, with a node wherever roads meet, an entrance or exit is (level B only) and each
 * lot is entered and left. The ramps join the two levels.
 */
function buildGraph(data: GarageData): Graph {
  const roads = data.lanes.filter((l) => !l.from_level);
  const ramps = data.lanes.filter((l) => l.from_level && l.to_level);
  const nodes: Graph['nodes'] = [];
  const node = (p: XY, level: Level) => {
    const k = nodes.findIndex((n) => n.level === level && d2(n.p, p) < MERGE_M);
    if (k >= 0) return k;
    nodes.push({ p, level });
    return nodes.length - 1;
  };
  const out: Edge[][] = [];
  const edge = (from: number, e: Edge) => {
    while (out.length < nodes.length) out.push([]);
    out[from].push(e);
  };
  const lines = new Map<Level, Map<string, XY[]>>();
  for (const level of LEVELS) {
    const onLevel = roads.filter((l) => !l.levels || l.levels.includes(level));
    const ls = new Map(onLevel.map((l) => [l.id, l.path.map(toM)]));
    const add = (id: string, p: XY) => ls.has(id) && ls.set(id, insertInto(ls.get(id)!, p));
    if (level === 'B') {
      for (const e of data.entrances) add(e.lane, toM(e.street));
      for (const x of data.exits) add(x.lane, toM(x.mouth));
    }
    for (const lot of data.lots) {
      const d = doors(lot, level);
      add(d.entry_lane, toM(d.entry));
      add(d.exit_lane, toM(d.exit));
    }
    for (const r of ramps) {
      const end = r.from_level === level ? r.path[0] : r.to_level === level ? r.path[r.path.length - 1] : null;
      if (!end) continue;
      const p = toM(end);
      let best: { id: string; d: number } | null = null;
      for (const [id, pts] of ls) {
        for (let i = 1; i < pts.length; i++) {
          const dd = project(p, pts[i - 1], pts[i]).d;
          if (!best || dd < best.d) best = { id, d: dd };
        }
      }
      if (best && best.d < JOIN_M) add(best.id, p);
    }
    // A road that starts or ends on another road (not at one of its corners) joins it there.
    for (const [id, pts] of ls) {
      for (const end of [pts[0], pts[pts.length - 1]]) {
        for (const [other, opts] of ls) {
          if (other === id || opts.some((v) => d2(v, end) < MERGE_M)) continue;
          if (opts.slice(1).some((b, i) => project(end, opts[i], b).d < JOIN_M)) ls.set(other, insertInto(opts, end));
        }
      }
    }
    lines.set(level, ls);
    for (const [id, pts] of ls) {
      const ids = pts.map((p) => node(p, level));
      const twoWay = onLevel.find((l) => l.id === id)?.oneway === false;
      for (let i = 1; i < ids.length; i++) {
        if (ids[i] === ids[i - 1]) continue;
        const m = d2(nodes[ids[i - 1]].p, nodes[ids[i]].p);
        edge(ids[i - 1], { to: ids[i], via: [nodes[ids[i]].p], m, lane: id });
        // The orange openings: from the entry road to the exit road, or back.
        if (twoWay) edge(ids[i], { to: ids[i - 1], via: [nodes[ids[i - 1]].p], m, lane: id });
      }
    }
  }
  // A ramp starts and ends at the junction it was joined to on each level (the nearest node there).
  const nearestOn = (p: XY, level: Level) => {
    let best = -1;
    for (let i = 0; i < nodes.length; i++) if (nodes[i].level === level && (best < 0 || d2(nodes[i].p, p) < d2(nodes[best].p, p))) best = i;
    return best >= 0 && d2(nodes[best].p, p) < JOIN_M ? best : node(p, level);
  };
  for (const r of ramps) {
    const pts = r.path.map(toM);
    const a = nearestOn(pts[0], r.from_level!);
    const b = nearestOn(pts[pts.length - 1], r.to_level!);
    edge(a, { to: b, via: [...pts.slice(1, -1), nodes[b].p], m: lengthOf(pts), lane: r.id });
  }
  while (out.length < nodes.length) out.push([]);
  return { nodes, out };
}

let graph: Graph | null = null;
const G = () => (graph ??= buildGraph(GARAGE));

function nodeAt(p: XY, level: Level): number {
  const { nodes } = G();
  let best = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].level !== level) continue;
    if (best < 0 || d2(nodes[i].p, p) < d2(nodes[best].p, p)) best = i;
  }
  return best;
}

/** Shortest directed way (Dijkstra; the graph has a few hundred nodes). */
/** What a stretch of a way is on: a level, or a ramp going up (to A) or down (to B). */
export type Stretch = Level | 'up' | 'down';

function shortest(from: number, to: number): { pts: XY[]; lanes: string[]; levels: Level[]; tags: Stretch[] } | null {
  const { nodes, out } = G();
  const dist = new Array(nodes.length).fill(Infinity);
  const prev: (Edge & { from: number })[] = new Array(nodes.length);
  const done = new Array(nodes.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let k = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (k < 0 || dist[i] < dist[k])) k = i;
    if (k < 0 || k === to) break;
    done[k] = true;
    for (const e of out[k]) {
      if (dist[k] + e.m < dist[e.to]) {
        dist[e.to] = dist[k] + e.m;
        prev[e.to] = { ...e, from: k };
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const steps: (Edge & { from: number })[] = [];
  for (let k = to; k !== from; k = prev[k].from) steps.unshift(prev[k]);
  const rampTo = (lane: string) => GARAGE.lanes.find((l) => l.id === lane)?.to_level;
  return {
    pts: [nodes[from].p, ...steps.flatMap((s) => s.via)],
    lanes: steps.map((s) => s.lane),
    levels: [nodes[from].level, ...steps.map((s) => nodes[s.to].level)],
    // One tag per segment between consecutive points: the level, or the ramp being climbed or descended.
    tags: steps.flatMap((s) => {
      const r = rampTo(s.lane);
      const tag: Stretch = r ? (r === 'A' ? 'up' : 'down') : nodes[s.to].level;
      return s.via.map(() => tag);
    }),
  };
}

/** Kept for drawing two-way roads; the car park's roads are one-way, drawn on their centre line. */
export function keepRight(pts: XY[], m = 2.5): XY[] {
  if (pts.length < 2) return pts;
  const normal = (a: XY, b: XY): XY => {
    const l = d2(a, b) || 1;
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  };
  return pts.map((p, i) => {
    const n0 = i > 0 ? normal(pts[i - 1], p) : null;
    const n1 = i < pts.length - 1 ? normal(p, pts[i + 1]) : null;
    let n: XY = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 ?? n1)!;
    const len = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / len, n[1] / len];
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
 * Inside a lot, from where its road turns in (or out) to the bay nearest `towards` (the stairs to be
 * used, or the middle of the lot): in at the edge, then along the aisle on that side of the middle
 * rows. The aisles run the length of the lot, a quarter of its width in from each long side.
 */
export function insideLot(lot: Poi, from: XY, towards: XY | null): { gate: XY; path: XY[] } | null {
  const r = lotRect(lot);
  if (!r) return null;
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const alongX = w >= h; // aisles run east–west
  const clamp = (v: number, a: number, b: number) => Math.max(a + LOT_INSET_M, Math.min(b - LOT_INSET_M, v));
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
  const aisles = alongX ? [r.y0 + h / 4, r.y0 + (3 * h) / 4] : [r.x0 + w / 4, r.x0 + (3 * w) / 4];
  const across = alongX ? target[1] : target[0];
  const aisle = Math.abs(aisles[0] - across) <= Math.abs(aisles[1] - across) ? aisles[0] : aisles[1];
  const onAisle = (along: number): XY => (alongX ? [clamp(along, r.x0, r.x1), aisle] : [aisle, clamp(along, r.y0, r.y1)]);
  const turn = onAisle(alongX ? inside[0] : inside[1]);
  const bay = onAisle(alongX ? target[0] : target[1]);
  const path: XY[] = [gate, inside, turn, bay].filter((p, i, a) => i === 0 || d2(p, a[i - 1]) > 0.5);
  return { gate, path };
}

/** A ramp on the way: where it starts, and whether it goes up to A or down to B. */
export interface RampOnWay {
  at: LatLng;
  to: Level;
}

export interface GarageRoute {
  /** Driven inside the car park (the way in: from the entrance; the way out: from the bay). */
  path: LatLng[];
  /** Where the car turns into (or out of) the lot. */
  gate: LatLng;
  /** The bay: where the car is left (or picked up). */
  bay: LatLng;
  level: Level;
  ramps: RampOnWay[];
  /** The way in stretches by level (and the ramps between), to draw level A differently. */
  parts: { on: Stretch; path: LatLng[] }[];
  /** The roads taken, in order, each with the level it was driven on. */
  roads: { lane: string; level: Level }[];
  meters: number;
  /** Whether every road on the way is one the owner is sure of. */
  certain: boolean;
}

function finish(roads: { pts: XY[]; lanes: string[]; levels: Level[]; tags: Stretch[] }, inLot: XY[], gate: XY, bay: XY, level: Level, lot: Lot, out: boolean): GarageRoute {
  const driven = out ? [...inLot, ...roads.pts] : [...roads.pts, ...inLot];
  // A tag for every segment of the drive: inside the lot it is the lot's level.
  const lotTags: Stretch[] = inLot.slice(1).map(() => level);
  const tags: Stretch[] = out ? [...lotTags, level, ...roads.tags] : [...roads.tags, level, ...lotTags];
  const parts: GarageRoute['parts'] = [];
  for (let i = 1; i < driven.length; i++) {
    const on = tags[i - 1] ?? level;
    const last = parts[parts.length - 1];
    if (last && last.on === on) last.path.push(fromM(driven[i]));
    else parts.push({ on, path: [fromM(driven[i - 1]), fromM(driven[i])] });
  }
  const unsure = new Set(GARAGE.lanes.filter((l) => !l.certain).map((l) => l.id));
  const ramps: RampOnWay[] = [];
  for (let i = 0; i < roads.lanes.length; i++) {
    const lane = GARAGE.lanes.find((l) => l.id === roads.lanes[i]);
    if (lane?.to_level && (i === 0 || roads.lanes[i - 1] !== lane.id)) ramps.push({ at: lane.path[0], to: lane.to_level });
  }
  return {
    path: driven.map(fromM),
    gate: fromM(gate),
    bay: fromM(bay),
    level,
    ramps,
    parts,
    roads: roads.lanes.map((lane, i) => ({ lane, level: roads.levels[i + 1] })).filter((r, i, a) => i === 0 || r.lane !== a[i - 1].lane || r.level !== a[i - 1].level),
    meters: lengthOf(driven),
    certain: lot.certain && !roads.lanes.some((l) => unsure.has(l)),
  };
}

/**
 * The way in: from an entrance (level B) along the one-way roads — up the yellow ramp for level A —
 * to the lot, then to the bay nearest `towards`. Null if that lot is not in the drawing.
 */
export function garageRoute(entrance: EntranceId, lot: Poi, towards: LatLng | null = null, level: Level = 'B'): GarageRoute | null {
  const ent = ENTRANCES.find((e) => e.id === entrance);
  const l = lotData(lot);
  if (!ent || !l) return null;
  const roads = shortest(nodeAt(toM(ent.street), 'B'), nodeAt(toM(doors(l, level).entry), level));
  if (!roads) return null;
  const inLot = insideLot(lot, roads.pts[roads.pts.length - 1], towards ? toM(towards) : null);
  if (!inLot) return null;
  return finish(roads, inLot.path, inLot.gate, inLot.path[inLot.path.length - 1], level, l, false);
}

/**
 * The way out: from the bay nearest `from` (the stairs the visitor comes down, or the middle of the
 * lot) to the lot's own exit, then along the one-way roads — down the green ramp from level A — to an
 * exit (level B), ending where its road leaves the car park.
 */
export function garageExit(lot: Poi, exit: EntranceId, level: Level = 'B', from: LatLng | null = null): GarageRoute | null {
  const x = EXITS.find((e) => e.id === exit);
  const l = lotData(lot);
  if (!x || !l) return null;
  const roads = shortest(nodeAt(toM(doors(l, level).exit), level), nodeAt(toM(x.mouth), 'B'));
  if (!roads) return null;
  const inLot = insideLot(lot, roads.pts[0], from ? toM(from) : null);
  if (!inLot) return null;
  const outOfLot = [...inLot.path].reverse();
  return finish(roads, outOfLot, inLot.gate, outOfLot[0], level, l, true);
}
