import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import type { SceneLight } from './scene-light';

/** Height of the lanterns on the canopy columns and lamp posts (navQ's `glass1`, 7.5–8.4 m). */
const LANTERN_HEIGHT = 8;
/** How wide a lantern's halo is, in metres. */
const HALO_METRES = 7;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;

uniform mat4 u_mvp;
uniform float u_height;
uniform float u_scale;
uniform float u_maxSize;

void main() {
  gl_Position = u_mvp * vec4(a_pos.x, u_height, a_pos.y, 1.0);
  // Real size in metres, so a far lantern's halo is small and a near one large.
  gl_PointSize = clamp(u_scale / gl_Position.w, 1.0, u_maxSize);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform float u_night;

out vec4 fragColor;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  // A bright core and a soft falloff, as a camera sees a lamp at night.
  float core = 1.0 - smoothstep(0.0, 0.18, r);
  float halo = pow(max(0.0, 1.0 - r), 2.2);
  vec3 color = vec3(1.0, 0.97, 0.9) * core + vec3(0.85, 0.9, 1.0) * halo * 0.55;
  fragColor = vec4(color * u_night, 1.0);
}
`;

/** Project a point and its neighbours a metre east and south: screen pixels per metre there, times its clip w. */
function pixelsPerMetreTimesW(m: Float64Array, [x, y, z]: [number, number, number], width: number, height: number): number {
  const project = (px: number, py: number, pz: number): [number, number, number] => {
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
    return [((cx / cw) * width) / 2, ((cy / cw) * height) / 2, cw];
  };
  const [ax, ay, w] = project(x, y, z);
  const [bx, by] = project(x + 1, y, z);
  const [dx, dy] = project(x, y, z + 1);
  return Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(dx - ax, dy - ay)) * Math.abs(w);
}

/**
 * The glow round each lantern of the courtyard canopies and lamp posts at night (`alharamain-3d-lamps`
 * lights the floor under them): one point sprite per lantern, added to what is behind it, hidden by
 * the Mosque where it stands in front. A cheap stand-in for a camera's bloom on a phone.
 */
export class LampGlowLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-glow';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffer: WebGLBuffer | null = null;
  private count = 0;
  private pending: Float32Array | null = null;
  private maxSize = 64;
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
    for (const name of ['u_mvp', 'u_height', 'u_scale', 'u_maxSize', 'u_night']) this.uniforms[name] = gl.getUniformLocation(prog, name);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    this.maxSize = Math.min(128, range?.[1] ?? 64);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.buffer = null;
    this.program = null;
    this.map = null;
    this.count = 0;
  }

  /** Where the lanterns stand (from the canopies' file, once it is read). */
  setLamps(lngLats: readonly [number, number][]): void {
    const v = new Float32Array(lngLats.length * 2);
    lngLats.forEach((ll, i) => {
      const [x, z] = metresFromOrigin(ll);
      v[i * 2] = x;
      v[i * 2 + 1] = z;
    });
    this.pending = v;
    this.map?.triggerRepaint();
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map) return;
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    if (this.pending) {
      if (!this.vao) {
        this.vao = gl.createVertexArray()!;
        this.buffer = gl.createBuffer()!;
      }
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.pending, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.vertexAttribDivisor(0, 0);
      gl.bindVertexArray(null);
      this.count = this.pending.length / 2;
      this.pending = null;
    }
    // Only once the lights are on (the night factor fades them in at dusk).
    if (!this.vao || !this.count || this.light.night < 0.05) return;

    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);
    // Pixels per metre times the clip w, at the screen's centre: the halo keeps its real size.
    const c = this.map.getCenter();
    const [cx, cz] = metresFromOrigin([c.lng, c.lat]);
    const scale = HALO_METRES * pixelsPerMetreTimesW(mvp, [cx, LANTERN_HEIGHT, cz], gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    gl.uniformMatrix4fv(this.uniforms.u_mvp, false, new Float32Array(mvp));
    gl.uniform1f(this.uniforms.u_height, LANTERN_HEIGHT);
    gl.uniform1f(this.uniforms.u_scale, Math.abs(scale));
    gl.uniform1f(this.uniforms.u_maxSize, this.maxSize);
    gl.uniform1f(this.uniforms.u_night, this.light.night);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }
}
