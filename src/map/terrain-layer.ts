import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { frameMatrix, metresFromOrigin, mulMat4 } from './glb-layer';
import type { SceneLight } from './scene-light';
import { STRIDE, type TerrainMesh } from './terrain-mesh';

const TERRAIN_URL = './models/madinah-terrain.bin';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_mvp;

out vec3 v_pos;
out vec3 v_normal;

void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_pos = a_pos;
  v_normal = a_normal;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_pos;
in vec3 v_normal;

uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
uniform vec3 u_fog;
uniform vec2 u_center;

out vec4 fragColor;

void main() {
  vec3 n = normalize(v_normal);
  // Basalt and sand of Uhud and the hills: darker on the steep faces.
  float slope = 1.0 - n.y;
  vec3 rock = mix(vec3(0.6, 0.49, 0.38), vec3(0.36, 0.28, 0.23), smoothstep(0.1, 0.6, slope));
  vec3 color = rock * (u_ambient * (0.85 + 0.15 * n.y) + u_sun * max(dot(n, u_sunDir), 0.0));

  // Haze with distance from where the visitor looks, as MapLibre's own fog does for its layers.
  float dist = length(v_pos.xz - u_center);
  float fogAmount = clamp(smoothstep(1800.0, 16000.0, dist) * 1.35, 0.0, 0.85);
  fragColor = vec4(mix(clamp(color, 0.0, 1.0), u_fog, fogAmount), 1.0);
}
`;

/**
 * Draws the mountains of Madinah (Uhud, Ayr and the other hills) in the 3D view (`terrain-mesh.ts`),
 * in one draw call, lit like the Mosque's models (`scene-light.ts`). The file loads only when 3D is
 * turned on, and its mesh is built in a worker (`terrain-worker.ts`).
 */
export class TerrainLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-terrain';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private pending: TerrainMesh | null = null;
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
    for (const name of ['u_mvp', 'u_sunDir', 'u_sun', 'u_ambient', 'u_fog', 'u_center']) this.uniforms[name] = gl.getUniformLocation(prog, name);
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

  private async load(generation: number): Promise<void> {
    let mesh: TerrainMesh | null = null;
    try {
      const worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
      mesh = await new Promise<TerrainMesh | null>((resolve) => {
        worker.onmessage = (e: MessageEvent<TerrainMesh | null>) => resolve(e.data);
        worker.onerror = () => resolve(null);
        worker.postMessage(new URL(TERRAIN_URL, location.href).href);
      });
      worker.terminate();
    } catch {
      // No workers here (a test environment): the 3D view stays without its mountains.
    }
    if (generation !== this.generation || !mesh) return;
    this.pending = mesh;
    this.map?.triggerRepaint();
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  private upload(gl: WebGL2RenderingContext, mesh: TerrainMesh): void {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    for (const [loc, offset] of [
      [0, 0],
      [1, 3],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, STRIDE * 4, offset * 4);
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
    gl.uniform3fv(u.u_fog, light.fog);
    gl.uniform2f(u.u_center, center[0], center[1]);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}
