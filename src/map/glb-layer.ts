import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import { ALHARAMAIN_MODELS, type AlharamainModel } from '../data-next/alharamain-3d';
import { motorEase } from '../domain/easing';
import { fromModelMetres, MODEL_ORIGIN_LNGLAT, toModelMetres } from '../domain/frames';
import {
  buildDoorCutBoxes,
  buildDoorKitMatrices,
  doorBayKey,
  doorSwingAt,
  getMosqueDoors,
  isBayOpen,
  isGateOpen,
  nearestDoorBay,
  nearestMosqueDoor,
  subscribeMosqueDoors,
  toggleNearestMosqueDoor,
} from '../domain/mosque-doors';
import type { InteriorPropPlacements } from '../domain/interior-floor';
import { MAX_REVEAL_LANES, NO_REVEAL, type InteriorReveal } from '../domain/interior-reveal';
import { buildSlidingDomes, domeSlideAt, isDomeOpen, type SlidingDome, toggleDome } from '../domain/sliding-domes';
import { gateLattice, materialColor, materialGlow, minaretCrown, portalKind, type SceneLight } from './scene-light';
import { createShadowTexture, SHADOW_GLSL, SHADOW_SIZE, sunMatrix, sunShadow } from './sun-shadow';

/** glTF metres are measured from the Mosque's anchor (Venue 4 in `DataAPI_svc_GetVenues.json`). */
const ORIGIN = MODEL_ORIGIN_LNGLAT as [number, number];

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfMaterial {
  name?: string;
  /** `MASK`: a pixel whose alpha is under `alphaCutoff` is not drawn (a lattice's holes). */
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
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
  /** The gate this portal belongs to; its open state picks the painted door (2 open hall, 1 shut). */
  portalGate?: number;
  lattice: boolean;
  /** Alpha under this is cut out (glTF `MASK`); 0 draws every pixel. */
  cutoff: number;
  /** Interior cutaway visibility role: `keep` (minarets/domes), `wall`, or `roof`. */
  interiorRole: 'keep' | 'wall' | 'roof';
  /**
   * When it is drawn: always, only while the canopies are open (day) or folded (night), or `anim`:
   * the canopies a visitor opened or closed with a tap, folded in the vertex shader.
   */
  when: 'always' | 'day' | 'night' | 'anim';
  /** The interior's props (columns, arches, lanterns, chandeliers): drawn only when the interior shows. */
  interiorOnly?: boolean;
  /** The 3D hinged door kit: always shown in 3D exterior & cutaway views, excluded from shadow depth pass. */
  doorKit?: boolean;
  /** Exterior Mosque building wall parts where active 3D doorway boxes are cut out. */
  cutDoorways?: boolean;
  /** Open-door threshold floor glow quad (alpha scaled by night intensity). */
  thresholdGlow?: boolean;
  /** Where the roof lifts over the interior: 0 never, 1 roof (above 1.5 m), 2 the rest (above 12 m). */
  revealRole: 0 | 1 | 2;
}

// The courtyards' twelve canopies (`uMB`, their `steel` ribs and `steel gold` finials) stand open to the
// sky, not under the roof: they stay whole in the cutaway (owner, 2026-11-18: the Hasawa's canopies).
const INTERIOR_KEEP_MATERIALS = new Set(['MINTEX', 'MINTEX.001', 'MIN2TEX2', 'GREENDOME', 'GREENDOME2', 'SilverDome', 'uMB', 'steel', 'steel gold']);
const INTERIOR_ROOF_MATERIALS = new Set(['roof', 'tile', 'domeblue', 'Domes', 'tent', 'silver', 'windowDome', 'dark']);

function classifyInteriorRole(url: string, materialName?: string): 'keep' | 'wall' | 'roof' {
  if (!url.includes('haram-3d')) return 'keep';
  if (materialName && INTERIOR_KEEP_MATERIALS.has(materialName)) return 'keep';
  if (materialName && INTERIOR_ROOF_MATERIALS.has(materialName)) return 'roof';
  return 'wall';
}

/** How a part lets the interior show (`GpuPrimitive.revealRole`): the props and what stays whole never. */
export function revealRoleOf(role: 'keep' | 'wall' | 'roof', prop: boolean): 0 | 1 | 2 {
  if (prop || role === 'keep') return 0;
  return role === 'roof' ? 1 : 2;
}

/** A parsed file waiting for the next frame: WebGL state is only ours while MapLibre renders this layer. */
interface PendingAsset {
  model: AlharamainModel;
  gltf: GltfJson;
  bin: Uint8Array;
  images: (ImageBitmap | null)[];
  /** For the interior props' file: where each prop mesh (by name) stands, 4×4 matrices end to end. */
  props?: Map<string, Float32Array>;
  /** True for the 3D Door Kit (`haram-doors-kit.glb`), whose buffers animate on hinged leaves. */
  doorKit?: boolean;
}

/**
 * A canopy opening or closing (owner, 2026-11-06), as the Madinah canopies move: it opens from the
 * bottom up (owner's correction, the same day). A bend travels along each arm from the hinge at the
 * top of the column to the tip: below it the arm lies at the open slope, above it the rest of the
 * folded bundle still stands upright, riding outwards on the bend. The fabric gathered in pleats
 * between the arms spreads as the bend passes, and billows a little there.
 * `u_canopy`: the column's axis (x, z) and hinge height in the mesh, and 1 when this draw folds.
 * `a_fold`: 0 folded, 1 open. `a_hide`: 1 hides the instance (the canopy is drawn by the anim group).
 * Mirrored in TypeScript by `foldCanopyVertex` (tests).
 */
const CANOPY_GLSL = `
layout(location = 7) in float a_hide;
layout(location = 8) in float a_fold;
uniform vec4 u_canopy;

vec3 canopyFold(vec3 p, inout vec3 n) {
  if (u_canopy.w < 0.5 || a_fold >= 0.999) return p;
  vec2 d = vec2(p.x - u_canopy.x, p.z - u_canopy.y);
  float h = p.y - u_canopy.z;
  float r = length(d);
  float w = smoothstep(1.6, 2.6, r) * step(-0.6, h);
  if (w <= 0.0) return p;
  vec2 dir = d / r;
  float len = length(vec2(r, h));
  float b0 = atan(h, r);
  // The bend: open below \`front - 1.5\`, upright (gathered to 0.62 of its length) above \`front + 1.5\`.
  float front = a_fold * 24.0 - 1.5;
  float a1 = clamp(front - 1.5, 0.0, len);
  float a2 = clamp(front + 1.5, 0.0, len) - a1;
  float a3 = len - a1 - a2;
  float bm = 0.5 * (b0 + 1.48);
  vec2 rh = a1 * vec2(cos(b0), sin(b0)) + a2 * 0.81 * vec2(cos(bm), sin(bm)) + a3 * 0.62 * vec2(cos(1.48), sin(1.48));
  float s = (a1 + 0.5 * a2) / max(len, 1e-3);
  float b = mix(b0, 1.48, smoothstep(front - 1.5, front + 1.5, len));
  float az = atan(d.y, d.x);
  float rib = 0.5 + 0.5 * cos(az * 16.0);
  float pleat = 1.0 - (1.0 - s) * 0.35 * (1.0 - rib);
  float billow = 0.35 * sin(3.14159 * s) * (1.0 - rib) * clamp(len / 14.0, 0.0, 1.0);
  float rr = rh.x * pleat + billow;
  float hh = rh.y;
  float db = (b - b0) * w;
  float nr = dot(n.xz, dir);
  vec2 rot = vec2(nr * cos(db) - n.y * sin(db), nr * sin(db) + n.y * cos(db));
  n = vec3(n.x + dir.x * (rot.x - nr), rot.y, n.z + dir.y * (rot.x - nr));
  vec3 folded = vec3(u_canopy.x + dir.x * rr, u_canopy.z + hh, u_canopy.y + dir.y * rr);
  return mix(p, folded, w);
}
`;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in mat4 a_model; // One per instance; takes locations 3 to 6.
${CANOPY_GLSL}
uniform mat4 u_mvp;
uniform mat4 u_light;

out vec3 v_normal;
out vec2 v_uv;
out float v_height;
out vec4 v_shadow;
out float v_localY;
out vec2 v_xz;

void main() {
  vec3 nrm = a_normal;
  vec3 pos = canopyFold(a_pos, nrm);
  v_localY = pos.y;
  vec4 world = a_model * vec4(pos, 1.0);
  gl_Position = a_hide > 0.5 ? vec4(0.0, 0.0, 2.0, 1.0) : u_mvp * world;
  v_height = world.y;
  v_xz = world.xz;
  v_shadow = u_light * world;
  // Some nodes are scaled unevenly or mirrored, so a plain rotation would bend their normals.
  v_normal = transpose(inverse(mat3(a_model))) * nrm;
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
in vec2 v_xz;

uniform vec4 u_baseColor;
// Where the roof lifts to show the interior (domain/interior-reveal.ts): this part's role, 0 never
// (minarets, the Green Dome, the courtyards' canopies, the interior's own props), 1 roof (lifted
// above 1.5 m), 2 the rest of the Mosque (lifted above 12 m: what stands on the roof, while the
// facades keep their height and their gates); the discs (x, z, radius) and lanes (a, b) lifted.
uniform int u_revealRole;
uniform vec3 u_revealDisc[2];
uniform int u_revealDiscs;
uniform vec4 u_revealLane[${MAX_REVEAL_LANES}];
uniform int u_revealLanes;
uniform float u_revealHalf;
// The minarets' green-lit crown, in the mesh's own height (x..y), or (0, 0) for none.
uniform vec2 u_crown;
// A portal's back wall to paint (scene-light.ts portalKind): 0 none, 1 closed gate, 2 open (Bab
// al-Salam); its UV rectangle and its size in metres. And whether a gate's lattice glows from behind.
uniform int u_portal;
uniform vec4 u_portalRect;
uniform vec2 u_portalSize;
uniform float u_lattice;
uniform float u_cutoff;
uniform int u_hasTex;
uniform sampler2D u_tex;
// Real 3D doorway cuts packed into an N x 2 RGBA32F lookup texture so haram-3d.glb walls open cleanly.
uniform int u_doorCutCount;
uniform int u_doorCutOn;
uniform sampler2D u_doorCutTex;
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
      float ax = abs(m.x);
      if (ax < w * 0.52) {
        // The lit hall receding through the open centre: cream and gold arches, its great chandelier.
        float bands = 0.5 + 0.5 * cos(m.x / w * 9.0);
        col = mix(vec3(0.3, 0.22, 0.13), vec3(0.5, 0.42, 0.3), bands) * mix(1.0, 0.8, m.y / h);
        vec2 c = (m - vec2(0.0, h * 0.7)) * vec2(1.3, 1.9);
        float chandelier = exp(-dot(c, c) * 3.0);
        float bulbs = 1.0 - smoothstep(0.03, 0.09, abs(length(c * vec2(1.0, 1.6)) - w * 0.7));
        emit = vec3(1.0, 0.9, 0.74) * (0.3 * bands + 2.4 * chandelier + 1.2 * bulbs * step(abs(c.y), 0.35));
      } else {
        // A carved leaf swung open toward the viewer (owner's photographs): gold lattice, studs and
        // a medallion, shaded darker toward its free edge so it reads as turned on its hinges.
        float lx = (ax - w * 0.52) / (w * 0.48);
        vec2 q = vec2(lx * 1.2 + m.y, lx * 1.2 - m.y) / 0.42;
        vec2 fr = abs(fract(q) - 0.5);
        float lattice = smoothstep(0.455, 0.49, max(fr.x, fr.y));
        vec3 leaf = mix(wood, gold, lattice);
        float stud = 1.0 - smoothstep(0.06, 0.1, length(fract(q) - 0.5));
        leaf = mix(leaf, gold, stud * 0.9);
        float r = length(vec2((lx - 0.5) * w * 0.48, m.y - h * 0.42));
        leaf = mix(leaf, gold * 1.1, 1.0 - smoothstep(w * 0.16, w * 0.18, r));
        leaf *= mix(1.0, 0.62, lx);
        col = leaf;
      }
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

// How far p is outside the lifted roof (negative: inside it), in metres.
float revealEdge(vec2 p) {
  float e = 1e6;
  for (int i = 0; i < 2; i++) {
    if (i >= u_revealDiscs) break;
    e = min(e, length(p - u_revealDisc[i].xy) - u_revealDisc[i].z);
  }
  for (int i = 0; i < ${MAX_REVEAL_LANES}; i++) {
    if (i >= u_revealLanes) break;
    vec2 a = u_revealLane[i].xy;
    vec2 ab = u_revealLane[i].zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    e = min(e, length(p - a - t * ab) - u_revealHalf);
  }
  return e;
}

// Filmic roll-off (ACES fit): strong light goes to white, as a camera sees it, never to orange.
vec3 filmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // The roof lifted over the interior: nothing drawn there, and a cut stone rim around the opening.
  float rim = 0.0;
  if (u_revealRole > 0 && v_height > (u_revealRole == 1 ? 1.5 : 12.0)) {
    float e = revealEdge(v_xz);
    if (e < 0.0) discard;
    rim = 1.0 - smoothstep(0.3, 0.7, e);
  }
  if (u_doorCutOn > 0 && u_doorCutCount > 0 && v_height < 6.5 && v_height > 0.04) {
    for (int i = 0; i < 96; i++) {
      if (i >= u_doorCutCount) break;
      vec4 box = texelFetch(u_doorCutTex, ivec2(i, 0), 0);
      if (v_xz.x >= box.x && v_xz.x <= box.z && v_xz.y >= box.y && v_xz.y <= box.w) {
        vec4 ht = texelFetch(u_doorCutTex, ivec2(i, 1), 0);
        if (v_height <= ht.x) discard;
      }
    }
  }
  // As navQ draws them: textures darkened toward linear, material colours as stored, no gamma at the end.
  vec4 albedo = u_baseColor;
  if (u_hasTex == 1) {
    vec4 texel = texture(u_tex, v_uv);
    albedo *= vec4(pow(texel.rgb, vec3(1.6)), texel.a);
  }
  albedo.rgb = mix(albedo.rgb, vec3(0.86, 0.8, 0.68), rim * 0.85);
  // A cut-out material (the fence's lattice and spikes): its holes are not drawn at all.
  if (u_cutoff > 0.0 && albedo.a < u_cutoff) discard;

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
${CANOPY_GLSL}
uniform mat4 u_light;

void main() {
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  vec3 pos = canopyFold(a_pos, nrm);
  gl_Position = a_hide > 0.5 ? vec4(0.0, 0.0, 2.0, 1.0) : u_light * a_model * vec4(pos, 1.0);
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
export function metresFromOrigin(lngLat: readonly [number, number]): [number, number] {
  return toModelMetres(lngLat);
}

/** `metresFromOrigin` the other way: `[east, south]` metres from the Mosque's anchor to `[lng, lat]`. */
export function lngLatFromMetres(eastSouth: readonly [number, number]): [number, number] {
  return fromModelMetres(eastSouth);
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

/** How long a canopy takes to open or close all the way (the real ones take minutes). */
export const CANOPY_MOVE_MS = 6000;

/**
 * How open a canopy is at `ms` into a move from `from` to `to` (0 folded, 1 open): driven like a
 * motor, it starts gently, runs, and slows into place.
 */
export function canopyFoldAt(from: number, to: number, ms: number, duration = CANOPY_MOVE_MS * Math.abs(to - from)): number {
  return from + (to - from) * motorEase(duration <= 0 ? 1 : ms / duration);
}

/** `CANOPY_GLSL`'s fold in TypeScript, for the tests: a vertex of the open canopy at fold `f`. */
export function foldCanopyVertex(p: readonly [number, number, number], f: number, axis: readonly [number, number, number]): [number, number, number] {
  if (f >= 0.999) return [p[0], p[1], p[2]];
  const dx = p[0] - axis[0];
  const dz = p[2] - axis[1];
  const h = p[1] - axis[2];
  const r = Math.hypot(dx, dz);
  const sm = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const w = sm(1.6, 2.6, r) * (h >= -0.6 ? 1 : 0);
  if (w <= 0) return [p[0], p[1], p[2]];
  const len = Math.hypot(r, h);
  const b0 = Math.atan2(h, r);
  const clamp = (v: number) => Math.max(0, Math.min(len, v));
  const front = f * 24 - 1.5;
  const a1 = clamp(front - 1.5);
  const a2 = clamp(front + 1.5) - a1;
  const a3 = len - a1 - a2;
  const bm = 0.5 * (b0 + 1.48);
  const rx = a1 * Math.cos(b0) + a2 * 0.81 * Math.cos(bm) + a3 * 0.62 * Math.cos(1.48);
  const hy = a1 * Math.sin(b0) + a2 * 0.81 * Math.sin(bm) + a3 * 0.62 * Math.sin(1.48);
  const st = (a1 + 0.5 * a2) / Math.max(len, 1e-3);
  const rib = 0.5 + 0.5 * Math.cos(Math.atan2(dz, dx) * 16);
  const pleat = 1 - (1 - st) * 0.35 * (1 - rib);
  const billow = 0.35 * Math.sin(Math.PI * st) * (1 - rib) * Math.min(1, len / 14);
  const rr = rx * pleat + billow;
  const folded: [number, number, number] = [axis[0] + (dx / r) * rr, axis[2] + hy, axis[1] + (dz / r) * rr];
  return [p[0] + (folded[0] - p[0]) * w, p[1] + (folded[1] - p[1]) * w, p[2] + (folded[2] - p[2]) * w];
}

/** One canopy a visitor can open or close with a tap: where it stands, and its instances to hide. */
interface Canopy {
  matrix: Float32Array;
  /** Open by day in navQ (it folds at night); the others stay folded. */
  foldable: boolean;
  refs: { buf: WebGLBuffer; data: Float32Array; i: number }[];
}

/** A canopy moving, or held where a visitor left it. */
interface CanopyMove {
  from: number;
  to: number;
  start: number;
  f: number;
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
 * How far a node standing at `[east, south]` metres from the origin is moved by its file's `shifts`,
 * as `[east, south]` metres; `[0, 0]` outside them.
 */
export function nodeShift(model: AlharamainModel, east: number, south: number): [number, number] {
  for (const s of model.shifts ?? []) {
    const [w, n] = metresFromOrigin([s.within[0][0], s.within[1][1]]);
    const [e, so] = metresFromOrigin([s.within[1][0], s.within[0][1]]);
    if (east >= w && east <= e && south >= n && south <= so) return [s.east, -s.north];
  }
  return [0, 0];
}

/** Where each node of a file stands on the ground, as `[lng, lat]` (one per node and anchor). */
export function nodePositions(model: AlharamainModel, gltf: GltfJson): [number, number][] {
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
      const east0n = east0 + x * Math.cos(turn) - z * Math.sin(turn);
      const south0n = south0 + x * Math.sin(turn) + z * Math.cos(turn);
      const [dEast, dSouth] = nodeShift(model, east0n, south0n);
      const east = east0n + dEast;
      const south = south0n + dSouth;
      const ll = new MercatorCoordinate(origin.x + east * perMetre, origin.y + south * perMetre, 0).toLngLat();
      out.push([ll.lng, ll.lat]);
    }
  }
  return out;
}

/** The sliding domes' unit in navQ's Mosque file: the mesh painted with the `Domes` material that
 * several nodes share (27 in `haram-3d.glb`), or -1 when a file has none. */
export function domeMeshIndex(gltf: GltfJson): number {
  const domesMat = (gltf.materials ?? []).findIndex((m) => m.name === 'Domes');
  if (domesMat < 0) return -1;
  const mesh = gltf.meshes.findIndex((m) => m.primitives.some((p) => p.material === domesMat));
  if (mesh < 0) return -1;
  return gltf.nodes.filter((n) => n.mesh === mesh).length > 1 ? mesh : -1;
}

/** Where each sliding dome stands, `[east, south]` model metres, in node order (one per anchor). */
export function domeInstanceCentres(model: AlharamainModel, gltf: GltfJson): [number, number][] {
  const mesh = domeMeshIndex(gltf);
  if (mesh < 0) return [];
  const turn = (model.rotation * Math.PI) / 180;
  const out: [number, number][] = [];
  // Nodes outside, anchors inside: the order the layer stacks the units' instances in.
  for (const node of gltf.nodes) {
    if (node.mesh !== mesh) continue;
    for (const anchor of model.anchors) {
      const [east0, south0] = metresFromOrigin(anchor);
      const [x, , z] = node.matrix ? [node.matrix[12], node.matrix[13], node.matrix[14]] : (node.translation ?? [0, 0, 0]);
      const east = east0 + x * Math.cos(turn) - z * Math.sin(turn);
      const south = south0 + x * Math.sin(turn) + z * Math.cos(turn);
      const [dEast, dSouth] = nodeShift(model, east, south);
      out.push([east + dEast, south + dSouth]);
    }
  }
  return out;
}

/** The interior props' file (scripts/build-interior-props-glb.py): one prototype per prop, at the origin. */
export const INTERIOR_PROPS_MODEL: AlharamainModel = { url: './models/haram-interior-props.glb', anchors: [MODEL_ORIGIN_LNGLAT], rotation: 0 };

/** The Mosque's 3D hinged door kit (scripts/build-door-kit-glb.py): frame, swinging leaves, threshold glow. */
export const DOOR_KIT_MODEL: AlharamainModel = { url: './models/haram-doors-kit.glb', anchors: [MODEL_ORIGIN_LNGLAT], rotation: 0 };

/**
 * The props' instance matrices by mesh name: Saudi extension columns, lanterns, ablaq arches and
 * ring chandeliers; Ottoman Rawdah/old-Mosque columns and chandeliers; exterior grilles of the
 * Sacred Chamber; the Greeting Passage's golden rail; the Prophetic Minbar and Mihrab; and the
 * warm teak wooden partitions separating the women's prayer areas.
 */
export function interiorPropMatrices(p: InteriorPropPlacements): Map<string, Float32Array> {
  const at = (list: readonly (readonly [number, number])[], turned: boolean) =>
    list.flatMap(([x, z]) => (turned ? [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, x, 0, z, 1] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1]));
  const oriented = (list: readonly { x: number; z: number; angle: number; scaleX: number }[]) =>
    list.flatMap(({ x, z, angle, scaleX }) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // Right-handed XZ rotation: +X -> (scaleX*c, 0, scaleX*s), +Y -> (0,1,0), +Z -> (-s, 0, c)
      return [scaleX * c, 0, scaleX * s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, 0, z, 1];
    });
  const columns = new Float32Array(at(p.columns, false));
  return new Map([
    ['InteriorColumn', columns],
    ['ColumnLanterns', columns],
    ['InteriorArch', new Float32Array([...at(p.archesEastWest, false), ...at(p.archesNorthSouth, true)])],
    ['InteriorChandelier', new Float32Array(at(p.chandeliers, false))],
    ['OttomanColumn', new Float32Array(at(p.ottomanColumns, false))],
    ['OttomanChandelier', new Float32Array(at(p.ottomanChandeliers, false))],
    ['ChamberGrille', new Float32Array(oriented(p.chamberGrilles))],
    ['ChamberRoof', new Float32Array(p.chamberRoof ? [p.chamberRoof.scaleX, 0, 0, 0, 0, 1, 0, 0, 0, 0, p.chamberRoof.scaleZ, 0, p.chamberRoof.x, 0, p.chamberRoof.z, 1] : [])],
    ['SalamRail', new Float32Array(oriented(p.salamRails))],
    ['ProphetMinbar', new Float32Array(p.minbar ? oriented([p.minbar]) : [])],
    ['ProphetMihrab', new Float32Array(p.mihrab ? oriented([p.mihrab]) : [])],
    ['WomenWoodPartition', new Float32Array(oriented(p.womenPartitions))],
  ]);
}

/** A dome sliding, or held where a visitor left it (0 closed, 1 open). */
interface DomeMove {
  from: number;
  to: number;
  start: number;
  f: number;
}

/** Height of the drum's middle above the ground (the unit stands at 13 m; its cap rises 9 m more). */
const DOME_PICK_HEIGHT_M = 17;
/** Half the unit's width: a tap within it (as seen on screen) picks the dome. */
const DOME_PICK_RADIUS_M = 9.6;

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
  private uCutoff: WebGLUniformLocation | null = null;
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
  private uCanopy: WebGLUniformLocation | null = null;
  private uDepthCanopy: WebGLUniformLocation | null = null;
  /** The canopies of the canopies file, the moves under way, and the group that draws them. */
  private canopies: Canopy[] = [];
  private moves = new Map<number, CanopyMove>();
  private canopyAxis: [number, number, number, number] = [0, 0, 0, 0];
  private animMatrices: WebGLBuffer | null = null;
  private animFolds: WebGLBuffer | null = null;
  private animCount = 0;
  private folded = false;
  private interior = false;
  /** Repaints the portals when a gate opens or shuts. */
  private unsubDoors: (() => void) | null = null;
  /** The last frame's projection (metres to clip space), to find the canopy under a tap. */
  private lastMvp: Float64Array | null = null;
  /** The sliding domes (owner, 2026-11-18): their units' matrices as the file has them (closed),
   * the instance buffer they are drawn from, how open each is, and the slides under way. */
  private domes: SlidingDome[] = [];
  private domeBase: Float32Array | null = null;
  private domeBuf: WebGLBuffer | null = null;
  private domeOpen = new Map<number, number>();
  private domeMoves = new Map<number, DomeMove>();
  private domeDirty = false;
  /** The 3D hinged doors (owner, 2026-11-20): per-bay open fraction (`gateId:bayIndex`), active swings, dynamic buffers, and wall cut texture. */
  private doorOpen = new Map<string, number>();
  private doorMoves = new Map<string, DomeMove>();
  private doorLeftBuf: WebGLBuffer | null = null;
  private doorRightBuf: WebGLBuffer | null = null;
  private doorGlowBuf: WebGLBuffer | null = null;
  private doorsDirty = false;
  private doorCutTex: WebGLTexture | null = null;
  private doorCutCount = 0;
  private uDoorCutCount: WebGLUniformLocation | null = null;
  private uDoorCutOn: WebGLUniformLocation | null = null;
  private uDoorCutTex: WebGLUniformLocation | null = null;
  /** The interior props' file is asked for once, when the interior's plan has arrived. */
  private propsRequested = false;
  /** Where the roof lifts this frame (the engine's answer: a tapped gate, a route inside). */
  private revealSource: (() => InteriorReveal) | null = null;
  private uRevealRole: WebGLUniformLocation | null = null;
  private uRevealDisc: WebGLUniformLocation | null = null;
  private uRevealDiscs: WebGLUniformLocation | null = null;
  private uRevealLane: WebGLUniformLocation | null = null;
  private uRevealLanes: WebGLUniformLocation | null = null;
  private uRevealHalf: WebGLUniformLocation | null = null;

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
    this.propsRequested = false;
    this.initShader(gl);
    this.unsubDoors = subscribeMosqueDoors(() => this.syncDoorTargets());
    this.syncDoorTargets();
    const generation = ++this.generation;
    for (const model of ALHARAMAIN_MODELS) void this.loadAsset(model, generation);
    void this.loadAsset(DOOR_KIT_MODEL, generation, undefined, true);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    this.generation++;
    this.unsubDoors?.();
    this.unsubDoors = null;
    for (const vao of this.vaos) gl.deleteVertexArray(vao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const t of this.textures) gl.deleteTexture(t);
    for (const asset of this.pending) for (const bmp of asset.images) bmp?.close();
    if (this.doorCutTex) gl.deleteTexture(this.doorCutTex);
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
    this.canopies = [];
    this.moves.clear();
    this.doorOpen.clear();
    this.doorMoves.clear();
    this.doorLeftBuf = this.doorRightBuf = this.doorGlowBuf = null;
    this.doorsDirty = false;
    this.doorCutTex = null;
    this.doorCutCount = 0;
    this.animMatrices = this.animFolds = null;
    this.animCount = 0;
    this.lastMvp = null;
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
    this.uCutoff = gl.getUniformLocation(prog, 'u_cutoff');
    this.uDoorCutCount = gl.getUniformLocation(prog, 'u_doorCutCount');
    this.uDoorCutOn = gl.getUniformLocation(prog, 'u_doorCutOn');
    this.uDoorCutTex = gl.getUniformLocation(prog, 'u_doorCutTex');
    this.uCanopy = gl.getUniformLocation(prog, 'u_canopy');
    this.uRevealRole = gl.getUniformLocation(prog, 'u_revealRole');
    this.uRevealDisc = gl.getUniformLocation(prog, 'u_revealDisc');
    this.uRevealDiscs = gl.getUniformLocation(prog, 'u_revealDiscs');
    this.uRevealLane = gl.getUniformLocation(prog, 'u_revealLane');
    this.uRevealLanes = gl.getUniformLocation(prog, 'u_revealLanes');
    this.uRevealHalf = gl.getUniformLocation(prog, 'u_revealHalf');

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
    this.uDepthCanopy = gl.getUniformLocation(dprog, 'u_canopy');
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
  private async loadAsset(model: AlharamainModel, generation: number, props?: Map<string, Float32Array>, doorKit = false): Promise<void> {
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
      this.pending.push({ model, gltf, bin, images, props, doorKit });
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
    // The courtyard canopies fold at night (as the Mosque's night photographs show them): a node
    // open in navQ's file is drawn by day as it is, and at night with the file's own folded canopy.
    const folding = canopyFolding(gltf);
    // A canopy with fabric (open by day, or always folded) opens and closes at a tap; the lamp
    // columns of the south courtyard, with no canopy, never do (owner, 2026-11-06).
    const firstCanopy = this.canopies.length;
    const groups = new Map<string, { mesh: number; when: GpuPrimitive['when']; matrices: number[]; canopy: number[]; gate?: number }>();
    const add = (mesh: number, when: GpuPrimitive['when'], matrix: Float64Array, canopy: number, gate?: number, nodeKey?: string) => {
      const key = nodeKey ?? `${mesh}|${when}`;
      const group = groups.get(key) ?? { mesh, when, matrices: [], canopy: [], gate };
      group.matrices.push(...matrix);
      group.canopy.push(canopy);
      groups.set(key, group);
    };
    const combined = new Float64Array(16);
    // The sliding domes' units are one group of their own, drawn from a buffer that moves them.
    const domeMesh = domeMeshIndex(gltf);
    for (const [nodeIdx, node] of gltf.nodes.entries()) {
      if (node.mesh === undefined || asset.props || asset.doorKit) continue;
      const local = node.matrix ? new Float64Array(node.matrix) : composeTrs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
      const folds = folding !== null && folding.open.has(node.mesh);
      const tappable = folding !== null && (folds || node.mesh === folding.closed);
      // A doorway portal (navQ's `DEEP` plane) is drawn per node so each gate opens and shuts on its
      // own; the nearest gate decides whether the shader paints the open hall or the carved leaves.
      const mesh = gltf.meshes[node.mesh];
      const isPortal = mesh.primitives.some((p) => portalKind(model.url, mesh.name, p.material !== undefined ? gltf.materials?.[p.material]?.name : undefined) > 0);
      for (const placement of placements) {
        mulMat4(combined, placement, local);
        const [dEast, dSouth] = nodeShift(model, combined[12], combined[14]);
        combined[12] += dEast;
        combined[14] += dSouth;
        const canopy = tappable ? this.canopies.push({ matrix: new Float32Array(combined), foldable: folds, refs: [] }) - 1 : -1;
        const gate = isPortal ? nearestMosqueDoor(combined[12], combined[14], 25)?.id : undefined;
        const nodeKey = isPortal ? `portal|${node.mesh}|${nodeIdx}` : node.mesh === domeMesh ? 'domes' : undefined;
        add(node.mesh, folds ? 'day' : 'always', combined, canopy, gate, nodeKey);
        if (folds) add(folding!.closed, 'night', combined, canopy);
      }
    }
    let doorKitMap: Map<string, Float32Array> | null = null;
    if (asset.doorKit) {
      const doors = getMosqueDoors();
      for (const gate of doors) {
        for (const bay of gate.bays) {
          const key = doorBayKey(gate.id, bay.bayIndex);
          if (!this.doorOpen.has(key)) this.doorOpen.set(key, gate.open && bay.open ? 1 : 0);
        }
      }
      const kit = buildDoorKitMatrices(doors, (gateId, bayIndex) => this.doorOpen.get(doorBayKey(gateId, bayIndex)) ?? (isBayOpen(gateId, bayIndex) ? 1 : 0));
      doorKitMap = new Map([
        ['DoorPortalFrame', kit.frames],
        ['DoorLeafLeft', kit.leftLeaves],
        ['DoorLeafRight', kit.rightLeaves],
        ['DoorThresholdGlow', kit.glows],
      ]);
      const cut = buildDoorCutBoxes(doors);
      this.doorCutCount = cut.count;
      const cutTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, cutTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cut.count, 2, 0, gl.RGBA, gl.FLOAT, cut.data);
      this.doorCutTex = cutTex;
      this.doorsDirty = true;
    }
    const instMap = asset.props ?? doorKitMap;
    // The interior props and 3D door kit stand where the architectural plan puts them, not at origin.
    for (const node of instMap ? gltf.nodes : []) {
      if (node.mesh === undefined) continue;
      const at = instMap!.get(gltf.meshes[node.mesh].name ?? '');
      if (!at) continue;
      const local = node.matrix ? new Float64Array(node.matrix) : composeTrs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
      for (let k = 0; k + 16 <= at.length; k += 16) {
        mulMat4(combined, at.subarray(k, k + 16), local);
        add(node.mesh, 'always', combined, -1, undefined, `${asset.doorKit ? 'doors' : 'props'}|${node.mesh}`);
      }
    }
    if (folding && this.canopies.length > firstCanopy) {
      // The canopies a visitor moves are drawn from the open canopy's mesh, folded in the shader.
      const openMesh = [...folding.open][0];
      groups.set('anim', { mesh: openMesh, when: 'anim', matrices: [], canopy: [] });
      const column = gltf.accessors[gltf.meshes[openMesh].primitives[0].attributes.POSITION];
      const lo = column.min ?? [0, 0, 0];
      const hi = column.max ?? [0, 0, 0];
      this.canopyAxis = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, hi[1], 1];
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
    for (const [key, { mesh: meshIndex, when, matrices, canopy, gate }] of groups) {
      const anim = when === 'anim';
      const domes = key === 'domes';
      const meshName = gltf.meshes[meshIndex].name ?? '';
      const doorDyn = Boolean(asset.doorKit) && (meshName === 'DoorLeafLeft' || meshName === 'DoorLeafRight' || meshName === 'DoorThresholdGlow');
      const instanceBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
      if (anim) gl.bufferData(gl.ARRAY_BUFFER, (this.canopies.length - firstCanopy) * 64, gl.DYNAMIC_DRAW);
      else gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(matrices), domes || doorDyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      this.buffers.push(instanceBuf);
      if (doorDyn) {
        if (meshName === 'DoorLeafLeft') this.doorLeftBuf = instanceBuf;
        else if (meshName === 'DoorLeafRight') this.doorRightBuf = instanceBuf;
        else if (meshName === 'DoorThresholdGlow') this.doorGlowBuf = instanceBuf;
      }
      if (domes) {
        this.domes = buildSlidingDomes(domeInstanceCentres(model, gltf));
        this.domeBase = new Float32Array(matrices);
        this.domeBuf = instanceBuf;
        // Domes a visitor opened before the file was (re)read stand open at once.
        for (const d of this.domes) if (isDomeOpen(d.n)) this.domeOpen.set(d.n, 1);
        this.domeDirty = true;
      }
      // Per instance: hidden while a visitor's move draws it (the canopies' groups only), and how
      // open it is (the anim group only).
      let hideBuf: WebGLBuffer | null = null;
      if (!anim && canopy.some((k) => k >= 0)) {
        hideBuf = gl.createBuffer()!;
        const data = new Float32Array(canopy.length);
        gl.bindBuffer(gl.ARRAY_BUFFER, hideBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        this.buffers.push(hideBuf);
        canopy.forEach((k, i) => k >= 0 && this.canopies[k].refs.push({ buf: hideBuf!, data, i }));
      }
      if (anim) {
        this.animMatrices = instanceBuf;
        this.animFolds = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.animFolds);
        gl.bufferData(gl.ARRAY_BUFFER, (this.canopies.length - firstCanopy) * 4, gl.DYNAMIC_DRAW);
        this.buffers.push(this.animFolds);
      }

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
        for (const [location, buf] of [
          [7, hideBuf],
          [8, anim ? this.animFolds : null],
        ] as const) {
          if (!buf) {
            gl.disableVertexAttribArray(location);
            continue;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 4, 0);
          gl.vertexAttribDivisor(location, 1);
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
        const pKind = portalKind(model.url, gltf.meshes[meshIndex].name, material?.name);
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
          ...portalOf(gltf, bin, prim, pKind),
          portalGate: pKind > 0 ? gate : undefined,
          lattice: gateLattice(model.url, material?.name),
          cutoff: material?.alphaMode === 'MASK' ? (material.alphaCutoff ?? 0.5) : 0,
          interiorRole: classifyInteriorRole(model.url, material?.name),
          instances: matrices.length / 16,
          when,
          interiorOnly: Boolean(asset.props),
          revealRole: revealRoleOf(classifyInteriorRole(model.url, material?.name), Boolean(asset.props)),
          doorKit: Boolean(asset.doorKit),
          cutDoorways: model.url.includes('haram-3d') && classifyInteriorRole(model.url, material?.name) !== 'keep',
          thresholdGlow: Boolean(asset.doorKit && material?.name === 'thresholdGlow'),
        });
      }
    }
  }

  /**
   * The interior's columns, ablaq arches, lanterns and chandeliers (owner, 2026-11-18), shown with the
   * interior cutaway: `matrices` per prop mesh (`interiorPropMatrices`). The file is read once.
   */
  setInteriorProps(matrices: Map<string, Float32Array>): void {
    if (this.propsRequested) return;
    this.propsRequested = true;
    void this.loadAsset(INTERIOR_PROPS_MODEL, this.generation, matrices);
  }

  /** Enable or disable translucent interior cutaway mode on the Mosque building while keeping minarets and domes opaque. */
  setInterior(on: boolean): void {
    this.interior = on;
    this.map?.triggerRepaint();
  }

  /**
   * Where the roof lifts over the interior, asked each frame (owner, 2026-11-18: the Mosque is seen
   * from outside unless a gate was tapped and the map zoomed in, a route walks inside, a dome is open,
   * or the interior view is on). `domain/interior-reveal.ts` says where.
   */
  setRevealSource(source: (() => InteriorReveal) | null): void {
    this.revealSource = source;
    this.map?.triggerRepaint();
  }

  /** Is any sliding dome open, or on its way? Then the interior shows through its opening. */
  private anyDomeOpen(): boolean {
    if (this.domeMoves.size) return true;
    for (const f of this.domeOpen.values()) if (f > 0) return true;
    return false;
  }

  /** Toggle the nearest Mosque doorway bay under screen `[x, y]` CSS pixels. */
  toggleDoorAt(x: number, y: number): ReturnType<typeof toggleNearestMosqueDoor> | null {
    if (!this.map) return null;
    const ll = this.map.unproject([x, y]);
    const [mx, mz] = toModelMetres([ll.lng, ll.lat]);
    return toggleNearestMosqueDoor(mx, mz, 14);
  }

  /** The gate whose doorway is under screen `[x, y]` CSS pixels, without toggling it (for picking). */
  doorGateAt(x: number, y: number): number | null {
    if (!this.map) return null;
    const ll = this.map.unproject([x, y]);
    const [mx, mz] = toModelMetres([ll.lng, ll.lat]);
    return nearestMosqueDoor(mx, mz, 14)?.id ?? null;
  }

  /** The individual doorway bay under screen `[x, y]` CSS pixels (null outside `maxDistM`). */
  doorBayAt(x: number, y: number, maxDistM = 6): { gateId: number; bayIndex: number } | null {
    if (!this.map) return null;
    const ll = this.map.unproject([x, y]);
    const [mx, mz] = toModelMetres([ll.lng, ll.lat]);
    const hit = nearestDoorBay(mx, mz, maxDistM);
    return hit ? { gateId: hit.gate.id, bayIndex: hit.bay.bayIndex } : null;
  }

  /** Live animated open fraction (`0` shut .. `1` open) of a specific doorway bay. */
  doorOpenFraction(gateId: number, bayIndex: number): number {
    return this.doorOpen.get(doorBayKey(gateId, bayIndex)) ?? (isBayOpen(gateId, bayIndex) ? 1 : 0);
  }

  /** Synchronize target open fractions from domain state into `doorOpen` / active `doorMoves`. */
  private syncDoorTargets(): void {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let changed = false;
    for (const gate of getMosqueDoors()) {
      for (const bay of gate.bays) {
        const key = doorBayKey(gate.id, bay.bayIndex);
        const target = gate.open && bay.open ? 1 : 0;
        if (!this.doorOpen.has(key)) {
          this.doorOpen.set(key, target);
          continue;
        }
        const move = this.doorMoves.get(key);
        const current = move?.f ?? this.doorOpen.get(key) ?? target;
        if (reduce) {
          if (Math.abs(current - target) > 1e-4 || move) {
            this.doorMoves.delete(key);
            this.doorOpen.set(key, target);
            this.doorsDirty = true;
            changed = true;
          }
        } else if (move ? move.to !== target : Math.abs(current - target) > 1e-4) {
          this.doorMoves.set(key, { from: current, to: target, start: performance.now(), f: current });
          changed = true;
        }
      }
    }
    if (changed) this.map?.triggerRepaint();
  }

  /** Advance active 3D door swings to `now` and update dynamic leaf & glow instance buffers. */
  private stepDoors(gl: WebGL2RenderingContext, now: number): boolean {
    if (!this.doorLeftBuf || !this.doorRightBuf || !this.doorGlowBuf || (!this.doorMoves.size && !this.doorsDirty)) return false;
    let moving = false;
    for (const [key, m] of this.doorMoves) {
      m.f = doorSwingAt(m.from, m.to, now - m.start);
      if (Math.abs(m.f - m.to) < 1e-4) {
        m.f = m.to;
        this.doorOpen.set(key, m.to);
        this.doorMoves.delete(key);
      } else {
        this.doorOpen.set(key, m.f);
        moving = true;
      }
    }
    const kit = buildDoorKitMatrices(getMosqueDoors(), (gateId, bayIndex) => this.doorOpen.get(doorBayKey(gateId, bayIndex)) ?? (isBayOpen(gateId, bayIndex) ? 1 : 0));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.doorLeftBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, kit.leftLeaves);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.doorRightBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, kit.rightLeaves);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.doorGlowBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, kit.glows);
    this.doorsDirty = false;
    return moving;
  }

  /**
   * A tap at `[x, y]` (CSS pixels): the canopy whose column or folded bundle is under it opens, or
   * closes if open. False when no canopy is there (the tap is then the map's).
   */
  toggleCanopyAt(x: number, y: number): boolean {
    const k = this.canopyAt(x, y);
    if (k === null) return false;
    const now = performance.now();
    const move = this.moves.get(k);
    const f = move?.f ?? (this.canopies[k].foldable && !this.folded ? 1 : 0);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const to = f > 0.5 ? 0 : 1;
    this.moves.set(k, { from: reduce ? to : f, to, start: now, f });
    this.setHidden(k, true);
    this.map?.triggerRepaint();
    return true;
  }

  /**
   * A tap at `[x, y]` (CSS pixels) on a sliding dome: it opens slowly (sliding along its rails by
   * its own size, north or south as the owner set), or closes if open. False when no dome is there.
   */
  toggleDomeAt(x: number, y: number): boolean {
    const n = this.domeAt(x, y);
    if (n === null) return false;
    const f = this.domeMoves.get(n)?.f ?? this.domeOpen.get(n) ?? 0;
    const to = toggleDome(n) ? 1 : 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.domeMoves.set(n, { from: reduce ? to : f, to, start: performance.now(), f });
    this.map?.triggerRepaint();
    return true;
  }

  /** The dome under a tap: within its unit's half-width on screen, the nearest to the eye. */
  domeAt(x: number, y: number): number | null {
    const mvp = this.lastMvp;
    const canvas = this.map?.getCanvas();
    if (!mvp || !canvas || !this.domes.length) return null;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const project = (east: number, south: number): [number, number, number] | null => {
      const h = DOME_PICK_HEIGHT_M;
      const cw = mvp[3] * east + mvp[7] * h + mvp[11] * south + mvp[15];
      if (cw <= 0) return null;
      const nx = (mvp[0] * east + mvp[4] * h + mvp[8] * south + mvp[12]) / cw;
      const ny = (mvp[1] * east + mvp[5] * h + mvp[9] * south + mvp[13]) / cw;
      return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H, cw];
    };
    let best: number | null = null;
    let bestDepth = Number.POSITIVE_INFINITY;
    for (const d of this.domes) {
      const south = d.south + d.slideSouth * (this.domeMoves.get(d.n)?.f ?? this.domeOpen.get(d.n) ?? 0);
      const c = project(d.east, south);
      const edge = project(d.east + DOME_PICK_RADIUS_M, south);
      if (!c || !edge) continue;
      const radius = Math.max(12, Math.hypot(edge[0] - c[0], edge[1] - c[1]));
      if (Math.hypot(x - c[0], y - c[1]) <= radius && c[2] < bestDepth) {
        best = d.n;
        bestDepth = c[2];
      }
    }
    return best;
  }

  /** Advance the domes' slides to `now` and write their units' matrices; true while one moves. */
  private stepDomes(gl: WebGL2RenderingContext, now: number): boolean {
    if (!this.domeBuf || !this.domeBase || (!this.domeMoves.size && !this.domeDirty)) return false;
    let moving = false;
    for (const [n, m] of this.domeMoves) {
      m.f = domeSlideAt(m.from, m.to, now - m.start);
      this.domeOpen.set(n, m.f);
      if (m.f === m.to) this.domeMoves.delete(n);
      else moving = true;
    }
    const out = new Float32Array(this.domeBase);
    for (const d of this.domes) {
      const f = this.domeOpen.get(d.n) ?? 0;
      // Along the ground's south axis (the matrices' translation is [east, up, south] metres).
      if (f) out[d.instance * 16 + 14] += d.slideSouth * f;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.domeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    this.domeDirty = false;
    // Its shadow is drawn again once it rests (a shadow pass every frame would cost a phone too much).
    if (!moving) this.shadowDirty = true;
    return moving;
  }

  /** The nearest canopy to a tap, by its column from the ground to the top, within 24 px. */
  private canopyAt(x: number, y: number): number | null {
    const mvp = this.lastMvp;
    const canvas = this.map?.getCanvas();
    if (!mvp || !canvas || !this.canopies.length) return null;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const [cx, cz] = this.canopyAxis;
    const project = (m: Float32Array, h: number): [number, number, number] | null => {
      const wx = m[0] * cx + m[4] * h + m[8] * cz + m[12];
      const wy = m[1] * cx + m[5] * h + m[9] * cz + m[13];
      const wz = m[2] * cx + m[6] * h + m[10] * cz + m[14];
      const cw = mvp[3] * wx + mvp[7] * wy + mvp[11] * wz + mvp[15];
      if (cw <= 0) return null;
      const nx = (mvp[0] * wx + mvp[4] * wy + mvp[8] * wz + mvp[12]) / cw;
      const ny = (mvp[1] * wx + mvp[5] * wy + mvp[9] * wz + mvp[13]) / cw;
      return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H, cw];
    };
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    this.canopies.forEach((c, k) => {
      const a = project(c.matrix, 0);
      const b = project(c.matrix, 18);
      if (!a || !b) return;
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t);
      // Within reach, the nearest to the eye wins: a column in front hides the ones behind it.
      if (d <= 24 && a[2] < bestScore) {
        best = k;
        bestScore = a[2];
      }
    });
    return best;
  }

  private setHidden(k: number, hidden: boolean): void {
    for (const ref of this.canopies[k].refs) ref.data[ref.i] = hidden ? 1 : 0;
    this.hideDirty = true;
  }

  private hideDirty = false;

  /** Advance the moves to `now`, and write the anim group's instances and the hidden flags. */
  private stepCanopies(gl: WebGL2RenderingContext, now: number): boolean {
    if (this.hideDirty) {
      const seen = new Set<WebGLBuffer>();
      for (const c of this.canopies) {
        for (const ref of c.refs) {
          if (seen.has(ref.buf)) continue;
          seen.add(ref.buf);
          gl.bindBuffer(gl.ARRAY_BUFFER, ref.buf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, ref.data);
        }
      }
      this.hideDirty = false;
    }
    if (!this.moves.size || !this.animMatrices || !this.animFolds) {
      this.animCount = 0;
      return false;
    }
    let moving = false;
    const matrices = new Float32Array(this.moves.size * 16);
    const folds = new Float32Array(this.moves.size);
    let n = 0;
    for (const [k, m] of this.moves) {
      m.f = canopyFoldAt(m.from, m.to, now - m.start);
      const done = m.f === m.to;
      if (!done) moving = true;
      // Folded back where navQ has it folded: the file's own canopy again.
      if (done && m.to === 0 && !(this.canopies[k].foldable && !this.folded)) {
        this.moves.delete(k);
        this.setHidden(k, false);
        continue;
      }
      if (done && m.to === 1 && this.canopies[k].foldable && !this.folded) {
        this.moves.delete(k);
        this.setHidden(k, false);
        continue;
      }
      matrices.set(this.canopies[k].matrix, n * 16);
      folds[n] = m.f;
      n++;
    }
    this.animCount = n;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.animMatrices);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, matrices.subarray(0, n * 16));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.animFolds);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, folds.subarray(0, n));
    if (this.hideDirty) return this.stepCanopies(gl, now) || moving;
    return moving;
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
    this.folded = folded;
    if (this.stepCanopies(gl, performance.now()) || this.moves.size) this.shadowDirty = true;
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
    gl.vertexAttrib1f(7, 0);
    gl.vertexAttrib1f(8, 1);
    for (const prim of this.prims) {
      if ((prim.when === 'day' && folded) || (prim.when === 'night' && !folded)) continue;
      // Under the roof no sun reaches the interior's props.
      if (prim.interiorOnly || prim.doorKit) continue;
      // A lattice casts the shadow of its bars, not of a wall: left out of the shadow map.
      if (prim.cutoff > 0) continue;
      const instances = prim.when === 'anim' ? this.animCount : prim.instances;
      if (!instances) continue;
      gl.uniform4fv(this.uDepthCanopy, prim.when === 'anim' ? this.canopyAxis : [0, 0, 0, 0]);
      gl.bindVertexArray(prim.vao);
      if (prim.hasIndices) gl.drawElementsInstanced(prim.mode, prim.count, prim.indexType, 0, instances);
      else gl.drawArraysInstanced(prim.mode, 0, prim.count, instances);
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
    this.lastMvp = mvp64;
    this.folded = this.light.night >= 0.5;
    // A canopy still moving asks for the next frame (its shadow follows in prerender).
    if (this.stepCanopies(gl, performance.now())) {
      this.shadowDirty = true;
      this.map?.triggerRepaint();
    }
    // A dome still sliding asks for the next frame too.
    if (this.stepDomes(gl, performance.now())) this.map?.triggerRepaint();
    if (this.stepDoors(gl, performance.now())) this.map?.triggerRepaint();

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
    gl.vertexAttrib1f(7, 0);
    gl.vertexAttrib1f(8, 1);
    // The sun's shadow map on unit 1 (drawn in prerender).
    gl.uniformMatrix4fv(this.uLight, false, sunShadow.matrix);
    gl.uniform1f(this.uShadowOn, sunShadow.strength > 0 && !this.shadowDirty ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sunShadow.texture);
    gl.uniform1i(this.uShadowMap, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.doorCutTex ?? this.fallbackTex);
    gl.uniform1i(this.uDoorCutTex, 2);
    gl.uniform1i(this.uDoorCutCount, this.doorCutTex ? this.doorCutCount : 0);
    gl.activeTexture(gl.TEXTURE0);

    let boundTex: WebGLTexture | null = null;
    // Folded from about sunset (the light is then half way to night) until morning.
    const folded = light.night >= 0.5;
    // Where the roof lifts (none in the interior view: there all of it is faded instead).
    const reveal = this.interior ? NO_REVEAL : (this.revealSource?.() ?? NO_REVEAL);
    const lifted = reveal.discs.length + reveal.lanes.length > 0;
    const discs = new Float32Array(6);
    reveal.discs.slice(0, 2).forEach((d, i) => discs.set(d, i * 3));
    const lanes = new Float32Array(MAX_REVEAL_LANES * 4);
    reveal.lanes.slice(0, MAX_REVEAL_LANES).forEach((l, i) => lanes.set(l, i * 4));
    gl.uniform3fv(this.uRevealDisc, discs);
    gl.uniform1i(this.uRevealDiscs, Math.min(2, reveal.discs.length));
    gl.uniform4fv(this.uRevealLane, lanes);
    gl.uniform1i(this.uRevealLanes, Math.min(MAX_REVEAL_LANES, reveal.lanes.length));
    gl.uniform1f(this.uRevealHalf, reveal.laneHalf);
    // The interior's columns, arches and chandeliers: under the roof they stay hidden when far away,
    // and draw whenever zoomed close (to see straight through open doors), in interior mode, or under an open dome/route.
    const props = this.interior || lifted || this.anyDomeOpen() || (this.map?.getZoom() ?? 0) >= 18.2;
    const passes: readonly ('all' | 'keep' | 'fade')[] = this.interior ? ['keep', 'fade'] : ['all'];
    for (const pass of passes) {
      gl.depthMask(pass !== 'fade');
      for (const prim of this.prims) {
        if ((prim.when === 'day' && folded) || (prim.when === 'night' && !folded)) continue;
        if (prim.interiorOnly && !props) continue;
        if (pass === 'keep' && prim.interiorRole !== 'keep') continue;
        if (pass === 'fade' && prim.interiorRole === 'keep') continue;
        if (prim.thresholdGlow && light.night <= 0.02) continue;
        const instances = prim.when === 'anim' ? this.animCount : prim.instances;
        if (!instances) continue;
        const alphaScale = (!this.interior ? 1 : prim.interiorRole === 'roof' ? 0.14 : prim.interiorRole === 'wall' ? 0.24 : 1) * (prim.thresholdGlow ? light.night : 1);
        gl.uniform4fv(this.uCanopy, prim.when === 'anim' ? this.canopyAxis : [0, 0, 0, 0]);
        gl.uniform4fv(this.uBaseColor, [prim.baseColor[0], prim.baseColor[1], prim.baseColor[2], prim.baseColor[3] * alphaScale]);
        gl.uniform3fv(this.uGlow, prim.glow);
        gl.uniform1f(this.uGlowTint, prim.glowTint);
        gl.uniform1f(this.uGlowRise, prim.glowRise);
        gl.uniform2fv(this.uCrown, prim.crown);
        gl.uniform1i(this.uPortal, prim.portalGate !== undefined ? (isGateOpen(prim.portalGate) ? 2 : 1) : prim.portal);
        gl.uniform4fv(this.uPortalRect, prim.portalRect);
        gl.uniform2fv(this.uPortalSize, prim.portalSize);
        gl.uniform1f(this.uLattice, prim.lattice ? 1 : 0);
        gl.uniform1f(this.uCutoff, prim.cutoff);
        gl.uniform1i(this.uRevealRole, lifted ? prim.revealRole : 0);
        gl.uniform1i(this.uDoorCutOn, prim.cutDoorways ? 1 : 0);

        const texture = prim.hasUv && prim.textureIndex >= 0 ? this.textures[prim.textureIndex] : undefined;
        gl.uniform1i(this.uHasTex, texture ? 1 : 0);
        const target = texture ?? this.fallbackTex;
        if (target && target !== boundTex) {
          gl.bindTexture(gl.TEXTURE_2D, target);
          boundTex = target;
        }

        gl.bindVertexArray(prim.vao);
        if (prim.hasIndices) gl.drawElementsInstanced(prim.mode, prim.count, prim.indexType, 0, instances);
        else gl.drawArraysInstanced(prim.mode, 0, prim.count, instances);
      }
    }
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}
