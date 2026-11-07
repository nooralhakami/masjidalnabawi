import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS } from '../data-next/alharamain-3d';
import { frameMatrix, mulMat4 } from './glb-layer';
import { cameraEye } from './plaza-layer';
import { RUG_D, RUG_W, rugLayout } from './rug-layout';
import type { SceneLight } from './scene-light';
import { createShadowTexture, SHADOW_GLSL, sunShadow } from './sun-shadow';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;  // -1..1 across, -1..1 deep
layout(location = 1) in vec4 a_rug;     // centre x, z, flip (0/1), tone
uniform mat4 u_mvp;
uniform float u_turn;
uniform vec2 u_size;
out vec2 v_uv;
out vec2 v_pos;
out float v_tone;
void main() {
  vec2 local = a_corner * u_size * 0.5;
  // Laid with the canopies' turn: rows run with the paving.
  float c = cos(u_turn);
  float s = sin(u_turn);
  vec2 world = a_rug.xy + vec2(c * local.x + s * local.y, -s * local.x + c * local.y);
  gl_Position = u_mvp * vec4(world.x, 0.0, world.y, 1.0);
  vec2 uv = a_corner * 0.5 + 0.5;
  v_uv = a_rug.z > 0.5 ? 1.0 - uv : uv;
  v_pos = world;
  v_tone = a_rug.w;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_pos;
in float v_tone;
uniform sampler2D u_tex;
uniform float u_night;
uniform vec3 u_eye;
uniform highp sampler2DShadow u_shadowMap;
uniform mat4 u_light;
uniform float u_shadow;
out vec4 fragColor;
${SHADOW_GLSL}
void main() {
  vec3 color = texture(u_tex, v_uv).rgb * v_tone;
  if (u_shadow > 0.0) {
    float shade = (1.0 - sunLit(u_light * vec4(v_pos.x, 0.0, v_pos.y, 1.0), 0.0008)) * u_shadow;
    color *= mix(1.0, 0.6, shade);
  }
  color *= mix(vec3(1.0), vec3(0.6, 0.6, 0.58), u_night);
  vec3 toEye = u_eye - vec3(v_pos.x, 0.0, v_pos.y);
  float depression = toEye.y / max(length(toEye.xz), 1.0);
  fragColor = vec4(color, smoothstep(0.03, 0.12, depression));
}
`;

/**
 * One carpet, drawn as the owner's reference photograph shows the Mosque's (2026-11-07): a deep navy
 * border of rosettes between gold lines, an olive-green field strewn with small flowers and leaves,
 * cream corners, and two medallions on navy lozenges with cream hearts. 2048 × 492 px for 5 × 1.2 m.
 */
export function drawRug(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  let seed = 11;
  const r = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const NAVY = '#1c2a4f';
  const GREEN = '#6a7a2c';
  const CREAM = '#efe4c4';
  const GOLD = '#c9a85a';
  const SKY = '#8fb2c9';
  const flower = (x: number, y: number, rad: number, petals: number, fill: string, heart: string) => {
    ctx.fillStyle = fill;
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * rad * 0.55, y + Math.sin(a) * rad * 0.55, rad * 0.5, rad * 0.28, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = heart;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.28, 0, Math.PI * 2);
    ctx.fill();
  };
  const vine = (x: number, y: number, len: number, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const a = r() * Math.PI * 2;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 1) * len, y + Math.sin(a + 1) * len, x + Math.cos(a) * len * 1.6, y + Math.sin(a) * len * 1.6);
    ctx.stroke();
  };
  const b = H * 0.13; // the border band
  const line = H * 0.012;
  // The border: navy, gold lines either side, rosettes along it.
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GOLD;
  ctx.fillRect(line * 0.5, line * 0.5, W - line, line);
  ctx.fillRect(line * 0.5, H - line * 1.5, W - line, line);
  ctx.fillRect(line * 0.5, line * 0.5, line, H - line);
  ctx.fillRect(W - line * 1.5, line * 0.5, line, H - line);
  const step = b * 0.95;
  for (let x = b * 0.6; x < W - b * 0.4; x += step) {
    for (const y of [b * 0.52, H - b * 0.52]) {
      vine(x, y, b * 0.25, GOLD);
      flower(x, y, b * 0.24, 6, Math.round(x / step) % 2 ? CREAM : SKY, GOLD);
    }
  }
  for (let y = b * 1.4; y < H - b * 1.2; y += step) {
    for (const x of [b * 0.52, W - b * 0.52]) flower(x, y, b * 0.24, 6, Math.round(y / step) % 2 ? CREAM : SKY, GOLD);
  }
  // The field.
  const f = { x: b, y: b, w: W - 2 * b, h: H - 2 * b };
  ctx.fillStyle = GOLD;
  ctx.fillRect(f.x - line, f.y - line, f.w + 2 * line, f.h + 2 * line);
  ctx.fillStyle = GREEN;
  ctx.fillRect(f.x, f.y, f.w, f.h);
  // A soft weave over the green.
  for (let k = 0; k < 2600; k++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(40,52,16,0.25)' : 'rgba(150,160,80,0.18)';
    ctx.fillRect(f.x + r() * f.w, f.y + r() * f.h, 3 + r() * 6, 2);
  }
  // Cream corners, curved toward the field, outlined in navy.
  for (const [cx, cy, sx, sy] of [
    [f.x, f.y, 1, 1],
    [f.x + f.w, f.y, -1, 1],
    [f.x, f.y + f.h, 1, -1],
    [f.x + f.w, f.y + f.h, -1, -1],
  ]) {
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + sx * f.h * 0.62, cy);
    ctx.quadraticCurveTo(cx + sx * f.h * 0.28, cy + sy * f.h * 0.2, cx + sx * f.h * 0.18, cy + sy * f.h * 0.5);
    ctx.quadraticCurveTo(cx + sx * f.h * 0.08, cy + sy * f.h * 0.42, cx, cy + sy * f.h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    flower(cx + sx * f.h * 0.14, cy + sy * f.h * 0.14, f.h * 0.07, 5, NAVY, GOLD);
  }
  // Flowers and leaves strewn over the field.
  for (let k = 0; k < 520; k++) {
    const x = f.x + 12 + r() * (f.w - 24);
    const y = f.y + 12 + r() * (f.h - 24);
    vine(x, y, 10 + r() * 14, r() < 0.5 ? '#3d4a18' : '#a8a46a');
    const pick = r();
    flower(x, y, 6 + r() * 9, 5 + Math.floor(r() * 3), pick < 0.45 ? CREAM : pick < 0.75 ? GOLD : pick < 0.9 ? SKY : NAVY, pick < 0.75 ? '#8a5a2a' : CREAM);
  }
  // The two medallions: a lobed navy lozenge, gold-edged, round a cream heart.
  for (const mx of [f.x + f.w * 0.17, f.x + f.w * 0.83]) {
    const my = H / 2;
    const rx = f.h * 0.62;
    const ry = f.h * 0.46;
    ctx.fillStyle = NAVY;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const lobe = 1 + 0.08 * Math.cos(a * 8);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const diamond = 1 / (Math.abs(dx) + Math.abs(dy));
      const x = mx + dx * rx * diamond * lobe;
      const y = my + dy * ry * diamond * lobe;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      flower(mx + Math.cos(a) * rx * 0.45, my + Math.sin(a) * ry * 0.45, 7, 5, k % 2 ? GOLD : SKY, CREAM);
    }
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = GOLD;
    ctx.beginPath();
    ctx.ellipse(mx, my, rx * 0.24, ry * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    flower(mx, my, ry * 0.17, 6, NAVY, GOLD);
  }
}

/**
 * The prayer carpets in 3D (owner, 2026-11-07): each laid whole where `rugLayout` puts it, drawn
 * with the carpet above, some turned round and a shade lighter or darker so no two rows look
 * stamped. They lie on the paving, take the canopies' shadows and the night's light like it.
 */
export class RugLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-rugs';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private tex: WebGLTexture | null = null;
  private noShadow: WebGLTexture | null = null;
  private count = 0;
  private columns: [number, number][] | null = null;
  private dirty = false;
  private frame = frameMatrix();

  constructor(private light: SceneLight) {}

  setColumns(lngLats: [number, number][]): void {
    this.columns = lngLats;
    this.dirty = true;
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
    for (const n of ['u_mvp', 'u_turn', 'u_size', 'u_tex', 'u_night', 'u_eye', 'u_shadowMap', 'u_light', 'u_shadow']) this.u[n] = gl.getUniformLocation(prog, n);

    // The carpet's picture, drawn once.
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 492;
    const ctx = canvas.getContext('2d');
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (ctx) {
      drawRug(ctx, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([106, 122, 44, 255]));
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.noShadow = createShadowTexture(gl, 1);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.buffers = [quad, inst];
    this.dirty = true;
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.noShadow) gl.deleteTexture(this.noShadow);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.program = null;
    this.buffers = [];
    this.map = null;
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.vao || !this.columns) return;
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    if (this.dirty) {
      const { rugs } = rugLayout(this.columns);
      const data = new Float32Array(rugs.length * 4);
      let seed = 3;
      rugs.forEach((rug, i) => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data.set([rug.x, rug.z, rug.flip ? 1 : 0, 0.93 + (seed / 4294967296) * 0.12], i * 4);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.count = rugs.length;
      this.dirty = false;
    }
    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);
    gl.useProgram(this.program);
    // On the ground over the paving, like it: no depth, blended.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(this.u.u_mvp, false, new Float32Array(mvp));
    gl.uniform1f(this.u.u_turn, (ALHARAMAIN_MODELS[1].rotation * Math.PI) / 180);
    gl.uniform2f(this.u.u_size, RUG_W, RUG_D);
    gl.uniform1f(this.u.u_night, this.light.night);
    const eye = this.map ? cameraEye(this.map) : ([0, 1000, 0] as const);
    gl.uniform3f(this.u.u_eye, eye[0], eye[1], eye[2]);
    gl.uniformMatrix4fv(this.u.u_light, false, sunShadow.matrix);
    gl.uniform1f(this.u.u_shadow, sunShadow.texture ? sunShadow.strength : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sunShadow.texture ?? this.noShadow);
    gl.uniform1i(this.u.u_shadowMap, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.u_tex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }
}
