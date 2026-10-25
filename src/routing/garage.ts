import garageJson from '../../data/garage.json';
import type { LatLng, Poi } from '../data/types';
import { lotLevels, parkingEntrances } from '../domain/parking';
import { fromM, toM, type XY } from './walk';

/**
 * The roads of the underground car park, from the owner's drawings (2026-10-13,
 * docs/routes/garage-*.json → data/garage.json). Pure.
 *
 *  - Two levels with the same roads: B below, A above. Cars come in and go out by B only: in at
 *    Omar ibn al-Khattab street (south-west, owner 2026-10-14) or Sultana (north-west), out at either.
 *  - Every road is one-way, in the order of its points; traffic circulates to the right (clockwise).
 *  - Level A is reached by the yellow ramp after lot 11 and left by the green ramps: one between
 *    facilities 220 and 222, one beside the yellow ramp (north, onto the exit road). Up there a car
 *    heads west on the north road, which leads into the north lots (the reverse of B); for the others
 *    it goes almost a full lap (down the west side, the west link into the loop). The orange openings,
 *    to switch between the way in and the way out, can be crossed either way (the north-west ones on
 *    B only). Two more pairs of ramps (owner, 2026-10-14): a yellow one beside the north-west green
 *    one, and a yellow and a green one at the south-west corner.
 *  - The east side is cut between lots 12 and 13 (owner, 2026-10-14): lot 12 is reached from the
 *    north road, lot 13 from the south (the way in from Omar ibn al-Khattab street). There is no way
 *    back at that exit (owner: «exit only»), so the south lots and lot 13 are reached only from there.
 *  - Lots 12 and 13 are on level B only (owner, 2026-10-25); a way asked for on A goes to B.
 *  - Level A has no east side (owner, 2026-10-25): road 6 ends by the south-east green ramp and turns into
 *    it; in from Qurban, a car climbs beside that ramp and turns west onto the road above lots 1-4.
 *  - Each of the 13 lots (on both levels) is entered right after its first facility and left by its
 *    own exit (the arrows in the drawing). A route ends at the lot's entrance and the way out starts
 *    at its exit (owner, 2026-10-13): the visitor parks where they like inside.
 */

export type EntranceId = 'omar' | 'sultana' | 'qurban';
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
  /**
   * A turn-round at a mouth (owner, 2026-10-25: the open area at the Omar entrance): from the exit
   * road back to that entrance's road. Only for a car already inside, and only while that entrance is open.
   */
  turn?: EntranceId;
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
  entrances: {
    id: EntranceId;
    lane: string;
    street: LatLng;
    approach?: LatLng[] /** The level it joins (B when absent; Qurban joins A only, owner 2026-10-23). */;
    level?: Level;
  }[];
  /** `mouth`: where the exit road leaves the car park; `departure`: the way on to the streets, where drawn. */
  exits: { id: EntranceId; lane: string; street: LatLng; mouth: LatLng; departure?: LatLng[]; level?: Level }[];
  lots: Lot[];
}

export const GARAGE = garageJson as unknown as GarageData;
export const ENTRANCES = GARAGE.entrances;
export const EXITS = GARAGE.exits;
export const LEVELS: readonly Level[] = ['B', 'A'];

/**
 * Entrances the supervisor has closed (owner, 2026-10-23: the Qurban one): the planner leaves them
 * out, for the way in and for the way out. All open until told otherwise.
 */
const closed = new Set<EntranceId>();
export function setEntranceOpen(id: EntranceId, open: boolean): void {
  if (open) closed.delete(id);
  else closed.add(id);
}
export const isEntranceOpen = (id: EntranceId) => !closed.has(id);

/** Points this close are one junction; a road ending (or starting) this close to another joins it. */
const MERGE_M = 1.5;
const JOIN_M = 4;

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
    for (const e of data.entrances) if ((e.level ?? 'B') === level) add(e.lane, toM(e.street));
    for (const x of data.exits) if ((x.level ?? 'B') === level) add(x.lane, toM(x.mouth));
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

/**
 * One step of the way inside the car park, for step-by-step directions: head north/east/south/west,
 * take the ramp up to A or down to B, turn into the lot or out of it.
 */
export interface GarageStep {
  kind: 'n' | 'e' | 's' | 'w' | 'up' | 'down' | 'lot_in' | 'lot_out';
  path: LatLng[];
  meters: number;
}

/** A way can also start part-way along a road (a car already in the car park): its first point and road. */
interface Start {
  node: number;
  cost: number;
  lead?: { p: XY; lane: string };
}

/** The turn-round roads (by lane id) and the entrance each belongs to. */
const TURNS = new Map(GARAGE.lanes.filter((l) => l.turn).map((l) => [l.id, l.turn!]));

/**
 * The shortest way along the one-way roads. `turns`: whether the turn-rounds at the mouths may be used
 * (a car already inside: out and straight back in rather than round the streets), each only while its
 * entrance is open.
 */
function shortest(from: number | Start[], to: number, turns = false): { pts: XY[]; lanes: string[]; levels: Level[]; tags: Stretch[] } | null {
  const { nodes, out } = G();
  const blocked = (lane: string) => TURNS.has(lane) && (!turns || !isEntranceOpen(TURNS.get(lane)!));
  const dist = new Array(nodes.length).fill(Infinity);
  const prev: (Edge & { from: number })[] = new Array(nodes.length);
  const done = new Array(nodes.length).fill(false);
  const starts: Start[] = typeof from === 'number' ? [{ node: from, cost: 0 }] : from;
  const startOf = new Map<number, Start>();
  for (const st of starts) {
    if (st.cost < dist[st.node]) {
      dist[st.node] = st.cost;
      startOf.set(st.node, st);
    }
  }
  for (;;) {
    let k = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (k < 0 || dist[i] < dist[k])) k = i;
    if (k < 0 || k === to) break;
    done[k] = true;
    for (const e of out[k]) {
      if (blocked(e.lane)) continue;
      if (dist[k] + e.m < dist[e.to]) {
        dist[e.to] = dist[k] + e.m;
        prev[e.to] = { ...e, from: k };
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const steps: (Edge & { from: number })[] = [];
  let k = to;
  for (; prev[k] && !(startOf.has(k) && startOf.get(k)!.cost === dist[k]); k = prev[k].from) steps.unshift(prev[k]);
  const first = k;
  const lead = startOf.get(first)?.lead;
  if (lead) steps.unshift({ from: -1, to: first, via: [nodes[first].p], m: 0, lane: lead.lane });
  const rampTo = (lane: string) => GARAGE.lanes.find((l) => l.id === lane)?.to_level;
  return {
    pts: [lead ? lead.p : nodes[first].p, ...steps.flatMap((s) => s.via)],
    lanes: steps.map((s) => s.lane),
    levels: [nodes[first].level, ...steps.map((s) => nodes[s.to].level)],
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

/** The level a lot is parked on when this one is asked for: that one if the lot is on it, else the lot's own. */
export const lotLevel = (lot: Poi, level: Level): Level => (lotLevels(lot).includes(level) ? level : lotLevels(lot)[0]);

/** The lot's area: the rectangle between its four facilities (its entrances on the plaza above). */
export function lotRect(lot: Poi): { x0: number; x1: number; y0: number; y1: number } | null {
  const f = parkingEntrances(lot).map((p) => toM([p.lat, p.lng]));
  if (f.length < 4) return null;
  const xs = f.map((p) => p[0]);
  const ys = f.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Inside a lot this far from a corner at least: an entrance is never right at a facility. */
const GATE_INSET_M = 6;

/**
 * The lot's entrance (or exit) on its edge: the point of the lot's edge nearest where its road turns
 * in (or out), kept clear of the corners.
 */
export function lotGate(lot: Poi, from: XY): XY | null {
  const r = lotRect(lot);
  if (!r) return null;
  const clamp = (v: number, a: number, b: number) => Math.max(a + GATE_INSET_M, Math.min(b - GATE_INSET_M, v));
  const edges: XY[] = [
    [clamp(from[0], r.x0, r.x1), r.y0],
    [clamp(from[0], r.x0, r.x1), r.y1],
    [r.x0, clamp(from[1], r.y0, r.y1)],
    [r.x1, clamp(from[1], r.y0, r.y1)],
  ];
  return edges.reduce((a, b) => (d2(b, from) < d2(a, from) ? b : a));
}

/** A ramp on the way: where it starts, and whether it goes up to A or down to B. */
export interface RampOnWay {
  at: LatLng;
  to: Level;
}

export interface GarageRoute {
  /** Driven inside the car park: the way in from the entrance to the lot's entrance; the way out from the lot's exit. */
  path: LatLng[];
  /** The lot's entrance (way in) or exit (way out), on its edge. */
  gate: LatLng;
  level: Level;
  ramps: RampOnWay[];
  /** The way in stretches by level (and the ramps between), to draw level A differently. */
  parts: { on: Stretch; path: LatLng[] }[];
  /** Step-by-step directions (GPS does not work underground, so the visitor steps through them). */
  steps: GarageStep[];
  /** The roads taken, in order, each with the level it was driven on. */
  roads: { lane: string; level: Level }[];
  meters: number;
  /** Whether every road on the way is one the owner is sure of. */
  certain: boolean;
}

function finish(roads: { pts: XY[]; lanes: string[]; levels: Level[]; tags: Stretch[] }, gate: XY, level: Level, lot: Lot, out: boolean): GarageRoute {
  // The turn between the road and the lot's edge is driven on the lot's level.
  const driven = out ? [gate, ...roads.pts] : [...roads.pts, gate];
  const tags: Stretch[] = out ? [level, ...roads.tags] : [...roads.tags, level];
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
    steps: stepsOf(roads.pts, roads.tags, gate, out),
    path: driven.map(fromM),
    gate: fromM(gate),
    level,
    ramps,
    parts,
    roads: roads.lanes.map((lane, i) => ({ lane, level: roads.levels[i + 1] })).filter((r, i, a) => i === 0 || r.lane !== a[i - 1].lane || r.level !== a[i - 1].level),
    meters: lengthOf(driven),
    certain: lot.certain && !roads.lanes.some((l) => unsure.has(l)),
  };
}

/** Shorter stretches than this join the step before (a kink in the drawing is not a turn). */
const MIN_STEP_M = 15;

/** The compass direction of a segment (y north). */
function heading(a: XY, b: XY): 'n' | 'e' | 's' | 'w' {
  const deg = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  return deg < 45 || deg >= 315 ? 'n' : deg < 135 ? 'e' : deg < 225 ? 's' : 'w';
}

/** The way as steps: runs in one direction (or one ramp), then into the lot (or, out, from it first). */
function stepsOf(pts: XY[], tags: Stretch[], gate: XY, out: boolean): GarageStep[] {
  const runs: { kind: GarageStep['kind']; pts: XY[] }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const tag = tags[i - 1];
    const kind: GarageStep['kind'] = tag === 'up' || tag === 'down' ? tag : heading(pts[i - 1], pts[i]);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.pts.push(pts[i]);
    else runs.push({ kind, pts: [pts[i - 1], pts[i]] });
  }
  // A short run (not a ramp) joins the run before it; then runs of the same kind merge.
  const merged: typeof runs = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && r.kind !== 'up' && r.kind !== 'down' && (lengthOf(r.pts) < MIN_STEP_M || prev.kind === r.kind)) prev.pts.push(...r.pts.slice(1));
    else if (prev && prev.kind !== 'up' && prev.kind !== 'down' && lengthOf(prev.pts) < MIN_STEP_M && merged.length === 1) {
      merged[0] = { kind: r.kind, pts: [...prev.pts, ...r.pts.slice(1)] };
    } else merged.push({ kind: r.kind, pts: [...r.pts] });
  }
  const steps: GarageStep[] = merged.map((r) => ({ kind: r.kind, path: r.pts.map(fromM), meters: lengthOf(r.pts) }));
  const lot: GarageStep = out
    ? { kind: 'lot_out', path: [fromM(gate), fromM(pts[0])], meters: d2(gate, pts[0]) }
    : { kind: 'lot_in', path: [fromM(pts[pts.length - 1]), fromM(gate)], meters: d2(pts[pts.length - 1], gate) };
  return out ? [lot, ...steps] : [...steps, lot];
}

/**
 * The way in: from an entrance (level B) along the one-way roads — up the yellow ramp for level A —
 * to the lot's entrance. Null if that lot is not in the drawing.
 */
export function garageRoute(entrance: EntranceId, lot: Poi, asked: Level = 'B'): GarageRoute | null {
  const level = lotLevel(lot, asked);
  const ent = ENTRANCES.find((e) => e.id === entrance);
  const l = lotData(lot);
  if (!ent || !l) return null;
  const roads = shortest(nodeAt(toM(ent.street), ent.level ?? 'B'), nodeAt(toM(doors(l, level).entry), level));
  const gate = roads && lotGate(lot, roads.pts[roads.pts.length - 1]);
  return roads && gate ? finish(roads, gate, level, l, false) : null;
}

/**
 * The way out: from the lot's exit along the one-way roads — down the green ramp from level A — to
 * an exit (level B), ending where its road leaves the car park.
 */
export function garageExit(lot: Poi, exit: EntranceId, asked: Level = 'B'): GarageRoute | null {
  const level = lotLevel(lot, asked);
  const x = EXITS.find((e) => e.id === exit);
  const l = lotData(lot);
  if (!x || !l) return null;
  const roads = shortest(nodeAt(toM(doors(l, level).exit), level), nodeAt(toM(x.mouth), x.level ?? 'B'));
  const gate = roads && lotGate(lot, roads.pts[0]);
  return roads && gate ? finish(roads, gate, level, l, true) : null;
}

/** A car this close to a road of the car park is taken to be on it (GPS underground wanders a little). */
export const ON_GARAGE_ROAD_M = 20;
/** What starting on a road going against the car’s heading costs (in metres): more than any lap of the car park. */
const AGAINST_M = 5000;

/**
 * Where a car already inside the car park can carry on from: points along the roads (on level B,
 * where every car comes in) within reach of its position, each continuing the way its road goes.
 * Empty when it is not by any road of the car park.
 */
function startsNear(p: XY, level: Level, heading?: number | null): Start[] {
  const { nodes, out } = G();
  const starts: Start[] = [];
  for (let a = 0; a < nodes.length; a++) {
    if (nodes[a].level !== level) continue;
    for (const e of out[a]) {
      if (GARAGE.lanes.find((l) => l.id === e.lane)?.from_level) continue; // not from the middle of a ramp
      const pr = project(p, nodes[a].p, nodes[e.to].p);
      if (pr.d > ON_GARAGE_ROAD_M) continue;
      // The rest of this stretch, plus a little for how far off the road the position is; when the
      // car's heading is known, a road going the other way (the two ways side by side) costs more.
      const [a0, b0] = [nodes[a].p, nodes[e.to].p];
      const road = (Math.atan2(b0[0] - a0[0], b0[1] - a0[1]) * 180) / Math.PI;
      const against = heading != null && Math.abs(((road - heading + 540) % 360) - 180) > 90;
      starts.push({ node: e.to, cost: d2(pr.q, nodes[e.to].p) + 2 * pr.d + (against ? AGAINST_M : 0), lead: { p: pr.q, lane: e.lane } });
    }
  }
  return starts;
}

/** Whether a position is on (or right by) a road of the car park. */
export function inGarage(from: LatLng, level: Level = 'B'): boolean {
  return startsNear(toM(from), level).length > 0;
}

/** This close to a road of the car park, or in a lot, a car may be in the car park: ask where it is. */
const NEAR_GARAGE_M = 30;

/** Whether a position is in the car park or by it (on a road, or in or beside a lot). */
export function nearGarage(from: LatLng, lots: Poi[]): boolean {
  const p = toM(from);
  const { nodes, out } = G();
  for (let a = 0; a < nodes.length; a++) for (const e of out[a]) if (project(p, nodes[a].p, nodes[e.to].p).d <= NEAR_GARAGE_M) return true;
  return lotsByDistance(from, lots).some((x) => x.m <= NEAR_GARAGE_M);
}

/** The lots by how far a position is from each (0 inside it), nearest first. */
export function lotsByDistance(from: LatLng, lots: Poi[]): { lot: Poi; m: number }[] {
  const [x, y] = toM(from);
  return lots
    .map((lot) => {
      const r = lotRect(lot);
      const m = r ? Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1)) : Infinity;
      return { lot, m };
    })
    .filter((x) => Number.isFinite(x.m))
    .sort((a, b) => a.m - b.m);
}

/**
 * The way from one lot to another, for a car parked (or about to leave) in a lot (owner,
 * 2026-10-14: «are you in lot n?»): out by the lot's own exit on its level, then along the one-way
 * roads to the other lot's entrance.
 */
export function garageRouteFromLot(fromLot: Poi, fromAsked: Level, lot: Poi, asked: Level = 'B'): GarageRoute | null {
  const fromLevel = lotLevel(fromLot, fromAsked);
  const level = lotLevel(lot, asked);
  const a = lotData(fromLot);
  const l = lotData(lot);
  if (!a || !l) return null;
  const roads = shortest(nodeAt(toM(doors(a, fromLevel).exit), fromLevel), nodeAt(toM(doors(l, level).entry), level), true);
  const gate = roads && lotGate(lot, roads.pts[roads.pts.length - 1]);
  const out = roads && lotGate(fromLot, roads.pts[0]);
  if (!roads || !gate || !out) return null;
  const way = finish(roads, gate, level, l, false);
  const first = way.path[0];
  const m = d2(out, toM(first));
  const start = fromM(out);
  const p0 = way.parts[0];
  return {
    ...way,
    path: [start, ...way.path],
    parts: p0 && p0.on === fromLevel ? [{ on: p0.on, path: [start, ...p0.path] }, ...way.parts.slice(1)] : [{ on: fromLevel, path: [start, first] }, ...way.parts],
    steps: [{ kind: 'lot_out', path: [start, first], meters: m }, ...way.steps],
    meters: way.meters + m,
    certain: way.certain && a.certain,
  };
}

/**
 * The way in for a car already in the car park (owner, 2026-10-14: near the yellow ramp, the way to
 * lot 12A went out to the streets and back in): from where it is, along the one-way roads — up the
 * yellow ramp for level A — to the lot's entrance. Null if the car is not by a road of the car park.
 */
export function garageRouteFrom(from: LatLng, lot: Poi, asked: Level = 'B', heading?: number | null, fromLevel: Level = 'B'): GarageRoute | null {
  const level = lotLevel(lot, asked);
  const l = lotData(lot);
  if (!l) return null;
  const starts = startsNear(toM(from), fromLevel, heading);
  if (!starts.length) return null;
  const roads = shortest(starts, nodeAt(toM(doors(l, level).entry), level), true);
  const gate = roads && lotGate(lot, roads.pts[roads.pts.length - 1]);
  return roads && gate ? finish(roads, gate, level, l, false) : null;
}
