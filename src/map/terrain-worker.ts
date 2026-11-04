/// <reference lib="webworker" />
import { buildTerrainMesh, parseTerrain } from './terrain-mesh';

/**
 * Builds the mountains' mesh off the main thread (`terrain-layer.ts`), so turning 3D on never
 * freezes the map. Message in: the terrain file's absolute URL. Out: `{ vertices, indices }`
 * (transferred), or `null` when the file could not be read.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<string>) => {
  let buffer: ArrayBuffer | null = null;
  try {
    const res = await fetch(e.data);
    if (res.ok) buffer = await res.arrayBuffer();
  } catch {
    // Offline: the 3D view stays without its mountains.
  }
  if (!buffer) {
    scope.postMessage(null);
    return;
  }
  const mesh = buildTerrainMesh(parseTerrain(buffer));
  // Copies trimmed to size, so whole buffers can be handed over without a second copy.
  const vertices = mesh.vertices.slice();
  const indices = mesh.indices.slice();
  scope.postMessage({ vertices, indices }, [vertices.buffer, indices.buffer]);
};
