import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { APPROVED_BUILDINGS, APPROVED_BY_POI_ID, APPROVED_FOOTPRINT_BUILDINGS, urbanOpacityForCamera } from '../domain/urban-approval';
import { streetCorridors } from '../../data/urban-approved.json';
import { frameMatrix, mulMat4, parseGlbBuffer } from './glb-layer';
import { cameraEye } from './plaza-layer';
import type { SceneLight } from './scene-light';

export const URBAN_GLB_URL = './models/urban-south-stage6.glb';
export const URBAN_LAYER_ID = 'urban-south-3d';
export const URBAN_ZONES = [{ id: 'south', url: URBAN_GLB_URL }] as const;
export const URBAN_STREETS_SOURCE_ID = 'urban-south-streets';
export const URBAN_STREETS_LAYER_ID = 'urban-south-streets-line';

const APPROVED_FOOTPRINT_IDS = APPROVED_FOOTPRINT_BUILDINGS.map((b) => b.poiId);
const VALID_HEIGHT_SOURCES = new Set(['osm_levels', 'estimated_display_only', 'owner_verified']);
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

interface GlbAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GlbBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GlbPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
}

interface GlbMesh {
  name?: string;
  primitives: GlbPrimitive[];
}

interface GlbNode {
  name?: string;
  mesh?: number;
  extras?: Record<string, unknown>;
}

interface GlbMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number };
  };
  emissiveTexture?: { index: number };
}

interface GlbTexture {
  source?: number;
}

interface GlbImage {
  bufferView?: number;
  mimeType?: string;
}

export interface UrbanGlbJson {
  asset?: { extras?: Record<string, unknown> };
  scenes?: { extras?: Record<string, unknown> }[];
  nodes?: GlbNode[];
  meshes?: GlbMesh[];
  materials?: GlbMaterial[];
  textures?: GlbTexture[];
  images?: GlbImage[];
  accessors?: GlbAccessor[];
  bufferViews?: GlbBufferView[];
}

export interface GlbValidationResult {
  ok: boolean;
  reason?: string;
  buildingCount: number;
  maxHeightM: number;
}

/**
 * A9 Provenance GLB Guard: validates `public/models/urban-south-stage6.glb` before uploading to
 * WebGL, proving it carries only owner-approved Zone 1 South buildings (`haram-urban-approved-v2`),
 * verified or display-tagged heights within expected bounds, and approved street/prop nodes.
 */
export function validateUrbanGlb(rawGltf: unknown): GlbValidationResult {
  const gltf = rawGltf as UrbanGlbJson;
  const extras = gltf.asset?.extras ?? gltf.scenes?.[0]?.extras;
  if (!extras || extras.schema !== 'haram-urban-approved-v2' || extras.tier !== 'verified' || extras.approvedBy !== 'owner') {
    return { ok: false, reason: 'Missing verified v2 owner approval extras on GLB asset', buildingCount: 0, maxHeightM: 0 };
  }
  if (extras.heightMode !== 'verified_and_estimated_display_only') {
    return { ok: false, reason: 'GLB heightMode is not verified_and_estimated_display_only', buildingCount: 0, maxHeightM: 0 };
  }

  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const seenBuildings = new Set<number>();
  let maxHeightM = 0;

  for (const node of nodes) {
    const name = node.name ?? '';
    const isHotel = name.startsWith('urban-hotel-');
    const isStreet = name.startsWith('urban-street-south-');
    const isProp = name.startsWith('urban-prop-south-');
    if (!isHotel && !isStreet && !isProp) {
      return { ok: false, reason: `Unapproved GLB node "${name}" rejected by A9 guard`, buildingCount: 0, maxHeightM };
    }
    if (isHotel) {
      const poiId = Number(node.extras?.poiId);
      const approved = APPROVED_BY_POI_ID.get(poiId);
      const src = String(node.extras?.heightSource ?? '');
      if (!approved || !approved.hasFootprint || node.extras?.buildingId !== approved.buildingId || !VALID_HEIGHT_SOURCES.has(src)) {
        return { ok: false, reason: `Unapproved or invalid hotel node "${name}"`, buildingCount: 0, maxHeightM };
      }
      if (typeof node.mesh === 'number') {
        const mesh = meshes[node.mesh];
        for (const prim of mesh?.primitives ?? []) {
          const posAcc = accessors[prim.attributes.POSITION];
          const maxY = posAcc?.max?.[1];
          if (typeof maxY === 'number') {
            maxHeightM = Math.max(maxHeightM, maxY);
            if (maxY < 10.0 || maxY > 72.0 || Math.abs(maxY - approved.heightM) > 4.0) {
              return {
                ok: false,
                reason: `Out-of-bounds height (${maxY.toFixed(2)} m vs ${approved.heightM} m) for "${name}" rejected by A9 guard`,
                buildingCount: 0,
                maxHeightM,
              };
            }
          }
        }
      }
      seenBuildings.add(poiId);
    }
  }

  if (seenBuildings.size !== APPROVED_FOOTPRINT_IDS.length || !APPROVED_FOOTPRINT_IDS.every((id) => seenBuildings.has(id))) {
    return {
      ok: false,
      reason: `Expected ${APPROVED_FOOTPRINT_IDS.length} footprinted approved hotels (${APPROVED_BUILDINGS.length} total), got ${seenBuildings.size}`,
      buildingCount: seenBuildings.size,
      maxHeightM,
    };
  }

  return { ok: true, buildingCount: seenBuildings.size, maxHeightM };
}

/** Verified OSM street corridors around Zone 1 South (lazy-loaded only in 3D). */
export function buildUrbanStreetGeoJson(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: (streetCorridors as unknown as { kind: string; road?: boolean; wayIndex: number; coords: [number, number][] }[]).map((c) => ({
      type: 'Feature',
      properties: { kind: c.kind, road: Boolean(c.road), wayIndex: c.wayIndex },
      geometry: { type: 'LineString', coordinates: c.coords },
    })),
  };
}

const VERT_SRC = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_mvp;
out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_worldPos = a_pos;
  v_normal = a_normal;
  v_uv = a_uv;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
uniform vec3 u_eye;
uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
uniform vec3 u_fog;
uniform float u_night;
uniform vec4 u_color;
uniform vec4 u_meta; // x=seed, y=tint, z=kind (0=building, 1=street, 2=prop, 3=lamp_glow), w=useTex
uniform sampler2D u_albedo;
uniform sampler2D u_mask;
out vec4 fragColor;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float kind = u_meta.z;
  if (kind > 2.5) {
    if (u_night < 0.12) discard;
    float r = length((v_uv - 0.5) * 2.0);
    float falloff = smoothstep(1.0, 0.0, r);
    float pool = falloff * falloff;
    float nFade = smoothstep(0.12, 0.85, u_night);
    fragColor = vec4(1.0, 0.84, 0.50, pool * nFade * 0.58);
    return;
  }

  vec2 uv = v_uv;
  vec2 duv_dx = dFdx(v_uv);
  vec2 duv_dy = dFdy(v_uv);
  if (u_meta.w > 0.5 && uv.y >= 2.0) {
    float sid = min(2.0, floor((uv.y - 2.0) / 10.0));
    float fcycle = fract(uv.y - (2.0 + sid * 10.0));
    float yTop = sid < 0.5 ? 53.0 : (sid < 1.5 ? 177.0 : 301.0);
    float yBot = sid < 0.5 ? 175.0 : (sid < 1.5 ? 299.0 : 411.0);
    float bandScale = (yBot - yTop) / 512.0;
    uv.y = (yBot - fcycle * (yBot - yTop)) / 512.0;
    duv_dx.y *= -bandScale;
    duv_dy.y *= -bandScale;
  }

  vec3 n = normalize(v_normal);
  vec3 baseRgb = u_color.rgb;
  float glassMask = 0.0;
  float roomMask = 0.0;
  float glowMask = 0.0;

  if (u_meta.w > 0.5) {
    baseRgb = textureGrad(u_albedo, uv, duv_dx, duv_dy).rgb;
    vec3 msk = textureGrad(u_mask, uv, duv_dx, duv_dy).rgb;
    glassMask = msk.r;
    roomMask = msk.g;
    glowMask = msk.b;
    baseRgb = clamp(baseRgb * (1.0 + u_meta.y * (1.0 - glassMask)), 0.0, 1.0);
  }

  vec3 sDir = normalize(u_sunDir);
  float ndotl = max(dot(n, sDir), 0.0);
  float hemi = 0.20 * (0.5 + 0.5 * n.y);
  vec3 lit = baseRgb * (u_ambient * (0.85 + hemi) + u_sun * (0.82 * ndotl + 0.14));

  // Fresnel sky reflection + solar specular on building curtain/window glass
  if (u_meta.w > 0.5 && glassMask > 0.22) {
    vec3 V = normalize(u_eye - v_worldPos);
    vec3 R = reflect(-V, n);
    float ndotv = max(dot(n, V), 0.0);
    float fresnel = mix(0.10, 0.88, pow(1.0 - ndotv, 3.5));

    float skyT = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
    float golden = clamp(u_sun.r * 1.4 - u_sun.b * 1.6, 0.0, 1.0);
    vec3 daySky = mix(vec3(0.84, 0.82, 0.78), vec3(0.32, 0.56, 0.86), skyT);
    vec3 goldSky = mix(vec3(0.95, 0.60, 0.34), vec3(0.26, 0.42, 0.68), skyT);
    vec3 nightSky = mix(vec3(0.22, 0.19, 0.24), vec3(0.03, 0.06, 0.14), skyT);
    vec3 reflSky = mix(mix(daySky, goldSky, golden), nightSky, u_night);

    float spec = pow(max(dot(R, sDir), 0.0), 48.0);
    lit = mix(lit, reflSky, glassMask * fresnel * 0.72) + u_sun * (spec * 0.90 * glassMask);
  }

  // Night architectural lighting: randomized room windows + commercial arcade / canopy / crown glow
  if (u_night > 0.05 && u_meta.w > 0.5) {
    float nStr = smoothstep(0.12, 0.85, u_night);
    if (roomMask > 0.08) {
      float floorIdx = floor((v_worldPos.y - 8.9) / 3.15);
      vec2 cell = vec2(floor(v_uv.x * 8.0), floorIdx);
      float h = hash12(cell + vec2(u_meta.x * 71.3, u_meta.x * 37.9));
      float isOn = step(0.47, h);
      vec3 warmTone = mix(vec3(1.0, 0.76, 0.44), vec3(1.0, 0.94, 0.80), fract(h * 19.3));
      lit += warmTone * (roomMask * isOn * nStr * 1.15);
    }
    if (glowMask > 0.08) {
      lit += vec3(1.0, 0.82, 0.52) * (glowMask * smoothstep(0.08, 0.75, u_night) * 1.10);
    }
  }

  // Subtle atmospheric haze matching SceneLight fog beyond 450 m
  float dist = length(u_eye - v_worldPos);
  float fogF = clamp((dist - 450.0) / 1450.0, 0.0, 0.62);
  lit = mix(lit, u_fog, fogF);

  fragColor = vec4(clamp(lit, 0.0, 1.0), u_color.a);
}
`;

interface GpuPart {
  vao: WebGLVertexArrayObject;
  count: number;
  indexType: number;
  color: [number, number, number, number];
  kind: number; // 0=building, 1=street, 2=prop, 3=lamp_glow
  seed: number;
  tint: number;
  useTex: boolean;
}

interface PendingLoad {
  gltf: UrbanGlbJson;
  bin: Uint8Array;
  albedoImg: ImageBitmap | HTMLImageElement | null;
  maskImg: ImageBitmap | HTMLImageElement | null;
}

async function decodeGlbImage(bytes: Uint8Array, mime: string): Promise<ImageBitmap | HTMLImageElement | null> {
  const blob = new Blob([bytes], { type: mime });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fallback below
    }
  }
  if (typeof Image === 'function' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return null;
}

function closeDecodedImage(img: ImageBitmap | HTMLImageElement | null): void {
  if (img && 'close' in img && typeof img.close === 'function') img.close();
}

/** Lazy WebGL2 custom layer rendering Stage 6 Zone 1 South buildings, streets, and urban props. */
export class Urban3DLayer implements CustomLayerInterface {
  readonly id = URBAN_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private light: SceneLight;
  private mercatorMatrix = frameMatrix();
  private program: WebGLProgram | null = null;
  private uMvp: WebGLUniformLocation | null = null;
  private uEye: WebGLUniformLocation | null = null;
  private uSunDir: WebGLUniformLocation | null = null;
  private uSun: WebGLUniformLocation | null = null;
  private uAmbient: WebGLUniformLocation | null = null;
  private uFog: WebGLUniformLocation | null = null;
  private uNight: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uMeta: WebGLUniformLocation | null = null;
  private uAlbedo: WebGLUniformLocation | null = null;
  private uMask: WebGLUniformLocation | null = null;
  private pending: PendingLoad | null = null;
  private parts: GpuPart[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private buffers: WebGLBuffer[] = [];
  private textures: WebGLTexture[] = [];
  private albedoTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private generation = 0;

  constructor(light: SceneLight) {
    this.light = light;
  }

  setLight(light: SceneLight): void {
    this.light = light;
    this.map?.triggerRepaint();
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.initProgram(gl);
    const gen = ++this.generation;
    void this.loadGlb(gen);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext): void {
    this.generation++;
    if (this.pending) {
      closeDecodedImage(this.pending.albedoImg);
      closeDecodedImage(this.pending.maskImg);
      this.pending = null;
    }
    for (const t of this.textures) gl.deleteTexture(t);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.textures = [];
    this.albedoTex = null;
    this.maskTex = null;
    this.vaos = [];
    this.buffers = [];
    this.parts = [];
    this.program = null;
    this.map = null;
  }

  private initProgram(gl: WebGL2RenderingContext): void {
    const compile = (type: number, src: string) => {
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
    this.uEye = gl.getUniformLocation(prog, 'u_eye');
    this.uSunDir = gl.getUniformLocation(prog, 'u_sunDir');
    this.uSun = gl.getUniformLocation(prog, 'u_sun');
    this.uAmbient = gl.getUniformLocation(prog, 'u_ambient');
    this.uFog = gl.getUniformLocation(prog, 'u_fog');
    this.uNight = gl.getUniformLocation(prog, 'u_night');
    this.uColor = gl.getUniformLocation(prog, 'u_color');
    this.uMeta = gl.getUniformLocation(prog, 'u_meta');
    this.uAlbedo = gl.getUniformLocation(prog, 'u_albedo');
    this.uMask = gl.getUniformLocation(prog, 'u_mask');
  }

  private async loadGlb(gen: number): Promise<void> {
    try {
      const res = await fetch(URBAN_GLB_URL);
      if (!res.ok) return;
      const { gltf: rawGltf, bin } = parseGlbBuffer(await res.arrayBuffer());
      if (gen !== this.generation) return;
      const gltf = rawGltf as unknown as UrbanGlbJson;
      const check = validateUrbanGlb(gltf);
      if (!check.ok) {
        console.warn(`[urban-3d] A9 guard blocked GLB load: ${check.reason}`);
        return;
      }

      const decodeTex = async (texIdx: number | undefined) => {
        if (typeof texIdx !== 'number') return null;
        const imgIdx = gltf.textures?.[texIdx]?.source;
        const imgMeta = typeof imgIdx === 'number' ? gltf.images?.[imgIdx] : undefined;
        if (!imgMeta || typeof imgMeta.bufferView !== 'number') return null;
        const bv = gltf.bufferViews?.[imgMeta.bufferView];
        if (!bv) return null;
        const start = bv.byteOffset ?? 0;
        const bytes = bin.slice(start, start + bv.byteLength);
        return decodeGlbImage(bytes, imgMeta.mimeType ?? 'image/jpeg');
      };

      const facadeMat = gltf.materials?.[0];
      const [albedoImg, maskImg] = await Promise.all([
        decodeTex(facadeMat?.pbrMetallicRoughness?.baseColorTexture?.index),
        decodeTex(facadeMat?.emissiveTexture?.index),
      ]);
      if (gen !== this.generation) {
        closeDecodedImage(albedoImg);
        closeDecodedImage(maskImg);
        return;
      }
      this.pending = { gltf, bin, albedoImg, maskImg };
      this.map?.triggerRepaint();
    } catch {
      // Offline or test DOM without fetch: map keeps operating safely.
    }
  }

  private makeFallbackTexture(gl: WebGL2RenderingContext, rgba: [number, number, number, number]): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    this.textures.push(tex);
    return tex;
  }

  private uploadImageTexture(gl: WebGL2RenderingContext, img: ImageBitmap | HTMLImageElement | null, fallbackRgba: [number, number, number, number]): WebGLTexture {
    if (!img) return this.makeFallbackTexture(gl, fallbackRgba);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const maxAniso = Math.min(4, Number(gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
    this.textures.push(tex);
    closeDecodedImage(img);
    return tex;
  }

  private upload(gl: WebGL2RenderingContext, loaded: PendingLoad): void {
    const { gltf, bin, albedoImg, maskImg } = loaded;
    this.albedoTex = this.uploadImageTexture(gl, albedoImg, [230, 218, 194, 255]);
    this.maskTex = this.uploadImageTexture(gl, maskImg, [0, 0, 0, 255]);

    const bvs = gltf.bufferViews ?? [];
    const accs = gltf.accessors ?? [];
    const mats = gltf.materials ?? [];
    const meshes = gltf.meshes ?? [];
    const glBuffers = bvs.map((bv, i) => {
      const isIndex = accs.some((a) => a.bufferView === i && a.type === 'SCALAR');
      if (isIndex) return null;
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const start = bv.byteOffset ?? 0;
      gl.bufferData(gl.ARRAY_BUFFER, bin.subarray(start, start + bv.byteLength), gl.STATIC_DRAW);
      this.buffers.push(buf);
      return buf;
    });

    for (const node of gltf.nodes ?? []) {
      if (typeof node.mesh !== 'number') continue;
      const name = node.name ?? '';
      const isBuilding = name.startsWith('urban-hotel-');
      const isStreet = name.startsWith('urban-street-south-');
      const isLampGlow = name === 'urban-prop-south-lamp-glow';
      const kind = isBuilding ? 0 : isStreet ? 1 : isLampGlow ? 3 : 2;
      const seed = Number(node.extras?.seed ?? 0);
      const tint = Number(node.extras?.tint ?? 0);

      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        this.vaos.push(vao);

        const posIdx = prim.attributes.POSITION;
        const posAcc = accs[posIdx];
        const posBv = bvs[posAcc.bufferView];
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers[posAcc.bufferView]);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, TYPE_COMPONENTS[posAcc.type] ?? 3, posAcc.componentType, false, posBv.byteStride ?? 0, posAcc.byteOffset ?? 0);

        const nrmIdx = prim.attributes.NORMAL;
        if (typeof nrmIdx === 'number') {
          const nrmAcc = accs[nrmIdx];
          const nrmBv = bvs[nrmAcc.bufferView];
          gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers[nrmAcc.bufferView]);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, TYPE_COMPONENTS[nrmAcc.type] ?? 3, nrmAcc.componentType, false, nrmBv.byteStride ?? 0, nrmAcc.byteOffset ?? 0);
        } else {
          gl.disableVertexAttribArray(1);
          gl.vertexAttrib3f(1, 0, 1, 0);
        }

        const uvIdx = prim.attributes.TEXCOORD_0;
        if (typeof uvIdx === 'number') {
          const uvAcc = accs[uvIdx];
          const uvBv = bvs[uvAcc.bufferView];
          gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers[uvAcc.bufferView]);
          gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(2, TYPE_COMPONENTS[uvAcc.type] ?? 2, uvAcc.componentType, false, uvBv.byteStride ?? 0, uvAcc.byteOffset ?? 0);
        } else {
          gl.disableVertexAttribArray(2);
          gl.vertexAttrib2f(2, 0.5, 0.5);
        }

        if (typeof prim.indices !== 'number') continue;
        const idxAcc = accs[prim.indices];
        const idxBv = bvs[idxAcc.bufferView];
        const idxByteOffset = idxAcc.byteOffset ?? 0;
        const byteCount = idxAcc.count * (COMPONENT_BYTES[idxAcc.componentType] ?? 2);
        const ebo = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        const rawStart = (idxBv.byteOffset ?? 0) + idxByteOffset;
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bin.subarray(rawStart, rawStart + byteCount), gl.STATIC_DRAW);
        this.buffers.push(ebo);

        const mat = mats[prim.material ?? 0];
        const baseColor = mat?.pbrMetallicRoughness?.baseColorFactor ?? [0.76, 0.7, 0.58, 1];
        const useTex = Boolean(mat?.pbrMetallicRoughness?.baseColorTexture);
        this.parts.push({
          vao,
          count: idxAcc.count,
          indexType: idxAcc.componentType,
          color: baseColor,
          kind,
          seed,
          tint,
          useTex,
        });
      }
    }
    gl.bindVertexArray(null);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map) return;
    if (this.pending) {
      this.upload(gl, this.pending);
      this.pending = null;
    }
    if (!this.parts.length) return;

    const proj = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!proj) return;
    const mvp64 = new Float64Array(16);
    mulMat4(mvp64, proj as unknown as ArrayLike<number>, this.mercatorMatrix);

    const fade = urbanOpacityForCamera(this.map.getBearing(), this.map.getPitch());
    const eye = cameraEye(this.map);

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.uniformMatrix4fv(this.uMvp, false, new Float32Array(mvp64));
    gl.uniform3f(this.uEye, eye[0], eye[1], eye[2]);
    gl.uniform3fv(this.uSunDir, this.light.sunDir);
    gl.uniform3fv(this.uSun, this.light.sun);
    gl.uniform3fv(this.uAmbient, this.light.ambient);
    gl.uniform3fv(this.uFog, this.light.fog);
    gl.uniform1f(this.uNight, this.light.night);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.albedoTex);
    gl.uniform1i(this.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(this.uMask, 1);

    // Pass 1: Opaque streets, props, and un-faded buildings
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const part of this.parts) {
      if (part.kind === 3) continue;
      const alpha = part.kind === 0 ? part.color[3] * fade : part.color[3];
      if (alpha < 0.99) continue;
      gl.uniform4f(this.uColor, part.color[0], part.color[1], part.color[2], alpha);
      gl.uniform4f(this.uMeta, part.seed, part.tint, part.kind, part.useTex ? 1 : 0);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
    }

    // Pass 2: A8 faded buildings + night streetlamp glow pools
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const part of this.parts) {
      if (part.kind === 3) continue;
      const alpha = part.kind === 0 ? part.color[3] * fade : part.color[3];
      if (alpha >= 0.99) continue;
      gl.uniform4f(this.uColor, part.color[0], part.color[1], part.color[2], alpha);
      gl.uniform4f(this.uMeta, part.seed, part.tint, part.kind, part.useTex ? 1 : 0);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
    }

    if (this.light.night >= 0.12) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const part of this.parts) {
        if (part.kind !== 3) continue;
        gl.uniform4f(this.uColor, part.color[0], part.color[1], part.color[2], 1);
        gl.uniform4f(this.uMeta, part.seed, part.tint, part.kind, 0);
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
      }
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }
}

/** Add Stage 6 Zone 1 South OSM corridor lines + Blender GLB custom layer lazily when 3D turns on. */
export function mountUrban3D(map: MLMap, light: SceneLight, before?: string): Urban3DLayer {
  if (!map.getSource(URBAN_STREETS_SOURCE_ID)) {
    map.addSource(URBAN_STREETS_SOURCE_ID, { type: 'geojson', data: buildUrbanStreetGeoJson() });
  }
  if (!map.getLayer(URBAN_STREETS_LAYER_ID)) {
    map.addLayer(
      {
        id: URBAN_STREETS_LAYER_ID,
        type: 'line',
        source: URBAN_STREETS_SOURCE_ID,
        minzoom: 14.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind'], ['arterial', 'boulevard', 'local', 'service'], '#3d4550', '#c9beaa'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, ['match', ['get', 'kind'], 'arterial', 4, 'boulevard', 3, 2], 18, ['match', ['get', 'kind'], 'arterial', 9, 'boulevard', 7, 5]],
          'line-opacity': 0.72,
        },
      },
      before,
    );
  }
  const existing = map.getLayer(URBAN_LAYER_ID) as unknown as Urban3DLayer | undefined;
  if (existing) return existing;
  const layer = new Urban3DLayer(light);
  map.addLayer(layer, before);
  return layer;
}
