#!/usr/bin/env node
/**
 * Builds the courtyard restroom blocks' 3D model, `public/models/haram-restroom-{a-east,a-west,
 * b-north,b-south}.glb`, from the owner's photographs (2026-11-06): white marble with four corner towers, each carrying a pair of
 * round-arched lattice windows (lit from inside at night) on a corbelled bay and a blind arch below;
 * an open middle bay on each long side behind a bronze lattice fence, under a marble lintel with a
 * dark steel soffit; a wudu counter with chrome taps and decorated panels in front of it, on a step;
 * The entrance is one short end only (owner, 2026-11-06): ordinary stairs in the left bay and an
 * escalator in the right one as seen from outside, the lift between them under a blind arch and the
 * sign. The other end has three openings closed with lattice: a tall pointed arch between two bays.
 * The four files are the same block with its entrance turned to the east, west, north or south.
 *
 * It replaces navQ's plain boxes (`haram-service-a/b.glb`) on the same footprints: a is 23 m east to
 * west, b 23 m north to south, both 14 m across, placed at the same offsets from their anchors.
 * Geometry and textures are made here, with no dependency: run `node scripts/restroom-model.mjs`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/models');

// ---------------------------------------------------------------- textures

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** An RGB PNG from a function of the pixel giving [r, g, b] in 0..1. */
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      for (let i = 0; i < 3; i++) raw[y * (w * 3 + 1) + 1 + x * 3 + i] = Math.round(Math.min(1, Math.max(0, c[i])) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Value noise that tiles over `size` pixels. */
function noise(size, cells, seed) {
  const r = rng(seed);
  const grid = Array.from({ length: cells * cells }, () => r());
  const at = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const ease = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = ease(fx - i);
    const ty = ease(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * ty;
  };
}
function fbm(size, seed) {
  const octaves = [4, 8, 16, 32].map((c, k) => noise(size, c, seed + k));
  return (x, y) => octaves.reduce((sum, n, k) => sum + n(x, y) / 2 ** k, 0) / 1.875;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const WHITE_MARBLE = [0.97, 0.965, 0.95];
const VEIN = [0.62, 0.64, 0.66];
const BRONZE = [0.46, 0.36, 0.22];

/** Carrara-like marble in panels 0.75 m wide and 1 m tall, 3 m to the texture (256 px). */
function marbleTexture() {
  const S = 256;
  const n = fbm(S, 11);
  const v = fbm(S, 23);
  const r = rng(5);
  const tone = Array.from({ length: 12 }, () => 0.97 + r() * 0.05);
  return png(S, S, (x, y) => {
    // Soft grey veins running mostly one way, faint and sparse as in Carrara.
    const t = (x / S) * 2 + (y / S) * 1 + v(x, y) * 1.6;
    const vein = (1 - Math.abs(Math.sin(t * Math.PI * 2))) ** 30 * smooth(0.45, 0.7, n(x, y));
    let c = mix(WHITE_MARBLE, VEIN, Math.min(1, vein * 0.55) + 0.06 * (n(x, y) - 0.5));
    const tile = Math.floor(x / 64) + 4 * Math.floor(y / (S / 3));
    c = c.map((k) => k * tone[tile % 12] * (0.97 + 0.03 * n(x, y)));
    const jx = Math.min(x % 64, 64 - (x % 64));
    const yy = y % (S / 3);
    const jy = Math.min(yy, S / 3 - yy);
    if (Math.min(jx, jy) < 1) c = c.map((k) => k * 0.8);
    return c;
  });
}

/** Black granite with grains, 1 m to the texture. */
function graniteTexture() {
  const r = rng(9);
  const n = fbm(64, 4);
  return png(64, 64, (x, y) => {
    const g = 0.14 + 0.05 * n(x, y) + (r() < 0.06 ? 0.12 : 0);
    return [g, g, g * 1.04];
  });
}

/** The arched lattice windows: interlaced rings, warm light behind. Fills the opening. */
function windowTexture() {
  const W = 128;
  const H = 256;
  const cell = 32;
  return png(W, H, (x, y) => {
    const lx = (x % cell) - cell / 2;
    const ly = (y % cell) - cell / 2;
    const ring = Math.abs(Math.hypot(lx, ly) - 11);
    const cx = Math.min(x % cell, cell - (x % cell));
    const cy = Math.min(y % cell, cell - (y % cell));
    const knot = Math.abs(Math.hypot(cx, cy) - 9);
    const bar = Math.min(ring, knot);
    const edge = Math.min(x, W - 1 - x, y, H - 1 - y);
    const light = mix([1, 0.95, 0.82], [0.98, 0.88, 0.7], y / H);
    const frame = [0.66, 0.6, 0.5];
    if (edge < 5) return frame;
    return mix(frame, light, smooth(1.2, 2.6, bar));
  });
}

/**
 * The bronze fence behind the counter, 4 m to the texture across and the whole 4.5 m from the
 * counter (1.5 m) to the soffit (6 m) down it: the wall inside, the spikes, then the lattice.
 */
function fenceTexture() {
  const W = 256;
  const H = 288;
  const wall = [0.86, 0.85, 0.82];
  const back = [0.8, 0.79, 0.76];
  const spikeTop = Math.round(H * 0.2);
  const rail = Math.round(H * 0.33);
  return png(W, H, (x, y) => {
    const post = Math.min(x % 128, 128 - (x % 128)) < 3;
    if (y < spikeTop) return wall.map((k) => k * (0.92 + 0.08 * (y / spikeTop)));
    if (y < rail - 3) {
      const px = (x % 12) - 6;
      const tip = (y - spikeTop) / (rail - 3 - spikeTop);
      const spike = Math.abs(px) < 0.8 + tip * 2.6 || (post && y > spikeTop - 6);
      return spike ? BRONZE : wall.map((k) => k * 0.9);
    }
    if (y < rail + 2 || y > H - 6 || post) return BRONZE.map((k) => k * 1.1);
    // Elongated hexagons: two zigzags mirrored in each 32 px column, joined where they meet.
    const cw = 32;
    const period = 40;
    const t = ((y - rail) % period) / period;
    const zig = (Math.abs(t * 2 - 1) - 0.5) * 18;
    const xm = x % cw;
    const d = Math.min(Math.abs(xm - (cw / 2 + zig)), Math.abs(xm - (cw / 2 - zig)));
    const join = Math.abs(t * 2 - 1) > 0.94 && Math.abs(xm - cw / 2) < 10;
    const shade = 0.9 + 0.1 * Math.sin((x / W) * Math.PI * 4);
    return d < 2.2 || join ? BRONZE.map((k) => k * shade) : back.map((k) => k * (0.9 + 0.1 * (1 - (y - rail) / (H - rail))));
  });
}

/** The counter's lower face: marble with bronze girih panels, 2 m across, 0.52 m tall. */
function counterTexture() {
  const W = 256;
  const H = 64;
  const n = fbm(W, 31);
  return png(W, H, (x, y) => {
    const px = x % 64;
    const inPanel = px > 7 && px < 57 && y > 6 && y < 58;
    if (!inPanel) return WHITE_MARBLE.map((k) => k * (0.94 + 0.05 * n(x, y)));
    const lx = (px - 32) / 25;
    const ly = (y - 32) / 26;
    const star = Math.min(Math.abs(Math.abs(lx) + Math.abs(ly) - 0.7), Math.abs(Math.max(Math.abs(lx), Math.abs(ly)) - 0.5));
    const grid = Math.min(Math.abs(((lx * 2 + 10) % 1) - 0.5), Math.abs(((ly * 2 + 10) % 1) - 0.5));
    const line = Math.min(star * 25, (0.5 - grid) * 60);
    return mix([0.72, 0.62, 0.42], [0.55, 0.52, 0.47], smooth(1, 2.2, line));
  });
}

/** The dark steel soffit under the lintel, with its light diagonal frame, 2 m to the texture. */
function soffitTexture() {
  const S = 128;
  return png(S, S, (x, y) => {
    const d1 = Math.abs(((x + y) % 64) - 32);
    const d2 = Math.abs(((x - y + 640) % 64) - 32);
    const beam = Math.min(x % 64, 64 - (x % 64));
    const line = Math.min(32 - d1, 32 - d2) < 1.5 || beam < 2;
    return line ? [0.42, 0.42, 0.43] : [0.1, 0.1, 0.11];
  });
}

/** The bronze zigzag lattice over a warm lit hall: the closed openings at the back end. */
function gateTexture() {
  const W = 128;
  const H = 256;
  return png(W, H, (x, y) => {
    const up = 1 - y / H;
    const hall = mix([0.78, 0.72, 0.6], [0.98, 0.93, 0.8], up);
    const xm = x % 16;
    const t = (y % 24) / 24;
    const zig = (Math.abs(t * 2 - 1) - 0.5) * 9;
    const d = Math.min(Math.abs(xm - (8 + zig)), Math.abs(xm - (8 - zig)));
    if (d < 1.2 || y < 3 || y > H - 4 || x < 3 || x > W - 4) return BRONZE;
    return hall;
  });
}

/** Looking into an open entrance bay: the lit hall above, the way down below (stairs or escalator). */
function wayDownTexture(escalator) {
  const W = 128;
  const H = 256;
  return png(W, H, (x, y) => {
    const up = 1 - y / H;
    if (up > 0.5) {
      const lamp = Math.exp(-(((x - W / 2) / 26) ** 2) - ((up - 0.86) / 0.07) ** 2);
      return mix([0.86, 0.8, 0.68], [1, 0.97, 0.88], lamp);
    }
    // Treads closing up towards the far end: a band every step, thinner as it recedes.
    const k = (0.5 - up) / 0.5;
    const step = (k * 9) ** 1.35 % 1;
    if (escalator) {
      const side = Math.abs(x - W / 2) / (W / 2);
      if (side > 0.62) return side > 0.9 ? [0.12, 0.12, 0.13] : [0.78, 0.8, 0.83];
      const groove = x % 4 < 1 ? 0.8 : 1;
      return (step < 0.18 ? [0.62, 0.62, 0.6] : [0.3, 0.3, 0.31]).map((v) => v * groove);
    }
    if (Math.abs(x - 10) < 2 || Math.abs(x - W + 10) < 2) return [0.82, 0.83, 0.86];
    return step < 0.3 ? [0.56, 0.53, 0.48] : [0.86, 0.84, 0.79];
  });
}

/** The sign over the entrance: gold, a number box, two lines of lettering and the figure. */
function signTexture() {
  const W = 256;
  const H = 64;
  const n = noise(64, 8, 41);
  return png(W, H, (x, y) => {
    const gold = [0.64, 0.48, 0.24];
    const light = [0.98, 0.95, 0.86];
    if (x < 3 || x > W - 4 || y < 3 || y > H - 4) return [0.3, 0.24, 0.14];
    if (x > 12 && x < 44 && y > 12 && y < 52) return x > 15 && x < 41 && y > 15 && y < 49 ? gold : light;
    if (x > 214 && x < 244 && y > 10 && y < 54) {
      const fx = x - 229;
      const head = Math.hypot(fx, y - 17) < 4;
      const body = Math.abs(fx) < 6 && y > 22 && y < 38;
      const legs = (Math.abs(fx - 3) < 2 || Math.abs(fx + 3) < 2) && y >= 38 && y < 50;
      return head || body || legs ? light : gold;
    }
    const line = (y > 12 && y < 28) || (y > 36 && y < 50);
    const glyph = n[(y % 64) * 64 + (Math.floor(x / 4) % 64)] > 0.48 && x > 54 && x < 204;
    return line && glyph ? light : gold;
  });
}

/** The recessed panel over the lift: a pointed blind arch cut in the marble. */
function archPanelTexture() {
  const W = 128;
  const H = 96;
  return png(W, H, (x, y) => {
    const s = Math.abs(x - W / 2) / 44;
    const apex = 14 + 46 * s ** 1.5;
    const edge = s < 1 ? Math.abs(y - apex) : 99;
    const jamb = Math.abs(s - 1) * 44 < 2 && y > 60;
    const shade = s < 1 && y > apex ? 0.86 : 0.95;
    return WHITE_MARBLE.map((k) => k * (edge < 2 || jamb ? 0.66 : shade));
  });
}

/** The corbel under each window bay: a row of small pointed arches, 0.6 m to each. */
function corbelTexture() {
  const W = 64;
  const H = 48;
  return png(W, H, (x, y) => {
    const s = Math.abs(x - W / 2) / (W / 2 - 4);
    const apex = 8 + 18 * s ** 1.6;
    const inside = s < 1 && y > apex;
    if (!inside) return WHITE_MARBLE.map((k) => k * (y < 6 ? 0.88 : 1));
    const depth = Math.min(1, (y - apex) / 18);
    return WHITE_MARBLE.map((k) => k * (0.62 + 0.22 * depth));
  });
}

// ---------------------------------------------------------------- geometry

const MATERIALS = {
  marble: { texture: marbleTexture, repeat: 3 },
  granite: { texture: graniteTexture, repeat: 1 },
  window: { texture: windowTexture },
  fence: { texture: fenceTexture },
  counter: { texture: counterTexture },
  soffit: { texture: soffitTexture, repeat: 2 },
  gate: { texture: gateTexture },
  stairs: { texture: () => wayDownTexture(false) },
  escalator: { texture: () => wayDownTexture(true) },
  sign: { texture: signTexture },
  archpanel: { texture: archPanelTexture },
  corbel: { texture: corbelTexture },
  steel: { color: [0.86, 0.87, 0.9, 1] },
  dark: { color: [0.2, 0.2, 0.21, 1] },
};

const prims = Object.fromEntries(Object.keys(MATERIALS).map((m) => [m, { pos: [], nrm: [], uv: [], idx: [] }]));

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * A flat convex polygon (local a, h, b metres) facing `normal`; its winding is turned to match, so
 * the shader's two-sided flip keeps the normal on the right side.
 */
function poly(mat, pts, uvs, normal) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) n = add(n, cross(pts[i], pts[(i + 1) % pts.length]));
  if (dot(n, normal) < 0) {
    pts = [...pts].reverse();
    uvs = [...uvs].reverse();
  }
  const p = prims[mat];
  const base = p.pos.length / 3;
  pts.forEach((q, i) => {
    p.pos.push(...q);
    p.nrm.push(...normal);
    p.uv.push(...uvs[i]);
  });
  for (let i = 1; i < pts.length - 1; i++) p.idx.push(base, base + i, base + i + 1);
}

/** World-scale UVs: the face's own across and up, in texture repeats. */
function faceUv(mat, q, normal) {
  const r = MATERIALS[mat].repeat ?? 1;
  if (Math.abs(normal[1]) > 0.5) return [q[0] / r, q[2] / r];
  const across = Math.abs(normal[0]) > 0.5 ? q[2] : q[0];
  return [across / r, -q[1] / r];
}

/** A box from min to max (a, h, b); `skip` leaves faces out, `faces` gives some another material. */
function box(mat, [a0, h0, b0], [a1, h1, b1], { skip = [], faces = {} } = {}) {
  const sides = {
    '+a': [
      [a1, h0, b0],
      [a1, h0, b1],
      [a1, h1, b1],
      [a1, h1, b0],
      [1, 0, 0],
    ],
    '-a': [
      [a0, h0, b0],
      [a0, h0, b1],
      [a0, h1, b1],
      [a0, h1, b0],
      [-1, 0, 0],
    ],
    '+b': [
      [a0, h0, b1],
      [a1, h0, b1],
      [a1, h1, b1],
      [a0, h1, b1],
      [0, 0, 1],
    ],
    '-b': [
      [a0, h0, b0],
      [a1, h0, b0],
      [a1, h1, b0],
      [a0, h1, b0],
      [0, 0, -1],
    ],
    '+h': [
      [a0, h1, b0],
      [a1, h1, b0],
      [a1, h1, b1],
      [a0, h1, b1],
      [0, 1, 0],
    ],
    '-h': [
      [a0, h0, b0],
      [a1, h0, b0],
      [a1, h0, b1],
      [a0, h0, b1],
      [0, -1, 0],
    ],
  };
  for (const [key, [p, q, r, s, n]] of Object.entries(sides)) {
    if (skip.includes(key)) continue;
    const m = faces[key] ?? mat;
    const pts = [p, q, r, s];
    poly(
      m,
      pts,
      pts.map((v) => faceUv(m, v, n)),
      n,
    );
  }
}

/** Points of an arch from its left springing to its right; k > 1 makes it pointed. */
function archCurve(c, w, spring, k, steps = 10) {
  const r = k * w;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const s = -w + w * (1 - Math.cos((Math.PI / 2) * (i / steps)));
    out.push([c + s, spring + Math.sqrt(Math.max(0, r * r - (s - (r - w)) ** 2))]);
  }
  for (let i = steps - 1; i >= 0; i--) out.push([2 * c - out[i][0], out[i][1]]);
  return out;
}

/**
 * A wall face with arched openings cut into it. The face is `origin + across * s + up * h`, facing
 * `normal`, over s0..s1 and h0..h1. Each opening is { c, w, sill, spring, k, depth, back }: its
 * reveals in the wall's material, and at its depth a panel in `back` with the texture fitted to it.
 */
function wallWithOpenings(mat, origin, across, normal, [s0, s1], [h0, h1], openings) {
  const at = (s, h, d = 0) => add(add(add(origin, mul(across, s)), [0, h, 0]), mul(normal, -d));
  const uvOf = (q) => faceUv(mat, q, normal);
  const quad = (m, pts, n) =>
    poly(
      m,
      pts,
      pts.map((q) => faceUv(m, q, n)),
      n,
    );
  const sorted = [...openings].sort((p, q) => p.c - q.c);
  let left = s0;
  for (const o of sorted) {
    quad(mat, [at(left, h0), at(o.c - o.w, h0), at(o.c - o.w, h1), at(left, h1)], normal);
    left = o.c + o.w;
    if (o.sill > h0) quad(mat, [at(o.c - o.w, h0), at(o.c + o.w, h0), at(o.c + o.w, o.sill), at(o.c - o.w, o.sill)], normal);
    const arch = archCurve(o.c, o.w, o.spring, o.k);
    for (let i = 0; i < arch.length - 1; i++) {
      const [sa, ha] = arch[i];
      const [sb, hb] = arch[i + 1];
      quad(mat, [at(sa, ha), at(sb, hb), at(sb, h1), at(sa, h1)], normal);
    }
    const outline = [[o.c - o.w, o.sill], ...arch, [o.c + o.w, o.sill]];
    const top = Math.max(...arch.map((p) => p[1]));
    const mid = [o.c, (o.sill + top) / 2];
    for (let i = 0; i < outline.length; i++) {
      const [sa, ha] = outline[i];
      const [sb, hb] = outline[(i + 1) % outline.length];
      let ns = hb - ha;
      let nh = -(sb - sa);
      if (ns * (mid[0] - sa) + nh * (mid[1] - ha) < 0) {
        ns = -ns;
        nh = -nh;
      }
      const len = Math.hypot(ns, nh) || 1;
      const n = add(mul(across, ns / len), [0, nh / len, 0]);
      const pts = [at(sa, ha), at(sb, hb), at(sb, hb, o.depth), at(sa, ha, o.depth)];
      poly(mat, pts, pts.map(uvOf), n);
    }
    const back = outline.map(([s, h]) => at(s, h, o.depth));
    const fitted = MATERIALS[o.back].repeat === undefined;
    const uvs = outline.map(([s, h], i) => (fitted ? [(s - (o.c - o.w)) / (2 * o.w), (top - h) / (top - o.sill)] : faceUv(o.back, back[i], normal)));
    poly(o.back, back, uvs, normal);
  }
  quad(mat, [at(left, h0), at(s1, h0), at(s1, h1), at(left, h1)], normal);
}

/**
 * A wall face with rectangular openings: { s0, s1, h0, h1, depth, back, top?, bottom? }. The face is
 * cut into cells along every edge, and each opening gets its reveals (`top` and `bottom` may give the
 * soffit and the floor another material) and a back panel, fitted when its texture has no repeat.
 */
function rectWall(mat, origin, across, normal, [s0, s1], [h0, h1], holes) {
  const at = (s, h, d = 0) => add(add(add(origin, mul(across, s)), [0, h, 0]), mul(normal, -d));
  const quad = (m, pts, n, uvs) => poly(m, pts, uvs ?? pts.map((q) => faceUv(m, q, n)), n);
  const cuts = (lo, hi, k0, k1) => [...new Set([lo, hi, ...holes.flatMap((o) => [o[k0], o[k1]])])].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q);
  const ss = cuts(s0, s1, 's0', 's1');
  const hs = cuts(h0, h1, 'h0', 'h1');
  for (let i = 0; i < ss.length - 1; i++) {
    for (let j = 0; j < hs.length - 1; j++) {
      const sc = (ss[i] + ss[i + 1]) / 2;
      const hc = (hs[j] + hs[j + 1]) / 2;
      if (holes.some((o) => sc > o.s0 && sc < o.s1 && hc > o.h0 && hc < o.h1)) continue;
      quad(mat, [at(ss[i], hs[j]), at(ss[i + 1], hs[j]), at(ss[i + 1], hs[j + 1]), at(ss[i], hs[j + 1])], normal);
    }
  }
  for (const o of holes) {
    const d = o.depth;
    quad(mat, [at(o.s0, o.h0), at(o.s0, o.h1), at(o.s0, o.h1, d), at(o.s0, o.h0, d)], across);
    quad(mat, [at(o.s1, o.h0), at(o.s1, o.h1), at(o.s1, o.h1, d), at(o.s1, o.h0, d)], mul(across, -1));
    quad(o.top ?? mat, [at(o.s0, o.h1), at(o.s1, o.h1), at(o.s1, o.h1, d), at(o.s0, o.h1, d)], [0, -1, 0]);
    if (o.bottom || o.h0 > h0) quad(o.bottom ?? mat, [at(o.s0, o.h0), at(o.s1, o.h0), at(o.s1, o.h0, d), at(o.s0, o.h0, d)], [0, 1, 0]);
    const back = [at(o.s0, o.h0, d), at(o.s1, o.h0, d), at(o.s1, o.h1, d), at(o.s0, o.h1, d)];
    // Fitted: u runs left to right as seen from outside (the viewer's right is -normal x up).
    const right = cross(mul(normal, -1), [0, 1, 0]);
    const flip = dot(right, across) < 0;
    const fitted = MATERIALS[o.back].repeat === undefined && MATERIALS[o.back].texture;
    const uvs = fitted
      ? [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ].map(([u, v]) => [flip ? 1 - u : u, v])
      : undefined;
    quad(o.back, back, normal, uvs);
  }
}

// Sizes in metres, from the photographs against people and the 23 x 14 m footprint.
const HALF_L = 11.5; // along the block
const CORE = 5.5; // half the width of the building; the counters reach 7
const TOWER = 3.4; // along the block
const TOWER_W = 2.0; // across it: the ends are towers, two bays and the lift pier between them
const TOWER_H = 7.6;
const END_H = 7.0;
const BAY = HALF_L - TOWER; // 8.1, where the open middle bay ends

function towers() {
  for (const sa of [-1, 1]) {
    for (const sb of [-1, 1]) {
      const a0 = sa > 0 ? BAY : -HALF_L;
      const a1 = sa > 0 ? HALF_L : -BAY;
      const b0 = sb > 0 ? CORE - TOWER_W : -CORE;
      const b1 = sb > 0 ? CORE : -(CORE - TOWER_W);
      const ac = (a0 + a1) / 2;
      const bc = (b0 + b1) / 2;
      box('marble', [a0, 0, b0], [a1, TOWER_H, b1], { skip: [sa > 0 ? '+a' : '-a', sb > 0 ? '+b' : '-b'] });
      box('granite', [a0 - 0.04, -0.2, b0 - 0.04], [a1 + 0.04, 0.35, b1 + 0.04], { skip: ['-h'] });
      // Stepped crown with its cornice.
      box('marble', [a0 - 0.1, TOWER_H, b0 - 0.1], [a1 + 0.1, TOWER_H + 0.22, b1 + 0.1]);
      box('marble', [a0 + 0.45, TOWER_H + 0.22, b0 + 0.45], [a1 - 0.45, TOWER_H + 0.95, b1 - 0.45]);
      box('marble', [a0 + 0.35, TOWER_H + 0.95, b0 + 0.35], [a1 - 0.35, TOWER_H + 1.05, b1 - 0.35]);

      // The two outer faces: a blind arch below, a corbelled bay with two lit windows above.
      // The end face is narrower than the long one; its arch and windows are scaled down to it.
      const outer = [
        { origin: [sa * HALF_L, 0, bc], across: [0, 0, 1], normal: [sa, 0, 0], f: TOWER_W / TOWER },
        { origin: [ac, 0, sb * CORE], across: [1, 0, 0], normal: [0, 0, sb], f: 1 },
      ];
      for (const { origin, across, normal, f } of outer) {
        const half = (TOWER * f) / 2;
        wallWithOpenings('marble', origin, across, normal, [-half, half], [0, TOWER_H], [{ c: 0, w: 0.62 * f, sill: 1.3, spring: 3.3, k: 1.3, depth: 0.1, back: 'marble' }]);
        const along = (s, d) => add(add(origin, mul(across, s)), mul(normal, d));
        const span = (s0, s1, d0, d1, h0, h1, opts) => {
          const p = along(s0, d0);
          const q = along(s1, d1);
          box('marble', [Math.min(p[0], q[0]), h0, Math.min(p[2], q[2])], [Math.max(p[0], q[0]), h1, Math.max(p[2], q[2])], opts);
        };
        const frontKey = normal[0] > 0 ? '+a' : normal[0] < 0 ? '-a' : normal[2] > 0 ? '+b' : '-b';
        const backKey = { '+a': '-a', '-a': '+a', '+b': '-b', '-b': '+b' }[frontKey];
        const bay = Math.min(1.25, half - 0.12);
        const wf = bay / 1.25;
        span(-bay, bay, 0, 0.32, 4.7, 7.25, { skip: [frontKey, backKey] });
        wallWithOpenings(
          'marble',
          along(0, 0.32),
          across,
          normal,
          [-bay, bay],
          [4.7, 7.25],
          [
            { c: -0.55 * wf, w: 0.38 * wf, sill: 5.05, spring: 6.4, k: 1, depth: 0.14, back: 'window' },
            { c: 0.55 * wf, w: 0.38 * wf, sill: 5.05, spring: 6.4, k: 1, depth: 0.14, back: 'window' },
          ],
        );
        span(-bay, bay, 0, 0.36, 7.25, 7.4, { skip: [backKey] });
        span(-bay + 0.05, bay - 0.05, 0, 0.26, 4.2, 4.7, { skip: [backKey], faces: { [frontKey]: 'corbel', '-h': 'corbel' } });
      }
    }
  }
}

/** Corbel UVs: the texture repeats every 0.6 m across and spans the band's height. */
function fixCorbelUvs() {
  const p = prims.corbel;
  for (let i = 0; i < p.pos.length / 3; i++) {
    const [a, h, b] = p.pos.slice(i * 3, i * 3 + 3);
    const [nx, ny] = p.nrm.slice(i * 3, i * 3 + 2);
    const across = Math.abs(nx) > 0.5 ? b : a;
    p.uv[i * 2] = (across + 1.2) / 0.6;
    p.uv[i * 2 + 1] = ny < -0.5 ? 0.02 : (4.7 - h) / 0.5;
  }
}

const INNER = CORE - TOWER_W; // 3.5: the end between the towers
const PIER = 1.45; // half the lift pier
const BAY_TOP = 3.6;

/** Three small square windows over a bay, and the ledge under them. */
function windowRow(s0, s1) {
  const c = (s0 + s1) / 2;
  return [-0.62, 0, 0.62].map((d) => ({ s0: c + d - 0.2, s1: c + d + 0.2, h0: 4.55, h1: 5.05, depth: 0.12, back: 'dark' }));
}

/**
 * The two ends; the entrance faces +a. Seen from outside it, the viewer's right is -b: the escalator
 * is in the -b bay, the ordinary stairs in the +b bay.
 */
function endBlocks() {
  for (const sa of [-1, 1]) {
    const a0 = sa > 0 ? BAY : -HALF_L;
    const a1 = sa > 0 ? HALF_L : -BAY;
    box('marble', [a0, 0, -INNER], [a1, END_H, INNER], { skip: [sa > 0 ? '+a' : '-a'] });
    box('marble', [a0 - 0.05, END_H, -INNER - 0.05], [a1 + 0.05, END_H + 0.18, INNER + 0.05]);
    const face = [sa * HALF_L, 0, 0];
    const ledge = (s0, s1) => box('marble', [sa > 0 ? HALF_L : -HALF_L - 0.1, 4.42, s0], [sa > 0 ? HALF_L + 0.1 : -HALF_L, 4.52, s1]);
    for (const sb of [-1, 1]) {
      const s0 = sb > 0 ? PIER : -INNER;
      const s1 = sb > 0 ? INNER : -PIER;
      const bayHole =
        sa > 0 ? { depth: 3.0, back: sb > 0 ? 'stairs' : 'escalator', top: 'soffit', bottom: 'granite' } : { depth: 0.35, back: 'gate', top: 'soffit', bottom: 'granite' };
      rectWall('marble', face, [0, 0, 1], [sa, 0, 0], [s0, s1], [0, END_H], [{ s0, s1, h0: 0, h1: BAY_TOP, ...bayHole }, ...windowRow(s0, s1)]);
      ledge(s0, s1);
      if (sa > 0) {
        // The bay's lattice gate, folded open against its outer side.
        const b = sb * (INNER - 0.04);
        const leaf = [
          [HALF_L - 0.95, 0, b],
          [HALF_L - 0.08, 0, b],
          [HALF_L - 0.08, BAY_TOP - 0.15, b],
          [HALF_L - 0.95, BAY_TOP - 0.15, b],
        ];
        poly(
          'fence',
          leaf,
          leaf.map(([a, h]) => [(HALF_L - a) / 4, 0.38 + (0.6 * (BAY_TOP - 0.15 - h)) / (BAY_TOP - 0.15)]),
          [0, 0, -sb],
        );
      }
    }
    if (sa > 0) {
      // The lift in the pier, the blind arch over it, and the sign at the top.
      rectWall(
        'marble',
        face,
        [0, 0, 1],
        [1, 0, 0],
        [-PIER, PIER],
        [0, END_H],
        [
          { s0: -0.62, s1: 0.62, h0: 0, h1: 2.35, depth: 0.12, back: 'steel' },
          { s0: -1.05, s1: 1.05, h0: 4.25, h1: 5.85, depth: 0.06, back: 'archpanel' },
        ],
      );
      box('dark', [HALF_L - 0.12, 0, -0.008], [HALF_L - 0.11, 2.35, 0.008]);
      box('marble', [HALF_L, 0, -0.78], [HALF_L + 0.06, 2.5, -0.62]);
      box('marble', [HALF_L, 0, 0.62], [HALF_L + 0.06, 2.5, 0.78]);
      box('marble', [HALF_L, 2.35, -0.78], [HALF_L + 0.06, 2.5, 0.78]);
      box('dark', [HALF_L, 6.05, -1.75], [HALF_L + 0.08, 6.85, 1.75], { skip: ['+a'] });
      const sign = [
        [HALF_L + 0.08, 6.05, 1.75],
        [HALF_L + 0.08, 6.05, -1.75],
        [HALF_L + 0.08, 6.85, -1.75],
        [HALF_L + 0.08, 6.85, 1.75],
      ];
      poly(
        'sign',
        sign,
        [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
        [1, 0, 0],
      );
      // The panel antennas on the roof over the entrance.
      for (const b of [-2.2, -0.7, 0.7, 2.2]) box('marble', [HALF_L - 0.9, END_H + 0.18, b - 0.22], [HALF_L - 0.8, END_H + 1.15, b + 0.22]);
    } else {
      // The back: a tall pointed arch closed with the same lattice.
      wallWithOpenings('marble', face, [0, 0, 1], [-1, 0, 0], [-PIER, PIER], [0, END_H], [{ c: 0, w: 1.15, sill: 0, spring: 3.9, k: 1.3, depth: 0.35, back: 'gate' }]);
    }
  }
}

function middleBay() {
  // Roof slab with the dark steel soffit seen under the lintels.
  box('marble', [-BAY, 6.0, -CORE], [BAY, 6.4, CORE], { faces: { '-h': 'soffit' } });
  box('marble', [-4.2, 6.4, -1.4], [-0.8, 7.0, 1.4]);
  box('dark', [1.5, 6.4, -0.9], [3.5, 6.85, 0.9]);
  for (const sb of [-1, 1]) {
    const b = (v) => sb * v;
    const lo = (v, w) => Math.min(b(v), b(w));
    const hi = (v, w) => Math.max(b(v), b(w));
    const outKey = sb > 0 ? '+b' : '-b';
    // Lintel.
    box('marble', [-BAY, 5.0, lo(4.9, CORE)], [BAY, 6.0, hi(4.9, CORE)], { faces: { '-h': 'soffit' } });
    // Fence, set back 1.2 m behind the face, from the counter to the soffit.
    const fence = [
      [-BAY, 1.5, b(4.3)],
      [BAY, 1.5, b(4.3)],
      [BAY, 6.0, b(4.3)],
      [-BAY, 6.0, b(4.3)],
    ];
    poly(
      'fence',
      fence,
      fence.map(([a, h]) => [(a + BAY) / 4, (6.0 - h) / 4.5]),
      [0, 0, sb],
    );
    box('marble', [-BAY, 1.5, lo(4.3, 4.9)], [BAY, 6.0, hi(4.3, 4.9)], { skip: ['+h', '-h', '+b', '-b'] });
    // Counter: its back wall with the taps, the trough, the decorated lower face.
    box('marble', [-BAY, 0, lo(4.3, CORE)], [BAY, 1.5, hi(4.3, CORE)], { skip: [outKey] });
    for (const [h0, h1, mat] of [
      [0, 0.2, 'marble'],
      [0.2, 0.72, 'counter'],
      [0.72, 1.5, 'marble'],
    ]) {
      const q = [
        [-BAY, h0, b(CORE)],
        [BAY, h0, b(CORE)],
        [BAY, h1, b(CORE)],
        [-BAY, h1, b(CORE)],
      ];
      const uvs = mat === 'counter' ? q.map(([a, h]) => [(a + BAY) / 2, (0.72 - h) / 0.52]) : q.map((v) => faceUv(mat, v, [0, 0, sb]));
      poly(mat, q, uvs, [0, 0, sb]);
    }
    box('marble', [-BAY, 0.72, lo(CORE, 5.88)], [BAY, 0.84, hi(CORE, 5.88)]);
    box('dark', [-BAY, 0.835, lo(CORE, 5.72)], [BAY, 0.845, hi(CORE, 5.72)]);
    for (let i = 0; i < 18; i++) {
      const a = -7.65 + 0.9 * i;
      box('steel', [a - 0.05, 0.98, lo(CORE, 5.58)], [a + 0.05, 1.42, hi(CORE, 5.58)], { skip: [sb > 0 ? '-b' : '+b'] });
      box('steel', [a - 0.02, 0.97, lo(CORE, 5.7)], [a + 0.02, 1.01, hi(CORE, 5.7)]);
    }
    // Pedestals at the counter's ends, the step people stand on, and its lower tread.
    for (const sa of [-1, 1]) {
      const a0 = sa > 0 ? BAY : -BAY - 1.3;
      box('marble', [a0, 0, lo(CORE, 6.7)], [a0 + 1.3, 1.65, hi(CORE, 6.7)], { skip: [outKey === '+b' ? '-b' : '+b'] });
      box('marble', [a0 - 0.05, 1.65, lo(CORE, 6.75)], [a0 + 1.35, 1.75, hi(CORE, 6.75)]);
      box('granite', [a0 - 0.02, -0.2, lo(CORE, 6.72)], [a0 + 1.32, 0.3, hi(CORE, 6.72)], { skip: ['-h'] });
    }
    box('marble', [-BAY, -0.2, lo(CORE, 6.6)], [BAY, 0.18, hi(CORE, 6.6)], { skip: ['-h'] });
    box('marble', [-BAY, -0.2, lo(6.6, 7.0)], [BAY, 0.09, hi(6.6, 7.0)], { skip: ['-h'] });
    // Rails up the step at a third and two thirds, as in the photographs.
    for (const a of [-2.7, 2.7]) {
      box('steel', [a - 0.025, 0.18, lo(6.45, 6.5)], [a + 0.025, 1.05, hi(6.45, 6.5)]);
      box('steel', [a - 0.025, 1.0, lo(6.2, 6.95)], [a + 0.025, 1.05, hi(6.2, 6.95)]);
    }
  }
}

towers();
fixCorbelUvs();
endBlocks();
middleBay();

// ---------------------------------------------------------------- glTF

/**
 * The two placements navQ gives (`haram-service-a/b.glb`): the block's centre from its anchor in
 * the models' frame (X east, Y up, Z south), and which way its length runs.
 */
const A = { centre: [-2.415, -41.918], lengthAlong: 'x' };
const B = { centre: [-2.355, -82.929], lengthAlong: 'z' };
/** The entrance (+a) faces east on a, north on b; `flip` turns the block half round on its centre. */
const VARIANTS = [
  { file: 'haram-restroom-a-east.glb', ...A, flip: false },
  { file: 'haram-restroom-a-west.glb', ...A, flip: true },
  { file: 'haram-restroom-b-north.glb', ...B, flip: false },
  { file: 'haram-restroom-b-south.glb', ...B, flip: true },
];

function turn([a, h, b], { lengthAlong, flip }) {
  if (flip) [a, b] = [-a, -b];
  // A quarter turn about Y keeps the faces' handedness: (a, b) -> (b, -a).
  return lengthAlong === 'x' ? [a, h, b] : [b, h, -a];
}
function place(q, v) {
  const [x, y, z] = turn(q, v);
  return [v.centre[0] + x, y, v.centre[1] + z];
}

const images = Object.fromEntries(
  Object.entries(MATERIALS)
    .filter(([, m]) => m.texture)
    .map(([k, m]) => [k, m.texture()]),
);

function buildGlb(variant) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const push = (buf, target) => {
    const pad = (4 - (buf.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf, Buffer.alloc(pad));
    offset += buf.length + pad;
    return bufferViews.length - 1;
  };
  const materials = [];
  const textures = [];
  const gltfImages = [];
  const primitives = [];
  for (const [name, def] of Object.entries(MATERIALS)) {
    const p = prims[name];
    if (p.idx.length === 0) continue;
    const n = p.pos.length / 3;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(place(p.pos.slice(i * 3, i * 3 + 3), variant), i * 3);
      nrm.set(turn(p.nrm.slice(i * 3, i * 3 + 3), variant), i * 3);
    }
    const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
    const posAcc = accessors.push({ bufferView: push(Buffer.from(pos.buffer), 34962), componentType: 5126, count: n, type: 'VEC3', min, max }) - 1;
    const nrmAcc = accessors.push({ bufferView: push(Buffer.from(nrm.buffer), 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
    const uvAcc = accessors.push({ bufferView: push(Buffer.from(new Float32Array(p.uv).buffer), 34962), componentType: 5126, count: n, type: 'VEC2' }) - 1;
    if (n > 65535) throw new Error(`${name}: too many vertices for 16-bit indices`);
    const idxAcc = accessors.push({ bufferView: push(Buffer.from(new Uint16Array(p.idx).buffer), 34963), componentType: 5123, count: p.idx.length, type: 'SCALAR' }) - 1;
    const pbr = { baseColorFactor: def.color ?? [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 };
    if (def.texture) {
      gltfImages.push({ bufferView: push(images[name]), mimeType: 'image/png' });
      textures.push({ source: gltfImages.length - 1 });
      pbr.baseColorTexture = { index: textures.length - 1 };
    }
    materials.push({ name, pbrMetallicRoughness: pbr, doubleSided: true });
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: materials.length - 1 });
  }
  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'scripts/restroom-model.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Restroom', mesh: 0 }],
    meshes: [{ name: 'Restroom', primitives }],
    materials,
    textures,
    images: gltfImages,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, json, bh, bin]);
}

for (const v of VARIANTS) {
  const glb = buildGlb(v);
  writeFileSync(resolve(OUT, v.file), glb);
  const verts = Object.values(prims).reduce((s, p) => s + p.pos.length / 3, 0);
  console.log(`${v.file}: ${(glb.length / 1024).toFixed(0)} KB, ${verts} vertices`);
}
