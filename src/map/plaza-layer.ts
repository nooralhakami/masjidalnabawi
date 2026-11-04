import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, alharamainPlaza } from '../data-next/alharamain-3d';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import { triangulate } from './polygon';
import type { SceneLight } from './scene-light';
import { createShadowTexture, SHADOW_GLSL, sunShadow } from './sun-shadow';

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
// The camera, in the models' metres (x east, y up, z south), and the sky the floor reflects.
uniform vec3 u_eye;
uniform vec3 u_sheen;
// The sun's shadow map (sun-shadow.ts) and how strong the sun is now.
uniform highp sampler2DShadow u_shadowMap;
uniform mat4 u_light;
uniform float u_shadow;

out vec4 fragColor;
${SHADOW_GLSL}
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
  // How glossy: polished stone shines more than concrete; carpet not at all.
  float gloss;

  if (v_kind > 1.5) {
    // The prayer areas: the Mosque's green carpets, rugs in rows facing the qibla (south), each with
    // a dark navy border and a medallion (the owner's photographs).
    vec2 rug = vec2(4.0, 1.3);
    vec2 r = (fract(p / rug) - 0.5) * rug;
    vec2 edge = rug * 0.5 - abs(r);
    float fwR = max(fwidth(r.x), fwidth(r.y));
    float detail = 1.0 - smoothstep(0.08, 0.25, fwR);
    float border = (1.0 - smoothstep(0.14, 0.14 + fwR, min(edge.x, edge.y))) * detail;
    float seam = 1.0 - smoothstep(0.015, 0.015 + fwR, min(edge.x, edge.y));
    float medal = (1.0 - smoothstep(0.32, 0.32 + fwR, length(r * vec2(0.55, 1.0)))) * detail;
    float weave = hash(floor(p * 30.0)) * (1.0 - smoothstep(0.003, 0.015, fwP));
    color = vec3(0.4, 0.44, 0.31) * (0.94 + 0.12 * weave);
    color = mix(color, vec3(0.13, 0.16, 0.27), max(border, medal * 0.8));
    color = mix(color, vec3(0.3, 0.32, 0.22), seam);
    alpha = 0.92;
    gloss = 0.0;
  } else if (v_kind > 0.5) {
    // The western plaza: polished concrete in large white squares, nothing else (owner, 2026-11-04).
    color = vec3(0.92, 0.91, 0.88);
    alpha = 0.72;
    float grid = joints(p, vec2(48.0), 0.1);
    color = mix(color, vec3(0.62, 0.62, 0.61), grid);
    gloss = 0.5;
  } else {
    // Round the Mosque, inside the line the owner drew: white square tiles.
    float near = min(box(v_pos, u_main) - 35.0, box(v_pos, u_south) - 3.0);
    if (near < 0.0) {
      color = vec3(0.95, 0.94, 0.91);
      alpha = 0.78;
      float j = joints(p, vec2(1.2), 0.01);
      color = mix(color, vec3(0.7, 0.7, 0.68), j);
      gloss = 1.0;
    } else {
      // Further out: grey speckled granite slabs, panels framed by a thin dark band.
      float speck = hash(floor(p * 24.0)) * (1.0 - smoothstep(0.004, 0.02, fwP));
      color = vec3(0.6, 0.6, 0.59) * (0.9 + 0.2 * speck);
      alpha = 0.45;
      float j = joints(p, vec2(1.2), 0.012);
      color = mix(color, vec3(0.42, 0.42, 0.42), j);
      const float P = 24.1;
      vec2 lp = (fract(p / P) - 0.5) * P;
      float edgeP = P * 0.5 - max(abs(lp.x), abs(lp.y));
      float band = line(edgeP - 0.4, 0.3, fwidth(edgeP));
      color = mix(color, vec3(0.3, 0.3, 0.31), band);
      alpha = mix(alpha, 0.5, band);
      gloss = 0.7;
    }
    // A dark granite strip where the white tiles meet the granite.
    float strip = line(near - 0.6, 0.6, fwidth(near));
    color = mix(color, vec3(0.2, 0.2, 0.21), strip);
    alpha = mix(alpha, 0.7, strip);
  }

  // In the shadow of the Mosque, its minarets and the canopies, the floor keeps only the sky's light.
  if (u_shadow > 0.0) {
    float shade = (1.0 - sunLit(u_light * vec4(v_pos.x, 0.0, v_pos.y, 1.0), 0.0008)) * u_shadow;
    color *= mix(1.0, 0.6, shade);
    alpha = mix(alpha, max(alpha, 0.8), shade);
  }
  // At night the stone takes the lamps' near-white light.
  color *= mix(vec3(1.0), vec3(0.6, 0.6, 0.58), u_night);
  // Polished floor: it mirrors the sky (or the lit night) more as the eye looks across it.
  vec3 view = normalize(u_eye - vec3(v_pos.x, 0.0, v_pos.y));
  float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
  color = mix(color, u_sheen, clamp(fresnel * gloss * 0.55, 0.0, 0.6));
  // Toward the horizon MapLibre's fog hides the ground, but not this layer: fade it there the same way.
  vec3 toEye = u_eye - vec3(v_pos.x, 0.0, v_pos.y);
  float depression = toEye.y / max(length(toEye.xz), 1.0);
  alpha *= smoothstep(0.03, 0.12, depression);
  fragColor = vec4(color, alpha);
}
`;

/**
 * The paving of the plazas round the Mosque in the 3D view, as the owner set it (2026-11-04): white
 * square tiles round the Mosque out to the line he drew, edged by a dark granite strip; grey granite
 * slabs beyond; the western plaza in large squares of polished white concrete; and its prayer areas
 * in the Mosque's green carpets. Polished floors mirror the sky, or the lit night, at low angles.
 * Drawn by the shader in real metres over navQ's plaza colours. A look, not a survey of the paving.
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
  /** Bound in place of the shadow map until the models' layer has made it (a shadow sampler needs a depth texture). */
  private noShadow: WebGLTexture | null = null;

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
    for (const name of ['u_mvp', 'u_turn', 'u_night', 'u_grid', 'u_main', 'u_south', 'u_eye', 'u_sheen', 'u_shadowMap', 'u_light', 'u_shadow'])
      this.uniforms[name] = gl.getUniformLocation(prog, name);

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
    this.noShadow = createShadowTexture(gl, 1);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    if (this.noShadow) gl.deleteTexture(this.noShadow);
    this.noShadow = null;
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
    // The camera in the models' metres, for the floor's gloss.
    const eye = this.map ? cameraEye(this.map) : ([0, 1000, 0] as const);
    gl.uniform3f(this.uniforms.u_eye, eye[0], eye[1], eye[2]);
    // By day it mirrors the sky's haze; at night the warm glow of the lit plazas.
    const sky = this.light.fog;
    const n = this.light.night;
    gl.uniform3f(this.uniforms.u_sheen, sky[0] * (1 - n) + 0.9 * n, sky[1] * (1 - n) + 0.88 * n, sky[2] * (1 - n) + 0.82 * n);
    gl.uniformMatrix4fv(this.uniforms.u_light, false, sunShadow.matrix);
    gl.uniform1f(this.uniforms.u_shadow, sunShadow.texture ? sunShadow.strength : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sunShadow.texture ?? this.noShadow);
    gl.uniform1i(this.uniforms.u_shadowMap, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }
}

/**
 * Where the camera stands, in the models' metres (x east, y up, z south), from the map's public
 * camera: it looks at the centre from `distance` away, tilted by the pitch, turned by the bearing.
 */
function cameraEye(map: MLMap): [number, number, number] {
  const c = map.getCenter();
  const [cx, cz] = metresFromOrigin([c.lng, c.lat]);
  const metresPerPixel = (40_075_016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const fov = (map.getVerticalFieldOfView() * Math.PI) / 180;
  const distance = (map.getContainer().clientHeight / 2 / Math.tan(fov / 2)) * metresPerPixel;
  const pitch = (map.getPitch() * Math.PI) / 180;
  const bearing = (map.getBearing() * Math.PI) / 180;
  const back = distance * Math.sin(pitch);
  return [cx - Math.sin(bearing) * back, distance * Math.cos(pitch), cz + Math.cos(bearing) * back];
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

/**
 * The outdoor plazas as triangles, in the models' metres: x, z, kind (0 the five sectors, 1 the
 * western annex, 2 its prayer areas, men's and women's, laid after it so their carpet lies on top).
 */
export function plazaMesh(): { vertices: Float32Array; indices: Uint16Array } {
  const v: number[] = [];
  const ix: number[] = [];
  for (const f of alharamainPlaza().features) {
    const kinds = { sector: 0, annex: 1, men: 2, women: 2 } as const;
    const ring = f.geometry.coordinates[0].slice(0, -1).map((ll) => metresFromOrigin(ll as [number, number]));
    const base = v.length / 3;
    const kind = kinds[f.properties.kind];
    for (const [x, z] of ring) v.push(x, z, kind);
    for (const i of triangulate(ring)) ix.push(base + i);
  }
  return { vertices: new Float32Array(v), indices: new Uint16Array(ix) };
}
