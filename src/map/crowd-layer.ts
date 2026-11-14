import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import type { PrayerDemoOverride } from '../domain/prayer-session';
import { Flows } from './crowd-flows';
import { Crowd, POSTURE_CODE, Worshippers, worshipperPose } from './crowd-sim';
import { crowdInput } from './crowd-world';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import type { SceneLight } from './scene-light';

/** How many walk the courtyards at once, and from which zoom they are shown (and walk). */
export const CROWD_SIZE = 500;
export const CROWD_MIN_ZOOM = 17;
/** The walk is drawn about 30 times a second: smooth enough, and kinder to a phone than 60. */
const FRAME_MS = 33;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
// swing group (0 none, 1/2 left/right arm, 3/4 left/right foot), material (0 robe, 1 skin,
// 2 headwear, 3 sandal, 4 shadow), who it is for (0 everyone, 1 men, 2 women)
layout(location = 2) in vec3 a_part;
layout(location = 3) in vec4 a_inst;  // x, z, heading, gait phase
layout(location = 4) in vec4 a_robe;  // robe colour, height
layout(location = 5) in vec4 a_head;  // headwear colour, woman (1) + skin tone / 2
// A worshipper at prayer: x 0 follows the session's posture, 1..4 a pose of its own (standing,
// ruku, sujud, juloos); y the rehal before it, z a child.
layout(location = 6) in vec4 a_pose;

uniform mat4 u_mvp;
uniform float u_posture;  // 0 standing, 1 ruku, 2 sujud, 3 juloos (the rows, all together)

out vec3 v_normal;
out vec3 v_color;
out float v_mat;
out vec2 v_local;
out float v_y;

// The body at prayer (owner, 2026-11-09): bent from the hips at ruku, laid low at sujud with the
// head at the ground, sitting on folded legs at juloos. The shadow is never posed.
vec3 poseBody(vec3 p, float pose, float s) {
  if (pose < 0.5) return p;
  float hip = 0.95 * s;
  if (pose < 1.5) {
    if (p.y <= hip) return p;
    float a = 1.25;
    float dy = p.y - hip;
    return vec3(p.x * cos(a) + dy * sin(a), hip + dy * cos(a) - p.x * sin(a), p.z);
  }
  if (pose < 2.5) {
    if (p.y <= hip) return vec3(p.x, p.y * 0.5, p.z);
    float a = 2.05;
    float dy = p.y - hip;
    return vec3(p.x * cos(a) + dy * sin(a), 0.475 * s + dy * cos(a) - p.x * sin(a), p.z);
  }
  float base = 0.35 * s;
  return vec3(p.x + (p.y < base ? 0.1 * s : 0.0), base + (p.y - base) * 0.62, p.z);
}

void main() {
  float woman = floor(a_head.w);
  float skin = fract(a_head.w) * 2.0;
  // Parts for the other sex, and a walker not placed (far off at z 1e6), are not drawn.
  bool hidden = (a_part.z == 1.0 && woman > 0.5) || (a_part.z == 2.0 && woman < 0.5) || a_inst.y > 1e5;
  float s = a_robe.w / 1.75;
  vec3 p = a_pos * vec3(1.0, s, 1.0);
  vec3 n = a_normal;
  float ph = a_inst.w;
  float swing = sin(ph);
  float pose = a_pose.x < 0.5 ? u_posture : a_pose.x - 1.0;
  if (pose < 0.5) {
    if (a_part.x == 1.0 || a_part.x == 2.0) {
      // The arms swing about the shoulder, against the feet.
      float a = (a_part.x == 1.0 ? -0.42 : 0.42) * swing;
      float py = 1.42 * s;
      float dy = p.y - py;
      p.xy = vec2(p.x * cos(a) - dy * sin(a), p.x * sin(a) + dy * cos(a) + py);
      n.xy = vec2(n.x * cos(a) - n.y * sin(a), n.x * sin(a) + n.y * cos(a));
    } else if (a_part.x == 3.0 || a_part.x == 4.0) {
      float k = a_part.x == 3.0 ? 1.0 : -1.0;
      p.x += 0.2 * swing * k;
      p.y += 0.045 * max(0.0, cos(ph) * k);
    }
    if (a_part.y != 4.0) {
      // The hem moves with the stride; the body rises a little at each step and sways.
      if (a_part.y == 0.0 && a_part.x == 0.0) p.x += 0.03 * swing * clamp((0.5 - p.y) / 0.4, 0.0, 1.0);
      p.y += 0.022 * abs(cos(ph));
      p.z += 0.012 * swing;
    }
  }
  vec3 q = a_part.y == 4.0 ? p : poseBody(p, pose, s);
  float c = cos(a_inst.z);
  float sn = sin(a_inst.z);
  vec3 world = vec3(a_inst.x + q.x * c - q.z * sn, q.y, a_inst.y + q.x * sn + q.z * c);
  gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : u_mvp * vec4(world, 1.0);
  v_normal = vec3(n.x * c - n.z * sn, n.y, n.x * sn + n.z * c);
  vec3 skinCol = mix(vec3(0.86, 0.68, 0.55), vec3(0.36, 0.24, 0.17), skin);
  v_color = a_part.y == 0.0 ? a_robe.rgb : a_part.y == 1.0 ? skinCol : a_part.y == 2.0 ? a_head.rgb : vec3(0.18, 0.15, 0.13);
  v_mat = a_part.y;
  v_local = a_pos.xz;
  v_y = a_pos.y / 1.75;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in float v_mat;
in vec2 v_local;
in float v_y;
uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
uniform float u_night;
out vec4 fragColor;
void main() {
  if (v_mat > 3.5) {
    // A soft shadow on the ground, fading at night when the sun is gone.
    float r = length(v_local / vec2(0.42, 0.34));
    fragColor = vec4(0.0, 0.0, 0.0, 0.32 * (1.0 - smoothstep(0.3, 1.0, r)) * (1.0 - u_night * 0.6));
    return;
  }
  vec3 n = normalize(v_normal);
  vec3 l = normalize(u_sunDir);
  // Cloth: the light wraps a little round the folds, and the robe darkens toward the ground
  // (the shade of the body and the light the floor gives back).
  float direct = max((dot(n, l) + 0.2) / 1.2, 0.0);
  float sky = 0.72 + 0.28 * n.y;
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.45, v_y));
  vec3 bounce = vec3(0.9, 0.86, 0.8) * 0.12 * max(-n.y, 0.0);
  vec3 lit = v_color * (u_ambient * sky * ao + u_sun * direct * mix(0.8, 1.0, ao) + bounce);
  // A soft sheen at the edges of the cloth against the light, and a little on the skin.
  float rim = pow(1.0 - abs(n.y), 3.0) * max(dot(n, l), 0.0);
  lit += u_sun * rim * (v_mat == 1.0 ? 0.08 : 0.05);
  // At night the plazas' lamps light people from above, near white.
  lit += v_color * vec3(0.42, 0.41, 0.38) * u_night * (0.6 + 0.4 * max(n.y, 0.0));
  fragColor = vec4(lit, 1.0);
}
`;

type V3 = [number, number, number];

/**
 * The figure: x forward, y up, z to the side; 1.75 m tall before the walker's own height. Smooth
 * (a normal at each vertex), in proportion (head about an eighth of the height), the thobe straight
 * and the abaya fuller to the ground (owner, 2026-11-07: more lifelike).
 */
function personMesh(): { data: Float32Array; shadowFirst: number; shadowCount: number; count: number } {
  const out: number[] = [];
  const push = (p: V3, n: V3, swing: number, mat: number, who: number) => out.push(...p, ...n, swing, mat, who);
  const norm = (n: V3): V3 => {
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const tri = (a: V3, b: V3, c: V3, swing: number, mat: number, who: number, normal?: V3) => {
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = norm(normal ?? [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    push(a, n, swing, mat, who);
    push(b, n, swing, mat, who);
    push(c, n, swing, mat, who);
  };
  /**
   * A smooth surface of revolution through rings `[y, forward radius, side radius]`, about (dx, dz),
   * over the angles `keep` allows; capped on top if asked.
   */
  const lathe = (
    rings: [number, number, number][],
    mat: number,
    who: number,
    opts: { seg?: number; dx?: number; dz?: number; keep?: (a: number) => boolean; cap?: boolean; swing?: number } = {},
  ) => {
    const seg = opts.seg ?? 16;
    const dx = opts.dx ?? 0;
    const dz = opts.dz ?? 0;
    const swing = opts.swing ?? 0;
    const at = (a: number, r: [number, number, number]): V3 => [dx + Math.cos(a) * r[1], r[0], dz + Math.sin(a) * r[2]];
    // The normal: outward, tilted by how the radius changes along the height.
    const nrm = (a: number, k: number): V3 => {
      const lo = rings[Math.max(0, k - 1)];
      const hi = rings[Math.min(rings.length - 1, k + 1)];
      const dy = hi[0] - lo[0] || 1e-3;
      const dr = (hi[1] + hi[2] - lo[1] - lo[2]) / 2;
      return norm([Math.cos(a) / (rings[k][1] + 1e-3), -dr / dy / ((rings[k][1] + rings[k][2]) / 2 + 1e-3), Math.sin(a) / (rings[k][2] + 1e-3)]);
    };
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        if (opts.keep && !opts.keep((a0 + a1) / 2)) continue;
        const p00 = at(a0, rings[k]);
        const p10 = at(a1, rings[k]);
        const p01 = at(a0, rings[k + 1]);
        const p11 = at(a1, rings[k + 1]);
        const n00 = nrm(a0, k);
        const n10 = nrm(a1, k);
        const n01 = nrm(a0, k + 1);
        const n11 = nrm(a1, k + 1);
        push(p00, n00, swing, mat, who);
        push(p10, n10, swing, mat, who);
        push(p11, n11, swing, mat, who);
        push(p00, n00, swing, mat, who);
        push(p11, n11, swing, mat, who);
        push(p01, n01, swing, mat, who);
      }
    }
    if (opts.cap) {
      const top = rings[rings.length - 1];
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        tri([dx, top[0], dz], at(a1, top), at(a0, top), swing, mat, who, [0, 1, 0]);
      }
    }
  };
  /** An ellipsoid about (dx, cy, dz) with radii r (forward, up, side). */
  const blob = (cy: number, r: V3, mat: number, who: number, opts: { dx?: number; dz?: number; swing?: number; seg?: number } = {}) => {
    const rings: [number, number, number][] = [];
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const t = -Math.PI / 2 + (k / n) * Math.PI;
      rings.push([cy + Math.sin(t) * r[1], Math.cos(t) * r[0] + 1e-3, Math.cos(t) * r[2] + 1e-3]);
    }
    lathe(rings, mat, who, { seg: opts.seg ?? 12, dx: opts.dx, dz: opts.dz, swing: opts.swing });
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, swing: number, mat: number, who: number) => {
    const c = (x: number, y: number, z: number): V3 => [x, y, z];
    const faces: [V3, V3, V3, V3][] = [
      [c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1)],
      [c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0), c(x0, y0, z0)],
      [c(x0, y1, z0), c(x0, y1, z1), c(x1, y1, z1), c(x1, y1, z0)],
      [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)],
      [c(x1, y0, z0), c(x0, y0, z0), c(x0, y1, z0), c(x1, y1, z0)],
    ];
    for (const [a, b, cc, d] of faces) {
      tri(a, b, cc, swing, mat, who);
      tri(a, cc, d, swing, mat, who);
    }
  };
  // Feet in sandals, under the hem, rounded at the toe.
  box(-0.07, 0.13, 0, 0.05, 0.055, 0.135, 3, 3, 0);
  box(-0.07, 0.13, 0, 0.05, -0.135, -0.055, 4, 3, 0);
  box(0.13, 0.17, 0, 0.04, 0.065, 0.125, 3, 3, 0);
  box(0.13, 0.17, 0, 0.04, -0.125, -0.065, 4, 3, 0);
  // Men: the thobe, straight and narrow to the ankle, with a fuller chest and square shoulders.
  lathe(
    [
      [0.05, 0.15, 0.19],
      [0.5, 0.14, 0.185],
      [0.95, 0.13, 0.18],
      [1.15, 0.14, 0.19],
      [1.32, 0.125, 0.205],
      [1.42, 0.1, 0.17],
      [1.47, 0.06, 0.08],
    ],
    0,
    1,
    { cap: true },
  );
  // Women: the abaya, falling fuller to the ground.
  lathe(
    [
      [0.02, 0.2, 0.24],
      [0.4, 0.17, 0.21],
      [0.9, 0.135, 0.175],
      [1.12, 0.13, 0.17],
      [1.3, 0.115, 0.18],
      [1.4, 0.09, 0.15],
      [1.45, 0.06, 0.08],
    ],
    0,
    2,
    { cap: true },
  );
  // The sleeves, from the shoulder, a little apart from the body; hands at their ends.
  for (const [side, swing] of [
    [1, 1],
    [-1, 2],
  ] as const) {
    lathe(
      [
        [0.84, 0.045, 0.045],
        [1.1, 0.05, 0.05],
        [1.4, 0.055, 0.06],
      ],
      0,
      0,
      { seg: 8, dz: side * 0.235, swing, cap: true },
    );
    blob(0.8, [0.04, 0.05, 0.032], 1, 0, { dz: side * 0.235, swing, seg: 8 });
  }
  // Neck and face (an eighth of the height), a little forward of the neck.
  lathe(
    [
      [1.43, 0.048, 0.05],
      [1.53, 0.045, 0.047],
    ],
    1,
    0,
    { seg: 8 },
  );
  blob(1.63, [0.095, 0.115, 0.082], 1, 0, { dx: 0.008 });
  // Men: the ghutra over a cap, held by the black agal, falling behind to the shoulders.
  lathe(
    [
      [1.66, 0.104, 0.092],
      [1.72, 0.103, 0.091],
      [1.76, 0.085, 0.078],
    ],
    2,
    1,
    { seg: 14, cap: true },
  );
  lathe(
    [
      [1.725, 0.106, 0.095],
      [1.745, 0.104, 0.093],
    ],
    3,
    1,
    { seg: 14 },
  );
  lathe(
    [
      [1.72, 0.108, 0.097],
      [1.58, 0.12, 0.13],
      [1.4, 0.15, 0.22],
      [1.3, 0.14, 0.215],
    ],
    2,
    1,
    { seg: 14, dx: -0.015, keep: (a) => Math.cos(a) < 0.35 },
  );
  // Women: the hijab round the face, and the khimar over the shoulders to the chest.
  blob(1.645, [0.108, 0.128, 0.096], 2, 2, { dx: -0.01, seg: 14 });
  lathe(
    [
      [1.62, 0.1, 0.1],
      [1.48, 0.13, 0.16],
      [1.34, 0.15, 0.225],
      [1.16, 0.15, 0.225],
    ],
    2,
    2,
    { seg: 14, dx: -0.005, keep: (a) => Math.cos(a) < 0.6 },
  );
  lathe(
    [
      [1.55, 0.095, 0.1],
      [1.4, 0.13, 0.18],
      [1.2, 0.145, 0.2],
    ],
    2,
    2,
    { seg: 14, keep: (a) => Math.cos(a) >= 0.6 },
  );
  const count = out.length / 9;
  // The shadow, a flat oval just above the ground.
  const s0: V3 = [-0.45, 0.012, -0.36];
  const s1: V3 = [0.45, 0.012, -0.36];
  const s2: V3 = [0.45, 0.012, 0.36];
  const s3: V3 = [-0.45, 0.012, 0.36];
  tri(s0, s2, s1, 0, 4, 0, [0, 1, 0]);
  tri(s0, s3, s2, 0, 4, 0, [0, 1, 0]);
  return { data: new Float32Array(out), shadowFirst: count, shadowCount: 6, count };
}

/**
 * A bier (owner, 2026-11-08): a wooden frame under a dark green cover, carried at shoulder height,
 * 2 m long; x forward. Its cover takes the robe colour, its frame the sandals'.
 */
function bierMesh(): { data: Float32Array; count: number } {
  const out: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, mat: number) => {
    for (const p of [a, b, c, a, c, d]) out.push(...p, ...n, 0, mat, 0);
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: number) => {
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], mat);
    quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], mat);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], mat);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], mat);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], mat);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], mat);
  };
  // The frame and its handles, resting on the carriers' shoulders.
  box(-1.0, 1.0, 1.4, 1.47, -0.3, 0.3, 3);
  box(-1.25, 1.25, 1.41, 1.45, -0.42, -0.38, 3);
  box(-1.25, 1.25, 1.41, 1.45, 0.38, 0.42, 3);
  // The cover, falling a little over the sides, and its rounded top.
  box(-0.98, 0.98, 1.33, 1.6, -0.31, 0.31, 0);
  box(-0.92, 0.92, 1.6, 1.68, -0.24, 0.24, 0);
  return { data: new Float32Array(out), count: out.length / 9 };
}

/** The cover's colour (dark green) for the bier's draw. */
const BIER_COVER: [number, number, number] = [0.08, 0.24, 0.16];
const MAX_BIERS = 4;

/**
 * A rehal (owner, 2026-11-09): the low wooden stand an open Qur'an rests on before a reader sitting
 * in the Mosque. About 0.3 m high, its leaves turned a little toward the reader; x forward.
 */
function rehalMesh(): { data: Float32Array; count: number } {
  const out: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, mat: number) => {
    for (const p of [a, b, c, a, c, d]) out.push(...p, ...n, 0, mat, 0);
  };
  const norm = (x: number, y: number, z: number): V3 => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  // The board the book rests on, its face turned up toward the reader.
  const near = 0.3;
  const far = 0.46;
  const low = 0.16;
  const high = 0.28;
  const half = 0.19;
  const n = norm(-0.6, 0.8, 0);
  quad([near, low, -half], [near, low, half], [far, high, half], [far, high, -half], n, 0);
  // The open pages, a little above the wood and a little inside it.
  const lift = 0.024;
  const p = (x: number, y: number, z: number): V3 => [x + n[0] * lift, y + n[1] * lift, z + n[2] * lift];
  quad(p(near, low, -half + 0.02), p(near, low, half - 0.02), p(far, high, half - 0.02), p(far, high, -half + 0.02), n, 2);
  // Two short legs under it.
  for (const side of [-1, 1]) {
    quad([0.33, 0, side * 0.155], [0.37, 0, side * 0.155], [0.37, 0.2, side * 0.155], [0.33, 0.2, side * 0.155], [0, 0, side], 0);
  }
  return { data: new Float32Array(out), count: out.length / 9 };
}

/** The rehal's wood and its pages, for its draw. */
const REHAL_WOOD: [number, number, number] = [0.36, 0.24, 0.14];
const REHAL_PAGES: [number, number, number] = [0.9, 0.88, 0.82];
/** The most figures at prayer the layer keeps places for (about what the scene draws well). */
const MAX_WORSHIPPERS = 1200;

/**
 * Who each walker is: robe, height, headwear, woman or man, skin (`data`, 8 floats each); and
 * `women`, 1 for each woman, which the walk keeps to (women only in the women's areas). About half
 * are women (owner, 2026-11-07: more women about their areas). A worshipper's sex, and a child's
 * smaller height, come from the place it was laid out at (`opts`).
 */
export function looks(n: number, seed: number, opts: { women?: ArrayLike<number>; scale?: ArrayLike<number> } = {}): { data: Float32Array; women: Uint8Array } {
  let s = seed;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const out = new Float32Array(n * 8);
  const women = new Uint8Array(n);
  for (let a = 0; a < n; a++) {
    const kind = r();
    // 0 a man in a thobe, 1 a woman in an abaya, 2 a pilgrim in coloured clothes.
    const branch = opts.women ? (r() < 0.18 ? 2 : opts.women[a] ? 1 : 0) : kind < 0.42 ? 0 : kind < 0.82 ? 1 : 2;
    let robe: number[];
    let head: number[];
    let woman = 0;
    let height: number;
    if (branch === 0) {
      // A man in a white thobe (some off-white or light grey), with a white or red shemagh.
      const w = 0.88 + r() * 0.08;
      robe = pick([
        [w, w, w * 0.97],
        [w, w, w * 0.97],
        [w * 0.95, w * 0.93, w * 0.86],
        [w * 0.86, w * 0.87, w * 0.88],
      ]);
      head = pick([
        [0.95, 0.95, 0.93],
        [0.95, 0.95, 0.93],
        [0.76, 0.22, 0.24],
        [0.8, 0.3, 0.3],
      ]);
      height = 1.66 + r() * 0.18;
    } else if (branch === 1) {
      // A woman in a black abaya and hijab; some in dark blue, beige or brown.
      woman = 1;
      const dark = r() < 0.75;
      robe = dark
        ? pick([
            [0.05, 0.05, 0.06],
            [0.07, 0.07, 0.08],
            [0.06, 0.07, 0.11],
          ])
        : pick([
            [0.6, 0.5, 0.4],
            [0.43, 0.34, 0.28],
            [0.3, 0.31, 0.36],
          ]);
      head = dark
        ? [0.04, 0.04, 0.05]
        : pick([
            [0.64, 0.54, 0.44],
            [0.7, 0.58, 0.6],
            [0.07, 0.07, 0.08],
          ]);
      height = 1.54 + r() * 0.16;
    } else {
      // Pilgrims in coloured clothes.
      robe = pick([
        [0.52, 0.64, 0.78],
        [0.4, 0.56, 0.46],
        [0.64, 0.6, 0.53],
        [0.56, 0.56, 0.58],
        [0.78, 0.6, 0.64],
      ]);
      woman = opts.women ? (opts.women[a] ? 1 : 0) : r() < 0.45 ? 1 : 0;
      head = woman
        ? pick([
            [0.92, 0.92, 0.9],
            [0.14, 0.14, 0.16],
            [0.58, 0.48, 0.4],
          ])
        : pick([
            [0.94, 0.94, 0.92],
            [0.2, 0.2, 0.22],
          ]);
      height = woman ? 1.52 + r() * 0.14 : 1.62 + r() * 0.16;
    }
    women[a] = woman;
    // A child is drawn at its place's scale (0.62, `prayer-session`), a grown worshipper at 1.
    out.set([...robe, height * (opts.scale?.[a] ?? 1), ...head, woman + r() * 0.49], a * 8);
  }
  return { data: out, women };
}

/**
 * People walking in the courtyards in 3D (owner, 2026-11-06), through the corridors and the
 * restrooms' walkways, clear of one another, the blocks and the columns (`crowd-sim.ts`). Shown
 * from zoom 17, where they are a few pixels tall; they stand still for those who ask for less motion.
 */
export class CrowdLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-crowd';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private instBuf: WebGLBuffer | null = null;
  private mesh = personMesh();
  private who = looks(CROWD_SIZE, 1234);
  private crowd: Crowd | null = null;
  private columns: [number, number][] | null = null;
  private inst = new Float32Array(CROWD_SIZE * 4);
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame = frameMatrix();
  private flows: Flows | null = null;
  private bier = bierMesh();
  private bierVao: WebGLVertexArrayObject | null = null;
  private bierInst: WebGLBuffer | null = null;
  private bierData = new Float32Array(MAX_BIERS * 4);
  // The worshippers at prayer: their places are laid out now and then (`crowd-sim.ts`), and drawn
  // from their own buffers, so an ordinary frame only submits them.
  private worshippers = new Worshippers();
  private worshipVao: WebGLVertexArrayObject | null = null;
  private worshipInst: WebGLBuffer | null = null;
  private worshipPose: WebGLBuffer | null = null;
  private worshipLook: WebGLBuffer | null = null;
  private worshipCount = 0;
  private worshipInstData = new Float32Array(MAX_WORSHIPPERS * 4);
  private worshipPoseData = new Float32Array(MAX_WORSHIPPERS * 4);
  private rehal = rehalMesh();
  private rehalVao: WebGLVertexArrayObject | null = null;
  private rehalInst: WebGLBuffer | null = null;
  private rehalCount = 0;
  private rehalData = new Float32Array(MAX_WORSHIPPERS * 4);

  /** `demo` names a prayer scene for a preview link (`?prayerDemo=fajr`); without it, the clock. */
  constructor(
    private light: SceneLight,
    private demo: PrayerDemoOverride | null = null,
  ) {}

  /** Where the canopy and lamp columns stand: the walkers can be placed once they are known. */
  setColumns(lngLats: [number, number][]): void {
    this.columns = lngLats;
    this.map?.triggerRepaint();
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;
    for (const name of ['u_mvp', 'u_sunDir', 'u_sun', 'u_ambient', 'u_night', 'u_posture']) this.u[name] = gl.getUniformLocation(prog, name);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh.data, gl.STATIC_DRAW);
    for (const [loc, size, off] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off);
    }
    const inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(3, 1);
    const look = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, look);
    gl.bufferData(gl.ARRAY_BUFFER, this.who.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.instBuf = inst;
    // The biers: their own mesh and places; their look is constant (attributes 4 and 5 left off).
    const bvao = gl.createVertexArray()!;
    gl.bindVertexArray(bvao);
    const bvbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, bvbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.bier.data, gl.STATIC_DRAW);
    for (const [loc, size, off] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off);
    }
    const binst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, binst);
    gl.bufferData(gl.ARRAY_BUFFER, this.bierData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.disableVertexAttribArray(4);
    gl.disableVertexAttribArray(5);
    gl.bindVertexArray(null);
    this.bierVao = bvao;
    this.bierInst = binst;
    // The worshippers: the same figure, their own places, looks and pose.
    const wvao = gl.createVertexArray()!;
    gl.bindVertexArray(wvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (const [loc, size, off] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off);
    }
    const wInst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wInst);
    gl.bufferData(gl.ARRAY_BUFFER, this.worshipInstData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(3, 1);
    const wLook = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wLook);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_WORSHIPPERS * 8 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(5, 1);
    const wPose = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wPose);
    gl.bufferData(gl.ARRAY_BUFFER, this.worshipPoseData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
    this.worshipVao = wvao;
    this.worshipInst = wInst;
    this.worshipLook = wLook;
    this.worshipPose = wPose;
    // The rehals: their own mesh and places; wood and pages are constant (attributes 4–6 left off).
    const rvao = gl.createVertexArray()!;
    gl.bindVertexArray(rvao);
    const rvbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rvbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.rehal.data, gl.STATIC_DRAW);
    for (const [loc, size, off] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off);
    }
    const rinst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rinst);
    gl.bufferData(gl.ARRAY_BUFFER, this.rehalData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.disableVertexAttribArray(4);
    gl.disableVertexAttribArray(5);
    gl.disableVertexAttribArray(6);
    gl.bindVertexArray(null);
    this.rehalVao = rvao;
    this.rehalInst = rinst;
    this.buffers = [vbo, inst, look, bvbo, binst, wInst, wLook, wPose, rvbo, rinst];
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.bierVao) gl.deleteVertexArray(this.bierVao);
    if (this.worshipVao) gl.deleteVertexArray(this.worshipVao);
    if (this.rehalVao) gl.deleteVertexArray(this.rehalVao);
    this.bierVao = null;
    this.bierInst = null;
    this.worshipVao = null;
    this.worshipInst = null;
    this.worshipPose = null;
    this.worshipLook = null;
    this.rehalVao = null;
    this.rehalInst = null;
    this.worshipCount = 0;
    this.rehalCount = 0;
    this.flows = null;
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.program = null;
    this.buffers = [];
    this.map = null;
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const map = this.map;
    if (!map || !this.program || !this.vao || !this.instBuf || map.getZoom() < CROWD_MIN_ZOOM) return;
    // The walkers keep about what is being looked at: a circle round the view's centre as wide as
    // the screen, so the corridors there are as busy as the photographs, at the same cost.
    const centre = map.getCenter();
    const [cx, cz] = metresFromOrigin([centre.lng, centre.lat]);
    const metresPerPixel = (40_075_016.686 * Math.cos((centre.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const canvas = map.getCanvas();
    const radius = Math.max(40, Math.min(320, metresPerPixel * Math.max(canvas.clientWidth, canvas.clientHeight) * 0.7));
    if (!this.crowd) {
      if (!this.columns) return;
      this.crowd = new Crowd(crowdInput(this.columns), CROWD_SIZE, 7, this.who.women);
      this.crowd.keepNear(cx, cz, radius, 0);
      this.flows = new Flows(this.crowd);
      this.last = performance.now();
    }
    this.crowd.keepNear(cx, cz, radius);
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    const crowd = this.crowd;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = performance.now();
    const clock = new Date();
    // The worshippers at prayer (owner, 2026-11-09): laid out when the scene changes, then drawn as they are.
    if (this.worshippers.sync(clock, this.demo, { columns: this.columns ?? [] })) this.buildWorshippers(gl);
    const prayer = this.worshippers.session;
    // At the congregational prayer the courtyards are the rows; the walkers wait for it to end.
    const congregational = prayer != null && (prayer.phase === 'fard_prayer' || prayer.phase === 'friday_khutbah' || prayer.phase === 'friday_prayer');
    const dt = Math.min(0.1, (now - this.last) / 1000);
    // The queues for the Rawdah, the greeting at the Prophet's chamber, a funeral now and then
    // (owner, 2026-11-08): while the view is about the south of the Mosque.
    this.flows?.update(still ? 0 : dt, clock, Flows.near(cx, cz, radius));
    if (!still) crowd.step(dt);
    this.last = now;
    // Each walker keeps its own looks (the looks buffer is by walker): one not placed is drawn far
    // below the ground, out of sight.
    const k = crowd.n;

    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.u_mvp, false, new Float32Array(mvp));
    gl.uniform3fv(this.u.u_sunDir, this.light.sunDir);
    gl.uniform3fv(this.u.u_sun, this.light.sun);
    gl.uniform3fv(this.u.u_ambient, this.light.ambient);
    gl.uniform1f(this.u.u_night, this.light.night);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!congregational) {
      for (let a = 0; a < crowd.n; a++) {
        const off = Number.isNaN(crowd.px[a]);
        this.inst.set([off ? 0 : crowd.px[a], off ? 1e6 : crowd.pz[a], crowd.heading[a], crowd.phase[a]], a * 4);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst.subarray(0, k * 4));
      gl.uniform1f(this.u.u_posture, 0);
      gl.bindVertexArray(this.vao);
      // The shadows first, blended on the ground; then the people, solid.
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLES, this.mesh.shadowFirst, this.mesh.shadowCount, k);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.mesh.count, k);
    }
    // The rows: the session's posture moves them all together (a uniform, not a new crowd).
    if (this.worshipCount && this.worshipVao) {
      gl.bindVertexArray(this.worshipVao);
      gl.uniform1f(this.u.u_posture, POSTURE_CODE[prayer?.posture ?? 'standing']);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLES, this.mesh.shadowFirst, this.mesh.shadowCount, this.worshipCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.mesh.count, this.worshipCount);
    }
    // The rehals before those reading; their wood and pages are constant colours.
    if (this.rehalCount && this.rehalVao) {
      gl.bindVertexArray(this.rehalVao);
      gl.uniform1f(this.u.u_posture, 0);
      gl.vertexAttrib4f(4, REHAL_WOOD[0], REHAL_WOOD[1], REHAL_WOOD[2], 1.75);
      gl.vertexAttrib4f(5, REHAL_PAGES[0], REHAL_PAGES[1], REHAL_PAGES[2], 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.rehal.count, this.rehalCount);
    }
    const biers = this.flows?.biers() ?? [];
    if (biers.length && this.bierVao && this.bierInst) {
      const nb = Math.min(MAX_BIERS, biers.length);
      for (let b = 0; b < nb; b++) this.bierData.set([biers[b].x, biers[b].z, biers[b].heading, 0], b * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bierInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.bierData.subarray(0, nb * 4));
      gl.bindVertexArray(this.bierVao);
      gl.vertexAttrib4f(4, BIER_COVER[0], BIER_COVER[1], BIER_COVER[2], 1.75);
      gl.vertexAttrib4f(5, 0, 0, 0, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.bier.count, nb);
    }
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);

    if (!still && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.map?.triggerRepaint();
      }, FRAME_MS);
    }
  }

  /**
   * Lay the worshippers out from the places the prayer scene left: who they are (a man, a woman, a
   * child at its place's scale), the pose they are drawn in, and the rehal before each reader.
   */
  private buildWorshippers(gl: WebGL2RenderingContext): void {
    const places = this.worshippers.placements;
    const n = Math.min(MAX_WORSHIPPERS, places.length);
    const women = new Uint8Array(n);
    const scale = new Float32Array(n);
    let rehals = 0;
    for (let a = 0; a < n; a++) {
      const w = places[a];
      women[a] = w.isWoman ? 1 : 0;
      scale[a] = w.scale;
      this.worshipInstData.set([w.x, w.z, w.heading, 0], a * 4);
      this.worshipPoseData.set([worshipperPose(w), w.hasRehal ? 1 : 0, w.isChild ? 1 : 0, 0], a * 4);
      if (w.hasRehal) {
        this.rehalData.set([w.x + Math.cos(w.heading) * 0.5, w.z + Math.sin(w.heading) * 0.5, w.heading, 0], rehals * 4);
        rehals++;
      }
    }
    this.worshipCount = n;
    this.rehalCount = rehals;
    if (!this.worshipInst || !this.worshipPose || !this.worshipLook) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.worshipInst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.worshipInstData.subarray(0, n * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.worshipPose);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.worshipPoseData.subarray(0, n * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.worshipLook);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, looks(n, 4321, { women, scale }).data.subarray(0, n * 8));
    if (this.rehalInst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rehalInst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.rehalData.subarray(0, rehals * 4));
    }
  }
}
