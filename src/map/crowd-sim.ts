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
}

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
  /** 1 where a person may stand. */
  readonly walk: Uint8Array;
  private readonly fw: number;
  private readonly fh: number;
  private readonly flowWalk: Uint8Array;
  private readonly fields: (Uint16Array | null)[];
  private readonly goalCells: number[];
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
  private readonly rnd: () => number;
  private fieldsThisStep = 0;

  constructor(input: CrowdInput, count: number, seed = 7) {
    this.rnd = random(seed);
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
    for (let k = 0; k < w * h; k++) this.walk[k] = W[k] && (!B[k] || O[k]) && !S[k] ? 1 : 0;
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
    this.flowWalk = new Uint8Array(this.fw * this.fh);
    for (let fj = 0; fj < this.fh; fj++) {
      for (let fi = 0; fi < this.fw; fi++) {
        let s = 0;
        for (let j = 0; j < FLOW; j++) for (let i = 0; i < FLOW; i++) s += this.walk[(fj * FLOW + j) * w + fi * FLOW + i];
        this.flowWalk[fj * this.fw + fi] = s >= (FLOW * FLOW) / 2 ? 1 : 0;
      }
    }
    this.goalCells = [];
    for (const [gx, gz] of input.goals) {
      const c = this.nearestFlowCell(gx, gz, 15);
      if (c >= 0 && !this.goalCells.includes(c)) this.goalCells.push(c);
    }
    this.fields = this.goalCells.map(() => null);

    this.n = count;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vz = new Float64Array(count);
    this.pref = new Float32Array(count);
    this.heading = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.goal = new Int16Array(count);
    for (let a = 0; a < count; a++) this.spawn(a);
  }

  private colKey(x: number, z: number): number {
    return Math.floor(x / 4) * 100003 + Math.floor(z / 4);
  }

  /** May a walker's body stand at x, z? */
  standable(x: number, z: number): boolean {
    for (const [dx, dz] of [
      [0, 0],
      [BODY_R, 0],
      [-BODY_R, 0],
      [0, BODY_R],
      [0, -BODY_R],
    ]) {
      const i = Math.floor((x + dx - this.x0) / CELL);
      const j = Math.floor((z + dz - this.z0) / CELL);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h || !this.walk[j * this.w + i]) return false;
    }
    return true;
  }

  private nearestFlowCell(x: number, z: number, radius: number): number {
    const ci = Math.floor((x - this.x0) / (CELL * FLOW));
    const cj = Math.floor((z - this.z0) / (CELL * FLOW));
    for (let r = 0; r <= radius; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.fw || j >= this.fh) continue;
          if (this.flowWalk[j * this.fw + i]) return j * this.fw + i;
        }
      }
    }
    return -1;
  }

  /** The walking distance (in 2 m cells) to goal `g` from every cell, computed once when first asked. */
  private field(g: number): Uint16Array | null {
    const ready = this.fields[g];
    if (ready) return ready;
    // At most two a step, so a crowd starting out never stalls a frame.
    if (this.fieldsThisStep >= 2) return null;
    this.fieldsThisStep++;
    const { fw, fh, flowWalk } = this;
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
    this.fields[g] = d;
    return d;
  }

  private spawn(a: number): void {
    for (let tries = 0; tries < 400; tries++) {
      const x = this.x0 + this.rnd() * this.w * CELL;
      const z = this.z0 + this.rnd() * this.h * CELL;
      if (!this.standable(x, z)) continue;
      let clear = true;
      for (let b = 0; b < a && clear; b++) clear = (this.px[b] - x) ** 2 + (this.pz[b] - z) ** 2 > 0.9 * 0.9;
      if (!clear) continue;
      this.px[a] = x;
      this.pz[a] = z;
      this.pref[a] = 1.1 + this.rnd() * 0.4;
      this.heading[a] = this.rnd() * Math.PI * 2;
      this.phase[a] = this.rnd() * Math.PI * 2;
      this.goal[a] = this.goalCells.length ? Math.floor(this.rnd() * this.goalCells.length) : -1;
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
      const dx = this.px[a] - cx;
      const dz = this.pz[a] - cz;
      if (!Number.isNaN(this.px[a]) && dx * dx + dz * dz <= far) continue;
      for (let tries = 0; tries < 60; tries++) {
        const ang = this.rnd() * Math.PI * 2;
        const rad = Math.sqrt(inner * inner + this.rnd() * (r * r - inner * inner));
        const x = cx + Math.cos(ang) * rad;
        const z = cz + Math.sin(ang) * rad;
        if (!this.standable(x, z)) continue;
        let clear = true;
        for (let b = 0; b < this.n && clear; b++) clear = b === a || (this.px[b] - x) ** 2 + (this.pz[b] - z) ** 2 > 0.81;
        if (!clear) continue;
        this.px[a] = x;
        this.pz[a] = z;
        this.vx[a] = this.vz[a] = 0;
        this.goal[a] = this.goalCells.length ? Math.floor(this.rnd() * this.goalCells.length) : -1;
        break;
      }
    }
  }

  /** Where the way leads from x, z toward the walker's goal: a unit direction, or null. */
  private way(a: number, x: number, z: number): [number, number] | null {
    const g = this.goal[a];
    if (g < 0) return null;
    const d = this.field(g);
    if (!d) return null;
    const { fw, fh } = this;
    const size = CELL * FLOW;
    let i = Math.floor((x - this.x0) / size);
    let j = Math.floor((z - this.z0) / size);
    if (i < 0 || j < 0 || i >= fw || j >= fh) return null;
    const here = d[j * fw + i];
    if (here <= 1) {
      // Arrived: on to another gate.
      this.goal[a] = Math.floor(this.rnd() * this.goalCells.length);
      return null;
    }
    // Two steps down the field, toward the centre of the cell two ahead: smoother than one.
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
    }
    if (here === UNREACHED) {
      this.goal[a] = Math.floor(this.rnd() * this.goalCells.length);
      return null;
    }
    const tx = this.x0 + (i + 0.5) * size - x;
    const tz = this.z0 + (j + 0.5) * size - z;
    const len = Math.hypot(tx, tz);
    return len > 1e-3 ? [tx / len, tz / len] : null;
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
      if (Number.isNaN(px[a])) continue;
      const x = px[a];
      const z = pz[a];
      const sp = Math.hypot(vx[a], vz[a]);
      const way = this.way(a, x, z);
      let dx = way ? way[0] : sp > 0.05 ? vx[a] / sp : Math.cos(this.heading[a]);
      let dz = way ? way[1] : sp > 0.05 ? vz[a] / sp : Math.sin(this.heading[a]);
      let fx = 0;
      let fz = 0;
      let crowd = 1;
      near(a, 2.2, others);
      for (const o of others) {
        const rx = px[o] - x;
        const rz = pz[o] - z;
        const dist = Math.hypot(rx, rz) || 1e-3;
        if (dist > 2.2) continue;
        // Keep a personal space.
        if (dist < 1.0) {
          const k = ((1.0 - dist) / dist) * 2.2;
          fx -= rx * k;
          fz -= rz * k;
        }
        // Someone ahead in the way: step to one's right (all the same side, as people do), and slow.
        const ahead = (rx * dx + rz * dz) / dist;
        if (ahead > 0.6) {
          const lateral = rx * -dz + rz * dx;
          const side = Math.abs(lateral) < 0.15 ? 1 : -Math.sign(lateral);
          const k = ((2.2 - dist) / 2.2) * 0.9;
          fx += -dz * side * k;
          fz += dx * side * k;
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
      const want = this.pref[a] * crowd * (way || sp > 0.05 ? 1 : 0);
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
      if (!this.standable(nx, nz)) {
        // Slide along the edge, or stop and look for the way again.
        if (this.standable(nx, z)) {
          nz = z;
          vz[a] = 0;
        } else if (this.standable(x, nz)) {
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
        if (this.standable(px[a] - ux * push, pz[a] - uz * push)) {
          px[a] -= ux * push;
          pz[a] -= uz * push;
        }
        if (this.standable(px[o] + ux * push, pz[o] + uz * push)) {
          px[o] += ux * push;
          pz[o] += uz * push;
        }
      }
    }
  }
}
