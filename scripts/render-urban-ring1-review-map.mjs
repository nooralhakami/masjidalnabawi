// Generates a self-contained interactive review map for the Ring-1 Microsoft audit.
// PREVIEW ONLY: it never writes data/urban-approved.json, never ships into public/models/,
// and never infers heights. The 3D mode extrudes at a uniform, owner-adjustable PREVIEW height
// that is explicitly labelled "not real data". Open it to see the candidate footprints on the
// real map before approving. Nothing here is committed or published by the script.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_OUT = '/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/تدقيق الحلقة الأولى 250م - بصمات Microsoft';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const OUT = resolve(arg('out', DEFAULT_OUT));
const AUDIT_PATH = resolve(arg('audit', resolve(OUT, 'audit.json')));
const PORT = Number(arg('port', '8787'));

const VENDOR_FILES = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'];

function vendorMapLibre() {
  const src = resolve(REPO, 'node_modules/maplibre-gl/dist');
  const dest = resolve(OUT, 'vendor');
  mkdirSync(dest, { recursive: true });
  for (const file of VENDOR_FILES) {
    const from = resolve(src, file);
    if (!existsSync(from)) throw new Error(`MapLibre dist missing: ${from}. Run npm install first.`);
    copyFileSync(from, resolve(dest, file));
  }
}

function polygonFeature(coordinates, properties) {
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [coordinates] } };
}
function pointFeature(at, properties) {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: at } };
}

function buildData(audit) {
  const buildings = audit.buildings.map((b) =>
    polygonFeature(b.coordinates, {
      id: b.id,
      name: b.name ?? null,
      kind: b.kind,
      identitySource: b.identitySource,
      direction: b.direction,
      distanceM: b.distanceM,
      nearestGateId: b.nearestGateId,
      areaM2: b.areaM2,
      corroborated: b.corroborated,
      osmWay: b.osmWay ?? null,
      osmOverlap: b.osmOverlap ?? null,
      candidatePoiIds: b.candidatePoiIds ?? [],
      footprintSource: b.footprintSource,
      heightM: b.heightM ?? null,
      levels: b.levels ?? null,
      msHeight: b.msHeight,
      msConfidence: b.msConfidence,
      review: b.review,
      center: b.center,
    }),
  );
  const gates = audit.geometry.gates.map((g) => pointFeature(g.at, { id: g.id }));
  const pois = audit.pois.map((p) =>
    pointFeature(p.coordinates, {
      id: p.id,
      name: p.name,
      category: p.category,
      direction: p.direction,
      matchedBuildingId: p.matchedBuildingId ?? null,
      matchMethod: p.matchMethod ?? null,
      distanceToFootprintM: p.distanceToFootprintM ?? null,
      nearestGateId: p.nearestGateId,
      mapStatus: p.mapStatus ?? null,
    }),
  );
  const fence = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: audit.geometry.fence } };

  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const b of audit.buildings)
    for (const [lng, lat] of b.coordinates) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }

  return {
    generatedAt: audit.generatedAt,
    ringM: audit.ringM,
    summary: audit.summary,
    sources: audit.sources,
    center: [39.6111, 24.4685],
    bbox: [west, south, east, north],
    buildings: { type: 'FeatureCollection', features: buildings },
    gates: { type: 'FeatureCollection', features: gates },
    pois: { type: 'FeatureCollection', features: pois },
    fence,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/review-map.html';
    const file = resolve(OUT, `.${path}`);
    if (!file.startsWith(OUT) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  server.listen(PORT, () => {
    console.log(`\n  خريطة المعاينة التفاعلية تعمل على:  http://localhost:${PORT}/review-map.html`);
    console.log('  (أوقف الخادم بـ Ctrl+C — هذه معاينة محلية، لا نشر ولا اعتماد)\n');
  });
}

function main() {
  if (!existsSync(AUDIT_PATH)) throw new Error(`Audit not found: ${AUDIT_PATH}. Run npm run audit:urban:ring1:ms first.`);
  const audit = JSON.parse(readFileSync(AUDIT_PATH, 'utf8'));
  const data = buildData(audit);
  mkdirSync(OUT, { recursive: true });
  vendorMapLibre();
  writeFileSync(resolve(OUT, 'review-data.json'), JSON.stringify(data));
  const template = readFileSync(resolve(HERE, 'review-map.template.html'), 'utf8');
  const html = template.replace('/*__DATA__*/null', JSON.stringify(data));
  writeFileSync(resolve(OUT, 'review-map.html'), html);
  console.log(`review map: ${data.buildings.features.length} buildings, ${data.gates.features.length} gates, ${data.pois.features.length} pois`);
  console.log(`written: ${resolve(OUT, 'review-map.html')}`);
  if (has('serve')) serve();
}

main();