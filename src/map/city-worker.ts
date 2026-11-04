/// <reference lib="webworker" />
import { buildCityMesh, parseTerrain, type BuildingRow } from './city-mesh';

/**
 * Builds the 3D view's surroundings off the main thread (`city-layer.ts`): reading both files and
 * turning them into one mesh takes tens of milliseconds on a phone, which the map must not feel.
 * Message in: `{ city, terrain }` (absolute URLs). Out: `{ vertices, indices }` (transferred), or
 * `null` when neither file could be read.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<{ city: string; terrain: string }>) => {
  const get = async <T>(url: string, read: (r: Response) => Promise<T>): Promise<T | null> => {
    try {
      const res = await fetch(url);
      return res.ok ? await read(res) : null;
    } catch {
      return null;
    }
  };
  const [city, terrain] = await Promise.all([get(e.data.city, (r) => r.json() as Promise<{ buildings: BuildingRow[] }>), get(e.data.terrain, (r) => r.arrayBuffer())]);
  if (!city && !terrain) {
    scope.postMessage(null);
    return;
  }
  const mesh = buildCityMesh(city?.buildings ?? [], terrain ? parseTerrain(terrain) : null);
  // Copies trimmed to size, so whole buffers can be handed over without a second copy.
  const vertices = mesh.vertices.slice();
  const indices = mesh.indices.slice();
  scope.postMessage({ vertices, indices }, [vertices.buffer, indices.buffer]);
};
