import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import { APPROVED_BUILDINGS, APPROVED_BY_POI_ID, urbanOpacityForCamera } from '../domain/urban-approval';
import { streetCorridors } from '../../data/urban-approved.json';
import { frameMatrix, mulMat4, parseGlbBuffer } from './glb-layer';
import type { SceneLight } from './scene-light';

export const URBAN_GLB_URL = './models/urban-south-stage5.glb';
export const URBAN_LAYER_ID = 'urban-south-stage5-3d';
export const URBAN_STREETS_SOURCE_ID = 'urban-south-streets';
export const URBAN_STREETS_LAYER_ID = 'urban-south-streets-line';

const APPROVED_POI_LIST = APPROVED_BUILDINGS.map((b) => b.poiId);
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
  pbrMetallicRoughness?: { baseColorFactor?: [number, number, number, number] };
}

export interface UrbanGlbJson {
  asset?: { extras?: Record<string, unknown> };
  scenes?: { extras?: Record<string, unknown> }[];
  nodes?: GlbNode[];
  meshes?: GlbMesh[];
  materials?: GlbMaterial[];
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
 * A9 Synthetic-Scene GLB Guard: validates `public/models/urban-south-stage5.glb` before uploading
 * to WebGL, proving it carries only owner-approved Stage 5 buildings, flat heights (< 1 m), and
 * verified Southern Plaza OSM corridors.
 */
export function validateUrbanGlb(rawGltf: unknown): GlbValidationResult {
  const gltf = rawGltf as UrbanGlbJson;
  const extras = gltf.asset?.extras ?? gltf.scenes?.[0]?.extras;
  if (!extras || extras.schema !== 'haram-urban-approved-v1' || extras.tier !== 'verified' || extras.approvedBy !== 'owner') {
    return { ok: false, reason: 'Missing verified owner approval extras on GLB asset', buildingCount: 0, maxHeightM: 0 };
  }
  if (extras.heightMode !== 'flat_pending_owner_floors') {
    return { ok: false, reason: 'GLB heightMode is not flat_pending_owner_floors', buildingCount: 0, maxHeightM: 0 };
  }

  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const seenBuildings = new Set<number>();
  let maxHeightM = 0;

  for (const node of nodes) {
    const name = node.name ?? '';
    const isHotel = name.startsWith('urban-hotel-');
    const isDoor = name.startsWith('urban-door-');
    const isStreet = name.startsWith('urban-street-south-');
    if (!isHotel && !isDoor && !isStreet) {
      return { ok: false, reason: `Unapproved GLB node "${name}" rejected by A9 guard`, buildingCount: 0, maxHeightM };
    }
    if (isHotel) {
      const poiId = Number(node.extras?.poiId);
      const approved = APPROVED_BY_POI_ID.get(poiId);
      if (!approved || node.extras?.buildingId !== approved.buildingId || node.extras?.heightSource !== 'flat_pending_owner_floors') {
        return { ok: false, reason: `Unapproved or height-modified hotel node "${name}"`, buildingCount: 0, maxHeightM };
      }
      seenBuildings.add(poiId);
    }
    if (typeof node.mesh === 'number') {
      const mesh = meshes[node.mesh];
      for (const prim of mesh?.primitives ?? []) {
        const posAcc = accessors[prim.attributes.POSITION];
        if (posAcc?.max && typeof posAcc.max[1] === 'number') {
          maxHeightM = Math.max(maxHeightM, posAcc.max[1]);
          if (posAcc.max[1] >= 1.0) {
            return { ok: false, reason: `Synthetic vertical height (${posAcc.max[1].toFixed(2)} m) rejected by A9 guard`, buildingCount: 0, maxHeightM };
          }
        }
      }
    }
  }

  if (seenBuildings.size !== APPROVED_POI_LIST.length || !APPROVED_POI_LIST.every((id) => seenBuildings.has(id))) {
    return {
      ok: false,
      reason: `Expected ${APPROVED_POI_LIST.length} approved hotels, got ${seenBuildings.size}`,
      buildingCount: seenBuildings.size,
      maxHeightM,
    };
  }

  return { ok: true, buildingCount: seenBuildings.size, maxHeightM };
}

/** Verified OSM street corridors around Southern Plaza (lazy-loaded only in 3D). */
export function buildUrbanStreetGeoJson(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: (streetCorridors as unknown as { kind: string; wayIndex: number; coords: [number, number][] }[]).map((c) => ({
      type: 'Feature',
      properties: { kind: c.kind, wayIndex: c.wayIndex },
      geometry: { type: 'LineString', coordinates: c.coords },
    })),
  };
}

const VERT_SRC = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
uniform mat4 u_mvp;
out vec3 v_normal;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_normal = a_normal;
}
`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec3 v_normal;
uniform vec4 u_color;
uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_ambient;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal);
  float ndotl = max(dot(n, normalize(u_sunDir)), 0.0);
  vec3 lit = pow(max(u_color.rgb, vec3(0.0)), vec3(1.0 / 2.2)) * (u_ambient + u_sun * (0.65 * ndotl + 0.35));
  fragColor = vec4(clamp(lit, 0.0, 1.0), u_color.a);
}
`;

interface GpuPart {
  vao: WebGLVertexArrayObject;
  count: number;
  indexType: number;
  color: [number, number, number, number];
  isBuilding: boolean;
}

/** Lazy WebGL2 custom layer rendering Stage 5 owner-approved Southern Plaza buildings and streets. */
export class Urban3DLayer implements CustomLayerInterface {
  readonly id = URBAN_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: MLMap | null = null;
  private light: SceneLight;
  private mercatorMatrix = frameMatrix();
  private program: WebGLProgram | null = null;
  private uMvp: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uSunDir: WebGLUniformLocation | null = null;
  private uSun: WebGLUniformLocation | null = null;
  private uAmbient: WebGLUniformLocation | null = null;
  private pending: { gltf: UrbanGlbJson; bin: Uint8Array } | null = null;
  private parts: GpuPart[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private buffers: WebGLBuffer[] = [];
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
    for (const v of this.vaos) gl.deleteVertexArray(v);
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.program) gl.deleteProgram(this.program);
    this.vaos = [];
    this.buffers = [];
    this.parts = [];
    this.pending = null;
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
    this.uColor = gl.getUniformLocation(prog, 'u_color');
    this.uSunDir = gl.getUniformLocation(prog, 'u_sunDir');
    this.uSun = gl.getUniformLocation(prog, 'u_sun');
    this.uAmbient = gl.getUniformLocation(prog, 'u_ambient');
  }

  private async loadGlb(gen: number): Promise<void> {
    try {
      const res = await fetch(URBAN_GLB_URL);
      if (!res.ok) return;
      const { gltf, bin } = parseGlbBuffer(await res.arrayBuffer());
      if (gen !== this.generation) return;
      const check = validateUrbanGlb(gltf);
      if (!check.ok) {
        console.warn(`[urban-3d] A9 guard blocked GLB load: ${check.reason}`);
        return;
      }
      this.pending = { gltf: gltf as unknown as UrbanGlbJson, bin };
      this.map?.triggerRepaint();
    } catch {
      // Offline or test DOM without fetch: map keeps operating safely.
    }
  }

  private upload(gl: WebGL2RenderingContext, gltf: UrbanGlbJson, bin: Uint8Array): void {
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
      const isBuilding = Boolean(node.name?.startsWith('urban-hotel-'));
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

        const baseColor = mats[prim.material ?? 0]?.pbrMetallicRoughness?.baseColorFactor ?? [0.76, 0.7, 0.58, 1];
        this.parts.push({
          vao,
          count: idxAcc.count,
          indexType: idxAcc.componentType,
          color: baseColor,
          isBuilding,
        });
      }
    }
    gl.bindVertexArray(null);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.program || !this.map) return;
    if (this.pending) {
      this.upload(gl, this.pending.gltf, this.pending.bin);
      this.pending = null;
    }
    if (!this.parts.length) return;

    const proj = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    if (!proj) return;
    const mvp64 = new Float64Array(16);
    mulMat4(mvp64, proj as unknown as ArrayLike<number>, this.mercatorMatrix);

    const fade = urbanOpacityForCamera(this.map.getBearing(), this.map.getPitch());

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniformMatrix4fv(this.uMvp, false, new Float32Array(mvp64));
    gl.uniform3fv(this.uSunDir, this.light.sunDir);
    gl.uniform3fv(this.uSun, this.light.sun);
    gl.uniform3fv(this.uAmbient, this.light.ambient);

    for (const part of this.parts) {
      const alpha = part.isBuilding ? part.color[3] * fade : part.color[3];
      gl.depthMask(alpha >= 0.99);
      gl.uniform4f(this.uColor, part.color[0], part.color[1], part.color[2], alpha);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
    }

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}

/** Add Stage 5 Southern Plaza OSM corridor lines + Blender GLB custom layer lazily when 3D turns on. */
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
          'line-color': ['match', ['get', 'kind'], 'road', '#3d4550', '#c9beaa'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 18, 5.5],
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
