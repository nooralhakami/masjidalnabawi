import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { STRIDE, type CityMesh } from './city-mesh';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import type { SceneLight } from './scene-light';

const CITY_URL = './models/madinah-city.json';
const TERRAIN_URL = './models/madinah-terrain.bin';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec3 a_info;

uniform mat4 u_mvp;

out vec3 v_pos;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_info;

void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_pos = a_pos;
  v_normal = a_normal;
  v_uv = a_uv;
  v_info = a_info;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_pos;
in vec3 v_normal;
in vec2 v_uv;
in vec3 v_info;

uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
uniform float u_night;
uniform vec3 u_fog;
uniform vec2 u_center;

out vec4 fragColor;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void main() {
  vec3 n = normalize(v_normal);
  float seed = v_info.x;
  float height = v_info.y;
  int kind = int(v_info.z + 0.5);

  float direct = max(dot(n, u_sunDir), 0.0);
  vec3 light = u_ambient * (0.85 + 0.15 * n.y) + u_sun * direct;
  vec3 color;
  float haze = 1.0;

  if (kind == 0) {
    // A hotel wall of cream stone: a grid of windows above a lit ground-floor arcade.
    vec3 stone = mix(vec3(0.84, 0.78, 0.68), vec3(0.94, 0.91, 0.85), fract(seed * 7.13));
    vec2 cell = vec2(v_uv.x / 3.2, v_uv.y / 3.4);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float body = step(5.0, v_uv.y) * step(v_uv.y, height - 1.8);
    float win = body * step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.82);
    // Far away a window grid would shimmer: blend it into its average as the cells shrink on screen.
    vec2 fw = fwidth(cell);
    float detail = 1.0 - smoothstep(0.3, 0.8, max(fw.x, fw.y));

    vec3 glass = vec3(0.2, 0.25, 0.31);
    vec3 albedo = mix(mix(stone, glass, 0.3 * body), mix(stone, glass, win), detail);
    color = albedo * light;

    float r1 = hash(vec3(id, seed * 97.0));
    float r2 = hash(vec3(id.yx, seed * 31.0 + 5.0));
    vec3 warm = vec3(1.0, 0.76, 0.46);
    vec3 cool = vec3(0.86, 0.93, 1.0);
    vec3 lamp = mix(warm, cool, step(0.72, r2)) * mix(0.55, 1.05, r2);
    vec3 near = win * step(r1, 0.6) * lamp;
    vec3 far = body * 0.32 * warm;
    vec3 glow = mix(far, near, detail);
    // The shops and arcades along the street, and a lit crown on some towers.
    float shops = step(0.6, v_uv.y) * step(v_uv.y, 4.6) * step(0.18, fract(v_uv.x / 5.5));
    glow += shops * vec3(1.0, 0.84, 0.58) * 0.95;
    glow += step(height - 1.2, v_uv.y) * step(0.55, fract(seed * 3.7)) * step(25.0, height) * vec3(0.88, 0.94, 1.0) * 0.8;
    // Floodlight washing the stone near the street.
    glow += stone * vec3(1.0, 0.88, 0.7) * 0.16 * (1.0 - smoothstep(0.0, 24.0, v_uv.y));
    color += glow * u_night;
  } else if (kind == 1) {
    // Flat roofs: pale concrete by day, dark at night.
    color = vec3(0.74, 0.72, 0.68) * light;
  } else {
    // Basalt and sand of Uhud and the hills: darker on the steep faces.
    float slope = 1.0 - n.y;
    vec3 rock = mix(vec3(0.6, 0.49, 0.38), vec3(0.36, 0.28, 0.23), smoothstep(0.1, 0.6, slope));
    color = rock * light;
    haze = 1.35;
  }

  // Haze with distance from where the visitor looks, as MapLibre's own fog does for its layers.
  float dist = length(v_pos.xz - u_center);
  float fogAmount = clamp(smoothstep(1800.0, 16000.0, dist) * haze, 0.0, 0.85);
  fragColor = vec4(mix(clamp(color, 0.0, 1.0), u_fog, fogAmount), 1.0);
}
`;

/**
 * Draws the surroundings of the 3D view (`city-mesh.ts`): the buildings round the Haram with their
 * windows (lit at night) and the mountains of Madinah, in one draw call, lit like the Mosque's
 * models (`scene-light.ts`). Both files load only when 3D is turned on.
 */
export class CityLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-city';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private pending: CityMesh | null = null;
  private generation = 0;
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
    for (const name of ['u_mvp', 'u_sunDir', 'u_sun', 'u_ambient', 'u_night', 'u_fog', 'u_center']) this.uniforms[name] = gl.getUniformLocation(prog, name);
    void this.load(++this.generation);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    this.generation++;
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.buffers = [];
    this.program = null;
    this.pending = null;
    this.count = 0;
    this.map = null;
  }

  /**
   * Both files are optional: without the terrain the buildings still stand, and the other way round.
   * The mesh is built in a worker (`city-worker.ts`), so turning 3D on never freezes the map.
   */
  private async load(generation: number): Promise<void> {
    const urls = { city: new URL(CITY_URL, location.href).href, terrain: new URL(TERRAIN_URL, location.href).href };
    let mesh: CityMesh | null = null;
    try {
      const worker = new Worker(new URL('./city-worker.ts', import.meta.url), { type: 'module' });
      mesh = await new Promise<CityMesh | null>((resolve) => {
        worker.onmessage = (e: MessageEvent<CityMesh | null>) => resolve(e.data);
        worker.onerror = () => resolve(null);
        worker.postMessage(urls);
      });
      worker.terminate();
    } catch {
      // No workers here (a test environment): the 3D view stays without its surroundings.
    }
    if (generation !== this.generation || !mesh) return;
    this.pending = mesh;
    this.map?.triggerRepaint();
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  private upload(gl: WebGL2RenderingContext, mesh: CityMesh): void {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const bytes = STRIDE * 4;
    const layout: [number, number, number][] = [
      [0, 3, 0],
      [1, 3, 3],
      [2, 2, 6],
      [3, 3, 8],
    ];
    for (const [loc, size, offset] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, offset * 4);
      gl.vertexAttribDivisor(loc, 0);
    }
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.buffers.push(vbo, ibo);
    this.count = mesh.indices.length;
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map) return;
    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;
    if (this.pending) {
      this.upload(gl, this.pending);
      this.pending = null;
    }
    if (!this.vao || !this.count) return;

    const mvp = new Float64Array(16);
    mulMat4(mvp, projMatrix as unknown as ArrayLike<number>, this.frame);
    const c = this.map.getCenter();
    const center = metresFromOrigin([c.lng, c.lat]);
    const light = this.light;
    const u = this.uniforms;

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(u.u_mvp, false, new Float32Array(mvp));
    gl.uniform3fv(u.u_sunDir, light.sunDir);
    gl.uniform3fv(u.u_sun, light.sun);
    gl.uniform3fv(u.u_ambient, light.ambient);
    gl.uniform1f(u.u_night, light.night);
    gl.uniform3fv(u.u_fog, light.fog);
    gl.uniform2f(u.u_center, center[0], center[1]);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}
