import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, type AlharamainModel } from '../data-next/alharamain-3d';
import { gateLattice, materialColor, materialGlow, minaretCrown, portalKind, type SceneLight } from './scene-light';
import { createShadowTexture, SHADOW_GLSL, SHADOW_SIZE, sunMatrix, sunShadow } from './sun-shadow';

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
  /** The green crown's height range in the mesh, or [0, 0]. */
  crown: [number, number];
  /** A portal's back wall to paint, its UV rectangle and size in metres; a lattice that glows. */
  portal: number;
  portalRect: [number, number, number, number];
  portalSize: [number, number];
  lattice: boolean;
  /** When it is drawn: always, or only while the canopies are open (day) or folded (night). */
  when: 'always' | 'day' | 'night';
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
uniform mat4 u_light;

out vec3 v_normal;
out vec2 v_uv;
out float v_height;
out vec4 v_shadow;
out float v_localY;

void main() {
  v_localY = a_pos.y;
  vec4 world = a_model * vec4(a_pos, 1.0);
  gl_Position = u_mvp * world;
  v_height = world.y;
  v_shadow = u_light * world;
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
in vec4 v_shadow;
in float v_localY;

uniform vec4 u_baseColor;
// The minarets' green-lit crown, in the mesh's own height (x..y), or (0, 0) for none.
uniform vec2 u_crown;
// A portal's back wall to paint (scene-light.ts portalKind): 0 none, 1 closed gate, 2 open (Bab
// al-Salam); its UV rectangle and its size in metres. And whether a gate's lattice glows from behind.
uniform int u_portal;
uniform vec4 u_portalRect;
uniform vec2 u_portalSize;
uniform float u_lattice;
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
uniform highp sampler2DShadow u_shadowMap;
uniform float u_shadowOn;

out vec4 fragColor;
${SHADOW_GLSL}
// A closed gate as the owner's photographs show it, in metres from the wall's bottom centre: carved
// wood with a gold lattice, studs and medallion in a gold frame; a transom of small lit arches; in a
// tall portal a calligraphy panel, a blue-grey band and an arched window with a hanging lantern.
// An open gate (kind 2) shows the lit hall inside and its great chandelier. Returns the light it gives.
vec3 portal(vec2 m, vec2 size, int kind, inout vec3 col) {
  vec3 stone = vec3(0.8, 0.74, 0.64);
  vec3 gold = vec3(0.74, 0.57, 0.22);
  vec3 wood = vec3(0.3, 0.15, 0.07);
  vec3 emit = vec3(0.0);
  col = stone;
  float W = size.x;
  float H = size.y;
  if (kind == 2) {
    float w = W * 0.4;
    float h = min(H * 0.9, 4.2);
    float inside = step(abs(m.x), w) * step(m.y, h);
    if (inside > 0.5) {
      // Arches of the hall receding inside, cream and gold, lit from within.
      float bands = 0.5 + 0.5 * cos(m.x / w * 9.0);
      // Dark enough that the floodlights outside do not wash it out; the hall's own lamps light it.
      col = mix(vec3(0.3, 0.22, 0.13), vec3(0.5, 0.42, 0.3), bands) * mix(1.0, 0.8, m.y / h);
      vec2 c = (m - vec2(0.0, h * 0.7)) * vec2(1.3, 1.9);
      float chandelier = exp(-dot(c, c) * 3.0);
      float bulbs = 1.0 - smoothstep(0.03, 0.09, abs(length(c * vec2(1.0, 1.6)) - w * 0.7));
      emit = vec3(1.0, 0.9, 0.74) * (0.3 * bands + 2.4 * chandelier + 1.2 * bulbs * step(abs(c.y), 0.35));
    }
    float frame = max(step(abs(abs(m.x) - w), 0.1) * step(m.y, h), step(abs(m.y - h), 0.1) * step(abs(m.x), w));
    col = mix(col, gold, frame);
    return emit;
  }
  bool tall = H > 9.0;
  float dw = tall ? 1.7 : W * 0.38;
  float dh = tall ? 5.6 : H * 0.8;
  if (abs(m.x) < dw && m.y < dh) {
    vec2 q = vec2(m.x + m.y, m.x - m.y) / 0.42;
    vec2 fr = abs(fract(q) - 0.5);
    float lattice = smoothstep(0.455, 0.49, max(fr.x, fr.y));
    col = mix(wood, gold, lattice);
    float stud = 1.0 - smoothstep(0.06, 0.1, length(fract(q) - 0.5));
    col = mix(col, gold, stud * 0.9);
    float r = length(m - vec2(0.0, dh * 0.42));
    col = mix(col, gold * 1.1, 1.0 - smoothstep(dw * 0.5, dw * 0.53, r));
    col = mix(col, gold * 0.75, (1.0 - smoothstep(dw * 0.3, dw * 0.33, r)) * 0.6);
    float edge = min(dw - abs(m.x), dh - m.y);
    col = mix(col, gold, 1.0 - smoothstep(0.12, 0.16, edge));
    col = mix(col, gold * 0.9, step(dh * 0.84, m.y) * step(m.y, dh - 0.16));
    col = mix(col, wood * 0.6, 1.0 - smoothstep(0.015, 0.035, abs(m.x)));
  } else if (abs(m.x) < dw && m.y < dh + 0.9) {
    col = wood;
    float a = fract((m.x + dw) / (2.0 * dw) * 6.0);
    float hole = step(abs(a - 0.5), 0.3) * step(dh + 0.15, m.y) * step(m.y, dh + 0.78);
    col = mix(col, vec3(0.9, 0.8, 0.6), hole);
    emit = vec3(1.0, 0.86, 0.62) * hole * 1.3;
  }
  if (tall) {
    if (abs(m.x) < 2.1 && m.y > dh + 1.1 && m.y < dh + 1.9) col = vec3(0.88, 0.84, 0.76) * (0.92 + 0.08 * sin(m.x * 31.0) * sin(m.y * 47.0));
    if (abs(m.x) < 2.1 && m.y > dh + 1.9 && m.y < dh + 2.7) col = mix(vec3(0.3, 0.34, 0.42), gold, step(0.62, fract(m.x * 1.1)) * 0.7);
    vec2 w = vec2(m.x, m.y - (dh + 3.5));
    bool win = (abs(w.x) < 1.0 && w.y > 0.0 && w.y < 2.3) || (length(vec2(w.x, w.y - 2.3)) < 1.0 && w.y >= 2.3);
    if (win) {
      col = vec3(0.6, 0.48, 0.3);
      emit = vec3(1.0, 0.88, 0.68) * 0.8;
      vec2 l = vec2(m.x, m.y - (dh + 3.9));
      if (abs(l.x) < 0.38 && l.y > 0.0 && l.y < 1.1) {
        col = vec3(0.78, 0.62, 0.3);
        emit = vec3(1.0, 0.95, 0.85) * (l.y < 0.35 ? 3.0 : 1.2);
      }
      if (abs(m.x) < 0.03 && l.y >= 1.1) col = gold;
    }
  }
  return emit;
}

// Filmic roll-off (ACES fit): strong light goes to white, as a camera sees it, never to orange.
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // As navQ draws them: textures darkened toward linear, material colours as stored, no gamma at the end.
  vec4 albedo = u_baseColor;
  if (u_hasTex == 1) {
    vec4 texel = texture(u_tex, v_uv);
    albedo *= vec4(pow(texel.rgb, vec3(1.6)), texel.a);
  }

  vec3 emit = vec3(0.0);
  if (u_portal > 0) {
    vec2 r = (v_uv - u_portalRect.xy) / max(u_portalRect.zw - u_portalRect.xy, vec2(1e-4));
    // UV v runs down the wall in navQ's files, so up is 1 − v.
    vec2 m = vec2((r.x - 0.5) * u_portalSize.x, (1.0 - r.y) * u_portalSize.y);
    vec3 painted = albedo.rgb;
    emit = portal(m, u_portalSize, u_portal, painted);
    albedo.rgb = painted;
  }
  if (u_lattice > 0.5) {
    // The lattice lunette in the upper part of the gate's photograph glows warm through its holes.
    float v = fract(v_uv.y);
    float band = smoothstep(0.1, 0.16, v) * (1.0 - smoothstep(0.42, 0.48, v));
    float holes = 1.0 - smoothstep(0.08, 0.3, dot(albedo.rgb, vec3(0.33)));
    emit = vec3(1.0, 0.85, 0.6) * band * holes * 1.2;
  }

  vec3 n = length(v_normal) > 0.0001 ? normalize(v_normal) : vec3(0.0, 1.0, 0.0);
  // Two-sided, because mirrored nodes turn their faces inside out.
  if (!gl_FrontFacing) n = -n;

  // Sky light, a little stronger on faces turned up, and the sun on the faces turned to it, unless
  // something stands between them (the shadow map).
  float sky = 0.85 + 0.15 * n.y;
  float facing = dot(n, u_sunDir);
  float direct = max(facing, 0.0);
  if (u_shadowOn > 0.5 && facing > 0.0) direct *= sunLit(v_shadow, 0.0006 + 0.0015 * (1.0 - facing));
  vec3 lit = albedo.rgb * (u_ambient * sky + u_sun * direct);

  // At night, floodlights from the ground: walls lit most, roofs least, the undersides of arches
  // in between; walls brighter low down, minarets brighter toward the top. Lamps (tint 0) glow evenly.
  float low = 1.0 - smoothstep(2.0, 18.0, v_height);
  float high = smoothstep(12.0, 70.0, v_height);
  float shape = u_glowRise > 0.0 ? mix(0.75, 1.1, low) : (u_glowRise < 0.0 ? mix(0.8, 1.15, high) : 1.0);
  float face = u_glowTint > 0.0 ? (n.y > 0.0 ? mix(1.0, 0.3, n.y) : mix(1.0, 0.7, -n.y)) : 1.0;
  vec3 surface = mix(vec3(1.0), albedo.rgb, u_glowTint);
  vec3 glow = u_glow * surface * shape * face * 2.2 * u_night;

  // The minarets' crown glows green at night, a lamp of its own over the floodlit stone.
  if (u_crown.y > 0.0) {
    float band = smoothstep(u_crown.x, u_crown.x + 0.4, v_localY) * (1.0 - smoothstep(u_crown.y - 0.4, u_crown.y, v_localY));
    glow = mix(glow, vec3(0.03, 0.85, 0.24) * 1.3, band * u_night);
  }

  // Lamps inside the gates are on by day too, only less striking in the sunlight.
  vec3 hdr = lit + glow + emit * mix(0.25, 1.0, u_night);
  // By day as navQ draws it; at night through the filmic curve.
  fragColor = vec4(mix(clamp(hdr, 0.0, 1.0), filmic(hdr * 1.4), u_night), albedo.a);
}
`;

/** The sun's shadow map: depth only, as the sun sees the models. */
const DEPTH_VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 3) in mat4 a_model;

uniform mat4 u_light;

void main() {
  gl_Position = u_light * a_model * vec4(a_pos, 1.0);
}
`;

const DEPTH_FRAG_SRC = `#version 300 es
precision highp float;
void main() {}
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
export function mulMat4(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): void {
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
export function parseGlbBuffer(buffer: ArrayBuffer): { gltf: GltfJson; bin: Uint8Array } {
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
export function metresFromOrigin([lng, lat]: readonly [number, number]): [number, number] {
  const origin = MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const here = MercatorCoordinate.fromLngLat([lng, lat], 0);
  const perMetre = origin.meterInMercatorCoordinateUnits();
  return [(here.x - origin.x) / perMetre, (here.y - origin.y) / perMetre];
}

/** Map the models' metres (X=East, Y=Up, Z=South) about the Mosque's anchor to Web Mercator (X=East, Y=South, Z=Up). */
export function frameMatrix(): Float64Array {
  const origin = MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const s = origin.meterInMercatorCoordinateUnits();
  return new Float64Array([s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, origin.x, origin.y, origin.z, 1]);
}

/**
 * In a canopies file: the meshes of open canopies (named `…CanopyOpen…` and carrying the fabric,
 * material `uMB`) and the mesh of a folded one (`…CanopyClosed…`), or null in any other file.
 */
export function canopyFolding(gltf: { nodes: GltfNode[]; meshes: GltfMesh[]; materials?: GltfMaterial[] }): { open: Set<number>; closed: number } | null {
  const closed = gltf.nodes.find((n) => n.mesh !== undefined && /CanopyClosed/.test(n.name ?? ''))?.mesh;
  if (closed === undefined) return null;
  const hasFabric = (mesh: number) => gltf.meshes[mesh].primitives.some((p) => p.material !== undefined && gltf.materials?.[p.material]?.name === 'uMB');
  const open = new Set(gltf.nodes.filter((n) => n.mesh !== undefined && /CanopyOpen/.test(n.name ?? '') && hasFabric(n.mesh)).map((n) => n.mesh!));
  return open.size ? { open, closed } : null;
}

/** A portal's back wall: what to paint, its UV rectangle, and its width and height in metres. */
function portalOf(
  gltf: GltfJson,
  bin: Uint8Array,
  prim: GltfPrimitive,
  kind: number,
): { portal: number; portalRect: [number, number, number, number]; portalSize: [number, number] } {
  const none = { portal: 0, portalRect: [0, 0, 1, 1] as [number, number, number, number], portalSize: [1, 1] as [number, number] };
  const uvIndex = prim.attributes.TEXCOORD_0;
  if (!kind || uvIndex === undefined) return none;
  // navQ's files give no bounds for texture coordinates (glTF only requires them for positions).
  const bounds = (index: number, size: number): { min: number[]; max: number[] } => {
    const acc = gltf.accessors[index];
    const bv = gltf.bufferViews[acc.bufferView];
    const stride = bv.byteStride ?? size * 4;
    const view = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0));
    const min = Array(size).fill(Infinity);
    const max = Array(size).fill(-Infinity);
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < size; c++) {
        const v = view.getFloat32(i * stride + c * 4, true);
        min[c] = Math.min(min[c], v);
        max[c] = Math.max(max[c], v);
      }
    }
    return { min, max };
  };
  const uv = bounds(uvIndex, 2);
  const pos = bounds(prim.attributes.POSITION, 3);
  const width = Math.max(pos.max[0] - pos.min[0], pos.max[2] - pos.min[2]);
  return { portal: kind, portalRect: [uv.min[0], uv.min[1], uv.max[0], uv.max[1]], portalSize: [width, pos.max[1] - pos.min[1]] };
}

/**
 * The three canopy shapes of navQ's file, each with its node's own turn and scale (its position
 * left out): the open canopy, the folded one, and the short lamp post (the mesh without fabric).
 */
export function canopyMeshes(gltf: GltfJson, folding: { open: Set<number>; closed: number }): Record<'open' | 'closed' | 'lamp', { mesh: number; shape: Float64Array }> {
  const first = (test: (mesh: number) => boolean) => gltf.nodes.find((n) => n.mesh !== undefined && test(n.mesh))!;
  const shape = (node: GltfNode) => ({ mesh: node.mesh!, shape: composeTrs([0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]) });
  return {
    open: shape(first((m) => folding.open.has(m))),
    closed: shape(first((m) => m === folding.closed)),
    lamp: shape(first((m) => !folding.open.has(m) && m !== folding.closed)),
  };
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
  private uLight: WebGLUniformLocation | null = null;
  private uShadowMap: WebGLUniformLocation | null = null;
  private uShadowOn: WebGLUniformLocation | null = null;
  private uCrown: WebGLUniformLocation | null = null;
  private uPortal: WebGLUniformLocation | null = null;
  private uPortalRect: WebGLUniformLocation | null = null;
  private uPortalSize: WebGLUniformLocation | null = null;
  private uLattice: WebGLUniformLocation | null = null;
  private depthProgram: WebGLProgram | null = null;
  private uDepthLight: WebGLUniformLocation | null = null;
  private shadowFbo: WebGLFramebuffer | null = null;
  /** The shadow map must be drawn again (the sun moved, a file arrived, the canopies folded). */
  private shadowDirty = true;
  private shadowFolded: boolean | null = null;
  private light: SceneLight;

  private pending: PendingAsset[] = [];
  private prims: (GpuPrimitive & { instances: number })[] = [];
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private textures: WebGLTexture[] = [];
  private fallbackTex: WebGLTexture | null = null;
  private generation = 0;
  private mercatorMatrix: Float64Array;

  /**
   * `light`: how the scene is lit now (change it with `setLight`). `onLamps`: where the lanterns of
   * the courtyard canopies stand, once their file is read, to light the plaza under them.
   */
  constructor(
    light: SceneLight,
    private onLamps?: (lngLats: [number, number][]) => void,
  ) {
    this.light = light;
    this.mercatorMatrix = frameMatrix();
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
    if (this.depthProgram) gl.deleteProgram(this.depthProgram);
    if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
    if (sunShadow.texture) gl.deleteTexture(sunShadow.texture);
    sunShadow.texture = null;
    sunShadow.strength = 0;
    this.depthProgram = null;
    this.shadowFbo = null;
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
    this.uLight = gl.getUniformLocation(prog, 'u_light');
    this.uShadowMap = gl.getUniformLocation(prog, 'u_shadowMap');
    this.uShadowOn = gl.getUniformLocation(prog, 'u_shadowOn');
    this.uCrown = gl.getUniformLocation(prog, 'u_crown');
    this.uPortal = gl.getUniformLocation(prog, 'u_portal');
    this.uPortalRect = gl.getUniformLocation(prog, 'u_portalRect');
    this.uPortalSize = gl.getUniformLocation(prog, 'u_portalSize');
    this.uLattice = gl.getUniformLocation(prog, 'u_lattice');

    // The depth-only pass the sun's shadow map is drawn with: the same vertex arrays, position and
    // instance matrix only.
    const dvs = compile(gl.VERTEX_SHADER, DEPTH_VERT_SRC);
    const dfs = compile(gl.FRAGMENT_SHADER, DEPTH_FRAG_SRC);
    const dprog = gl.createProgram()!;
    gl.attachShader(dprog, dvs);
    gl.attachShader(dprog, dfs);
    gl.linkProgram(dprog);
    gl.deleteShader(dvs);
    gl.deleteShader(dfs);
    this.depthProgram = dprog;
    this.uDepthLight = gl.getUniformLocation(dprog, 'u_light');
    sunShadow.texture = createShadowTexture(gl, SHADOW_SIZE);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sunShadow.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowDirty = true;

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
      if (this.onLamps && model.url.includes('canopies')) {
        this.onLamps(model.points ? [...model.points.umbrellas, ...model.points.lamps].map(([lng, lat]) => [lng, lat] as [number, number]) : nodePositions(model, gltf));
      }
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
    // The courtyard canopies fold at night (as the Mosque's night photographs show them): a node
    // open in navQ's file is drawn by day as it is, and at night with the file's own folded canopy.
    const folding = canopyFolding(gltf);
    const groups = new Map<string, { mesh: number; when: GpuPrimitive['when']; matrices: number[] }>();
    const add = (mesh: number, when: GpuPrimitive['when'], matrix: Float64Array) => {
      const key = `${mesh}|${when}`;
      const group = groups.get(key) ?? { mesh, when, matrices: [] };
      group.matrices.push(...matrix);
      groups.set(key, group);
    };
    const combined = new Float64Array(16);
    if (folding && model.points) {
      // The canopies stand where data/canopies.json puts them; the file gives only their shapes.
      const meshes = canopyMeshes(gltf, folding);
      const turn = composeTrs([0, 0, 0], [0, Math.sin(half), 0, Math.cos(half)], [1, 1, 1]);
      const place = (ll: readonly [number, number], shape: Float64Array) => {
        const [east, south] = metresFromOrigin(ll);
        const at = composeTrs([east, 0, south], [0, 0, 0, 1], [1, 1, 1]);
        const turned = new Float64Array(16);
        mulMat4(turned, at, turn);
        mulMat4(combined, turned, shape);
        return combined;
      };
      for (const ll of model.points.umbrellas) {
        add(meshes.open.mesh, 'day', place(ll, meshes.open.shape));
        add(meshes.closed.mesh, 'night', place(ll, meshes.closed.shape));
      }
      for (const ll of model.points.lamps) add(meshes.lamp.mesh, 'always', place(ll, meshes.lamp.shape));
    }
    for (const node of folding && model.points ? [] : gltf.nodes) {
      if (node.mesh === undefined) continue;
      const local = node.matrix ? new Float64Array(node.matrix) : composeTrs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
      const folds = folding !== null && folding.open.has(node.mesh);
      for (const placement of placements) {
        mulMat4(combined, placement, local);
        add(node.mesh, folds ? 'day' : 'always', combined);
        if (folds) add(folding!.closed, 'night', combined);
      }
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
    for (const { mesh: meshIndex, when, matrices } of groups.values()) {
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
        const bcf = materialColor(model.url, material?.name) ?? pbr?.baseColorFactor ?? [0.85, 0.82, 0.78, 1.0];
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
          crown: minaretCrown(model.url, gltf.meshes[meshIndex].name, material?.name) ?? [0, 0],
          ...portalOf(gltf, bin, prim, portalKind(model.url, gltf.meshes[meshIndex].name, material?.name)),
          lattice: gateLattice(model.url, material?.name),
          instances: matrices.length / 16,
          when,
        });
      }
    }
  }

  /** The sun moved or a preview asked for another moment: the next frame uses this light. */
  setLight(light: SceneLight): void {
    const moved = light.sunDir.some((v, i) => Math.abs(v - this.light.sunDir[i]) > 1e-4);
    this.light = light;
    if (moved) this.shadowDirty = true;
    this.map?.triggerRepaint();
  }

  /** Before the frame (MapLibre's offscreen pass): draw the sun's shadow map if anything changed. */
  prerender(gl: WebGL2RenderingContext): void {
    if (this.pending.length) {
      for (const asset of this.pending) this.upload(gl, asset);
      this.pending = [];
      this.shadowDirty = true;
    }
    const light = this.light;
    // No sun, no shadows: from the golden hour down to night they fade out.
    // Long shadows of a sun near the horizon streak across the plazas; they fade in as it climbs.
    const climb = Math.max(0, Math.min(1, (light.sunDir[1] - 0.12) / 0.22));
    sunShadow.strength = Math.max(0, Math.min(1, (light.sun[0] + light.sun[1] + light.sun[2]) / 0.9)) * (1 - light.night) * climb;
    const folded = light.night >= 0.5;
    if (folded !== this.shadowFolded) this.shadowDirty = true;
    if (!this.shadowDirty || !this.depthProgram || !this.shadowFbo || !this.prims.length || sunShadow.strength <= 0) return;
    this.shadowDirty = false;
    this.shadowFolded = folded;

    sunShadow.matrix.set(sunMatrix(light.sunDir));
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    gl.useProgram(this.depthProgram);
    gl.uniformMatrix4fv(this.uDepthLight, false, sunShadow.matrix);
    for (const prim of this.prims) {
      if ((prim.when === 'day' && folded) || (prim.when === 'night' && !folded)) continue;
      gl.bindVertexArray(prim.vao);
      if (prim.hasIndices) gl.drawElementsInstanced(prim.mode, prim.count, prim.indexType, 0, prim.instances);
      else gl.drawArraysInstanced(prim.mode, 0, prim.count, prim.instances);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.map?.triggerRepaint();
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program) return;

    const projMatrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!projMatrix) return;

    if (this.pending.length) {
      for (const asset of this.pending) this.upload(gl, asset);
      this.pending = [];
      this.shadowDirty = true;
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
    // The sun's shadow map on unit 1 (drawn in prerender).
    gl.uniformMatrix4fv(this.uLight, false, sunShadow.matrix);
    gl.uniform1f(this.uShadowOn, sunShadow.strength > 0 && !this.shadowDirty ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sunShadow.texture);
    gl.uniform1i(this.uShadowMap, 1);
    gl.activeTexture(gl.TEXTURE0);

    let boundTex: WebGLTexture | null = null;
    // Folded from about sunset (the light is then half way to night) until morning.
    const folded = light.night >= 0.5;
    for (const prim of this.prims) {
      if ((prim.when === 'day' && folded) || (prim.when === 'night' && !folded)) continue;
      gl.uniform4fv(this.uBaseColor, prim.baseColor);
      gl.uniform3fv(this.uGlow, prim.glow);
      gl.uniform1f(this.uGlowTint, prim.glowTint);
      gl.uniform1f(this.uGlowRise, prim.glowRise);
      gl.uniform2fv(this.uCrown, prim.crown);
      gl.uniform1i(this.uPortal, prim.portal);
      gl.uniform4fv(this.uPortalRect, prim.portalRect);
      gl.uniform2fv(this.uPortalSize, prim.portalSize);
      gl.uniform1f(this.uLattice, prim.lattice ? 1 : 0);

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
