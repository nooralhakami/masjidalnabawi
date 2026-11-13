import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = '/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/تدقيق الحلقة الأولى 250م';
const RING_M = 250;
const LAT0 = 24.4685;
const LNG0 = 39.6111;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 111_320;

export const project = ([lng, lat]) => [(lng - LNG0) * KX, (lat - LAT0) * KY];
export const unproject = ([x, y]) => [x / KX + LNG0, y / KY + LAT0];

export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function pointLineDistance(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, pointSegmentDistance(p, line[i - 1], line[i]));
  return best;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(p, a, b) {
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(c, a, b)) return true;
  if (o2 === 0 && onSegment(d, a, b)) return true;
  if (o3 === 0 && onSegment(a, c, d)) return true;
  if (o4 === 0 && onSegment(b, c, d)) return true;
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function polygonLineDistance(polygon, line) {
  let best = Infinity;
  for (let i = 1; i < polygon.length; i++) {
    for (let j = 1; j < line.length; j++) {
      const a = polygon[i - 1];
      const b = polygon[i];
      const c = line[j - 1];
      const d = line[j];
      if (segmentsIntersect(a, b, c, d)) return 0;
      best = Math.min(best, pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
    }
  }
  return best;
}

export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon) {
  let area = 0;
  for (let i = 1; i < polygon.length; i++) area += polygon[i - 1][0] * polygon[i][1] - polygon[i][0] * polygon[i - 1][1];
  return Math.abs(area / 2);
}

function centroid(polygon) {
  let x = 0;
  let y = 0;
  let crossSum = 0;
  for (let i = 1; i < polygon.length; i++) {
    const cross = polygon[i - 1][0] * polygon[i][1] - polygon[i][0] * polygon[i - 1][1];
    crossSum += cross;
    x += (polygon[i - 1][0] + polygon[i][0]) * cross;
    y += (polygon[i - 1][1] + polygon[i][1]) * cross;
  }
  if (Math.abs(crossSum) < 0.001) return polygon.slice(0, -1).reduce((a, p, _, all) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]);
  return [x / (3 * crossSum), y / (3 * crossSum)];
}

function nearestGate(center, gates) {
  return gates.map((gate) => ({ id: gate.id, distanceM: Math.hypot(center[0] - gate.xy[0], center[1] - gate.xy[1]) })).sort((a, b) => a.distanceM - b.distanceM)[0];
}

function direction(center, fenceCenter) {
  const dx = center[0] - fenceCenter[0];
  const dy = center[1] - fenceCenter[1];
  return Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? 'north' : 'south') : dx >= 0 ? 'east' : 'west';
}

function normalizeName(value = '') {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ـ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function buildingKind(tags) {
  const name = `${tags.name ?? ''} ${tags['name:en'] ?? ''}`;
  if (tags.building === 'construction') return 'construction';
  if (tags.tourism === 'hotel' || tags.building === 'hotel' || /فندق|hotel/i.test(name)) return 'hotel';
  if (tags.building === 'mosque' || tags.amenity === 'place_of_worship' || tags.tourism === 'museum' || /مسجد|متحف|محكمة|وزارة|وكالة/.test(name)) return 'landmark';
  if (tags.building === 'commercial') return 'commercial';
  if (/luggage|escalator|visitor|gift|^\d+$|مئذنة|مغسلة/i.test(name)) return 'service';
  return 'context';
}

function sourcePosition(osm) {
  if (!osm) return 'manual_unspecified';
  return { n: 'node', w: 'way_centroid', r: 'relation_centroid' }[osm[0]] ?? 'unknown';
}

function distanceToFootprint(p, polygon) {
  return pointInPolygon(p, polygon) ? 0 : pointLineDistance(p, polygon);
}

export function matchPoi(poi, buildings) {
  const direct = poi.osm?.startsWith('w') ? buildings.find((b) => b.osmWay === Number(poi.osm.slice(1))) : undefined;
  const name = normalizeName(poi.name_ar ?? poi.name);
  const named = name ? buildings.filter((b) => [b.tags.name, b.tags['name:ar'], b.tags['name:en']].some((n) => n && normalizeName(n) === name)) : [];
  const containing = buildings.filter((b) => pointInPolygon(poi.xy, b.polygon)).sort((a, b) => a.areaM2 - b.areaM2);
  const nearest = [...buildings].sort((a, b) => distanceToFootprint(poi.xy, a.polygon) - distanceToFootprint(poi.xy, b.polygon))[0];
  const candidates = [direct, ...named, ...containing, nearest].filter(Boolean);
  const building = candidates[0];
  if (!building) return { matchedBuildingId: null, matchMethod: 'unmatched', distanceToFootprintM: null };
  const method = direct
    ? 'osm_way_reference'
    : named.includes(building)
      ? 'exact_name_unverified'
      : containing.includes(building)
        ? 'point_inside_footprint'
        : 'nearest_footprint_unverified';
  return { matchedBuildingId: building.id, matchMethod: method, distanceToFootprintM: Number(distanceToFootprint(poi.xy, building.polygon).toFixed(1)) };
}

export function buildAudit(fence, pois, osm) {
  const line = fence.runs.flatMap((run, i) => run.path.slice(i ? 1 : 0));
  const fenceXy = line.map(project);
  const fenceCenter = fenceXy.slice(0, -1).reduce((a, p, _, all) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]);
  const gates = fence.gates.map((gate) => ({ ...gate, xy: project(gate.at) }));
  let excludedInside = 0;
  const candidates = [];
  for (const element of osm.elements) {
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 4) continue;
    const coordinates = element.geometry.map((p) => [p.lon, p.lat]);
    const polygon = coordinates.map(project);
    const center = centroid(polygon);
    const verticesInside = polygon.slice(0, -1).filter((p) => pointInPolygon(p, fenceXy)).length;
    const distance = polygonLineDistance(polygon, fenceXy);
    const inside = verticesInside === polygon.length - 1 || (verticesInside === 0 && distance > 0 && pointInPolygon(center, fenceXy));
    if (inside) {
      excludedInside++;
      continue;
    }
    if (distance > RING_M + 1e-7) continue;
    const gate = nearestGate(center, gates);
    candidates.push({
      osmId: element.id,
      tags: element.tags ?? {},
      coordinates,
      polygon,
      center,
      centerLonLat: unproject(center),
      distanceM: distance,
      nearestGateId: gate.id,
      nearestGateDistanceM: gate.distanceM,
      direction: direction(center, fenceCenter),
      crossesFence: verticesInside > 0 && verticesInside < polygon.length - 1,
      areaM2: polygonArea(polygon),
    });
  }
  const order = { north: 0, east: 1, south: 2, west: 3 };
  candidates.sort((a, b) => order[a.direction] - order[b.direction] || a.nearestGateId - b.nearestGateId || a.distanceM - b.distanceM || a.osmId - b.osmId);
  const counters = { north: 0, east: 0, south: 0, west: 0 };
  const buildings = candidates.map((b) => {
    const prefix = { north: 'N', east: 'E', south: 'S', west: 'W' }[b.direction];
    const id = `${prefix}${String(++counters[b.direction]).padStart(3, '0')}`;
    return {
      id,
      osmWay: b.osmId,
      name: b.tags.name ?? b.tags['name:ar'] ?? b.tags['name:en'] ?? null,
      kind: buildingKind(b.tags),
      direction: b.direction,
      distanceM: Number(b.distanceM.toFixed(1)),
      nearestGateId: b.nearestGateId,
      nearestGateDistanceM: Number(b.nearestGateDistanceM.toFixed(1)),
      areaM2: Number(b.areaM2.toFixed(1)),
      levels: b.tags['building:levels'] ?? null,
      heightM: b.tags.height ?? null,
      crossesFence: b.crossesFence,
      coordinates: b.coordinates,
      center: b.centerLonLat,
      candidatePoiIds: [],
      tags: b.tags,
      polygon: b.polygon,
      xy: b.center,
      review: { footprint: 'pending_owner', identity: 'pending_owner', height: 'pending_owner', pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' },
    };
  });
  const ringPois = [];
  for (const poi of pois) {
    if (!((poi.id >= 701 && poi.id <= 743) || (poi.id >= 801 && poi.id <= 844))) continue;
    const xy = project([poi.lng, poi.lat]);
    if (pointInPolygon(xy, fenceXy)) continue;
    const distance = pointLineDistance(xy, fenceXy);
    if (distance > RING_M + 1e-7) continue;
    const gate = nearestGate(xy, gates);
    ringPois.push({
      id: poi.id,
      name: poi.name_ar,
      category: poi.category,
      osm: poi.osm ?? null,
      sourcePosition: sourcePosition(poi.osm),
      coordinates: [poi.lng, poi.lat],
      direction: direction(xy, fenceCenter),
      distanceM: Number(distance.toFixed(1)),
      nearestGateId: gate.id,
      nearestGateDistanceM: Number(gate.distanceM.toFixed(1)),
      xy,
      mapStatus: 'source_point_not_entrance',
      review: { identity: 'pending_owner', hostBuilding: 'pending_owner', pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' },
    });
  }
  ringPois.sort((a, b) => a.id - b.id);
  for (const poi of ringPois) {
    Object.assign(poi, matchPoi(poi, buildings));
    delete poi.xy;
    const building = buildings.find((b) => b.id === poi.matchedBuildingId);
    if (building) building.candidatePoiIds.push(poi.id);
  }
  for (const building of buildings) {
    delete building.polygon;
    delete building.xy;
  }
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    ringM: RING_M,
    distanceBasis: 'minimum_distance_from_exterior_footprint_to_outer_courtyard_fence',
    sources: {
      fence: { captured: fence.captured, description: fence._source },
      buildings: { timestamp: osm.osm3s?.timestamp_osm_base ?? null, copyright: osm.osm3s?.copyright ?? null },
      navQ: {
        capture: 'raw/capture-2026-11-08-fence/evidence.json',
        status: 'incomplete_capture_unverified_mapbox_osm_candidates',
        role: 'inspected_for_crosscheck_only_not_merged_into_numbered_footprints',
        heightsAndExteriorEntrances: 'not_verified',
      },
      pois: 'data/pois.json; existing hidden OSM-derived records; points are not verified entrances',
      imagery: 'Esri World Imagery; Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
    geometry: {
      fence: line,
      gates: fence.gates.map((gate) => ({ id: gate.id, at: gate.at })),
    },
    summary: {
      buildings: buildings.length,
      hotels: ringPois.filter((p) => p.category === 'hotels').length,
      food: ringPois.filter((p) => p.category === 'food').length,
      byDirection: Object.fromEntries(Object.keys(order).map((d) => [d, buildings.filter((b) => b.direction === d).length])),
      construction: buildings.filter((b) => b.kind === 'construction').length,
      withLevels: buildings.filter((b) => b.levels !== null).length,
      withHeight: buildings.filter((b) => b.heightM !== null).length,
      excludedInside,
    },
    buildings,
    pois: ringPois,
  };
}

function csv(rows, columns) {
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.join(','), ...rows.map((row) => columns.map((column) => quote(typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column])).join(','))].join(
    '\n',
  );
}

async function main() {
  const fence = JSON.parse(readFileSync(resolve(ROOT, 'data/haram-fence.json'), 'utf8'));
  const pois = JSON.parse(readFileSync(resolve(ROOT, 'data/pois.json'), 'utf8'));
  const osm = JSON.parse(readFileSync(resolve(ROOT, 'docs/routes/osm/buildings-2026-10-08.json'), 'utf8'));
  const audit = buildAudit(fence, pois, osm);
  const output = process.env.URBAN_AUDIT_OUT ?? DEFAULT_OUTPUT;
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    resolve(output, 'buildings.csv'),
    `${csv(audit.buildings, ['id', 'osmWay', 'name', 'kind', 'direction', 'distanceM', 'nearestGateId', 'nearestGateDistanceM', 'areaM2', 'levels', 'heightM', 'crossesFence', 'candidatePoiIds', 'center'])}\n`,
  );
  writeFileSync(
    resolve(output, 'pois.csv'),
    `${csv(audit.pois, ['id', 'name', 'category', 'osm', 'sourcePosition', 'direction', 'distanceM', 'nearestGateId', 'nearestGateDistanceM', 'matchedBuildingId', 'matchMethod', 'distanceToFootprintM', 'mapStatus', 'coordinates'])}\n`,
  );
  if (!process.argv.includes('--data-only')) {
    const { renderAtlas } = await import('./render-urban-ring1-atlas.mjs');
    await renderAtlas(audit, output);
  }
  console.log(JSON.stringify({ output, ...audit.summary }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
