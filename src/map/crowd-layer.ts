import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { Crowd } from './crowd-sim';
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

uniform mat4 u_mvp;

out vec3 v_normal;
out vec3 v_color;
out float v_mat;
out vec2 v_local;

void main() {
  float woman = floor(a_head.w);
  float skin = fract(a_head.w) * 2.0;
  bool hidden = (a_part.z == 1.0 && woman > 0.5) || (a_part.z == 2.0 && woman < 0.5);
  float s = a_robe.w / 1.75;
  vec3 p = a_pos * vec3(1.0, s, 1.0);
  vec3 n = a_normal;
  float ph = a_inst.w;
  float swing = sin(ph);
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
  float c = cos(a_inst.z);
  float sn = sin(a_inst.z);
  vec3 world = vec3(a_inst.x + p.x * c - p.z * sn, p.y, a_inst.y + p.x * sn + p.z * c);
  gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : u_mvp * vec4(world, 1.0);
  v_normal = vec3(n.x * c - n.z * sn, n.y, n.x * sn + n.z * c);
  vec3 skinCol = mix(vec3(0.86, 0.68, 0.55), vec3(0.36, 0.24, 0.17), skin);
  v_color = a_part.y == 0.0 ? a_robe.rgb : a_part.y == 1.0 ? skinCol : a_part.y == 2.0 ? a_head.rgb : vec3(0.18, 0.15, 0.13);
  v_mat = a_part.y;
  v_local = a_pos.xz;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in float v_mat;
in vec2 v_local;
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
  float direct = max(dot(n, normalize(u_sunDir)), 0.0);
  float sky = 0.75 + 0.25 * n.y;
  vec3 lit = v_color * (u_ambient * sky + u_sun * direct);
  // At night the plazas' lamps light people from above, near white.
  lit += v_color * vec3(0.42, 0.41, 0.38) * u_night * (0.6 + 0.4 * max(n.y, 0.0));
  fragColor = vec4(lit, 1.0);
}
`;

type V3 = [number, number, number];

/** The figure: x forward, y up, z to the side; 1.75 m tall before the walker's own height. */
function personMesh(): { data: Float32Array; shadowFirst: number; shadowCount: number; count: number } {
  const out: number[] = [];
  const push = (p: V3, n: V3, swing: number, mat: number, who: number) => out.push(...p, ...n, swing, mat, who);
  const tri = (a: V3, b: V3, c: V3, swing: number, mat: number, who: number, normal?: V3) => {
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = normal ?? [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    push(a, n, swing, mat, who);
    push(b, n, swing, mat, who);
    push(c, n, swing, mat, who);
  };
  /** A tube from y0 (radii forward/side r0) to y1 (r1), over the angles where `keep` says so. */
  const tube = (
    y0: number,
    r0: [number, number],
    y1: number,
    r1: [number, number],
    mat: number,
    who: number,
    opts: { seg?: number; dx?: number; keep?: (a: number) => boolean; cap?: boolean; swing?: number; dz?: number } = {},
  ) => {
    const seg = opts.seg ?? 10;
    const dx = opts.dx ?? 0;
    const dz = opts.dz ?? 0;
    const swing = opts.swing ?? 0;
    const at = (a: number, y: number, r: [number, number]): V3 => [dx + Math.cos(a) * r[0], y, dz + Math.sin(a) * r[1]];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      if (opts.keep && !opts.keep((a0 + a1) / 2)) continue;
      const mid = (a0 + a1) / 2;
      const nrm: V3 = [Math.cos(mid), 0.15, Math.sin(mid)];
      tri(at(a0, y0, r0), at(a1, y0, r0), at(a1, y1, r1), swing, mat, who, nrm);
      tri(at(a0, y0, r0), at(a1, y1, r1), at(a0, y1, r1), swing, mat, who, nrm);
      if (opts.cap) tri([dx, y1, dz], at(a1, y1, r1), at(a0, y1, r1), swing, mat, who, [0, 1, 0]);
    }
  };
  /** An ellipsoid (rings of tubes). */
  const blob = (cy: number, r: V3, mat: number, who: number, dx = 0) => {
    const rings = 5;
    for (let k = 0; k < rings; k++) {
      const t0 = -Math.PI / 2 + (k / rings) * Math.PI;
      const t1 = -Math.PI / 2 + ((k + 1) / rings) * Math.PI;
      tube(
        cy + Math.sin(t0) * r[1],
        [Math.cos(t0) * r[0] + 1e-3, Math.cos(t0) * r[2] + 1e-3],
        cy + Math.sin(t1) * r[1],
        [Math.cos(t1) * r[0] + 1e-3, Math.cos(t1) * r[2] + 1e-3],
        mat,
        who,
        { seg: 8, dx },
      );
    }
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
  // Feet in sandals, under the hem.
  box(-0.08, 0.16, 0, 0.07, 0.05, 0.14, 3, 3, 0);
  box(-0.08, 0.16, 0, 0.07, -0.14, -0.05, 4, 3, 0);
  // The robe (thobe or abaya), wider at the hem, and the shoulders.
  tube(0.06, [0.2, 0.25], 1.3, [0.13, 0.2], 0, 0, { seg: 12 });
  tube(1.3, [0.13, 0.2], 1.46, [0.09, 0.13], 0, 0, { seg: 12, cap: true });
  // Arms in the robe's sleeves, hands at their ends.
  box(-0.05, 0.05, 0.86, 1.42, 0.2, 0.27, 1, 0, 0);
  box(-0.05, 0.05, 0.86, 1.42, -0.27, -0.2, 2, 0, 0);
  box(-0.04, 0.04, 0.78, 0.87, 0.21, 0.26, 1, 1, 0);
  box(-0.04, 0.04, 0.78, 0.87, -0.26, -0.21, 2, 1, 0);
  // Neck and face.
  tube(1.44, [0.05, 0.05], 1.55, [0.05, 0.05], 1, 0, { seg: 6 });
  blob(1.64, [0.1, 0.12, 0.09], 1, 0);
  // Men: a shemagh or cap on the head, falling behind to the shoulders.
  tube(1.66, [0.112, 0.102], 1.78, [0.1, 0.095], 2, 1, { seg: 10, cap: true });
  tube(1.72, [0.115, 0.105], 1.38, [0.17, 0.22], 2, 1, { seg: 12, dx: -0.02, keep: (a) => Math.cos(a) < 0.3 });
  // Women: the hijab round the face and over the shoulders.
  blob(1.65, [0.118, 0.135, 0.108], 2, 2, -0.012);
  tube(1.6, [0.11, 0.12], 1.3, [0.19, 0.25], 2, 2, { seg: 12, keep: (a) => Math.cos(a) < 0.55 });
  tube(1.55, [0.1, 0.11], 1.3, [0.17, 0.22], 2, 2, { seg: 12, keep: (a) => Math.cos(a) >= 0.55 });
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

/** Who each walker is: robe, height, headwear, woman or man, skin. */
function looks(n: number, seed: number): Float32Array {
  let s = seed;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const out = new Float32Array(n * 8);
  for (let a = 0; a < n; a++) {
    const kind = r();
    let robe: number[];
    let head: number[];
    let woman = 0;
    let height: number;
    if (kind < 0.5) {
      // A man in a white thobe, with a white or red shemagh, or a white cap.
      const w = 0.9 + r() * 0.06;
      robe = [w, w, w * 0.97];
      head = pick([
        [0.95, 0.95, 0.93],
        [0.95, 0.95, 0.93],
        [0.78, 0.3, 0.3],
        [0.94, 0.94, 0.92],
      ]);
      height = 1.66 + r() * 0.18;
    } else if (kind < 0.85) {
      // A woman in a black abaya and hijab; some in beige or brown.
      woman = 1;
      const dark = r() < 0.75;
      robe = dark
        ? [0.06, 0.06, 0.07]
        : pick([
            [0.62, 0.52, 0.42],
            [0.45, 0.36, 0.3],
          ]);
      head = dark
        ? [0.05, 0.05, 0.06]
        : pick([
            [0.66, 0.56, 0.46],
            [0.72, 0.6, 0.62],
            [0.08, 0.08, 0.09],
          ]);
      height = 1.54 + r() * 0.16;
    } else {
      // Pilgrims in coloured clothes.
      robe = pick([
        [0.55, 0.68, 0.82],
        [0.42, 0.6, 0.48],
        [0.66, 0.62, 0.55],
        [0.58, 0.58, 0.6],
        [0.82, 0.62, 0.68],
      ]);
      head = pick([
        [0.94, 0.94, 0.92],
        [0.15, 0.15, 0.17],
        [0.6, 0.5, 0.4],
      ]);
      woman = r() < 0.4 ? 1 : 0;
      height = woman ? 1.52 + r() * 0.14 : 1.62 + r() * 0.16;
    }
    out.set([...robe, height, ...head, woman + r() * 0.49], a * 8);
  }
  return out;
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
  private crowd: Crowd | null = null;
  private columns: [number, number][] | null = null;
  private inst = new Float32Array(CROWD_SIZE * 4);
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame = frameMatrix();

  constructor(private light: SceneLight) {}

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
    for (const name of ['u_mvp', 'u_sunDir', 'u_sun', 'u_ambient', 'u_night']) this.u[name] = gl.getUniformLocation(prog, name);

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
    gl.bufferData(gl.ARRAY_BUFFER, looks(CROWD_SIZE, 1234), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.instBuf = inst;
    this.buffers = [vbo, inst, look];
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.vao) gl.deleteVertexArray(this.vao);
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
      this.crowd = new Crowd(crowdInput(this.columns), CROWD_SIZE, 7);
      this.crowd.keepNear(cx, cz, radius, 0);
      this.last = performance.now();
    }
    this.crowd.keepNear(cx, cz, radius);
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    const crowd = this.crowd;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = performance.now();
    if (!still) crowd.step(Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    let k = 0;
    for (let a = 0; a < crowd.n; a++) {
      if (Number.isNaN(crowd.px[a])) continue;
      this.inst.set([crowd.px[a], crowd.pz[a], crowd.heading[a], crowd.phase[a]], k * 4);
      k++;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst.subarray(0, k * 4));

    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.u_mvp, false, new Float32Array(mvp));
    gl.uniform3fv(this.u.u_sunDir, this.light.sunDir);
    gl.uniform3fv(this.u.u_sun, this.light.sun);
    gl.uniform3fv(this.u.u_ambient, this.light.ambient);
    gl.uniform1f(this.u.u_night, this.light.night);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    // The shadows first, blended on the ground; then the people, solid.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLES, this.mesh.shadowFirst, this.mesh.shadowCount, k);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.mesh.count, k);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);

    if (!still && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.map?.triggerRepaint();
      }, FRAME_MS);
    }
  }
}
