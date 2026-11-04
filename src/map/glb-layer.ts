import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, type AlharamainModel } from '../data-next/alharamain-3d';
import { materialGlow, type SceneLight } from './scene-light';

/** glTF metres are measured from the Mosque's anchor (Venue 4 in `DataAPI_svc_GetVenues.json`). */
const ORIGIN = ALHARAMAIN_MODELS[0].anchors[0] as [number, number];

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
}

interface GltfPrimitive {
  attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number };
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  children?: number[];
}

interface GltfJson {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  images?: { bufferView: number; mimeType: string }[];
  textures?: { source: number }[];
  materials?: GltfMaterial[];
  meshes: GltfMesh[];
  nodes: GltfNode[];
}

interface GpuPrimitive {
  vao: WebGLVertexArrayObject;
  count: number;
  indexType: number;
  hasIndices: boolean;
  mode: number;
  baseColor: [number, number, number, number];
  textureIndex: number;
  hasUv: boolean;
  /** Its own light at full night (`materialGlow`): colour, how much it takes the surface's colour, and where it is brightest. */
  glow: [number, number, number];
  glowTint: number;
  glowRise: number;
}

/** A parsed file waiting for the next frame: WebGL state is only ours while MapLibre renders this layer. */
interface PendingAsset {
  model: AlharamainModel;
  gltf: GltfJson;
  bin: Uint8Array;
  images: (ImageBitmap | null)[];
}

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in mat4 a_model; // One per instance; takes locations 3 to 6.

uniform mat4 u_mvp;

out vec3 v_normal;
out vec2 v_uv;
out float v_height;

void main() {
  vec4 world = a_model * vec4(a_pos, 1.0);
  gl_Position = u_mvp * world;
  v_height = world.y;
  // Some nodes are scaled unevenly or mirrored, so a plain rotation would bend their normals.
  v_normal = transpose(inverse(mat3(a_model))) * a_normal;
  v_uv = a_uv;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in float v_height;

uniform vec4 u_baseColor;
uniform int u_hasTex;
uniform sampler2D u_tex;
// The scene's light (scene-light.ts): the sun, the sky, and how far into the night it is.
uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
uniform float u_night;
// This material's own light once the lamps are on.
uniform vec3 u_glow;
uniform float u_glowTint;
uniform float u_glowRise;

out vec4 fragColor;

void main() {
  // As navQ draws them: textures darkened toward linear, material colours as stored, no gamma at the end.
  vec4 albedo = u_baseColor;
  if (u_hasTex == 1) {
    vec4 texel = texture(u_tex, v_uv);
    albedo *= vec4(pow(texel.rgb, vec3(1.6)), texel.a);
  }

  vec3 n = length(v_normal) > 0.0001 ? normalize(v_normal) : vec3(0.0, 1.0, 0.0);
  // Two-sided, because mirrored nodes turn their faces inside out.
  if (!gl_FrontFacing) n = -n;

  // Sky light, a little stronger on faces turned up, and the sun on the faces turned to it.
  float sky = 0.85 + 0.15 * n.y;
  float direct = max(dot(n, u_sunDir), 0.0);
  vec3 lit = albedo.rgb * (u_ambient * sky + u_sun * direct);

  // At night: floodlit walls brightest near the ground, minarets brightest near the top.
  float low = 1.0 - smoothstep(2.0, 18.0, v_height);
  float high = smoothstep(12.0, 70.0, v_height);
  float shape = u_glowRise > 0.0 ? mix(0.7, 1.15, low) : (u_glowRise < 0.0 ? mix(0.8, 1.2, high) : 1.0);
  vec3 surface = mix(vec3(1.0), albedo.rgb * 1.8, u_glowTint);
  vec3 glow = u_glow * surface * shape * u_night;

  fragColor = vec4(clamp(lit + glow, 0.0, 1.0), albedo.a);
}
`;

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

/** Build a 4x4 column-major matrix from translation, quaternion rotation, and scale. */
function composeTrs(t: [number, number, number], r: [number, number, number, number], s: [number, number, number]): Float64Array {
  const [x, y, z, w] = r;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const [sx, sy, sz] = s;

  const out = new Float64Array(16);
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
  out[15] = 1;
  return out;
}

/** Multiply two 4x4 column-major matrices (`out = a * b`) in 64-bit precision. */
function mulMat4(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}

/** Parse binary `.glb` buffer into JSON descriptor and binary payload view. */
function parseGlbBuffer(buffer: ArrayBuffer): { gltf: GltfJson; bin: Uint8Array } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Invalid GLB magic header');
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('Missing GLB JSON chunk');
  const jsonBytes = new Uint8Array(buffer, 20, jsonLen);
  const gltf = JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson;

  const binHeaderOffset = 20 + jsonLen;
  const binLen = view.getUint32(binHeaderOffset, true);
  if (view.getUint32(binHeaderOffset + 4, true) !== CHUNK_BIN) throw new Error('Missing GLB BIN chunk');
  const bin = new Uint8Array(buffer, binHeaderOffset + 8, binLen);
  return { gltf, bin };
}

/** Metres east and south of the Mosque's anchor, the frame every glTF node is drawn in. */
function metresFromOrigin([lng, lat]: readonly [number, number]): [number, number] {
  const origin = MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const here = MercatorCoordinate.fromLngLat([lng, lat], 0);
  const perMetre = origin.meterInMercatorCoordinateUnits();
  return [(here.x - origin.x) / perMetre, (here.y - origin.y) / perMetre];
}

/** Where each node of a file stands on the ground, as `[lng, lat]` (one per node and anchor). */
function nodePositions(model: AlharamainModel, gltf: GltfJson): [number, number][] {
  const origin = MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const perMetre = origin.meterInMercatorCoordinateUnits();
  const turn = (model.rotation * Math.PI) / 180;
  const out: [number, number][] = [];
  for (const anchor of model.anchors) {
    const [east0, south0] = metresFromOrigin(anchor);
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue;
      const [x, , z] = node.matrix ? [node.matrix[12], node.matrix[13], node.matrix[14]] : (node.translation ?? [0, 0, 0]);
      // The same clockwise turn (seen from above) as the drawn file: east/south rotate together.
      const east = east0 + x * Math.cos(turn) - z * Math.sin(turn);
      const south = south0 + x * Math.sin(turn) + z * Math.cos(turn);
      const ll = new MercatorCoordinate(origin.x + east * perMetre, origin.y + south * perMetre, 0).toLngLat();
      out.push([ll.lng, ll.lat]);
    }
  }
  return out;
}

/**
 * Draws the Al-Haramain 3D files (`ALHARAMAIN_MODELS`) on MapLibre with WebGL2: the Mosque, the
 * courtyard canopies and the service blocks, at the anchors navQ gives them. Nodes sharing a mesh
 * are one instanced draw, so 599 nodes cost one draw call per mesh material, not one per node.
 */
export class HaramGlbLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uMvp: WebGLUniformLocation | null = null;
  private uBaseColor: WebGLUniformLocation | null = null;
  private uHasTex: WebGLUniformLocation | null = null;
  private uTex: WebGLUniformLocation | null = null;
  private uSunDir: WebGLUniformLocation | null = null;
  private uSun: WebGLUniformLocation | null = null;
  private uAmbient: WebGLUniformLocation | null = null;
  private uNight: WebGLUniformLocation | null = null;
  private uGlow: WebGLUniformLocation | null = null;
  private uGlowTint: WebGLUniformLocation | null = null;
  private uGlowRise: WebGLUniformLocation | null = null;
  private light: SceneLight;

  private pending: PendingAsset[] = [];
  private prims: (GpuPrimitive & { instances: number })[] = [];
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private textures: WebGLTexture[] = [];
  private fallbackTex: WebGLTexture | null = null;
  private generation = 0;
  private mercatorMatrix = new Float64Array(16);

  /**
   * `light`: how the scene is lit now (change it with `setLight`). `onLamps`: where the lanterns of
   * the courtyard canopies stand, once their file is read, to light the plaza under them.
   */
  constructor(
    light: SceneLight,
    private onLamps?: (lngLats: [number, number][]) => void,
  ) {
    this.light = light;
    const origin = MercatorCoordinate.fromLngLat(ORIGIN, 0);
    const s = origin.meterInMercatorCoordinateUnits();
    // Map glTF metres (X=East, Y=Up, Z=South) to Web Mercator (X=East, Y=South, Z=Up).
    this.mercatorMatrix.set([s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, origin.x, origin.y, origin.z, 1]);
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.initShader(gl);
    const generation = ++this.generation;
    for (const model of ALHARAMAIN_MODELS) void this.loadAsset(model, generation);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    this.generation++;
    for (const vao of this.vaos) gl.deleteVertexArray(vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const t of this.textures) gl.deleteTexture(t);
    for (const asset of this.pending) for (const bmp of asset.images) bmp?.close();
    if (this.fallbackTex) gl.deleteTexture(this.fallbackTex);
    if (this.program) gl.deleteProgram(this.program);
    this.pending = [];
    this.prims = [];
    this.buffers = [];
    this.vaos = [];
    this.textures = [];
    this.fallbackTex = null;
    this.program = null;
    this.map = null;
  }

  private initShader(gl: WebGL2RenderingContext): void {
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
    this.uMvp = gl.getUniformLocation(prog, 'u_mvp');
    this.uBaseColor = gl.getUniformLocation(prog, 'u_baseColor');
    this.uHasTex = gl.getUniformLocation(prog, 'u_hasTex');
    this.uTex = gl.getUniformLocation(prog, 'u_tex');
    this.uSunDir = gl.getUniformLocation(prog, 'u_sunDir');
    this.uSun = gl.getUniformLocation(prog, 'u_sun');
    this.uAmbient = gl.getUniformLocation(prog, 'u_ambient');
    this.uNight = gl.getUniformLocation(prog, 'u_night');
    this.uGlow = gl.getUniformLocation(prog, 'u_glow');
    this.uGlowTint = gl.getUniformLocation(prog, 'u_glowTint');
    this.uGlowRise = gl.getUniformLocation(prog, 'u_glowRise');

    const fb = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fb);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.fallbackTex = fb;
  }

  /** Each file loads on its own: a missing one leaves the others standing and the map unharmed. */
  private async loadAsset(model: AlharamainModel, generation: number): Promise<void> {
    try {
      const res = await fetch(model.url);
      if (!res.ok) return;
      const { gltf, bin } = parseGlbBuffer(await res.arrayBuffer());
      const images = await Promise.all(
        (gltf.images ?? []).map(async (img) => {
          const bv = gltf.bufferViews[img.bufferView];
          const start = bv.byteOffset ?? 0;
          const blob = new Blob([bin.subarray(start, start + bv.byteLength) as unknown as BlobPart], { type: img.mimeType });
          return createImageBitmap(blob).catch(() => null);
        }),
      );
      if (generation !== this.generation) {
        for (const bmp of images) bmp?.close();
        return;
      }
      this.pending.push({ model, gltf, bin, images });
      if (this.onLamps && model.url.includes('canopies')) this.onLamps(nodePositions(model, gltf));
      this.map?.triggerRepaint();
    } catch {
      // Offline, or a test environment without fetch: 3D simply stays without this file.
    }
  }

  private upload(gl: WebGL2RenderingContext, asset: PendingAsset): void {
    const { model, gltf, bin, images } = asset;
    const texOffset = this.textures.length;
    const imageTexs = images.map((bmp) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (bmp) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        bmp.close();
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([230, 225, 215, 255]));
      }
      return tex;
    });
    for (const t of gltf.textures ?? []) this.textures.push(imageTexs[t.source] ?? this.fallbackTex!);

    // Every world matrix per mesh: each anchor of this file times each node using that mesh.
    const half = (-model.rotation * Math.PI) / 360; // Clockwise from above is negative about glTF's Y.
    const placements = model.anchors.map((anchor) => {
      const [east, south] = metresFromOrigin(anchor);
      return composeTrs([east, 0, south], [0, Math.sin(half), 0, Math.cos(half)], [1, 1, 1]);
    });
    const matricesByMesh = new Map<number, number[]>();
    const combined = new Float64Array(16);
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue;
      const local = node.matrix ? new Float64Array(node.matrix) : composeTrs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
      const list = matricesByMesh.get(node.mesh) ?? [];
      for (const placement of placements) {
        mulMat4(combined, placement, local);
        list.push(...combined);
      }
      matricesByMesh.set(node.mesh, list);
    }

    const sliceAccessor = (accIndex: number): Uint8Array => {
      const acc = gltf.accessors[accIndex];
      const bv = gltf.bufferViews[acc.bufferView];
      const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const elemBytes = (TYPE_COMPONENTS[acc.type] ?? 1) * (COMPONENT_BYTES[acc.componentType] ?? 4);
      const stride = bv.byteStride ?? elemBytes;
      if (stride === elemBytes) return bin.subarray(offset, offset + acc.count * elemBytes);
      const packed = new Uint8Array(acc.count * elemBytes);
      for (let i = 0; i < acc.count; i++) {
        packed.set(bin.subarray(offset + i * stride, offset + i * stride + elemBytes), i * elemBytes);
      }
      return packed;
    };
    const bindAttribute = (location: number, accIndex: number, size: number): void => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, sliceAccessor(accIndex), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gltf.accessors[accIndex].componentType, false, 0, 0);
      this.buffers.push(buf);
    };

    const materials = gltf.materials ?? [];
    for (const [meshIndex, matrices] of matricesByMesh) {
      const instanceBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(matrices), gl.STATIC_DRAW);
      this.buffers.push(instanceBuf);

      for (const prim of gltf.meshes[meshIndex].primitives) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        this.vaos.push(vao);

        bindAttribute(0, prim.attributes.POSITION, 3);
        if (prim.attributes.NORMAL !== undefined) bindAttribute(1, prim.attributes.NORMAL, 3);
        else gl.disableVertexAttribArray(1);
        const hasUv = prim.attributes.TEXCOORD_0 !== undefined;
        if (hasUv) bindAttribute(2, prim.attributes.TEXCOORD_0!, 2);
        else gl.disableVertexAttribArray(2);

        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
        for (let column = 0; column < 4; column++) {
          gl.enableVertexAttribArray(3 + column);
          gl.vertexAttribPointer(3 + column, 4, gl.FLOAT, false, 64, column * 16);
          gl.vertexAttribDivisor(3 + column, 1);
        }

        let count = gltf.accessors[prim.attributes.POSITION].count;
        let indexType: number = gl.UNSIGNED_SHORT;
        const hasIndices = prim.indices !== undefined;
        if (hasIndices) {
          const idxBuf = gl.createBuffer()!;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sliceAccessor(prim.indices!), gl.STATIC_DRAW);
          this.buffers.push(idxBuf);
          count = gltf.accessors[prim.indices!].count;
          indexType = gltf.accessors[prim.indices!].componentType;
        }
        gl.bindVertexArray(null);

        const material = prim.material !== undefined ? materials[prim.material] : undefined;
        const pbr = material?.pbrMetallicRoughness;
        const glow = materialGlow(model.url, material?.name);
        const bcf = pbr?.baseColorFactor ?? [0.85, 0.82, 0.78, 1.0];
        const texIdx = pbr?.baseColorTexture?.index ?? -1;
        const baseColor: [number, number, number, number] = [bcf[0], bcf[1], bcf[2], bcf[3]];

        this.prims.push({
          vao,
          count,
          indexType,
          hasIndices,
          mode: prim.mode ?? gl.TRIANGLES,
          baseColor,
          textureIndex: texIdx >= 0 ? texIdx + texOffset : -1,
          hasUv,
          glow: glow?.color ?? [0, 0, 0],
          glowTint: glow?.tint ?? 1,
          glowRise: glow?.rise ?? 0,
          instances: matrices.length / 16,
        });
      }
    }
  }

  /** The sun moved or a preview asked for another moment: the next frame uses this light. */
  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program) return;

    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;

    if (this.pending.length) {
      for (const asset of this.pending) this.upload(gl, asset);
      this.pending = [];
    }
    if (!this.prims.length) return;

    // Multiply in 64-bit once per frame, so the model does not shake at high zoom.
    const mvp64 = new Float64Array(16);
    mulMat4(mvp64, projMatrix as unknown as ArrayLike<number>, this.mercatorMatrix);

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    // Mirrored nodes have a negative determinant, so faces cannot be culled.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uTex, 0);
    gl.uniformMatrix4fv(this.uMvp, false, new Float32Array(mvp64));
    const light = this.light;
    gl.uniform3fv(this.uSunDir, light.sunDir);
    gl.uniform3fv(this.uSun, light.sun);
    gl.uniform3fv(this.uAmbient, light.ambient);
    gl.uniform1f(this.uNight, light.night);
    gl.vertexAttrib3f(1, 0, 1, 0);
    gl.vertexAttrib2f(2, 0, 0);

    let boundTex: WebGLTexture | null = null;
    for (const prim of this.prims) {
      gl.uniform4fv(this.uBaseColor, prim.baseColor);
      gl.uniform3fv(this.uGlow, prim.glow);
      gl.uniform1f(this.uGlowTint, prim.glowTint);
      gl.uniform1f(this.uGlowRise, prim.glowRise);

      const texture = prim.hasUv && prim.textureIndex >= 0 ? this.textures[prim.textureIndex] : undefined;
      gl.uniform1i(this.uHasTex, texture ? 1 : 0);
      const target = texture ?? this.fallbackTex;
      if (target && target !== boundTex) {
        gl.bindTexture(gl.TEXTURE_2D, target);
        boundTex = target;
      }

      gl.bindVertexArray(prim.vao);
      if (prim.hasIndices) gl.drawElementsInstanced(prim.mode, prim.count, prim.indexType, 0, prim.instances);
      else gl.drawArraysInstanced(prim.mode, 0, prim.count, prim.instances);
    }
    gl.bindVertexArray(null);
  }
}
