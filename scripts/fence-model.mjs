#!/usr/bin/env node
/**
 * Builds the outer fence of the courtyards, `public/models/haram-fence.glb`, along the line in
 * `data/haram-fence.json` (the Authority's fence and gate openings, owner 2026-11-08), as the owner's
 * photographs show it: a beige granite base, a dark green steel panel with a row of gold
 * eight-pointed stars above and below an interlaced lattice, gold spikes on top; granite pillars
 * with a small dome every few panels; at every gate two taller pillars carrying brass lanterns,
 * and the orange board with the gate's number beside the opening, on the outside.
 *
 * One panel, one pillar and one gate pillar, each repeated along the line (one draw each, however
 * many); the boards are one mesh, each with its number from `scripts/fence-signs.png`. The lattice
 * and the spikes are cut-out textures (glTF `MASK`). Frame: metres from the Mosque's anchor, X east,
 * Y up, Z south (as the Authority's files). No dependency: run `node scripts/fence-model.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(readFileSync(resolve(ROOT, 'data/haram-fence.json'), 'utf8'));
const OUT = resolve(ROOT, 'public/models/haram-fence.glb');

// ---------------------------------------------------------------- the frame (as MapLibre's Mercator)

const ORIGIN = [39.611752, 24.466806];
const EARTH = 2 * Math.PI * 6371008.8;
const mx = (lng) => (180 + lng) / 360;
const my = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const PER_M = 1 / (EARTH * Math.cos((ORIGIN[1] * Math.PI) / 180));
/** [lng, lat] → [east, south] metres from the anchor. */
const toModel = ([lng, lat]) => [(mx(lng) - mx(ORIGIN[0])) / PER_M, (my(lat) - my(ORIGIN[1])) / PER_M];

// ---------------------------------------------------------------- sizes (from the photographs)

const BAY = 2.4; // one panel, post to post
const BASE_H = 0.85; // granite plinth
const BASE_D = 0.55;
const RAIL_LO = 0.92; // the steel panel
const RAIL_HI = 3.2;
const SPIKE_H = 0.32;
const PILLAR = { w: 0.72, h: 3.75 };
const GATE_PILLAR = { w: 0.8, h: 3.95 };
const PILLAR_EVERY = 4; // panels between plain pillars
const SIGN = { w: 1.5, h: 1.5, y: 2.15 };

// ---------------------------------------------------------------- PNG

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
/** A PNG from a function of the pixel giving [r, g, b] or [r, g, b, a] in 0..1. */
function png(w, h, fn, alpha = false) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      for (let k = 0; k < ch; k++) raw[y * (w * ch + 1) + 1 + x * ch + k] = Math.round(Math.max(0, Math.min(1, c[k] ?? 1)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
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

// ---------------------------------------------------------------- textures

const GREEN = [0.16, 0.27, 0.19];
const GOLD = [0.86, 0.68, 0.33];
const GRANITE = [0.93, 0.85, 0.76];

/** Beige granite with dark and light grains, 1 m to the texture. */
function graniteTexture() {
  const r = rng(7);
  const grain = Array.from({ length: 128 * 128 }, () => r());
  return png(128, 128, (x, y) => {
    const g = grain[y * 128 + x];
    const k = g < 0.12 ? 0.72 : g > 0.93 ? 1.1 : 0.94 + 0.08 * g;
    return GRANITE.map((c, i) => c * k * (i === 2 ? 0.98 : 1));
  });
}

/**
 * The panel between its posts (2.28 m by 2.2 m, from the bottom rail to the top one): a row of four
 * eight-pointed stars in square cells along the top and the bottom, the interlaced lattice between
 * them; open between the bars.
 */
function latticeTexture() {
  const W = 512;
  const H = 494;
  const band = (m) => Math.round((m / 2.2) * H);
  const top = band(0.5);
  const bottom = H - band(0.42);
  const bar = 6;
  return png(
    W,
    H,
    (x, y) => {
      const frame = x < bar || x >= W - bar || y < bar || y >= H - bar || Math.abs(y - top) < bar / 2 + 1 || Math.abs(y - bottom) < bar / 2 + 1;
      if (frame) return [...GREEN, 1];
      if (y < top || y > bottom) {
        // A star cell: its square frame, and two squares a quarter turned on each other, in gold.
        const y0 = y < top ? 0 : bottom;
        const ch = y < top ? top : H - bottom;
        const cw = W / 4;
        const cx = (x % cw) - cw / 2;
        const cy = y - y0 - ch / 2;
        const half = Math.min(cw, ch) * 0.34;
        if (Math.abs(Math.abs(cx) - cw / 2) < 3) return [...GREEN, 1];
        const sq = Math.max(Math.abs(cx), Math.abs(cy));
        const dia = (Math.abs(cx) + Math.abs(cy)) / Math.SQRT2;
        const star = Math.abs(sq - half) < 2.6 || Math.abs(dia - half) < 2.6;
        const inside = sq < half && dia < half;
        if (star && (sq >= half - 2.6 || dia >= half - 2.6) && !(sq < half - 2.6 && dia < half - 2.6)) return [...GOLD, 1];
        // Thin bars from the cell's corners to the star.
        const diag = Math.abs(Math.abs(cx) - Math.abs(cy) * (cw / ch)) < 2 && !inside;
        return diag ? [...GREEN, 1] : [0, 0, 0, 0];
      }
      // Interlaced lattice: two zigzags mirrored in each column, elongated hexagons, joined where
      // they meet (as the restroom fence, at the scale of the photographs).
      const cw = 42;
      const period = 64;
      const t = ((y - top) % period) / period;
      const zig = (Math.abs(t * 2 - 1) - 0.5) * 30;
      const xm = (x + cw / 2) % cw;
      const d = Math.min(Math.abs(xm - (cw / 2 + zig)), Math.abs(xm - (cw / 2 - zig)));
      const join = Math.abs(t * 2 - 1) > 0.93 && Math.abs(xm - cw / 2) < 16;
      return d < 3.4 || join ? [...GREEN.map((c) => c * (0.92 + 0.12 * Math.sin(x * 0.05))), 1] : [0, 0, 0, 0];
    },
    true,
  );
}

/** A row of gold spear points on a short collar, sixteen to the panel; open between them. */
function spikesTexture() {
  const W = 512;
  const H = 72;
  return png(
    W,
    H,
    (x, y) => {
      const px = (x % 32) - 16;
      const up = 1 - y / H; // 0 at the rail, 1 at the tip
      if (up < 0.12) return Math.abs(px) < 5 ? [...GOLD.map((c) => c * 0.85), 1] : [0, 0, 0, 0];
      const half = up < 0.3 ? 4.5 : 6.5 * (1 - (up - 0.3) / 0.7);
      return Math.abs(px) < half ? [...GOLD.map((c) => c * (0.9 + 0.2 * (px / 16))), 1] : [0, 0, 0, 0];
    },
    true,
  );
}

const MATERIALS = {
  granite: { texture: graniteTexture, repeat: 1 },
  steel: { color: [...GREEN, 1] },
  lattice: { texture: latticeTexture, mask: true },
  spikes: { texture: spikesTexture, mask: true },
  gold: { color: [...GOLD, 1] },
  lantern: { color: [1, 0.86, 0.6, 1] },
  sign: { image: () => readFileSync(resolve(ROOT, 'scripts/fence-signs.png')) },
};

// ---------------------------------------------------------------- geometry

const newPrims = () => Object.fromEntries(Object.keys(MATERIALS).map((m) => [m, { pos: [], nrm: [], uv: [], idx: [] }]));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function poly(prims, mat, pts, uvs, normal) {
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

/** A box from min to max (x, y, z), its faces' UVs at world scale; `skip` leaves faces out. */
function box(prims, mat, [x0, y0, z0], [x1, y1, z1], skip = []) {
  const r = MATERIALS[mat].repeat ?? 1;
  const faces = {
    '+x': [
      [x1, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [1, 0, 0],
    ],
    '-x': [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
      [-1, 0, 0],
    ],
    '+z': [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      [0, 0, 1],
    ],
    '-z': [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [0, 0, -1],
    ],
    '+y': [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
      [0, 1, 0],
    ],
  };
  for (const [key, [a, b, c, d, n]] of Object.entries(faces)) {
    if (skip.includes(key)) continue;
    const pts = [a, b, c, d];
    const uvs = pts.map((q) => (Math.abs(n[1]) > 0.5 ? [q[0] / r, q[2] / r] : Math.abs(n[0]) > 0.5 ? [q[2] / r, -q[1] / r] : [q[0] / r, -q[1] / r]));
    poly(prims, mat, pts, uvs, n);
  }
}

/** A frustum of 8 sides from radius r0 at y0 to r1 at y1 (a dome is three of them). */
function frustum(prims, mat, r0, r1, y0, y1) {
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a0 = ((i + 0.5) * 2 * Math.PI) / N;
    const a1 = ((i + 1.5) * 2 * Math.PI) / N;
    const p = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
    const mid = (a0 + a1) / 2;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const n = [Math.cos(mid), slope, Math.sin(mid)];
    const l = Math.hypot(...n);
    poly(
      prims,
      mat,
      [p(r0, a0, y0), p(r0, a1, y0), p(r1, a1, y1), p(r1, a0, y1)],
      [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      n.map((v) => v / l),
    );
  }
}

/** One panel, post to post along X (−1.2 to 1.2 m), its two faces ±Z. */
function panelMesh() {
  const p = newPrims();
  const h = BAY / 2;
  box(p, 'granite', [-h, 0, -BASE_D / 2], [h, BASE_H, BASE_D / 2]);
  box(p, 'granite', [-h, BASE_H, -BASE_D / 2 - 0.03], [h, RAIL_LO, BASE_D / 2 + 0.03]);
  box(p, 'steel', [-h, RAIL_LO, -0.045], [h, RAIL_LO + 0.06, 0.045]);
  box(p, 'steel', [-h, RAIL_HI - 0.08, -0.045], [h, RAIL_HI, 0.045]);
  for (const s of [-1, 1]) box(p, 'steel', [s * h - 0.03, RAIL_LO, -0.04], [s * h + 0.03, RAIL_HI, 0.04], ['+y']);
  const iw = h - 0.03;
  poly(
    p,
    'lattice',
    [
      [-iw, RAIL_LO + 0.06, 0],
      [iw, RAIL_LO + 0.06, 0],
      [iw, RAIL_HI - 0.08, 0],
      [-iw, RAIL_HI - 0.08, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    [0, 0, 1],
  );
  poly(
    p,
    'spikes',
    [
      [-h, RAIL_HI, 0],
      [h, RAIL_HI, 0],
      [h, RAIL_HI + SPIKE_H, 0],
      [-h, RAIL_HI + SPIKE_H, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    [0, 0, 1],
  );
  return p;
}

/** A granite pillar with its cornice, a small dome and a gold finial; at a gate, brass lanterns on both faces. */
function pillarMesh({ w, h }, lanterns) {
  const p = newPrims();
  const r = w / 2;
  box(p, 'granite', [-r, 0, -r], [r, h, r]);
  box(p, 'granite', [-r - 0.06, h, -r - 0.06], [r + 0.06, h + 0.14, r + 0.06]);
  const top = h + 0.14;
  frustum(p, 'granite', r * 0.9, r * 0.85, top, top + 0.14);
  frustum(p, 'granite', r * 0.85, r * 0.55, top + 0.14, top + 0.32);
  frustum(p, 'granite', r * 0.55, 0.05, top + 0.32, top + 0.45);
  box(p, 'gold', [-0.025, top + 0.43, -0.025], [0.025, top + 0.62, 0.025]);
  if (lanterns) {
    for (const s of [-1, 1]) {
      const z0 = s * r;
      const z1 = s * (r + 0.32);
      const [za, zb] = s > 0 ? [z0, z1] : [z1, z0];
      box(p, 'gold', [-0.04, h - 1.05, Math.min(za, zb)], [0.04, h - 0.98, Math.max(za, zb)]);
      box(p, 'lantern', [-0.15, h - 1.55, s > 0 ? z0 + 0.06 : z1], [0.15, h - 1.05, s > 0 ? z1 : z0 - 0.06]);
      box(p, 'gold', [-0.18, h - 1.05, s > 0 ? z0 + 0.03 : z1 - 0.03], [0.18, h - 0.98, s > 0 ? z1 + 0.03 : z0 - 0.03]);
    }
  }
  return p;
}

// ---------------------------------------------------------------- along the line

const RUNS = DATA.runs.map((r) => ({ kind: r.kind, pts: r.path.map(toModel) }));
const ring = RUNS.flatMap((r) => r.pts.slice(1));
function inside([x, z]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** The unit direction a → b and the normal that points away from the courtyards. */
function frame(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let n = [-u[1], u[0]];
  const m = [(a[0] + b[0]) / 2 + n[0] * 3, (a[1] + b[1]) / 2 + n[1] * 3];
  if (inside(m)) n = [-n[0], -n[1]];
  return { L, u, n };
}
/** A node turning the mesh's +X to the direction u (in X east, Z south), at p, stretched along X. */
function node(mesh, p, u, stretch = 1) {
  const a = Math.atan2(-u[1], u[0]);
  return { mesh, translation: [p[0], 0, p[1]], rotation: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], ...(stretch !== 1 ? { scale: [stretch, 1, 1] } : {}) };
}

const PANEL = 0;
const PILLAR_MESH = 1;
const GATE_PILLAR_MESH = 2;
const SIGNS = 3;
const nodes = [];
const signs = newPrims();
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3;

RUNS.forEach((run, k) => {
  if (run.kind === 'fence') {
    for (let i = 0; i + 1 < run.pts.length; i++) {
      const a = run.pts[i];
      const b = run.pts[i + 1];
      const { L, u } = frame(a, b);
      if (L < 0.3) continue;
      const n = Math.max(1, Math.round(L / BAY));
      for (let j = 0; j < n; j++) {
        const s = ((j + 0.5) * L) / n;
        nodes.push(node(PANEL, [a[0] + u[0] * s, a[1] + u[1] * s], u, L / (n * BAY)));
        if (j > 0 && j % PILLAR_EVERY === 0) nodes.push(node(PILLAR_MESH, [a[0] + ((u[0] * j) / n) * L, a[1] + ((u[1] * j) / n) * L], u));
      }
      // A corner of the line gets a pillar (not where it meets a gate: that one is the gate's).
      if (i > 0) {
        const prev = frame(run.pts[i - 1], a);
        if (prev.u[0] * u[0] + prev.u[1] * u[1] < Math.cos((20 * Math.PI) / 180)) nodes.push(node(PILLAR_MESH, a, u));
      }
    }
    return;
  }
  // An opening: a tall pillar on each side, one between gates sharing it, and each gate's board.
  const a = run.pts[0];
  const b = run.pts[run.pts.length - 1];
  const { L, u, n } = frame(a, b);
  const ids = DATA.gates
    .filter((g) => g.opening === k)
    .map((g) => ({
      id: g.id,
      s: (() => {
        const q = toModel(g.at);
        return (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1];
      })(),
    }));
  ids.sort((x, y) => x.s - y.s);
  const at = (s) => [a[0] + u[0] * s, a[1] + u[1] * s];
  nodes.push(node(GATE_PILLAR_MESH, at(-GATE_PILLAR.w / 2), u), node(GATE_PILLAR_MESH, at(L + GATE_PILLAR.w / 2), u));
  const parts = Math.max(1, ids.length);
  for (let j = 1; j < parts; j++) nodes.push(node(GATE_PILLAR_MESH, at((j * L) / parts), u));
  ids.forEach((g, j) => {
    // The board: on the fence beside the opening for the first gate, on the pillar between gates for the others.
    const onPillar = j > 0;
    const w = onPillar ? GATE_PILLAR.w - 0.08 : SIGN.w;
    const h = onPillar ? GATE_PILLAR.w - 0.08 : SIGN.h;
    const s = onPillar ? (j * L) / parts : -GATE_PILLAR.w - 0.12 - SIGN.w / 2;
    const out = onPillar ? GATE_PILLAR.w / 2 + 0.02 : 0.1;
    const c = at(s);
    const face = [c[0] + n[0] * out, c[1] + n[1] * out];
    const right = [n[1], -n[0]]; // as seen from outside, facing the fence
    const idx = g.id - 301;
    const cu = (idx % 10) / 10;
    const cv = Math.floor(idx / 10) / 7;
    const corner = (dx, y) => [face[0] + right[0] * dx, y, face[1] + right[1] * dx];
    const y0 = SIGN.y - h / 2;
    const y1 = SIGN.y + h / 2;
    const quad = [corner(-w / 2, y0), corner(w / 2, y0), corner(w / 2, y1), corner(-w / 2, y1)];
    poly(
      signs,
      'sign',
      quad,
      [
        [cu, cv + 1 / 7],
        [cu + 0.1, cv + 1 / 7],
        [cu + 0.1, cv],
        [cu, cv],
      ],
      [n[0], 0, n[1]],
    );
    // Its back, plain steel, so the number never shows mirrored from inside.
    const back = quad.map((q) => [q[0] - n[0] * 0.015, q[1], q[2] - n[1] * 0.015]);
    poly(
      signs,
      'steel',
      back,
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [-n[0], 0, -n[1]],
    );
  });
});
nodes.push({ mesh: SIGNS });

// ---------------------------------------------------------------- glTF

const MESHES = [
  ['Panel', panelMesh()],
  ['Pillar', pillarMesh(PILLAR, false)],
  ['GatePillar', pillarMesh(GATE_PILLAR, true)],
  ['Signs', signs],
];

function buildGlb() {
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
  const images = [];
  const matIndex = {};
  for (const [name, def] of Object.entries(MATERIALS)) {
    const pbr = { baseColorFactor: def.color ?? [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 };
    if (def.texture || def.image) {
      images.push({ bufferView: push(def.image ? def.image() : def.texture()), mimeType: 'image/png' });
      textures.push({ source: images.length - 1 });
      pbr.baseColorTexture = { index: textures.length - 1 };
    }
    matIndex[name] = materials.push({ name, pbrMetallicRoughness: pbr, doubleSided: true, ...(def.mask ? { alphaMode: 'MASK', alphaCutoff: 0.5 } : {}) }) - 1;
  }
  const meshes = MESHES.map(([name, prims]) => {
    const primitives = [];
    for (const [mat, p] of Object.entries(prims)) {
      if (!p.idx.length) continue;
      const n = p.pos.length / 3;
      if (n > 65535) throw new Error(`${name}/${mat}: too many vertices for 16-bit indices`);
      const pos = new Float32Array(p.pos);
      const min = [0, 1, 2].map((k) => Math.min(...p.pos.filter((_, i) => i % 3 === k)));
      const max = [0, 1, 2].map((k) => Math.max(...p.pos.filter((_, i) => i % 3 === k)));
      const posAcc = accessors.push({ bufferView: push(Buffer.from(pos.buffer), 34962), componentType: 5126, count: n, type: 'VEC3', min, max }) - 1;
      const nrmAcc = accessors.push({ bufferView: push(Buffer.from(new Float32Array(p.nrm).buffer), 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
      const uvAcc = accessors.push({ bufferView: push(Buffer.from(new Float32Array(p.uv).buffer), 34962), componentType: 5126, count: n, type: 'VEC2' }) - 1;
      const idxAcc = accessors.push({ bufferView: push(Buffer.from(new Uint16Array(p.idx).buffer), 34963), componentType: 5123, count: p.idx.length, type: 'SCALAR' }) - 1;
      primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc }, indices: idxAcc, material: matIndex[mat] });
    }
    return { name, primitives };
  });
  const bin = Buffer.concat(chunks);
  const round = (v) => Math.round(v * 1000) / 1000;
  const gltf = {
    asset: { version: '2.0', generator: 'scripts/fence-model.mjs' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes: nodes.map((n) => ({
      mesh: n.mesh,
      ...(n.translation ? { translation: n.translation.map(round) } : {}),
      ...(n.rotation ? { rotation: n.rotation.map((v) => Math.round(v * 1e6) / 1e6) } : {}),
      ...(n.scale ? { scale: n.scale.map((v) => Math.round(v * 1e4) / 1e4) } : {}),
    })),
    meshes,
    materials,
    textures,
    images,
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

const glb = buildGlb();
writeFileSync(OUT, glb);
const count = (m) => nodes.filter((n) => n.mesh === m).length;
console.log(
  `haram-fence.glb: ${(glb.length / 1024).toFixed(0)} KB; ${count(PANEL)} panels, ${count(PILLAR_MESH)} pillars, ${count(GATE_PILLAR_MESH)} gate pillars, ${DATA.gates.length} boards`,
);
