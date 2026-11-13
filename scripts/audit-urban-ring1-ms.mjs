import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchPoi, pointInPolygon, pointLineDistance, polygonLineDistance, project, unproject } from './audit-urban-ring1.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = '/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/تدقيق الحلقة الأولى 250م - بصمات Microsoft';
const RING_M = 250;
const OVERLAP_MIN = 0.5;

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

function fracInside(a, b) {
  let n = 0;
  for (const p of a.slice(0, -1)) if (pointInPolygon(p, b)) n++;
  return n / (a.length - 1);
}

function osmKind(tags) {
  const name = `${tags.name ?? ''} ${tags['name:en'] ?? ''}`;
  if (tags.building === 'construction') return 'construction';
  if (tags.tourism === 'hotel' || tags.building === 'hotel' || /فندق|hotel/i.test(name)) return 'hotel';
  if (tags.building === 'mosque' || tags.amenity === 'place_of_worship' || tags.tourism === 'museum' || /مسجد|متحف|محكمة|وزارة|وكالة/.test(name)) return 'landmark';
  if (tags.building === 'commercial') return 'commercial';
  return 'context';
}

export function buildMsAudit(fence, pois, osm, ms) {
  const line = fence.runs.flatMap((run, i) => run.path.slice(i ? 1 : 0));
  const fenceXy = line.map(project);
  const fenceCenter = fenceXy.slice(0, -1).reduce((a, p, _, all) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]);
  const gates = fence.gates.map((gate) => ({ ...gate, xy: project(gate.at) }));

  const osmBuildings = osm.elements
    .filter((e) => e.type === 'way' && e.geometry && e.geometry.length >= 4)
    .map((e) => ({ id: e.id, tags: e.tags ?? {}, polygon: e.geometry.map((p) => project([p.lon, p.lat])) }));

  let excludedInside = 0;
  let excludedBeyond = 0;
  let excludedCrosses = 0;
  const candidates = [];
  for (const feature of ms.features) {
    if (!feature.geometry || feature.geometry.type !== 'Polygon') continue;
    const coordinates = feature.geometry.coordinates[0];
    const polygon = coordinates.map(project);
    const center = centroid(polygon);
    const verticesInside = polygon.slice(0, -1).filter((p) => pointInPolygon(p, fenceXy)).length;
    const distance = polygonLineDistance(polygon, fenceXy);
    const inside = verticesInside === polygon.length - 1 || (verticesInside === 0 && distance > 0 && pointInPolygon(center, fenceXy));
    if (inside) {
      excludedInside++;
      continue;
    }
    if (distance > RING_M + 1e-7) {
      excludedBeyond++;
      continue;
    }
    const crossesFence = verticesInside > 0 && verticesInside < polygon.length - 1;
    if (crossesFence) {
      excludedCrosses++;
      continue;
    }
    let bestOsm = null;
    let bestScore = 0;
    for (const o of osmBuildings) {
      const score = Math.max(fracInside(polygon, o.polygon), fracInside(o.polygon, polygon));
      if (score > bestScore) {
        bestScore = score;
        bestOsm = o;
      }
    }
    const linkedOsm = bestScore >= OVERLAP_MIN ? bestOsm : null;
    const gate = nearestGate(center, gates);
    candidates.push({
      coordinates,
      polygon,
      center,
      centerLonLat: unproject(center),
      distanceM: distance,
      nearestGateId: gate.id,
      nearestGateDistanceM: gate.distanceM,
      direction: direction(center, fenceCenter),
      areaM2: polygonArea(polygon),
      osmWay: linkedOsm ? linkedOsm.id : null,
      osmTags: linkedOsm ? linkedOsm.tags : {},
      osmOverlap: Number(bestScore.toFixed(2)),
      msHeight: feature.properties?.height ?? -1,
      msConfidence: feature.properties?.confidence ?? -1,
    });
  }

  const order = { north: 0, east: 1, south: 2, west: 3 };
  candidates.sort((a, b) => order[a.direction] - order[b.direction] || a.nearestGateId - b.nearestGateId || a.distanceM - b.distanceM || a.areaM2 - b.areaM2);
  const counters = { north: 0, east: 0, south: 0, west: 0 };
  const buildings = candidates.map((b) => {
    const prefix = { north: 'N', east: 'E', south: 'S', west: 'W' }[b.direction];
    const id = `${prefix}${String(++counters[b.direction]).padStart(3, '0')}`;
    const osmName = b.osmTags.name ?? b.osmTags['name:ar'] ?? b.osmTags['name:en'] ?? null;
    return {
      id,
      footprintSource: 'microsoft_ml',
      osmWay: b.osmWay,
      osmOverlap: b.osmOverlap,
      name: osmName,
      kind: b.osmWay ? osmKind(b.osmTags) : 'context',
      identitySource: b.osmWay ? 'osm_overlap_unverified' : 'ms_only_unverified',
      direction: b.direction,
      distanceM: Number(b.distanceM.toFixed(1)),
      nearestGateId: b.nearestGateId,
      nearestGateDistanceM: Number(b.nearestGateDistanceM.toFixed(1)),
      areaM2: Number(b.areaM2.toFixed(1)),
      levels: null,
      heightM: null,
      msHeight: b.msHeight,
      msConfidence: b.msConfidence,
      coordinates: b.coordinates,
      center: b.centerLonLat,
      candidatePoiIds: [],
      review: { footprint: 'pending_owner', identity: 'pending_owner', height: 'pending_owner', pedestrianEntrance: 'not_supplied', carEntrance: 'not_supplied' },
      polygon: b.polygon,
      xy: b.center,
      tags: b.osmTags,
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
    if (building) {
      building.candidatePoiIds.push(poi.id);
      if (poi.category === 'hotels') {
        building.kind = 'hotel';
        if (!building.name) building.name = poi.name;
        building.identitySource = poi.matchMethod === 'point_inside_footprint' ? 'poi_inside_footprint' : 'poi_link_unverified';
      } else if (poi.category === 'food' && building.kind !== 'hotel') {
        building.kind = 'food';
        if (!building.name) building.name = poi.name;
        if (building.identitySource === 'ms_only_unverified')
          building.identitySource = poi.matchMethod === 'point_inside_footprint' ? 'poi_inside_footprint' : 'poi_link_unverified';
      }
    }
  }
  for (const building of buildings) {
    building.corroborated = building.identitySource !== 'ms_only_unverified';
    delete building.polygon;
    delete building.xy;
  }

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    ringM: RING_M,
    footprintSource: 'microsoft_ml',
    distanceBasis: 'minimum_distance_from_exterior_footprint_to_outer_courtyard_fence',
    sources: {
      fence: { captured: fence.captured, description: fence._source },
      footprints: {
        name: 'Microsoft Global ML Building Footprints',
        license: ms.license,
        release: ms.datasetRelease,
        quadkey: ms.quadkey,
        url: ms.projectUrl,
        heightNote: ms.heightNote,
      },
      identity: {
        name: 'OpenStreetMap',
        timestamp: osm.osm3s?.timestamp_osm_base ?? null,
        copyright: osm.osm3s?.copyright ?? null,
        role: 'names/kind linked by overlap >= 0.5; unverified',
      },
      pois: 'data/pois.json; existing hidden OSM-derived records; points are not verified entrances',
      imagery: 'Esri World Imagery; Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
    geometry: { fence: line, gates: fence.gates.map((gate) => ({ id: gate.id, at: gate.at })) },
    summary: {
      buildings: buildings.length,
      corroborated: buildings.filter((b) => b.corroborated).length,
      msOnly: buildings.filter((b) => !b.corroborated).length,
      hotels: ringPois.filter((p) => p.category === 'hotels').length,
      food: ringPois.filter((p) => p.category === 'food').length,
      byDirection: Object.fromEntries(Object.keys(order).map((d) => [d, buildings.filter((b) => b.direction === d).length])),
      named: buildings.filter((b) => b.name).length,
      excludedInside,
      excludedBeyond,
      excludedCrosses,
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
  const ms = JSON.parse(readFileSync(resolve(ROOT, 'docs/routes/ms-buildings/haram-bbox-2026-11-11.json'), 'utf8'));
  const audit = buildMsAudit(fence, pois, osm, ms);
  const output = process.env.URBAN_AUDIT_OUT ?? DEFAULT_OUTPUT;
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    resolve(output, 'buildings.csv'),
    `${csv(audit.buildings, ['id', 'footprintSource', 'osmWay', 'osmOverlap', 'name', 'kind', 'identitySource', 'corroborated', 'direction', 'distanceM', 'nearestGateId', 'nearestGateDistanceM', 'areaM2', 'candidatePoiIds', 'center'])}\n`,
  );
  writeFileSync(
    resolve(output, 'pois.csv'),
    `${csv(audit.pois, ['id', 'name', 'category', 'osm', 'direction', 'distanceM', 'nearestGateId', 'nearestGateDistanceM', 'matchedBuildingId', 'matchMethod', 'distanceToFootprintM', 'mapStatus', 'coordinates'])}\n`,
  );
  if (!process.argv.includes('--data-only')) {
    const { renderMsAtlas } = await import('./render-urban-ring1-ms-atlas.mjs');
    await renderMsAtlas(audit, output);
  }
  console.log(JSON.stringify({ output, ...audit.summary }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
