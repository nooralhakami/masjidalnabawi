import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../data-next/alharamain-3d';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import { triangulate } from './polygon';
import type { SceneLight } from './scene-light';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_kind;

uniform mat4 u_mvp;

out vec2 v_pos;
out float v_kind;

void main() {
  gl_Position = u_mvp * vec4(a_pos.x, 0.0, a_pos.y, 1.0);
  v_pos = a_pos;
  v_kind = a_kind;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_pos;
in float v_kind;

uniform float u_turn;
uniform float u_night;
uniform vec2 u_grid;
// The Mosque's footprint (from its own model): the main block and the narrower southern block, as
// boxes (centre x, z, half width, half depth) in the models' frame.
uniform vec4 u_main;
uniform vec4 u_south;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Distance outside a box, square at the corners (so a band round it keeps square corners).
float box(vec2 p, vec4 b) {
  vec2 d = abs(p - b.xy) - b.zw;
  return max(d.x, d.y);
}

// A line of width w at distance d, smoothed over the pixel footprint fw.
float line(float d, float w, float fw) {
  return 1.0 - smoothstep(w, w + fw * 1.5, abs(d));
}

// Joints of a grid of cells (size), half width w in metres: coverage of the nearest line, kept at
// least about a pixel wide, and faded where the grid would only shimmer.
float joints(vec2 p, vec2 size, float w) {
  vec2 d = (0.5 - abs(fract(p / size) - 0.5)) * size;
  vec2 fw = fwidth(p);
  vec2 hw = max(vec2(w), fw * 0.5);
  vec2 j = (1.0 - smoothstep(hw, hw + fw, d)) * min(vec2(1.0), vec2(w) / hw * 1.5 + 0.35);
  float fade = 1.0 - smoothstep(0.15, 0.45, max(fw.x / size.x, fw.y / size.y) * 6.0);
  return max(j.x, j.y) * fade;
}

void main() {
  float c = cos(u_turn);
  float s = sin(u_turn);
  // The paving follows the Mosque and the canopy grid (u_grid: a canopy column, in the turned frame).
  vec2 p = vec2(c * v_pos.x - s * v_pos.y, s * v_pos.x + c * v_pos.y) - u_grid;
  float fwP = max(fwidth(p.x), fwidth(p.y));

  vec3 color;
  float alpha;

  if (v_kind > 0.5) {
    // The western plaza: whitish polished concrete, no inlays, only long lines both ways with wide
    // squares between them, set square to the qibla (owner, 2026-11-04).
    color = vec3(0.9, 0.89, 0.86);
    alpha = 0.5;
    float grid = joints(p, vec2(8.0), 0.08);
    color = mix(color, vec3(0.5, 0.5, 0.51), grid);
    alpha = mix(alpha, 0.6, grid);
  } else {
    // How far from the Mosque's walls (negative inside).
    float wall = min(box(v_pos, u_main), box(v_pos, u_south));
    if (wall < 10.0) {
      // Along the walls: small white rectangles side by side, rows staggered (owner's photographs).
      vec2 q = vec2(p.x + 0.6 * floor(p.y / 0.6), p.y);
      color = vec3(0.94, 0.93, 0.9);
      alpha = 0.6;
      float j = joints(q, vec2(1.2, 0.6), 0.012);
      color = mix(color, vec3(0.62, 0.62, 0.6), j);
    } else {
      // Grey speckled granite in square slabs, panels between four canopies framed by a double
      // dark band (the owner's photographs).
      float speck = hash(floor(p * 24.0)) * (1.0 - smoothstep(0.004, 0.02, fwP));
      color = vec3(0.6, 0.6, 0.59) * (0.9 + 0.2 * speck);
      alpha = 0.45;
      float j = joints(p, vec2(1.2), 0.012);
      color = mix(color, vec3(0.42, 0.42, 0.42), j);
      const float P = 24.1;
      vec2 lp = (fract(p / P) - 0.5) * P;
      float edge = P * 0.5 - max(abs(lp.x), abs(lp.y));
      float fwE = fwidth(edge);
      float band = line(edge - 0.4, 0.3, fwE);
      color = mix(color, vec3(0.3, 0.3, 0.31), band);
      alpha = mix(alpha, 0.5, band);
    }
    // A dark granite strip where the white band meets the granite.
    float strip = line(wall - 10.6, 0.6, fwidth(wall));
    color = mix(color, vec3(0.2, 0.2, 0.21), strip);
    alpha = mix(alpha, 0.68, strip);
  }

  // At night the stone is lit by the lamps and the pools of light lie over it.
  color *= mix(1.0, 0.6, u_night);
  fragColor = vec4(color, alpha);
}
`;

/**
 * The paving of the plazas round the Mosque in the 3D view, after the owner's description and
 * photographs (2026-11-04): white rectangles along the Mosque's walls edged by a dark granite strip,
 * grey speckled granite slabs framed by dark bands between the canopies, and in the western plaza
 * whitish polished concrete with wide lines square to the qibla. Drawn by the shader in real metres
 * (so it keeps its size as the visitor zooms), part see-through over navQ's official plaza colours
 * (`alharamain-3d-plaza`), which still tint it. A look, not a survey of the actual paving.
 */
export class PlazaMarbleLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-marble';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private frame = frameMatrix();

  constructor(private light: SceneLight) {}

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;
    for (const name of ['u_mvp', 'u_turn', 'u_night', 'u_grid', 'u_main', 'u_south']) this.uniforms[name] = gl.getUniformLocation(prog, name);

    const { vertices, indices } = plazaMesh();
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.vertexAttribDivisor(1, 0);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.buffers = [vbo, ibo];
    this.count = indices.length;
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.buffers = [];
    this.program = null;
    this.map = null;
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.vao) return;
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);

    gl.useProgram(this.program);
    // Lies on the ground like the plaza colours under it: no depth, blended over them.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(this.uniforms.u_mvp, false, new Float32Array(mvp));
    // Turned with the Mosque's files (`threeDRotation`, clockwise from above).
    gl.uniform1f(this.uniforms.u_turn, (ALHARAMAIN_MODELS[1].rotation * Math.PI) / 180);
    gl.uniform1f(this.uniforms.u_night, this.light.night);
    gl.uniform2fv(this.uniforms.u_grid, CANOPY_GRID);
    gl.uniform4fv(this.uniforms.u_main, MOSQUE_MAIN);
    gl.uniform4fv(this.uniforms.u_south, MOSQUE_SOUTH);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }
}

/**
 * A canopy column of navQ's file (its node `00CanopyClosed`, at -171.45 m east, -400.41 m south of
 * the canopies' anchor), in the Mosque's frame turned with the paving: the panels' corners stand on
 * the canopy grid, so each medallion lies between four canopies.
 */
const CANOPY_GRID: [number, number] = (() => {
  const canopies = ALHARAMAIN_MODELS[1];
  const [ax, az] = metresFromOrigin(canopies.anchors[0] as [number, number]);
  const t = (canopies.rotation * Math.PI) / 180;
  // The node turned with its file, then the whole frame turned back the way the shader turns p.
  const nx = ax + -171.45 * Math.cos(t) - -400.41 * Math.sin(t);
  const nz = az + -171.45 * Math.sin(t) + -400.41 * Math.cos(t);
  return [Math.cos(t) * nx - Math.sin(t) * nz, Math.sin(t) * nx + Math.cos(t) * nz];
})();

/**
 * The Mosque's footprint, measured from `haram-3d.glb` (its walls between 4 and 30 m high, in the
 * models' frame): the main block x −263.4…143.5, z −353.3…−110.6, and the southern block (the old
 * Mosque) x −109.6…−11.4, z −110.6…−57.0. As boxes: centre x, z, half width, half depth.
 */
const MOSQUE_MAIN: [number, number, number, number] = [(-263.4 + 143.5) / 2, (-353.3 + -110.6) / 2, (143.5 + 263.4) / 2, (353.3 - 110.6) / 2];
const MOSQUE_SOUTH: [number, number, number, number] = [(-109.6 + -11.4) / 2, (-110.6 + -57.0) / 2, (109.6 - 11.4) / 2, (110.6 - 57.0) / 2];

/** The outdoor plazas (the five sectors and the western annex) as triangles, in the models' metres: x, z, kind (0 sector, 1 annex). */
export function plazaMesh(): { vertices: Float32Array; indices: Uint16Array } {
  const v: number[] = [];
  const ix: number[] = [];
  for (const f of alharamainPlaza().features) {
    if (f.properties.kind !== 'sector' && f.properties.kind !== 'annex') continue;
    const ring = f.geometry.coordinates[0].slice(0, -1).map((ll) => metresFromOrigin(ll as [number, number]));
    const base = v.length / 3;
    const kind = f.properties.kind === 'annex' ? 1 : 0;
    for (const [x, z] of ring) v.push(x, z, kind);
    for (const i of triangulate(ring)) ix.push(base + i);
  }
  return { vertices: new Float32Array(v), indices: new Uint16Array(ix) };
}
