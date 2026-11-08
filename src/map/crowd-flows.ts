import { rawdahState } from '../domain/rawdah';
import { type Crowd, FIXED, FREE, HIDDEN, LED, STEERED, type XY } from './crowd-sim';
import {
  FLOWS_CENTRE,
  FLOWS_REACH,
  FUNERAL_WAY,
  HOLD_CENTRE,
  HOLD_HALF,
  HOLD_ORGANISERS,
  QUEUE_CHECKERS,
  QUEUE_ENTRY_Z,
  QUEUE_HEAD_Z,
  QUEUE_LANES,
  QUEUE_MOUTH_Z,
  QUEUE_OUT_Z,
  QUEUE_ROW,
  RAWDAH_AWAY,
  RAWDAH_IN,
  RAWDAH_OUT,
  SALAM_IN,
  SALAM_OUT,
  SALAM_OUT_AT,
} from './rawdah-layout';

/**
 * The flows round the Rawdah and the Prophet's chamber (owner, 2026-11-08), played by walkers taken
 * from the crowd and given back to it:
 *
 * - The Rawdah: those whose turn it is (men or women, as the rota on the Rawdah card) queue in the
 *   six lanes, are checked one by one at the lanes' heads, wait before Gate 37, are sent in batches
 *   into the Rawdah through Gate 39, and come out of Gate 2 some time later.
 * - The greeting: men walk to Gate 1, are inside a while, come out of Gate 41 and walk south.
 * - Now and then a funeral: a bier on four men's shoulders, men following, to the south face by
 *   Gate 42.
 *
 * Only while the view is about the south of the Mosque; otherwise every walker is free.
 */

/** A walker's own way: a list of steps, done one after another. */
type Step =
  | { via: number } // led down the flow field to a goal
  | { go: XY } // steered straight to a point
  | { hide: number } // inside the Mosque for so many seconds
  | { at: XY } // comes out here
  | { join: 'hold' } // waits before Gate 37
  | { done: true }; // back to the crowd

/** How many queue in each lane, and the most who wait before Gate 37. */
export const LANE_FILL = 12;
const HOLD_MAX = 30;
const BATCH_MAX = 22;
/** The greeting: a man every so many seconds, at most so many on the way at once. */
const SALAM_EVERY = 2;
const SALAM_MAX = 44;
/** A funeral: its walk (m/s), the men round the bier, those following. */
const FUNERAL_SPEED = 1.15;
const FOLLOWERS = 10;

export interface Bier {
  x: number;
  z: number;
  heading: number;
}

interface Funeral {
  path: XY[];
  /** Cumulative length at each point of `path`. */
  at: number[];
  s: number;
  carriers: number[];
  followers: number[];
}

export class Flows {
  private active = false;
  private t = 0;
  private turnCheck = -1;
  private turn: 'men' | 'women' = 'men';
  private rnd: () => number;
  /** Per walker held: its steps, which it is on, and the time its step ends (hiding). */
  private plans = new Map<number, { steps: Step[]; i: number; until: number; since: number }>();
  private lanes: number[][] = QUEUE_LANES.map(() => []);
  private coming: number[][] = QUEUE_LANES.map(() => []);
  /** When each walker coming to a lane set out. */
  private setOut = new Map<number, number>();
  private nextRelease: number[] = QUEUE_LANES.map(() => 0);
  private nextJoin: number[] = QUEUE_LANES.map(() => 0);
  private hold: number[] = [];
  private nextBatch = 0;
  private organisers: number[] = [];
  private nextSalam = 0;
  private salam = new Set<number>();
  private funerals: Funeral[] = [];
  private nextFuneral = 0;
  private secondFuneral = Number.POSITIVE_INFINITY;
  /** Funerals begun since the flows were made (for the tests). */
  funeralsStarted = 0;
  private g: {
    entry: number[];
    hold: number;
    rawdahIn: number;
    away: number;
    salamIn: number[];
    salamOut: number[];
    funeral: number[];
  };

  constructor(
    private crowd: Crowd,
    seed = 3,
  ) {
    let s = seed >>> 0 || 1;
    this.rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const add = (p: XY) => crowd.addSpecialGoal(p);
    this.g = {
      entry: QUEUE_LANES.map(([w, e]) => add([(w + e) / 2, QUEUE_ENTRY_Z])),
      hold: add(HOLD_CENTRE),
      rawdahIn: add(RAWDAH_IN),
      away: add(RAWDAH_AWAY),
      salamIn: SALAM_IN.map(add),
      salamOut: SALAM_OUT.map(add),
      funeral: FUNERAL_WAY.map(add),
    };
  }

  /** Is the view (centre x, z, radius r) about the south of the Mosque? */
  static near(x: number, z: number, r: number): boolean {
    return Math.hypot(x - FLOWS_CENTRE[0], z - FLOWS_CENTRE[1]) < FLOWS_REACH + r;
  }

  /** The biers being carried now. */
  biers(): Bier[] {
    return this.funerals.map((f) => {
      const [x, z, heading] = this.along(f, f.s);
      return { x, z, heading };
    });
  }

  /** Who the flows hold now, and what they are (for the tests). */
  census(): { queue: number[]; hold: number[]; organisers: number[]; salam: number[]; funerals: number } {
    return { queue: this.lanes.flat(), hold: [...this.hold], organisers: [...this.organisers], salam: [...this.salam], funerals: this.funerals.length };
  }

  /** The Rawdah's turn now. */
  private turnNow(now: Date): void {
    if (this.t < this.turnCheck) return;
    this.turnCheck = this.t + 5;
    this.turn = rawdahState(now).turn;
  }

  /** A free walker, of the given sex, nearest x, z within `reach` metres; -1 if none. */
  private recruit(x: number, z: number, woman: boolean, reach = 120): number {
    const c = this.crowd;
    let best = -1;
    let bd = reach * reach;
    for (let a = 0; a < c.n; a++) {
      if (c.mode[a] !== FREE || Number.isNaN(c.px[a]) || (c.woman[a] === 1) !== woman) continue;
      const d = (c.px[a] - x) ** 2 + (c.pz[a] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** Give walker `a` its steps, starting now. */
  private plan(a: number, steps: Step[]): void {
    this.plans.set(a, { steps, i: -1, until: 0, since: 0 });
    this.next(a);
  }

  private next(a: number): void {
    const p = this.plans.get(a);
    if (!p) return;
    const c = this.crowd;
    p.i++;
    p.since = this.t;
    const step = p.steps[p.i];
    if (!step || 'done' in step) {
      this.plans.delete(a);
      this.salam.delete(a);
      c.free(a);
      return;
    }
    if ('via' in step) c.lead(a, step.via);
    else if ('go' in step) c.steer(a, step.go[0], step.go[1]);
    else if ('hide' in step) {
      c.hide(a);
      p.until = this.t + step.hide;
    } else if ('at' in step) {
      c.mode[a] = STEERED;
      if (!c.place(a, step.at[0], step.at[1]))
        p.until = this.t + 2; // wait for room at the door
      else this.next(a);
    } else if ('join' in step) {
      this.plans.delete(a);
      this.hold.push(a);
      const [hx, hz] = HOLD_CENTRE;
      for (let tries = 0; tries < 20; tries++) {
        const x = hx + (this.rnd() * 2 - 1) * HOLD_HALF[0];
        const z = hz + (this.rnd() * 2 - 1) * HOLD_HALF[1];
        if (!c.standable(x, z, !c.woman[a])) continue;
        c.steer(a, x, z, 0.75);
        return;
      }
      c.steer(a, hx, hz, 0.75);
    }
  }

  /** Move every held walker on to its next step where it has finished this one. */
  private advancePlans(): void {
    const c = this.crowd;
    for (const [a, p] of [...this.plans]) {
      const step = p.steps[p.i];
      if (!step) continue;
      if ('via' in step) {
        // There (near its goal), or lost on the way too long: back to the crowd.
        const [gx, gz] = c.goalPoint(step.via);
        const far = Math.hypot(c.px[a] - gx, c.pz[a] - gz) > 5;
        if ((c.arrived[a] && far) || this.t - p.since > 240) {
          this.plans.delete(a);
          this.salam.delete(a);
          c.free(a);
        } else if (c.arrived[a]) this.next(a);
      } else if ('go' in step) {
        if (Math.hypot(c.px[a] - step.go[0], c.pz[a] - step.go[1]) < 0.8) this.next(a);
      } else if ('hide' in step || 'at' in step) {
        if (this.t >= p.until) {
          if ('at' in step) {
            p.i--;
            this.next(a);
          } else this.next(a);
        }
      }
    }
  }

  /** Where slot `k` of lane `l` stands: two abreast, rows back from the head. */
  private slot(l: number, k: number): XY {
    const [w, e] = QUEUE_LANES[l];
    const cx = (w + e) / 2;
    return [cx + (k % 2 ? 0.55 : -0.55), QUEUE_HEAD_Z + Math.floor(k / 2) * QUEUE_ROW];
  }

  /** Begin: the queues and the waiting already there, the organisers at their places. */
  private start(now: Date): void {
    this.active = true;
    this.turnCheck = -1;
    this.turnNow(now);
    const c = this.crowd;
    const woman = this.turn === 'women';
    this.placeOrganisers();
    for (let l = 0; l < QUEUE_LANES.length; l++) {
      for (let k = 0; k < LANE_FILL; k++) {
        const [x, z] = this.slot(l, k);
        const a = this.recruit(x, z, woman, 10_000);
        if (a < 0) break;
        c.px[a] = x;
        c.pz[a] = z;
        c.vx[a] = c.vz[a] = 0;
        c.heading[a] = -Math.PI / 2;
        c.steer(a, x, z, 0.62);
        this.lanes[l].push(a);
      }
      this.nextRelease[l] = this.t + 2 + this.rnd() * 6;
    }
    for (let k = 0; k < 12; k++) {
      const a = this.recruit(HOLD_CENTRE[0], HOLD_CENTRE[1], woman, 10_000);
      if (a < 0) break;
      if (!c.place(a, HOLD_CENTRE[0] + (this.rnd() * 2 - 1) * HOLD_HALF[0], HOLD_CENTRE[1] + (this.rnd() * 2 - 1) * HOLD_HALF[1])) continue;
      this.plan(a, [{ join: 'hold' }]);
    }
    this.nextBatch = this.t + 20 + this.rnd() * 20;
    // The greeting already under way: men along the way in, and out.
    for (let k = 0; k < 18; k++) this.salamAt(this.rnd() < 0.55 ? 'in' : 'out');
    this.nextSalam = this.t;
    this.nextFuneral = this.t + 60 + this.rnd() * 60;
    this.secondFuneral = Number.POSITIVE_INFINITY;
  }

  /** The checkers and the organisers by Gate 37: standing, of the turn's sex, facing their work. */
  private placeOrganisers(): void {
    const c = this.crowd;
    for (const a of this.organisers) c.free(a);
    this.organisers = [];
    const woman = this.turn === 'women';
    const spots: [XY, number][] = [...QUEUE_CHECKERS.map((p): [XY, number] => [p, Math.PI / 2]), ...HOLD_ORGANISERS.map((p): [XY, number] => [p, -Math.PI / 2])];
    for (const [[x, z], heading] of spots) {
      const a = this.recruit(x, z, woman, 10_000);
      if (a < 0) break;
      c.mode[a] = FIXED;
      c.px[a] = x;
      c.pz[a] = z;
      c.vx[a] = c.vz[a] = 0;
      c.heading[a] = heading;
      this.organisers.push(a);
    }
  }

  /** A man on the greeting's way, somewhere along it (at start), or (`fresh`) from nearby. */
  private salamAt(part: 'in' | 'out' | 'fresh'): void {
    const c = this.crowd;
    if (part === 'fresh') {
      const [x, z] = SALAM_IN[0];
      const a = this.recruit(x, z, false, 90);
      if (a < 0) return;
      this.salam.add(a);
      this.plan(a, this.salamSteps(0));
      return;
    }
    const way = part === 'in' ? SALAM_IN : [SALAM_OUT_AT, ...SALAM_OUT];
    const leg = Math.floor(this.rnd() * (way.length - 1));
    const f = this.rnd();
    const x = way[leg][0] + (way[leg + 1][0] - way[leg][0]) * f;
    const z = way[leg][1] + (way[leg + 1][1] - way[leg][1]) * f;
    const a = this.recruit(x, z, false, 10_000);
    if (a < 0 || !c.place(a, x, z)) return;
    this.salam.add(a);
    this.plan(a, part === 'in' ? this.salamSteps(leg + 1) : this.salamOutSteps(leg));
  }

  private salamSteps(from: number): Step[] {
    return [...this.g.salamIn.slice(from).map((via) => ({ via })), { hide: 50 + this.rnd() * 40 }, { at: SALAM_OUT_AT }, ...this.salamOutSteps(0)];
  }

  private salamOutSteps(from: number): Step[] {
    return [...this.g.salamOut.slice(from).map((via) => ({ via })), { done: true }];
  }

  /** Each frame: the lanes, the waiting, the batches, the greeting and the funerals. */
  update(dt: number, now: Date, near: boolean): void {
    if (!near) {
      if (this.active) this.stop();
      return;
    }
    if (!this.active) this.start(now);
    this.t += dt;
    const c = this.crowd;
    const was = this.turn;
    this.turnNow(now);
    if (this.turn !== was) this.placeOrganisers();
    const woman = this.turn === 'women';
    this.advancePlans();

    // The queues.
    for (let l = 0; l < QUEUE_LANES.length; l++) {
      const lane = this.lanes[l];
      // Those who reached the lane's mouth take their place in it.
      const coming = this.coming[l];
      for (let k = coming.length - 1; k >= 0; k--) {
        const a = coming[k];
        if (c.mode[a] !== LED) {
          coming.splice(k, 1);
          continue;
        }
        const lost = this.t - (this.setOut.get(a) ?? this.t) > 100;
        if (!c.arrived[a] && !lost) continue;
        coming.splice(k, 1);
        this.setOut.delete(a);
        // In at the lane's mouth, or (lost, or come to a stop elsewhere) back to the crowd.
        const [gx, gz] = c.goalPoint(this.g.entry[l]);
        if (!lost && c.pz[a] > QUEUE_MOUTH_Z && Math.hypot(c.px[a] - gx, c.pz[a] - gz) < 6) lane.push(a);
        else c.free(a);
      }
      lane.forEach((a, k) => {
        const [x, z] = this.slot(l, k);
        // Into the lane at its mouth, straight between the rails, then up to its place.
        if (c.pz[a] > QUEUE_MOUTH_Z - 0.5 && Math.abs(c.px[a] - x) > 0.4) c.steer(a, x, QUEUE_MOUTH_Z + 1, 0.62);
        else c.steer(a, x, z, 0.62);
      });
      // The checker lets the first through, when there is room to wait before Gate 37.
      const head = lane[0];
      if (head !== undefined && this.t >= this.nextRelease[l] && this.hold.length < HOLD_MAX) {
        const [x, z] = this.slot(l, 0);
        if (Math.hypot(c.px[head] - x, c.pz[head] - z) < 0.9) {
          lane.shift();
          this.plan(head, [{ go: [x, QUEUE_OUT_Z] }, { via: this.g.hold }, { join: 'hold' }]);
          this.nextRelease[l] = this.t + 8 + this.rnd() * 5;
        }
      }
      // Others of the turn's sex come to the lane's end.
      // (More set out than are missing: the way to the lane takes a minute or more.)
      if (lane.length < LANE_FILL && lane.length + coming.length < LANE_FILL + 6 && this.t >= this.nextJoin[l]) {
        const [w, e] = QUEUE_LANES[l];
        const a = this.recruit((w + e) / 2, QUEUE_ENTRY_Z, woman, 90);
        if (a >= 0) {
          c.lead(a, this.g.entry[l]);
          coming.push(a);
          this.setOut.set(a, this.t);
        }
        this.nextJoin[l] = this.t + 1.5 + this.rnd() * 2;
      }
    }

    // A batch from before Gate 37 into the Rawdah through Gate 39, out of Gate 2 a while later.
    if (this.t >= this.nextBatch) {
      const batch = this.hold.splice(0, BATCH_MAX);
      for (const a of batch) this.plan(a, [{ via: this.g.rawdahIn }, { hide: 40 + this.rnd() * 40 }, { at: RAWDAH_OUT }, { via: this.g.away }, { done: true }]);
      this.nextBatch = this.t + 35 + this.rnd() * 10;
    }

    // The greeting.
    if (this.t >= this.nextSalam) {
      if (this.salam.size < SALAM_MAX) this.salamAt('fresh');
      this.nextSalam = this.t + SALAM_EVERY * (0.6 + this.rnd() * 0.8);
    }

    // Funerals: now and then, sometimes two together.
    if (this.t >= this.nextFuneral) {
      this.startFuneral();
      this.nextFuneral = this.t + 240 + this.rnd() * 240;
      if (this.rnd() < 0.3) this.secondFuneral = this.t + 20 + this.rnd() * 10;
    }
    if (this.t >= this.secondFuneral) {
      this.secondFuneral = Number.POSITIVE_INFINITY;
      this.startFuneral();
    }
    for (const f of [...this.funerals]) this.carry(f, dt);
  }

  /** The point at distance s along a funeral's way: x, z, heading. */
  private along(f: Funeral, s: number): [number, number, number] {
    const { path, at } = f;
    const end = at[at.length - 1];
    const q = Math.max(0, Math.min(end, s));
    let k = 1;
    while (k < at.length - 1 && at[k] < q) k++;
    const [ax, az] = path[k - 1];
    const [bx, bz] = path[k];
    const span = at[k] - at[k - 1] || 1;
    const u = (q - at[k - 1]) / span;
    return [ax + (bx - ax) * u, az + (bz - az) * u, Math.atan2(bz - az, bx - ax)];
  }

  private startFuneral(): void {
    const c = this.crowd;
    // The way, through the walkable cells from point to point, smoothed.
    let path: XY[] = [FUNERAL_WAY[0]];
    for (let k = 1; k < FUNERAL_WAY.length; k++) {
      const [x, z] = path[path.length - 1];
      const leg = c.route(x, z, this.g.funeral[k]);
      path.push(...leg.slice(1));
    }
    path.push(FUNERAL_WAY[FUNERAL_WAY.length - 1]);
    for (let r = 0; r < 3; r++) {
      const next: XY[] = [path[0]];
      for (let k = 0; k + 1 < path.length; k++) {
        const [ax, az] = path[k];
        const [bx, bz] = path[k + 1];
        next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
      next.push(path[path.length - 1]);
      path = next;
    }
    const at = [0];
    for (let k = 1; k < path.length; k++) at.push(at[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
    const f: Funeral = { path, at, s: 6, carriers: [], followers: [] };
    const [sx, sz] = path[0];
    for (let k = 0; k < 4; k++) {
      const a = this.recruit(sx, sz, false, 10_000);
      if (a < 0) break;
      c.mode[a] = FIXED;
      f.carriers.push(a);
    }
    if (f.carriers.length < 4) {
      for (const a of f.carriers) c.free(a);
      return;
    }
    for (let k = 0; k < FOLLOWERS; k++) {
      const a = this.recruit(sx, sz, false, 10_000);
      if (a < 0) break;
      const [x, z] = this.followerSpot(f, k);
      if (!c.place(a, x, z)) continue;
      c.steer(a, x, z, 0.7);
      c.pref[a] = 1.3;
      f.followers.push(a);
    }
    this.funeralsStarted++;
    this.funerals.push(f);
    this.carry(f, 0);
  }

  /** Where follower k walks: in rows of three behind the bier. */
  private followerSpot(f: Funeral, k: number): XY {
    const [x, z, h] = this.along(f, f.s - 2.4 - Math.floor(k / 3) * 1.0);
    const side = ((k % 3) - 1) * 0.75;
    return [x - Math.sin(h) * side, z + Math.cos(h) * side];
  }

  /** On along the way: the four under the bier, the men behind; at the end, all go in. */
  private carry(f: Funeral, dt: number): void {
    const c = this.crowd;
    const end = f.at[f.at.length - 1];
    f.s += FUNERAL_SPEED * dt;
    if (f.s >= end) {
      for (const a of [...f.carriers, ...f.followers]) {
        c.hide(a);
        c.free(a);
      }
      this.funerals.splice(this.funerals.indexOf(f), 1);
      return;
    }
    f.carriers.forEach((a, k) => {
      const along = k < 2 ? 0.75 : -0.75;
      const side = k % 2 ? 0.42 : -0.42;
      const [x, z, h] = this.along(f, f.s + along);
      c.px[a] = x - Math.sin(h) * side;
      c.pz[a] = z + Math.cos(h) * side;
      c.heading[a] = h;
      c.phase[a] = (c.phase[a] + (FUNERAL_SPEED / 0.7) * Math.PI * dt) % (Math.PI * 2);
    });
    f.followers.forEach((a, k) => {
      if (c.mode[a] !== STEERED) return;
      const [x, z] = this.followerSpot(f, k);
      c.steer(a, x, z, 0.7);
    });
  }

  /** The view has gone elsewhere: everyone back to the crowd. */
  private stop(): void {
    const c = this.crowd;
    this.active = false;
    for (let a = 0; a < c.n; a++) {
      if (c.mode[a] === FREE) continue;
      if (c.mode[a] === HIDDEN) c.px[a] = Number.NaN;
      c.pref[a] = Math.min(c.pref[a], 1.5);
      c.free(a);
    }
    this.plans.clear();
    this.lanes = QUEUE_LANES.map(() => []);
    this.coming = QUEUE_LANES.map(() => []);
    this.setOut.clear();
    this.hold = [];
    this.organisers = [];
    this.salam.clear();
    this.funerals = [];
  }
}
