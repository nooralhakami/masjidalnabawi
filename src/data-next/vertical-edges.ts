import { FLOORS } from './floors';
import { VERTICAL_NODES, type VerticalNode, type VerticalNodeType } from './vertical-nodes';

/**
 * The floor-to-floor links of the Haram, derived from the verified vertical nodes (Phase 1, plan §4.2).
 *
 * navQ records each lift and escalator landing as a node on its floor, but draws no explicit link
 * between two floors. A link is recovered where two landings of the **same kind** on a venue's two
 * floors are **mutual nearest neighbours** in plan and within `PAIR_MAX_M`: a lift shaft's two
 * landings sit almost on top of each other, and an escalator's two landings a few metres apart. The
 * mutuality test is what makes this safe — a landing whose nearest counterpart does not answer back
 * is left **unconnected**, never guessed (owner rule: no fabrication). The four extra Mosque GF
 * escalator landings (4201, 4203, 4635, 4644) have no mutual roof partner in the capture, so they
 * carry no edge; the three accessible gates stand on GF alone and are not vertical links.
 *
 * Pure data: the routing consumer asserts its provenance (src/data/provenance.ts, 'vertical-edges').
 * The plan metric below matches the walk frame (domain/frames.ts); data-next imports no src layer,
 * so the two constants are repeated here rather than imported.
 */

export interface VerticalEdge {
  /** The landing on the lower floor. */
  a: number;
  /** The landing on the upper floor. */
  b: number;
  /** A link is a lift or an escalator; the GF accessible gates are not vertical links. */
  type: Exclude<VerticalNodeType, 'gate'>;
  venueId: number;
  /** The lower floor id. */
  fromFloor: number;
  /** The upper floor id. */
  toFloor: number;
  /** Plan distance between the two landings (m, to 0.1) — the evidence for the link. */
  meters: number;
}

const LAT0 = 24.4673;
const KY = 111_320;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const planM = (a: VerticalNode, b: VerticalNode): number => Math.hypot((a.lng - b.lng) * KX, (a.lat - b.lat) * KY);

/**
 * Two mutual-nearest landings farther apart than this are not taken as one link. Every recovered
 * pair lies within 17.6 m (the longest Mosque escalator); the bound only guards against a stray
 * match, and mutuality already rejects the ambiguous landings (21 m and beyond, one-way).
 */
const PAIR_MAX_M = 25;

const nearest = (from: VerticalNode, pool: readonly VerticalNode[]): VerticalNode => pool.reduce((best, n) => (planM(from, n) < planM(from, best) ? n : best), pool[0]);

function derive(): readonly VerticalEdge[] {
  const edges: VerticalEdge[] = [];
  const venues = [...new Set(VERTICAL_NODES.map((n) => n.venueId))];
  for (const venueId of venues) {
    const floors = FLOORS.filter((f) => f.venueId === venueId).sort((a, b) => a.level - b.level);
    if (floors.length !== 2) continue;
    const [lower, upper] = floors;
    for (const type of ['elevator', 'escalator'] as const) {
      const lo = VERTICAL_NODES.filter((n) => n.venueId === venueId && n.floorId === lower.id && n.type === type && !n.closed);
      const up = VERTICAL_NODES.filter((n) => n.venueId === venueId && n.floorId === upper.id && n.type === type && !n.closed);
      if (!lo.length || !up.length) continue;
      for (const a of lo) {
        const b = nearest(a, up);
        const m = planM(a, b);
        if (m > PAIR_MAX_M || nearest(b, lo).id !== a.id) continue;
        edges.push({ a: a.id, b: b.id, type, venueId, fromFloor: lower.id, toFloor: upper.id, meters: Math.round(m * 10) / 10 });
      }
    }
  }
  return edges.sort((x, y) => x.a - y.a);
}

/** All recovered floor-to-floor links (46: 8 lifts, 38 escalators), lower-floor node first. */
export const VERTICAL_EDGES: readonly VerticalEdge[] = derive();

/** The step-free subset: lifts only (escalators and stairs are excluded when accessible mode is on). */
export const ACCESSIBLE_VERTICAL_EDGES: readonly VerticalEdge[] = VERTICAL_EDGES.filter((e) => e.type === 'elevator');

const linked = new Set(VERTICAL_EDGES.flatMap((e) => [e.a, e.b]));

/**
 * The landings with no recovered link: the three GF accessible gates (not vertical links) and the
 * four Mosque GF escalator landings whose roof partner is not in the capture. Listed openly so the
 * gap is visible, not hidden (owner rule: state what is unavailable).
 */
export const UNLINKED_VERTICAL_NODES: readonly VerticalNode[] = VERTICAL_NODES.filter((n) => !linked.has(n.id));

/** The links of one venue (the Mosque 4: GF↔ROF; the car park 20: B1↔B2). */
export const verticalEdgesOfVenue = (venueId: number): readonly VerticalEdge[] => VERTICAL_EDGES.filter((e) => e.venueId === venueId);
