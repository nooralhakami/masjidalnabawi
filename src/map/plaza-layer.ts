import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../data-next/alharamain-3d';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import { triangulate } from './polygon';
import type { SceneLight } from './scene-light';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;

uniform mat4 u_mvp;

out vec2 v_pos;

void main() {
  gl_Position = u_mvp * vec4(a_pos.x, 0.0, a_pos.y, 1.0);
  v_pos = a_pos;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_pos;

uniform float u_turn;
uniform float u_night;
uniform vec2 u_grid;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// The eight-pointed star: a square and the same square turned 45°.
float starField(vec2 q) {
  vec2 a = abs(q);
  return min(max(a.x, a.y), (a.x + a.y) * 0.70711);
}

// A line of width w at distance d, smoothed over the pixel footprint fw.
float line(float d, float w, float fw) {
  return 1.0 - smoothstep(w, w + fw * 1.5, abs(d));
}

void main() {
  // The paving follows the Mosque and the canopy grid (u_grid: a canopy column, in the Mosque's frame).
  float c = cos(u_turn);
  float s = sin(u_turn);
  vec2 p = vec2(c * v_pos.x - s * v_pos.y, s * v_pos.x + c * v_pos.y) - u_grid;

  // Large panels between four canopies, framed by a double dark-grey band, a star medallion in the
  // middle (the aerial photographs); read from the map's height.
  const float P = 24.1;
  vec2 lp = (fract(p / P) - 0.5) * P;
  float edge = P * 0.5 - max(abs(lp.x), abs(lp.y));
  float fwE = fwidth(edge);
  float frame = max(line(edge - 0.35, 0.14, fwE), line(edge - 0.95, 0.14, fwE));
  float medal = starField(lp);
  float fwM = fwidth(medal);
  float medalLine = max(line(medal - 3.4, 0.12, fwM), line(medal - 2.6, 0.08, fwM));
  float medalFill = 1.0 - smoothstep(2.2, 2.2 + fwM, medal);

  // Up close: star-and-cross granite about 2.4 m from star to star (the photographs from the ground).
  const float L = 2.4;
  vec2 q = (fract(p / L) - 0.5) * L;
  float field = starField(q);
  float fw = fwidth(field);
  float inStar = 1.0 - smoothstep(0.86 - fw, 0.86 + fw, field);
  float joint = line(field - 0.86, 0.02, fw);
  float fine = 1.0 - smoothstep(0.06, 0.2, fw);
  float speckle = hash(floor(p * 18.0)) * (1.0 - smoothstep(0.004, 0.02, fw));

  vec3 color = vec3(0.87, 0.87, 0.86);
  float alpha = 0.22;
  color = mix(color, vec3(0.66, 0.67, 0.68), (1.0 - inStar) * fine);
  alpha = mix(alpha, 0.3, (1.0 - inStar) * fine);
  color = mix(color, vec3(0.45, 0.46, 0.48), joint * fine);
  alpha = mix(alpha, 0.36, joint * fine);
  color = mix(color, vec3(0.66, 0.36, 0.27), medalFill);
  alpha = mix(alpha, 0.5, medalFill);
  color = mix(color, vec3(0.34, 0.35, 0.37), max(frame, medalLine));
  alpha = mix(alpha, 0.62, max(frame, medalLine));
  color *= 0.95 + 0.1 * speckle;
  // At night the stone is lit by the lamps and the pools of light lie over it.
  color *= mix(1.0, 0.55, u_night);
  fragColor = vec4(color, alpha);
}
`;

/**
 * The granite of the plazas round the Mosque in the 3D view, after the owner's photographs: large
 * panels framed by dark bands with a star medallion between every four canopies (as seen from the
 * air), and star-and-cross paving up close. Drawn by the shader in real metres (so it keeps its size
 * as the visitor zooms), half see-through over navQ's official plaza colours (`alharamain-3d-plaza`),
 * which still tint it. A look, not a survey: only the panels' grid is taken from the canopies' file.
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
    for (const name of ['u_mvp', 'u_turn', 'u_night', 'u_grid']) this.uniforms[name] = gl.getUniformLocation(prog, name);

    const { vertices, indices } = plazaMesh();
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);
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

/** The outdoor plazas (the five sectors and the western annex) as triangles, in the models' metres. */
export function plazaMesh(): { vertices: Float32Array; indices: Uint16Array } {
  const v: number[] = [];
  const ix: number[] = [];
  for (const f of alharamainPlaza().features) {
    if (f.properties.kind !== 'sector' && f.properties.kind !== 'annex') continue;
    const ring = f.geometry.coordinates[0].slice(0, -1).map((ll) => metresFromOrigin(ll as [number, number]));
    const base = v.length / 2;
    for (const [x, z] of ring) v.push(x, z);
    for (const i of triangulate(ring)) ix.push(base + i);
  }
  return { vertices: new Float32Array(v), indices: new Uint16Array(ix) };
}
