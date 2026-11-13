// Builds public/models/urban-3d.json from data/urban-approved.json — the owner's verified buildings.
//
// Zero guessing (owner, 2026-11-10): a building is extruded only when its record carries
//   approved: true, a finite numeric heightM (> 0), and a footprint ring that lies outside the
//   Haram fence. A level count, a missing height, an unapproved footprint or a polygon inside the
//   courtyards is rejected, never estimated. With no approval file the collection is empty, so the
//   3D view draws no surrounding buildings until exact positions arrive (owner, 2026-11-04).
//
// Approval record (data/urban-approved.json):
//   { "buildings": [ {
//       "id": "N001", "approved": true, "kind": "hotel|food|landmark|context",
//       "heightM": 45,                         // a measured/verified number, required
//       "footprint": [[lng,lat], ...],         // ring (closed or open), outside the fence, required
//       "source": "how the footprint and height were verified",
//       "pedestrianEntrance": [lng,lat],       // optional provenance; not used for the massing
//       "carEntrance": [lng,lat]
//   } ] }
//
// Output: a GeoJSON FeatureCollection (Polygon footprints in lng/lat, properties id/height/kind) that
// MapLibre draws as one fill-extrusion layer (src/map/engine.ts), the plan's sanctioned massing path.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const KIND = { context: 0, hotel: 1, food: 2, landmark: 3 };

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** The outer courtyard fence as one ring, from data/haram-fence.json. */
export function fenceRing(fence) {
  return fence.runs.flatMap((run, i) => run.path.slice(i ? 1 : 0));
}

const isLngLat = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Why a record may not be extruded, or null when it is verified and approved. */
export function validateBuilding(b, fence) {
  if (!b || typeof b !== 'object') return 'not_a_record';
  if (b.approved !== true) return 'not_approved';
  if (!Number.isFinite(b.heightM) || b.heightM <= 0) return 'height_not_a_verified_number';
  if (!Array.isArray(b.footprint) || b.footprint.length < 3) return 'footprint_too_small';
  if (!b.footprint.every(isLngLat)) return 'footprint_not_coordinates';
  const ring = fenceRing(fence);
  if (b.footprint.some((p) => pointInPolygon(p, ring))) return 'footprint_inside_fence';
  if (!(b.kind in KIND)) return 'unknown_kind';
  if (typeof b.id !== 'string' || !b.id) return 'missing_id';
  return null;
}

/** The approved buildings as a GeoJSON collection; unapproved records are reported, never drawn. */
export function buildUrbanGeoJSON(approved, fence) {
  const records = Array.isArray(approved?.buildings) ? approved.buildings : [];
  const features = [];
  const rejected = [];
  const seen = new Set();
  for (const b of records) {
    const reason = validateBuilding(b, fence) ?? (seen.has(b.id) ? 'duplicate_id' : null);
    if (reason) {
      rejected.push({ id: b?.id ?? null, reason });
      continue;
    }
    seen.add(b.id);
    const ring = b.footprint.slice();
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    features.push({
      type: 'Feature',
      properties: { id: b.id, height: b.heightM, kind: KIND[b.kind] },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { geojson: { type: 'FeatureCollection', features }, accepted: features.length, rejected };
}

function main() {
  const fence = JSON.parse(readFileSync(resolve(ROOT, 'data/haram-fence.json'), 'utf8'));
  const approvalPath = resolve(ROOT, 'data/urban-approved.json');
  const approved = existsSync(approvalPath) ? JSON.parse(readFileSync(approvalPath, 'utf8')) : { buildings: [] };
  const { geojson, accepted, rejected } = buildUrbanGeoJSON(approved, fence);
  writeFileSync(resolve(ROOT, 'public/models/urban-3d.json'), `${JSON.stringify(geojson)}\n`);
  console.log(`urban-3d: ${accepted} approved building(s) → public/models/urban-3d.json`);
  for (const r of rejected) console.log(`  rejected ${r.id ?? '(no id)'}: ${r.reason}`);
  if (!existsSync(approvalPath)) console.log('  no data/urban-approved.json yet: the 3D view draws no surrounding buildings.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
