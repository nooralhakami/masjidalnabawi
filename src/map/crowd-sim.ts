/**
 * People walking in the courtyards (owner, 2026-11-06): where they may walk, the way to where they
 * go, and how they keep clear of one another, of the restroom blocks and of the canopy columns.
 * In the models' metres (x east, z south); no WebGL here, so it can be tested on its own.
 *
 * - The ground: a 0.5 m grid. Walkable inside the plazas, not on the prayer carpets, the Mosque or
 *   the restroom blocks; the walkways in front of the blocks are walkable again; around each column
 *   a disc is kept clear.
 * - The way: from each goal (a gate), the walking distance over a 2 m grid; a walker goes down it,
 *   so it follows the corridors and walkways and never cuts across the carpets.
 * - Keeping clear: each walker keeps its distance from the others near it, steps aside for one in
 *   its way, slows in a crowd, and turns gently (limited acceleration); what overlap is left after a
 *   step is pushed apart, and no step lands off the walkable ground.
 */

export type XY = readonly [number, number];

export interface CrowdInput {
  /** Where people may walk (the plazas). */
  walkable: readonly (readonly XY[])[];
  /** Where they may not (carpets, buildings), unless also in `open`. */
  blocked: readonly (readonly XY[])[];
  /** Cut back out of `blocked` (the restrooms' walkways, the owner's cleared corridors). */
  open: readonly (readonly XY[])[];
  /** Never walkable, whatever `open` says: buildings (the Mosque, the restroom blocks). */
  solid?: readonly (readonly XY[])[];
  /** The canopy and lamp columns. */
  columns: readonly XY[];
  /** Where people walk to: the gates. */
  goals: readonly XY[];
  /**
   * For women only (owner, 2026-11-07): men never stand here; women come and go through the
   * gaps left between the `fences`.
   */
  womenOnly?: readonly (readonly XY[])[];
  /** Thin barriers (polylines): no one crosses them, and the way never leads through them. */
  fences?: readonly (readonly XY[])[];
  /** Where women also walk to, inside their areas. */
  womenGoals?: readonly XY[];
  /** Only for those led there (the Rawdah's queue lanes, owner 2026-11-08): no one free walks in. */
  reserved?: readonly (readonly XY[])[];
}

/**
 * What moves a walker (the flows round the Rawdah, owner 2026-11-08): free (its own way between the
 * gates), led to a goal down its flow field (`arrived` is set there), steered straight to a point
 * (`tx`, `tz`) where it stops, placed by hand (not moved here, nor pushed), or hidden (inside the
 * Mosque).
 */
export const FREE = 0;
export const LED = 1;
export const STEERED = 2;
export const FIXED = 3;
export const HIDDEN = 4;

/** How far men keep from the women's areas when placed (fewer men about them, owner 2026-11-07). */
const MEN_CLEAR = 14;
/** Half a fence's width (it stands about 0.15 m thick), so a walker's body stops at it. */
const FENCE_R = 0.2;

export const CELL = 0.5;
const FLOW = 4; // occupancy cells to a flow cell: 2 m
export const BODY_R = 0.27;
export const COLUMN_R = 0.95;
const UNREACHED = 0xffff;

/** A small seeded random generator, so a crowd is the same each time it is built. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Fill the cells of `grid` whose centres lie inside `ring` with `value` (scanline). */
function raster(grid: Uint8Array, w: number, h: number, x0: number, z0: number, ring: readonly XY[], value: number): void {
  const zs = ring.map((p) => p[1]);
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / CELL));
  const j1 = Math.min(h - 1, Math.ceil((Math.max(...zs) - z0) / CELL));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const z = z0 + (j + 0.5) * CELL;
    xs.length = 0;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [ax, az] = ring[a];
      const [bx, bz] = ring[b];
      if (az > z !== bz > z) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL - 0.5));
      const i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * w + i] = value;
    }
  }
}

export class Crowd {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  /** 1 where anyone may stand, 2 where only women may, 3 only one led there, 0 nowhere. */
  readonly walk: Uint8Array;
  /** 1 for a woman, per walker. */
  readonly woman: Uint8Array;
  private readonly fw: number;
  private readonly fh: number;
  /** The way for women (0) and for men (1): 2 m cells one may walk through. */
  private readonly flowWalk: [Uint8Array, Uint8Array];
  private readonly fields: [(Uint16Array | null)[], (Uint16Array | null)[]];
  private readonly goalCells: number[];
  /** The goals a man may walk to, and those in the women's areas. */
  private readonly menGoals: number[];
  private readonly womenGoals: number[];
  /** 2 m cells within MEN_CLEAR of a women's area. */
  private readonly nearWomen: Uint8Array;
  private readonly columns: readonly XY[];
  private readonly colHash = new Map<number, number[]>();

  readonly n: number;
  /** Per walker: position and velocity (64-bit: a 32-bit position could round over a cell's edge), preferred speed, heading, gait phase, goal. */
  readonly px: Float64Array;
  readonly pz: Float64Array;
  readonly vx: Float64Array;
  readonly vz: Float64Array;
  readonly pref: Float32Array;
  readonly heading: Float32Array;
  readonly phase: Float32Array;
  readonly goal: Int16Array;
  /** Per walker: FREE, LED, STEERED, FIXED or HIDDEN; arrived (LED), its point (STEERED), its personal space. */
  readonly mode: Uint8Array;
  readonly arrived: Uint8Array;
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  readonly space: Float32Array;
  private readonly rnd: () => number;
  private fieldsThisStep = 0;

  constructor(input: CrowdInput, count: number, seed = 7, women?: ArrayLike<number>) {
    this.rnd = random(seed);
    this.woman = new Uint8Array(count);
    if (women) for (let a = 0; a < count; a++) this.woman[a] = women[a] ? 1 : 0;
    const all = input.walkable.flat();
    const xs = all.map((p) => p[0]);
    const zs = all.map((p) => p[1]);
    this.x0 = Math.min(...xs) - 2;
    this.z0 = Math.min(...zs) - 2;
    this.w = Math.ceil((Math.max(...xs) + 2 - this.x0) / CELL / FLOW) * FLOW;
    this.h = Math.ceil((Math.max(...zs) + 2 - this.z0) / CELL / FLOW) * FLOW;
    const { w, h, x0, z0 } = this;
    const W = new Uint8Array(w * h);
    const B = new Uint8Array(w * h);
    const O = new Uint8Array(w * h);
    for (const r of input.walkable) raster(W, w, h, x0, z0, r, 1);
    for (const r of input.blocked) raster(B, w, h, x0, z0, r, 1);
    for (const r of input.open) raster(O, w, h, x0, z0, r, 1);
    const S = new Uint8Array(w * h);
    for (const r of input.solid ?? []) raster(S, w, h, x0, z0, r, 1);
    this.walk = new Uint8Array(w * h);
    const F = new Uint8Array(w * h);
    for (const r of input.womenOnly ?? []) raster(F, w, h, x0, z0, r, 1);
    for (const r of input.reserved ?? []) raster(F, w, h, x0, z0, r, 3);
    for (let k = 0; k < w * h; k++) this.walk[k] = W[k] && (!B[k] || O[k]) && !S[k] ? (F[k] === 3 ? 3 : F[k] ? 2 : 1) : 0;
    // The fences: every cell whose centre is within FENCE_R of one is closed.
    const fenceCells: number[] = [];
    for (const line of input.fences ?? []) {
      for (let q = 0; q + 1 < line.length; q++) {
        const [ax, az] = line[q];
        const [bx, bz] = line[q + 1];
        const lx = bx - ax;
        const lz = bz - az;
        const ll = lx * lx + lz * lz || 1e-9;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - FENCE_R - x0) / CELL));
        const i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx) + FENCE_R - x0) / CELL));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - FENCE_R - z0) / CELL));
        const j1 = Math.min(h - 1, Math.floor((Math.max(az, bz) + FENCE_R - z0) / CELL));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const cx = x0 + (i + 0.5) * CELL;
            const cz = z0 + (j + 0.5) * CELL;
            const t = Math.max(0, Math.min(1, ((cx - ax) * lx + (cz - az) * lz) / ll));
            if (Math.hypot(cx - ax - t * lx, cz - az - t * lz) <= FENCE_R + CELL / 2) {
              this.walk[j * w + i] = 0;
              fenceCells.push(j * w + i);
            }
          }
        }
      }
    }
    // A clear disc round each column (its body plus a walker's).
    this.columns = input.columns;
    const reach = COLUMN_R + BODY_R;
    for (const [cx, cz] of input.columns) {
      const i0 = Math.floor((cx - reach - x0) / CELL);
      const j0 = Math.floor((cz - reach - z0) / CELL);
      for (let j = j0; j <= j0 + Math.ceil((2 * reach) / CELL) + 1; j++) {
        for (let i = i0; i <= i0 + Math.ceil((2 * reach) / CELL) + 1; i++) {
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const dx = x0 + (i + 0.5) * CELL - cx;
          const dz = z0 + (j + 0.5) * CELL - cz;
          if (dx * dx + dz * dz < reach * reach) this.walk[j * w + i] = 0;
        }
      }
    }
    input.columns.forEach(([cx, cz], k) => {
      const key = this.colKey(cx, cz);
      const list = this.colHash.get(key) ?? [];
      list.push(k);
      this.colHash.set(key, list);
    });

    // The way: a 2 m cell is walkable when most of it is.
    this.fw = w / FLOW;
    this.fh = h / FLOW;
    const forWomen = new Uint8Array(this.fw * this.fh);
    const forMen = new Uint8Array(this.fw * this.fh);
    const zone = new Uint8Array(this.fw * this.fh);
    for (let fj = 0; fj < this.fh; fj++) {
      for (let fi = 0; fi < this.fw; fi++) {
        let all = 0;
        let men = 0;
        let only = 0;
        for (let j = 0; j < FLOW; j++) {
          for (let i = 0; i < FLOW; i++) {
            const v = this.walk[(fj * FLOW + j) * w + fi * FLOW + i];
            if (v === 1 || v === 2) all++;
            if (v === 1) men++;
            if (v === 2) only++;
          }
        }
        const c = fj * this.fw + fi;
        forWomen[c] = all >= (FLOW * FLOW) / 2 ? 1 : 0;
        // A man's way keeps off any 2 m cell that touches a women's area, so it never leads him
        // along its edge to push at it (the crush by block 215, owner 2026-11-07).
        forMen[c] = men >= (FLOW * FLOW) / 2 && only === 0 ? 1 : 0;
        zone[c] = only > 0 ? 1 : 0;
      }
    }
    // The way never leads through a fence, however thin.
    for (const k of fenceCells) {
      const i = k % w;
      const c = Math.floor((k - i) / w / FLOW) * this.fw + Math.floor(i / FLOW);
      forWomen[c] = forMen[c] = 0;
    }
    this.flowWalk = [forWomen, forMen];
    // Within MEN_CLEAR of the women's areas (a spread over the 2 m cells).
    this.nearWomen = zone.slice();
    for (let r = 0; r < Math.ceil(MEN_CLEAR / (CELL * FLOW)); r++) {
      const next = this.nearWomen.slice();
      for (let c = 0; c < next.length; c++) {
        if (this.nearWomen[c]) continue;
        const i = c % this.fw;
        if ((i > 0 && this.nearWomen[c - 1]) || (i < this.fw - 1 && this.nearWomen[c + 1]) || this.nearWomen[c - this.fw] || this.nearWomen[c + this.fw]) next[c] = 1;
      }
      this.nearWomen = next;
    }
    this.goalCells = [];
    this.menGoals = [];
    this.womenGoals = [];
    const addGoal = ([gx, gz]: XY, womens: boolean) => {
      // A women's goal stays inside their areas (snapped to the nearest cell there, never out to a
      // corridor beside them, where the women would gather).
      const c = womens ? this.nearestFlowCell(gx, gz, 15, (k) => zone[k] === 1) : this.nearestFlowCell(gx, gz, 15);
      if (c < 0) return;
      let g = this.goalCells.indexOf(c);
      if (g < 0) {
        g = this.goalCells.length;
        this.goalCells.push(c);
        if (forMen[c]) this.menGoals.push(g);
      }
      if ((womens || zone[c]) && !this.womenGoals.includes(g)) this.womenGoals.push(g);
    };
    for (const p of input.goals) addGoal(p, false);
    for (const p of input.womenGoals ?? []) addGoal(p, true);
    this.fields = [this.goalCells.map(() => null), this.goalCells.map(() => null)];

    this.n = count;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vz = new Float64Array(count);
    this.pref = new Float32Array(count);
    this.heading = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.goal = new Int16Array(count);
    this.mode = new Uint8Array(count);
    this.arrived = new Uint8Array(count);
    this.tx = new Float64Array(count);
    this.tz = new Float64Array(count);
    this.space = new Float32Array(count).fill(1);
    for (let a = 0; a < count; a++) this.spawn(a);
  }

  private colKey(x: number, z: number): number {
    return Math.floor(x / 4) * 100003 + Math.floor(z / 4);
  }

  /**
   * May a walker's body stand at x, z? A man (`man`) not in the women's areas; a free walker
   * (`free`) not in the reserved lanes.
   */
  standable(x: number, z: number, man = false, free = false): boolean {
    for (const [dx, dz] of [
      [0, 0],
      [BODY_R, 0],
      [-BODY_R, 0],
      [0, BODY_R],
      [0, -BODY_R],
    ]) {
      const i = Math.floor((x + dx - this.x0) / CELL);
      const j = Math.floor((z + dz - this.z0) / CELL);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
      const v = this.walk[j * this.w + i];
      if (!v || (man && v === 2) || (free && v === 3)) return false;
    }
    return true;
  }

  private nearestFlowCell(x: number, z: number, radius: number, accept: (cell: number) => boolean = () => true): number {
    const ci = Math.floor((x - this.x0) / (CELL * FLOW));
    const cj = Math.floor((z - this.z0) / (CELL * FLOW));
    for (let r = 0; r <= radius; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.fw || j >= this.fh) continue;
          if (this.flowWalk[0][j * this.fw + i] && accept(j * this.fw + i)) return j * this.fw + i;
        }
      }
    }
    return -1;
  }

  /** The walking distance (in 2 m cells) to goal `g` from every cell, computed once when first asked. */
  private field(g: number, man: number, force = false): Uint16Array | null {
    const ready = this.fields[man][g];
    if (ready) return ready;
    // At most two a step, so a crowd starting out never stalls a frame.
    if (this.fieldsThisStep >= 2 && !force) return null;
    this.fieldsThisStep++;
    const { fw, fh } = this;
    const flowWalk = this.flowWalk[man];
    const d = new Uint16Array(fw * fh).fill(UNREACHED);
    const queue = new Int32Array(fw * fh);
    let head = 0;
    let tail = 0;
    d[this.goalCells[g]] = 0;
    queue[tail++] = this.goalCells[g];
    while (head < tail) {
      const c = queue[head++];
      const i = c % fw;
      const j = (c - i) / fw;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= fw || nj >= fh) continue;
        const nc = nj * fw + ni;
        if (!flowWalk[nc] || d[nc] !== UNREACHED) continue;
        d[nc] = d[c] + 1;
        queue[tail++] = nc;
      }
    }
    this.fields[man][g] = d;
    return d;
  }

  /** Is walker `a` a man (1) or a woman (0)? */
  private man(a: number): number {
    return this.woman[a] ? 0 : 1;
  }

  /** Somewhere to walk to: a man to a gate open to him; a woman, one time in two, inside her areas. */
  private pickGoal(a: number): number {
    const list = this.woman[a] ? (this.womenGoals.length && this.rnd() < 0.5 ? this.womenGoals : this.goalCells.map((_, g) => g)) : this.menGoals;
    return list.length ? list[Math.floor(this.rnd() * list.length)] : -1;
  }

  /** Is x, z inside a women's area (`walk` 2)? */
  private inWomen(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / CELL);
    const j = Math.floor((z - this.z0) / CELL);
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 2;
  }

  /** Is x, z near a women's area? */
  private nearWomenAt(x: number, z: number): boolean {
    const size = CELL * FLOW;
    const i = Math.floor((x - this.x0) / size);
    const j = Math.floor((z - this.z0) / size);
    return i >= 0 && j >= 0 && i < this.fw && j < this.fh && this.nearWomen[j * this.fw + i] === 1;
  }

  /**
   * Would a walker be placed here? Women gather in their areas (most of those placed near one go
   * in); men mostly keep MEN_CLEAR away. `tries` grows the chance to take what is found.
   */
  private welcome(a: number, x: number, z: number, tries: number, limit: number): boolean {
    if (tries > limit * 0.75) return true;
    const near = this.nearWomenAt(x, z);
    if (!near) return true;
    if (this.woman[a]) return this.inWomen(x, z) || this.rnd() < 0.3;
    return this.rnd() < 0.15;
  }

  private spawn(a: number): void {
    for (let tries = 0; tries < 400; tries++) {
      const x = this.x0 + this.rnd() * this.w * CELL;
      const z = this.z0 + this.rnd() * this.h * CELL;
      if (!this.standable(x, z, !this.woman[a], true) || !this.welcome(a, x, z, tries, 400)) continue;
      let clear = true;
      for (let b = 0; b < a && clear; b++) clear = (this.px[b] - x) ** 2 + (this.pz[b] - z) ** 2 > 0.9 * 0.9;
      if (!clear) continue;
      this.px[a] = x;
      this.pz[a] = z;
      this.pref[a] = 1.1 + this.rnd() * 0.4;
      this.heading[a] = this.rnd() * Math.PI * 2;
      this.phase[a] = this.rnd() * Math.PI * 2;
      this.goal[a] = this.pickGoal(a);
      return;
    }
    this.px[a] = Number.NaN;
  }

  /**
   * Keep the walkers about the part of the courtyards being looked at (centre x, z, radius r): one
   * further than 1.3 r is placed again between `inner` and r from the centre (by default at the
   * edge of the view, where a newcomer is seen arriving, not appearing), clear of the others.
   */
  keepNear(cx: number, cz: number, r: number, inner = 0.7 * r): void {
    const far = (1.3 * r) ** 2;
    for (let a = 0; a < this.n; a++) {
      // Those the flows hold are theirs to place.
      if (this.mode[a] !== FREE) continue;
      const dx = this.px[a] - cx;
      const dz = this.pz[a] - cz;
      if (!Number.isNaN(this.px[a]) && dx * dx + dz * dz <= far) continue;
      for (let tries = 0; tries < 60; tries++) {
        const ang = this.rnd() * Math.PI * 2;
        const rad = Math.sqrt(inner * inner + this.rnd() * (r * r - inner * inner));
        const x = cx + Math.cos(ang) * rad;
        const z = cz + Math.sin(ang) * rad;
        if (!this.standable(x, z, !this.woman[a], true) || !this.welcome(a, x, z, tries, 60)) continue;
        let clear = true;
        for (let b = 0; b < this.n && clear; b++) clear = b === a || (this.px[b] - x) ** 2 + (this.pz[b] - z) ** 2 > 0.81;
        if (!clear) continue;
        this.px[a] = x;
        this.pz[a] = z;
        this.vx[a] = this.vz[a] = 0;
        this.goal[a] = this.pickGoal(a);
        break;
      }
    }
  }

  /** Where the way leads from x, z toward the walker's goal: a unit direction, or null. */
  private way(a: number, x: number, z: number): [number, number] | null {
    const g = this.goal[a];
    if (g < 0) return null;
    const d = this.field(g, this.man(a));
    if (!d) return null;
    const { fw, fh } = this;
    const size = CELL * FLOW;
    let i = Math.floor((x - this.x0) / size);
    let j = Math.floor((z - this.z0) / size);
    if (i < 0 || j < 0 || i >= fw || j >= fh) return null;
    const here = d[j * fw + i];
    if (here <= 1) {
      // Arrived: on to another gate, or (led) wait to be told.
      if (this.mode[a] === LED) this.arrived[a] = 1;
      else this.goal[a] = this.pickGoal(a);
      return null;
    }
    // Two steps down the field, toward the centre of the cell two ahead: smoother than one.
    const fromI = i;
    const fromJ = j;
    let oneI = i;
    let oneJ = j;
    for (let step = 0; step < 2; step++) {
      let best = d[j * fw + i];
      let bi = i;
      let bj = j;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if ((!di && !dj) || ni < 0 || nj < 0 || ni >= fw || nj >= fh) continue;
          const v = d[nj * fw + ni];
          // A diagonal only where both sides are open, so no corner is cut.
          if (di && dj && (d[j * fw + ni] === UNREACHED || d[nj * fw + i] === UNREACHED)) continue;
          if (v < best) {
            best = v;
            bi = ni;
            bj = nj;
          }
        }
      }
      if (bi === i && bj === j) break;
      i = bi;
      j = bj;
      if (step === 0) {
        oneI = i;
        oneJ = j;
      }
    }
    // Two ahead only in plain sight: round the end of a rail, the next cell, not across it.
    if (i !== oneI || j !== oneJ) {
      const ex = this.x0 + (i + 0.5) * size;
      const ez = this.z0 + (j + 0.5) * size;
      for (const f of [0.25, 0.5, 0.75]) {
        if (!this.standable(x + (ex - x) * f, z + (ez - z) * f, !this.woman[a])) {
          i = oneI;
          j = oneJ;
          break;
        }
      }
    }
    // Off the way (a cell mostly blocked, at an edge): back onto it through a neighbour; with none,
    // a free walker picks another gate, one led keeps going as it was (its flow lets it go in time).
    if (here === UNREACHED && i === fromI && j === fromJ) {
      if (this.mode[a] !== LED) this.goal[a] = this.pickGoal(a);
      return null;
    }
    const tx = this.x0 + (i + 0.5) * size - x;
    const tz = this.z0 + (j + 0.5) * size - z;
    const len = Math.hypot(tx, tz);
    return len > 1e-3 ? [tx / len, tz / len] : null;
  }

  /**
   * A goal of the flows' own (a gate's door, a waypoint), led to by its flow field but never
   * picked by a free walker; snapped to the nearest 2 m cell a man may walk.
   */
  addSpecialGoal([gx, gz]: XY): number {
    const c = this.nearestFlowCell(gx, gz, 15, (k) => this.flowWalk[1][k] === 1);
    if (c < 0) return -1;
    let g = this.goalCells.indexOf(c);
    if (g < 0) {
      g = this.goalCells.length;
      this.goalCells.push(c);
      this.fields[0].push(null);
      this.fields[1].push(null);
    }
    return g;
  }

  /** The centre of goal `g`'s cell. */
  goalPoint(g: number): XY {
    const c = this.goalCells[g];
    const i = c % this.fw;
    const j = (c - i) / this.fw;
    return [this.x0 + (i + 0.5) * CELL * FLOW, this.z0 + (j + 0.5) * CELL * FLOW];
  }

  /** The way from x, z to goal `g` for a man: the centres of the 2 m cells down its field. */
  route(x: number, z: number, g: number): XY[] {
    const d = this.field(g, 1, true);
    const { fw, fh } = this;
    const size = CELL * FLOW;
    let i = Math.floor((x - this.x0) / size);
    let j = Math.floor((z - this.z0) / size);
    const out: XY[] = [];
    if (!d || i < 0 || j < 0 || i >= fw || j >= fh) return out;
    for (let guard = 0; guard < fw * fh && d[j * fw + i] !== UNREACHED; guard++) {
      out.push([this.x0 + (i + 0.5) * size, this.z0 + (j + 0.5) * size]);
      if (d[j * fw + i] === 0) break;
      let best = d[j * fw + i];
      let bi = i;
      let bj = j;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if ((!di && !dj) || ni < 0 || nj < 0 || ni >= fw || nj >= fh) continue;
          if (di && dj && (d[j * fw + ni] === UNREACHED || d[nj * fw + i] === UNREACHED)) continue;
          if (d[nj * fw + ni] < best) {
            best = d[nj * fw + ni];
            bi = ni;
            bj = nj;
          }
        }
      }
      if (bi === i && bj === j) break;
      i = bi;
      j = bj;
    }
    return out;
  }

  /** Lead walker `a` to goal `g`. */
  lead(a: number, g: number): void {
    this.mode[a] = LED;
    this.goal[a] = g;
    this.arrived[a] = 0;
    this.space[a] = 1;
  }

  /** Steer walker `a` straight to x, z (with personal space `room`). */
  steer(a: number, x: number, z: number, room = 1): void {
    this.mode[a] = STEERED;
    this.tx[a] = x;
    this.tz[a] = z;
    this.space[a] = room;
  }

  /** Hide walker `a` (gone inside the Mosque). */
  hide(a: number): void {
    this.mode[a] = HIDDEN;
    this.px[a] = Number.NaN;
    this.vx[a] = this.vz[a] = 0;
  }

  /** Put walker `a` at the standable point nearest x, z (within a few metres); false if none. */
  place(a: number, x: number, z: number): boolean {
    for (let r = 0; r <= 6; r += 0.5) {
      for (let k = 0; k < (r ? 12 : 1); k++) {
        const ang = (k / 12) * Math.PI * 2;
        const qx = x + Math.cos(ang) * r;
        const qz = z + Math.sin(ang) * r;
        if (!this.standable(qx, qz, !this.woman[a])) continue;
        this.px[a] = qx;
        this.pz[a] = qz;
        this.vx[a] = this.vz[a] = 0;
        return true;
      }
    }
    return false;
  }

  /** Hand walker `a` back to the free crowd (placed again by `keepNear` if it cannot stay where it is). */
  free(a: number): void {
    this.mode[a] = FREE;
    this.space[a] = 1;
    this.arrived[a] = 0;
    if (!Number.isNaN(this.px[a]) && !this.standable(this.px[a], this.pz[a], !this.woman[a], true)) this.px[a] = Number.NaN;
    this.goal[a] = this.pickGoal(a);
  }

  /** Advance every walker by `dt` seconds (split into steps of at most 50 ms). */
  step(dt: number): void {
    let left = Math.min(dt, 0.25);
    while (left > 1e-4) {
      const h = Math.min(left, 0.05);
      this.substep(h);
      left -= h;
    }
  }

  private substep(dt: number): void {
    this.fieldsThisStep = 0;
    const { n, px, pz, vx, vz } = this;
    // Neighbours through a hash of 1.5 m cells.
    const HS = 1.5;
    const buckets = new Map<number, number[]>();
    const key = (x: number, z: number) => Math.floor(x / HS) * 100003 + Math.floor(z / HS);
    for (let a = 0; a < n; a++) {
      if (Number.isNaN(px[a])) continue;
      const k = key(px[a], pz[a]);
      const b = buckets.get(k);
      if (b) b.push(a);
      else buckets.set(k, [a]);
    }
    const near = (a: number, r: number, out: number[]) => {
      out.length = 0;
      const ci = Math.floor(px[a] / HS);
      const cj = Math.floor(pz[a] / HS);
      const span = Math.ceil(r / HS);
      for (let j = cj - span; j <= cj + span; j++) {
        for (let i = ci - span; i <= ci + span; i++) {
          const b = buckets.get(i * 100003 + j);
          if (b) for (const o of b) if (o !== a) out.push(o);
        }
      }
    };
    const others: number[] = [];
    for (let a = 0; a < n; a++) {
      if (Number.isNaN(px[a]) || this.mode[a] === FIXED || this.mode[a] === HIDDEN) continue;
      const x = px[a];
      const z = pz[a];
      const sp = Math.hypot(vx[a], vz[a]);
      const steered = this.mode[a] === STEERED;
      let way: [number, number] | null;
      // Steered: straight to its point, slowing over the last metre and stopping there.
      let near1 = 1;
      if (steered) {
        const ox = this.tx[a] - x;
        const oz = this.tz[a] - z;
        const od = Math.hypot(ox, oz);
        way = od > 0.2 ? [ox / od, oz / od] : null;
        near1 = Math.min(1, od);
      } else if (this.mode[a] === LED && this.arrived[a]) {
        way = null;
      } else {
        way = this.way(a, x, z);
      }
      let dx = way ? way[0] : sp > 0.05 ? vx[a] / sp : Math.cos(this.heading[a]);
      let dz = way ? way[1] : sp > 0.05 ? vz[a] / sp : Math.sin(this.heading[a]);
      let fx = 0;
      let fz = 0;
      let crowd = 1;
      const room = this.space[a];
      near(a, 2.2, others);
      for (const o of others) {
        const rx = px[o] - x;
        const rz = pz[o] - z;
        const dist = Math.hypot(rx, rz) || 1e-3;
        if (dist > 2.2) continue;
        // Keep a personal space (closer in a queue).
        if (dist < room) {
          const k = ((room - dist) / dist) * 2.2;
          fx -= rx * k;
          fz -= rz * k;
        }
        // Someone ahead in the way: step to one's right (all the same side, as people do), and slow.
        const ahead = (rx * dx + rz * dz) / dist;
        if (ahead > 0.6) {
          // One steered to a place (a queue, a gate) keeps to its line and only slows.
          if (!steered) {
            const lateral = rx * -dz + rz * dx;
            const side = Math.abs(lateral) < 0.15 ? 1 : -Math.sign(lateral);
            const k = ((2.2 - dist) / 2.2) * 0.9;
            fx += -dz * side * k;
            fz += dx * side * k;
          }
          crowd = Math.min(crowd, Math.max(0.35, (dist - 0.55) / 1.2));
        }
      }
      // Columns ahead: pass round them.
      for (let ci = -1; ci <= 1; ci++) {
        for (let cj = -1; cj <= 1; cj++) {
          const list = this.colHash.get((Math.floor(x / 4) + ci) * 100003 + Math.floor(z / 4) + cj);
          if (!list) continue;
          for (const c of list) {
            const [cx, cz] = this.columns[c];
            const rx = cx - x;
            const rz = cz - z;
            const dist = Math.hypot(rx, rz);
            const clear = dist - COLUMN_R - BODY_R;
            if (clear > 1.6) continue;
            const k = (1.6 - Math.max(0, clear)) / 1.6;
            fx -= (rx / dist) * k * 1.2;
            fz -= (rz / dist) * k * 1.2;
          }
        }
      }
      dx += fx;
      dz += fz;
      const dl = Math.hypot(dx, dz) || 1;
      const want = steered ? (way ? this.pref[a] * crowd * near1 : 0) : this.pref[a] * crowd * (way || sp > 0.05 ? 1 : 0);
      const tx = (dx / dl) * want;
      const tz = (dz / dl) * want;
      // A body gathers speed and turns over a moment, not at once.
      let ax = (tx - vx[a]) / dt;
      let az = (tz - vz[a]) / dt;
      const al = Math.hypot(ax, az);
      const maxA = 2.2;
      if (al > maxA) {
        ax *= maxA / al;
        az *= maxA / al;
      }
      vx[a] += ax * dt;
      vz[a] += az * dt;
      let nx = x + vx[a] * dt;
      let nz = z + vz[a] * dt;
      const man = !this.woman[a];
      const free = this.mode[a] === FREE;
      if (!this.standable(nx, nz, man, free)) {
        // Slide along the edge, or stop and look for the way again.
        if (this.standable(nx, z, man, free)) {
          nz = z;
          vz[a] = 0;
        } else if (this.standable(x, nz, man, free)) {
          nx = x;
          vx[a] = 0;
        } else {
          nx = x;
          nz = z;
          vx[a] = vz[a] = 0;
        }
      }
      px[a] = nx;
      pz[a] = nz;
      const s = Math.hypot(vx[a], vz[a]);
      if (s > 0.08) {
        // The body turns toward where it goes, over about a third of a second.
        const target = Math.atan2(vz[a], vx[a]);
        let diff = target - this.heading[a];
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading[a] += diff * Math.min(1, dt * 3);
      }
      // A step of about 0.7 m: the gait follows the ground covered.
      this.phase[a] = (this.phase[a] + (s / 0.7) * Math.PI * dt) % (Math.PI * 2);
    }
    // What overlap is left: push the two apart, where both may stand.
    const minD = 2 * BODY_R + 0.04;
    for (let a = 0; a < n; a++) {
      if (Number.isNaN(px[a])) continue;
      near(a, minD, others);
      for (const o of others) {
        if (o < a) continue;
        const rx = px[o] - px[a];
        const rz = pz[o] - pz[a];
        const dist = Math.hypot(rx, rz) || 1e-3;
        if (dist >= minD) continue;
        const push = (minD - dist) / 2;
        const ux = rx / dist;
        const uz = rz / dist;
        if (this.mode[a] !== FIXED && this.standable(px[a] - ux * push, pz[a] - uz * push, !this.woman[a], this.mode[a] === FREE)) {
          px[a] -= ux * push;
          pz[a] -= uz * push;
        }
        if (this.mode[o] !== FIXED && this.standable(px[o] + ux * push, pz[o] + uz * push, !this.woman[o], this.mode[o] === FREE)) {
          px[o] += ux * push;
          pz[o] += uz * push;
        }
      }
    }
  }
}
