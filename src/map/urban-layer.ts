import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { metresFromOrigin } from './glb-layer';
import { cameraEye } from './plaza-layer';
import { MOSQUE_MAIN, MOSQUE_SOUTH } from './prayer-layout';
import type { SceneLight } from './scene-light';
import { occludedIds, type UrbanBuilding } from './urban-occlusion';

export const URBAN_SOURCE = 'alharamain-urban';
export const URBAN_LAYER = 'alharamain-3d-urban';
export const URBAN_LAYER_FADED = 'alharamain-3d-urban-faded';
const URBAN_URL = './models/urban-3d.json';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * The verified buildings round the Haram (scripts/build-urban-3d.mjs → models/urban-3d.json), drawn
 * as native fill-extrusion — the plan's sanctioned massing path (§2.2), stable on every renderer the
 * custom WebGL layers are not. The file loads only in 3D; with no approvals it is empty, so no guessed
 * building ever shows (owner, 2026-11-04). Warm beige/granite stone, lit by the hour (scene-light.ts).
 *
 * A tower between the camera and the Mosque fades to 30% (owner, 2026-11-10). fill-extrusion-opacity
 * takes no data expression, so the fade is two layers split by an `occluded` property: the solid one
 * at 0.96, the ghosted one at 0.3. The property is recomputed into the source when the camera settles
 * (moveend), never per frame, so panning and turning pay only the geometry, not a per-place loop.
 */
export class UrbanLayer {
  private features: UrbanBuilding[] = [];
  private data: GeoJSON.FeatureCollection = EMPTY;
  private occluded = new Set<string>();
  private generation = 0;
  private loadedFlag = false;
  private readonly targets: [number, number, number][];
  private readonly onCamera = () => this.updateOcclusion();

  constructor(
    private map: MLMap,
    light: SceneLight,
    before?: string,
  ) {
    // The Mosque's main hall and the old southern Mosque, at their roofline: the view the fade protects.
    this.targets = [
      [MOSQUE_MAIN[0], 20, MOSQUE_MAIN[1]],
      [MOSQUE_SOUTH[0], 15, MOSQUE_SOUTH[1]],
    ];
    if (!map.getSource(URBAN_SOURCE)) map.addSource(URBAN_SOURCE, { type: 'geojson', data: EMPTY, promoteId: 'id' });
    if (!map.getLayer(URBAN_LAYER)) {
      const c = urbanColors(light);
      const color: ExpressionSpecification = ['match', ['get', 'kind'], 1, c.hotel, 2, c.food, 3, c.landmark, c.context];
      for (const [id, occluded, opacity] of [
        [URBAN_LAYER, 0, 0.96],
        [URBAN_LAYER_FADED, 1, 0.3],
      ] as const) {
        map.addLayer(
          {
            id,
            type: 'fill-extrusion',
            source: URBAN_SOURCE,
            minzoom: 14,
            filter: ['==', ['get', 'occluded'], occluded],
            paint: {
              'fill-extrusion-color': color,
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': opacity,
              'fill-extrusion-vertical-gradient': true,
            },
          },
          before,
        );
      }
    }
    map.on('moveend', this.onCamera);
    void this.load(++this.generation);
  }

  /** How many approved buildings are loaded (0 until exact positions arrive). */
  get count(): number {
    return this.features.length;
  }

  /** True once the approval file has been read (even when it is empty). */
  get loaded(): boolean {
    return this.loadedFlag;
  }

  private async load(generation: number): Promise<void> {
    let data: GeoJSON.FeatureCollection = EMPTY;
    try {
      const res = await fetch(new URL(URBAN_URL, location.href).href);
      if (res.ok) data = (await res.json()) as GeoJSON.FeatureCollection;
    } catch {
      // No file (or offline): the 3D view stays without its surrounding buildings.
    }
    if (generation !== this.generation) return;
    this.data = { type: 'FeatureCollection', features: data.features ?? [] };
    this.features = this.data.features
      .filter((f) => f.geometry?.type === 'Polygon' && f.properties?.height > 0)
      .map((f) => ({
        id: String(f.properties?.id ?? f.id),
        height: Number(f.properties?.height),
        ring: (f.geometry as GeoJSON.Polygon).coordinates[0].map((ll) => metresFromOrigin([ll[0], ll[1]])),
      }));
    this.loadedFlag = true;
    // Stamp the fade for the opening camera, then upload once.
    this.occluded = this.features.length ? occludedIds(this.features, cameraEye(this.map), this.targets) : new Set();
    this.stamp();
    (this.map.getSource(URBAN_SOURCE) as GeoJSONSource | undefined)?.setData(this.data);
  }

  /** Re-grade the stone as the sun moves (called on entering 3D, then once a minute). */
  setLight(light: SceneLight): void {
    const c = urbanColors(light);
    const color: ExpressionSpecification = ['match', ['get', 'kind'], 1, c.hotel, 2, c.food, 3, c.landmark, c.context];
    for (const id of [URBAN_LAYER, URBAN_LAYER_FADED]) if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'fill-extrusion-color', color);
  }

  /** After the camera settles (never per frame): fade the towers that now block the Mosque. */
  private updateOcclusion(): void {
    if (!this.features.length) return;
    const next = occludedIds(this.features, cameraEye(this.map), this.targets);
    if (next.size === this.occluded.size && [...next].every((id) => this.occluded.has(id))) return;
    this.occluded = next;
    this.stamp();
    (this.map.getSource(URBAN_SOURCE) as GeoJSONSource | undefined)?.setData(this.data);
  }

  /** Write the fade into the source properties the two layers' filters read. */
  private stamp(): void {
    for (const f of this.data.features) {
      if (f.properties) f.properties.occluded = this.occluded.has(String(f.properties.id ?? f.id)) ? 1 : 0;
    }
  }

  /** Drop the camera listener; the engine removes the layer and source itself. */
  destroy(): void {
    this.generation++;
    this.map.off('moveend', this.onCamera);
  }
}

type Rgb = [number, number, number];
const KIND_BASE: Record<number, Rgb> = {
  // Madinah's warm stone: granite beige for the city's fabric, sandstone for the hotels' towers,
  // a terracotta hint for the restaurants, a muted green for landmarks (echoing the Haram's own green).
  0: [0.8, 0.73, 0.62],
  1: [0.86, 0.79, 0.67],
  2: [0.82, 0.67, 0.54],
  3: [0.7, 0.76, 0.66],
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const css = (c: Rgb) => `rgb(${Math.round(clamp01(c[0]) * 255)}, ${Math.round(clamp01(c[1]) * 255)}, ${Math.round(clamp01(c[2]) * 255)})`;

/** Each kind's stone under this hour's light: bright by day, dim and cool at night with warm windows. */
function urbanColors(light: SceneLight): { context: string; hotel: string; food: string; landmark: string } {
  const lit = (base: Rgb): Rgb => {
    const glow = light.night * 0.1;
    return [
      base[0] * (light.ambient[0] * 0.9 + light.sun[0] * 0.35) + glow,
      base[1] * (light.ambient[1] * 0.9 + light.sun[1] * 0.35) + glow * 0.72,
      base[2] * (light.ambient[2] * 0.9 + light.sun[2] * 0.35) + glow * 0.4,
    ];
  };
  return { context: css(lit(KIND_BASE[0])), hotel: css(lit(KIND_BASE[1])), food: css(lit(KIND_BASE[2])), landmark: css(lit(KIND_BASE[3])) };
}
