import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';

/**
 * Geolocation anchor of `Venue_3DModel_tebud_MadinaProd2.glb` (Venue ID 4 in
 * `DataAPI_svc_GetVenues.json`): `centerLongitude: 39.611752, centerLatitude: 24.466806`.
 */
const HARAM_ORIGIN_LNG = 39.611752;
const HARAM_ORIGIN_LAT = 24.466806;

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
  buffers: WebGLBuffer[];
  count: number;
  indexType: number;
  hasIndices: boolean;
  mode: number;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  textureIndex: number;
  hasUv: boolean;
}

interface DrawItem {
  meshIndex: number;
  worldMatrix: Float64Array;
  normalMatrix: Float32Array;
}

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;
uniform mat3 u_normalMat;

out vec3 v_normal;
out vec2 v_uv;
out float v_height;

void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_normal = u_normalMat * a_normal;
  v_uv = a_uv;
  v_height = a_pos.y;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in float v_height;

uniform vec4 u_baseColor;
uniform vec2 u_pbr; // x: metallic, y: roughness
uniform int u_hasTex;
uniform sampler2D u_tex;

out vec4 fragColor;

void main() {
  vec4 albedo = u_baseColor;
  if (u_hasTex == 1) {
    vec4 texel = texture(u_tex, v_uv);
    albedo *= texel;
  }

  vec3 n = length(v_normal) > 0.0001 ? normalize(v_normal) : vec3(0.0, 1.0, 0.0);
  // Two-sided normal handling because mirrored Blender nodes in haram-3d.glb use scale [-1, -1, -1].
  if (!gl_FrontFacing) n = -n;

  // Primary warm sunlight from South-West-Up + soft fill light from North-East + sky hemisphere.
  vec3 sunDir = normalize(vec3(-0.42, 0.78, 0.46));
  vec3 fillDir = normalize(vec3(0.55, 0.48, -0.68));
  vec3 viewDir = normalize(vec3(0.18, 0.72, 0.67));

  float ndl = max(dot(n, sunDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;

  // Ambient occlusion hint near ground level, brighter on domes and minarets.
  float ao = clamp(0.84 + 0.16 * clamp(v_height / 18.0, 0.0, 1.0), 0.82, 1.04);

  vec3 ambient = mix(vec3(0.46, 0.44, 0.42), vec3(0.72, 0.75, 0.80), hemi);
  vec3 direct = vec3(1.02, 0.98, 0.91) * (ndl * 0.62) + vec3(0.82, 0.87, 0.95) * (fill * 0.20);

  // Subtle specular highlight for domes, golden finials, and marble columns.
  vec3 halfVec = normalize(sunDir + viewDir);
  float shininess = mix(48.0, 12.0, clamp(u_pbr.y, 0.05, 1.0));
  float spec = pow(max(dot(n, halfVec), 0.0), shininess) * mix(0.14, 0.45, u_pbr.x + (1.0 - u_pbr.y) * 0.5);
  vec3 specColor = mix(vec3(1.0, 0.97, 0.90), albedo.rgb, u_pbr.x);

  vec3 color = (albedo.rgb * (ambient + direct) + specColor * spec) * ao;
  fragColor = vec4(clamp(color, 0.0, 1.0), albedo.a);
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

/** Convert linear glTF material factor to perceptual sRGB so untextured materials match textured ones. */
function linearToSrgb(c: number): number {
  return Math.min(1, Math.max(0, Math.pow(c, 1 / 2.2)));
}

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

/** Extract upper-left 3x3 normal matrix (inverse-transpose of upper 3x3) from a 4x4 world matrix. */
function normalMat3(m: Float64Array): Float32Array {
  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-10) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const invDet = 1 / det;

  return new Float32Array([
    b01 * invDet,
    b11 * invDet,
    b21 * invDet,
    (-a22 * a01 + a02 * a21) * invDet,
    (a22 * a00 - a02 * a20) * invDet,
    (-a21 * a00 + a01 * a20) * invDet,
    (a12 * a01 - a02 * a11) * invDet,
    (-a12 * a00 + a02 * a10) * invDet,
    (a11 * a00 - a01 * a10) * invDet,
  ]);
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

/** Build a procedural octagonal marble column + golden capital/base mesh to support umbrellas and light pillars. */
function createPillarPrimitives(gl: WebGL2RenderingContext): GpuPrimitive[] {
  const sides = 8;
  const buildCylinder = (rBot: number, rTop: number, y0: number, y1: number, color: [number, number, number, number], metal: number, rough: number): GpuPrimitive => {
    const pos: number[] = [];
    const norm: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(c * rBot, y0, s * rBot, c * rTop, y1, s * rTop);
      norm.push(c, 0, s, c, 0, s);
    }
    for (let i = 0; i < sides; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const normBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norm), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    return {
      vao,
      buffers: [posBuf, normBuf, idxBuf],
      count: idx.length,
      indexType: gl.UNSIGNED_SHORT,
      hasIndices: true,
      mode: gl.TRIANGLES,
      baseColor: color,
      metallic: metal,
      roughness: rough,
      textureIndex: -1,
      hasUv: false,
    };
  };

  return [
    // White marble column shaft
    buildCylinder(0.58, 0.52, 0.0, 12.1, [0.93, 0.91, 0.87, 1.0], 0.05, 0.35),
    // Golden base pedestal & upper capital ring
    buildCylinder(0.76, 0.64, 0.0, 1.35, [0.76, 0.63, 0.36, 1.0], 0.55, 0.22),
    buildCylinder(0.62, 0.88, 10.2, 12.2, [0.78, 0.65, 0.38, 1.0], 0.6, 0.2),
  ];
}

/**
 * Outer courtyard umbrella coordinates `(x, z)` in glTF meters relative to `HARAM_ORIGIN`.
 * Surrounds the Mosque (`X: [-263.4, +143.5]`, `Z: [-353.3, -128.8]`, old south section `X: [-125.3, +5.5], Z: [-128.8, -57.0]`)
 * matching the official Al-Haramain 3D courtyard canopy grid.
 */
function outerUmbrellaPositions(): [number, number][] {
  const pts: [number, number][] = [];
  // 1. Northern Courtyard (3 rows north of the Mosque wall Z = -353.3, from X = -255 to +135)
  for (const z of [-370, -390, -410, -430]) {
    for (let x = -252; x <= 132; x += 24) pts.push([x, z]);
  }
  // 2. Western Courtyard (west of X = -263.4, from Z = -135 to -390)
  for (const x of [-282, -304, -326, -348]) {
    for (let z = -138; z >= -390; z -= 24) pts.push([x, z]);
  }
  // 3. Eastern Courtyard (east of X = +143.5, from Z = -150 to -390)
  for (const x of [162, 184, 206]) {
    for (let z = -156; z >= -390; z -= 24) pts.push([x, z]);
  }
  // 4. South-West Courtyard (south of main expansion Z = -128.8, west of old Mosque X = -125.3)
  for (const z of [-110, -88]) {
    for (let x = -146; x >= -326; x -= 24) pts.push([x, z]);
  }
  // 5. South-East Courtyard (south of main expansion Z = -128.8, east of old Mosque X = +5.5)
  for (const z of [-110, -88]) {
    for (let x = 26; x <= 122; x += 24) pts.push([x, z]);
  }
  return pts;
}

/** Outer courtyard walkway light pillars `(x, z)` in glTF meters. */
function outerLightPillarPositions(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = -340; x <= 200; x += 36) {
    pts.push([x, -448]);
    pts.push([x, -52]);
  }
  for (let z = -430; z <= -70; z += 36) {
    pts.push([-372, z]);
    pts.push([230, z]);
  }
  return pts;
}

/**
 * Custom WebGL2 3D layer for MapLibre GL 6.11.0 that renders the official Al-Haramain 3D Blender
 * model (`public/models/haram-3d.glb`: Green Dome, 10 minarets, 27 sliding domes, ornate golden doors,
 * walls, and inner courtyards) plus instanced 3D courtyard umbrellas, marble/gold columns, and light pillars.
 */
export class HaramGlbLayer implements CustomLayerInterface {
  readonly id = 'alharamain-3d-models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private program: WebGLProgram | null = null;
  private uMvp: WebGLUniformLocation | null = null;
  private uNormalMat: WebGLUniformLocation | null = null;
  private uBaseColor: WebGLUniformLocation | null = null;
  private uPbr: WebGLUniformLocation | null = null;
  private uHasTex: WebGLUniformLocation | null = null;
  private uTex: WebGLUniformLocation | null = null;

  private meshes: GpuPrimitive[][] = [];
  private drawItems: DrawItem[] = [];
  private textures: WebGLTexture[] = [];
  private fallbackTex: WebGLTexture | null = null;
  private ready = false;
  private loading = false;
  private mercatorMatrix = new Float64Array(16);

  constructor() {
    const origin = MercatorCoordinate.fromLngLat([HARAM_ORIGIN_LNG, HARAM_ORIGIN_LAT], 0);
    const s = origin.meterInMercatorCoordinateUnits();
    // Map glTF meters (X=East, Y=Up, Z=South) to Web Mercator (X=East, Y=South, Z=Up)
    this.mercatorMatrix.set([s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, origin.x, origin.y, origin.z, 1]);
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.initShader(gl);
    if (!this.ready && !this.loading) {
      this.loading = true;
      void this.loadModel(gl);
    }
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    for (const prims of this.meshes) {
      for (const p of prims) {
        gl.deleteVertexArray(p.vao);
        for (const b of p.buffers) gl.deleteBuffer(b);
      }
    }
    for (const t of this.textures) gl.deleteTexture(t);
    if (this.fallbackTex) gl.deleteTexture(this.fallbackTex);
    if (this.program) gl.deleteProgram(this.program);
    this.meshes = [];
    this.drawItems = [];
    this.textures = [];
    this.fallbackTex = null;
    this.program = null;
    this.ready = false;
    this.loading = false;
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
    this.uNormalMat = gl.getUniformLocation(prog, 'u_normalMat');
    this.uBaseColor = gl.getUniformLocation(prog, 'u_baseColor');
    this.uPbr = gl.getUniformLocation(prog, 'u_pbr');
    this.uHasTex = gl.getUniformLocation(prog, 'u_hasTex');
    this.uTex = gl.getUniformLocation(prog, 'u_tex');

    const fb = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fb);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.fallbackTex = fb;
  }

  private async loadModel(gl: WebGL2RenderingContext): Promise<void> {
    try {
      const res = await fetch('./models/haram-3d.glb');
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      if (!this.program) return; // Layer removed while fetching
      const { gltf, bin } = parseGlbBuffer(buf);
      await this.uploadTextures(gl, gltf, bin);
      if (!this.program) return;
      this.uploadMeshes(gl, gltf, bin);
      this.ready = true;
      this.map?.triggerRepaint();
    } catch {
      // Offline or test environment without fetch: fail silently without breaking the map.
    } finally {
      this.loading = false;
    }
  }

  private async uploadTextures(gl: WebGL2RenderingContext, gltf: GltfJson, bin: Uint8Array): Promise<void> {
    const images = gltf.images ?? [];
    const imageTexs: WebGLTexture[] = [];
    for (const img of images) {
      const bv = gltf.bufferViews[img.bufferView];
      const slice = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([230, 225, 215, 255]));
      try {
        const bmp = await createImageBitmap(new Blob([slice as unknown as BlobPart], { type: img.mimeType }));
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        bmp.close();
      } catch {
        // Keep 1x1 fallback texel if ImageBitmap decoding is unsupported.
      }
      imageTexs.push(tex);
    }
    this.textures = (gltf.textures ?? []).map((t) => imageTexs[t.source] ?? this.fallbackTex!);
  }

  private uploadMeshes(gl: WebGL2RenderingContext, gltf: GltfJson, bin: Uint8Array): void {
    const materials = gltf.materials ?? [];
    const sliceAccessor = (accIndex: number): Uint8Array => {
      const acc = gltf.accessors[accIndex];
      const bv = gltf.bufferViews[acc.bufferView];
      const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const comps = TYPE_COMPONENTS[acc.type] ?? 1;
      const elemBytes = comps * (COMPONENT_BYTES[acc.componentType] ?? 4);
      const stride = bv.byteStride ?? elemBytes;
      if (stride === elemBytes) {
        return bin.subarray(offset, offset + acc.count * elemBytes);
      }
      const packed = new Uint8Array(acc.count * elemBytes);
      for (let i = 0; i < acc.count; i++) {
        packed.set(bin.subarray(offset + i * stride, offset + i * stride + elemBytes), i * elemBytes);
      }
      return packed;
    };

    for (const mesh of gltf.meshes) {
      const gpuPrims: GpuPrimitive[] = [];
      for (const prim of mesh.primitives) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buffers: WebGLBuffer[] = [];

        // POSITION (location 0)
        const posAcc = gltf.accessors[prim.attributes.POSITION];
        const posBuf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sliceAccessor(prim.attributes.POSITION), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, posAcc.componentType, false, 0, 0);
        buffers.push(posBuf);

        // NORMAL (location 1)
        if (prim.attributes.NORMAL !== undefined) {
          const normAcc = gltf.accessors[prim.attributes.NORMAL];
          const normBuf = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
          gl.bufferData(gl.ARRAY_BUFFER, sliceAccessor(prim.attributes.NORMAL), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, normAcc.componentType, false, 0, 0);
          buffers.push(normBuf);
        } else {
          gl.disableVertexAttribArray(1);
        }

        // TEXCOORD_0 (location 2)
        const hasUv = prim.attributes.TEXCOORD_0 !== undefined;
        if (hasUv) {
          const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0!];
          const uvBuf = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
          gl.bufferData(gl.ARRAY_BUFFER, sliceAccessor(prim.attributes.TEXCOORD_0!), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(2, 2, uvAcc.componentType, false, 0, 0);
          buffers.push(uvBuf);
        } else {
          gl.disableVertexAttribArray(2);
        }

        // INDICES
        let count = posAcc.count;
        let indexType: number = gl.UNSIGNED_SHORT;
        const hasIndices = prim.indices !== undefined;
        if (hasIndices) {
          const idxAcc = gltf.accessors[prim.indices!];
          const idxBuf = gl.createBuffer()!;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sliceAccessor(prim.indices!), gl.STATIC_DRAW);
          buffers.push(idxBuf);
          count = idxAcc.count;
          indexType = idxAcc.componentType;
        }
        gl.bindVertexArray(null);

        const mat = prim.material !== undefined ? materials[prim.material] : undefined;
        const pbr = mat?.pbrMetallicRoughness;
        const bcf = pbr?.baseColorFactor ?? [0.85, 0.82, 0.78, 1.0];
        const texIdx = pbr?.baseColorTexture?.index ?? -1;
        // Untextured materials in Blender GLB have linear RGB factors; convert to sRGB for faithful brightness.
        const baseColor: [number, number, number, number] =
          texIdx >= 0 ? [bcf[0], bcf[1], bcf[2], bcf[3]] : [linearToSrgb(bcf[0]), linearToSrgb(bcf[1]), linearToSrgb(bcf[2]), bcf[3]];

        gpuPrims.push({
          vao,
          buffers,
          count,
          indexType,
          hasIndices,
          mode: prim.mode ?? gl.TRIANGLES,
          baseColor,
          metallic: pbr?.metallicFactor ?? 0,
          roughness: pbr?.roughnessFactor ?? 0.5,
          textureIndex: texIdx,
          hasUv,
        });
      }
      this.meshes.push(gpuPrims);
    }

    // Add procedural marble-and-gold pillar mesh as the last mesh entry.
    const pillarMeshIndex = this.meshes.length;
    this.meshes.push(createPillarPrimitives(gl));

    // Build draw items from all 281 GLB nodes.
    let umbrellaMeshIndex = -1;
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue;
      const worldMatrix = node.matrix ? new Float64Array(node.matrix) : composeTrs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
      this.drawItems.push({
        meshIndex: node.mesh,
        worldMatrix,
        normalMatrix: normalMat3(worldMatrix),
      });

      // Identify the courtyard umbrella canopy mesh (`Plane.038`, mesh 33) and add support pillars under inner umbrellas.
      if (gltf.meshes[node.mesh]?.name === 'Plane.038') {
        umbrellaMeshIndex = node.mesh;
        const t = node.translation ?? [0, 0, 0];
        const pillarMat = composeTrs([t[0], 0, t[2]], [0, 0, 0, 1], [1, 1, 1]);
        this.drawItems.push({
          meshIndex: pillarMeshIndex,
          worldMatrix: pillarMat,
          normalMatrix: normalMat3(pillarMat),
        });
      }
    }

    // Instance outer courtyard umbrellas (`Mesh 33` canopy + marble/gold support column) around the Haram plaza.
    if (umbrellaMeshIndex >= 0) {
      const canopyRot: [number, number, number, number] = [0, -1, 0, 0];
      const canopyScale: [number, number, number] = [-2.55, -2.55, -2.55];
      for (const [x, z] of outerUmbrellaPositions()) {
        const canopyMat = composeTrs([x, 12.5, z], canopyRot, canopyScale);
        this.drawItems.push({
          meshIndex: umbrellaMeshIndex,
          worldMatrix: canopyMat,
          normalMatrix: normalMat3(canopyMat),
        });
        const pillarMat = composeTrs([x, 0, z], [0, 0, 0, 1], [1, 1, 1]);
        this.drawItems.push({
          meshIndex: pillarMeshIndex,
          worldMatrix: pillarMat,
          normalMatrix: normalMat3(pillarMat),
        });
      }
    }

    // Add outer courtyard light pillars along the perimeter walkways.
    for (const [x, z] of outerLightPillarPositions()) {
      const lightMat = composeTrs([x, 0, z], [0, 0, 0, 1], [0.65, 1.15, 0.65]);
      this.drawItems.push({
        meshIndex: pillarMeshIndex,
        worldMatrix: lightMat,
        normalMatrix: normalMat3(lightMat),
      });
    }
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.ready || !this.program) return;

    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;

    // Multiply projMatrix * mercatorMatrix once per frame in 64-bit precision.
    const baseMvp = new Float64Array(16);
    mulMat4(baseMvp, projMatrix as unknown as ArrayLike<number>, this.mercatorMatrix);
    const nodeMvp64 = new Float64Array(16);
    const nodeMvp32 = new Float32Array(16);

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    // Mirrored nodes in haram-3d.glb have negative determinant (`scale: [-1, -1, -1]`), so disable face culling.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uTex, 0);
    gl.vertexAttrib3f(1, 0, 1, 0);
    gl.vertexAttrib2f(2, 0, 0);

    let boundTex: WebGLTexture | null = null;

    for (const item of this.drawItems) {
      const prims = this.meshes[item.meshIndex];
      if (!prims) continue;

      mulMat4(nodeMvp64, baseMvp, item.worldMatrix);
      for (let i = 0; i < 16; i++) nodeMvp32[i] = nodeMvp64[i];

      gl.uniformMatrix4fv(this.uMvp, false, nodeMvp32);
      gl.uniformMatrix3fv(this.uNormalMat, false, item.normalMatrix);

      for (const prim of prims) {
        gl.uniform4fv(this.uBaseColor, prim.baseColor);
        gl.uniform2f(this.uPbr, prim.metallic, prim.roughness);

        const useTex = prim.hasUv && prim.textureIndex >= 0 && this.textures[prim.textureIndex] !== undefined;
        gl.uniform1i(this.uHasTex, useTex ? 1 : 0);
        const targetTex = useTex ? this.textures[prim.textureIndex] : this.fallbackTex;
        if (targetTex && targetTex !== boundTex) {
          gl.bindTexture(gl.TEXTURE_2D, targetTex);
          boundTex = targetTex;
        }

        gl.bindVertexArray(prim.vao);
        if (prim.hasIndices) {
          gl.drawElements(prim.mode, prim.count, prim.indexType, 0);
        } else {
          gl.drawArrays(prim.mode, 0, prim.count);
        }
      }
    }

    gl.bindVertexArray(null);
  }
}
