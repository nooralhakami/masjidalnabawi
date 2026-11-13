import { existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ZOOM = 19;
const TILE = 256;
const DIRECTIONS = [
  { id: 'north', prefix: '01', ar: 'الشمال' },
  { id: 'south', prefix: '02', ar: 'الجنوب' },
  { id: 'west', prefix: '03', ar: 'الغرب' },
  { id: 'east', prefix: '04', ar: 'الشرق' },
];
const KIND_AR = { hotel: 'فندق', construction: 'إنشاء في OSM', landmark: 'معلم/خدمة عامة', commercial: 'تجاري', service: 'مرفق', context: 'سياقي' };
const DIRECTION_AR = { north: 'الشمال', south: 'الجنوب', west: 'الغرب', east: 'الشرق' };
const COLORS = { hotel: '#d99a27', construction: '#d14b4b', landmark: '#258b83', commercial: '#8764b8', service: '#4c88b7', context: '#d6d0bf' };
const tileCache = new Map();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pixel([lng, lat]) {
  const n = 2 ** ZOOM * TILE;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n];
}

function metersPerPixel(lat = 24.4685) {
  return (Math.cos((lat * Math.PI) / 180) * 40075016.68557849) / (2 ** ZOOM * TILE);
}

async function fetchTile(x, y) {
  const key = `${ZOOM}/${y}/${x}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const promise = fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${key}`, { signal: AbortSignal.timeout(30_000) }).then(
    async (response) => {
      if (!response.ok) throw new Error(`Esri tile ${key}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1000) throw new Error(`Esri tile ${key}: empty image`);
      return `data:image/jpeg;base64,${bytes.toString('base64')}`;
    },
  );
  tileCache.set(key, promise);
  return promise;
}

async function limited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function placeLabels(items, width, height) {
  const placed = [];
  const offsets = [
    [0, 0],
    [0, -38],
    [0, 38],
    [-42, 0],
    [42, 0],
    [-36, -32],
    [36, -32],
    [-36, 32],
    [36, 32],
    [0, -72],
    [0, 72],
    [-76, 0],
    [76, 0],
  ];
  return items.map((item) => {
    const w = item.id.length > 4 ? 48 : 42;
    const h = 32;
    let best;
    for (const [dx, dy] of offsets) {
      const cx = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, item.x + dx));
      const cy = Math.max(h / 2 + 4, Math.min(height - h / 2 - 4, item.y + dy));
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      const collisions = placed.filter((p) => overlaps(box, p)).length;
      if (!best || collisions < best.collisions) best = { ...item, cx, cy, w, h, collisions };
      if (!collisions) break;
    }
    placed.push({ x: best.cx - w / 2, y: best.cy - h / 2, w, h });
    return best;
  });
}

function boundsFor(audit, direction) {
  const points = [];
  for (const building of audit.buildings.filter((b) => b.direction === direction)) for (const coordinate of building.coordinates) points.push(pixel(coordinate));
  for (const gate of audit.geometry.gates.filter((g) => {
    const p = pixel(g.at);
    const center = pixel([39.6111, 24.4685]);
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const d = Math.abs(dy) >= Math.abs(dx) ? (dy <= 0 ? 'north' : 'south') : dx >= 0 ? 'east' : 'west';
    return d === direction;
  }))
    points.push(pixel(gate.at));
  const margin = 45 / metersPerPixel();
  let minX = Math.min(...points.map((p) => p[0])) - margin;
  let minY = Math.min(...points.map((p) => p[1])) - margin;
  let maxX = Math.max(...points.map((p) => p[0])) + margin;
  let maxY = Math.max(...points.map((p) => p[1])) + margin;
  if (maxX - minX < 1000) {
    const add = (1000 - (maxX - minX)) / 2;
    minX -= add;
    maxX += add;
  }
  if (maxY - minY < 850) {
    const add = (850 - (maxY - minY)) / 2;
    minY -= add;
    maxY += add;
  }
  return { minX, minY, maxX, maxY, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

function buildingRows(buildings, includeDirection = false) {
  return buildings
    .map(
      (b) =>
        `<tr><td><strong class="id">${b.id}</strong></td><td>${esc(b.name ?? `OSM way ${b.osmWay}`)}<small>${KIND_AR[b.kind]} · way ${b.osmWay}</small></td>${includeDirection ? `<td>${DIRECTION_AR[b.direction]}</td>` : ''}<td>${b.distanceM} م</td><td>${b.nearestGateId}</td><td>${b.levels ? `${esc(b.levels)} أدوار` : b.heightM ? `${esc(b.heightM)} م` : 'غير موثق'}</td><td>${b.candidatePoiIds.length ? b.candidatePoiIds.join(', ') : '—'}</td></tr>`,
    )
    .join('');
}

function poiRows(pois) {
  return pois
    .map(
      (p) =>
        `<tr><td><strong class="poi-${p.category}">${p.id}</strong></td><td>${esc(p.name)}</td><td>${p.matchedBuildingId ?? '—'}<small>${esc(p.matchMethod)}</small></td><td>${p.distanceToFootprintM ?? '—'} م</td><td>${p.nearestGateId}</td></tr>`,
    )
    .join('');
}

async function pageHtml(audit, direction) {
  const crop = boundsFor(audit, direction.id);
  const local = (coordinate) => {
    const p = pixel(coordinate);
    return [p[0] - crop.minX, p[1] - crop.minY];
  };
  const minTileX = Math.floor(crop.minX / TILE);
  const minTileY = Math.floor(crop.minY / TILE);
  const tiles = [];
  for (let x = minTileX; x <= Math.floor(crop.maxX / TILE); x++) {
    for (let y = minTileY; y <= Math.floor(crop.maxY / TILE); y++) tiles.push({ x, y });
  }
  const images = await limited(
    tiles,
    6,
    async ({ x, y }) => `<img src="${await fetchTile(x, y)}" alt="" style="inset-inline-start:${x * TILE - crop.minX}px;top:${y * TILE - crop.minY}px">`,
  ).then((all) => all.join(''));
  const buildings = audit.buildings.filter((b) => b.direction === direction.id);
  const pois = audit.pois.filter((p) => p.direction === direction.id);
  const polygons = audit.buildings
    .map((b) => {
      const points = b.coordinates.map((c) => local(c).join(',')).join(' ');
      const active = b.direction === direction.id;
      return `<polygon points="${points}" fill="${active ? COLORS[b.kind] : '#777'}" fill-opacity="${active ? '.28' : '.08'}" stroke="${active ? COLORS[b.kind] : '#777'}" stroke-opacity="${active ? '.95' : '.35'}" stroke-width="${active ? 2.6 : 1.3}" ${b.kind === 'construction' ? 'stroke-dasharray="8 5"' : ''}/>`;
    })
    .join('');
  const fence = audit.geometry.fence.map((c) => local(c).join(',')).join(' ');
  const labelItems = [
    ...buildings.map((b) => ({ id: b.id, type: 'building', ...Object.fromEntries(['x', 'y'].map((k, i) => [k, local(b.center)[i]])) })),
    ...pois.map((p) => ({ id: String(p.id), type: p.category, ...Object.fromEntries(['x', 'y'].map((k, i) => [k, local(p.coordinates)[i]])) })),
    ...audit.geometry.gates
      .map((g) => ({ id: String(g.id), type: 'gate', ...Object.fromEntries(['x', 'y'].map((k, i) => [k, local(g.at)[i]])) }))
      .filter((g) => g.x >= 0 && g.x <= crop.width && g.y >= 0 && g.y <= crop.height),
  ];
  const labels = placeLabels(labelItems, crop.width, crop.height)
    .map((l) => {
      const color = l.type === 'building' ? '#172b26' : l.type === 'hotels' ? '#a85f00' : l.type === 'food' ? '#a52727' : '#08734c';
      const leader = Math.hypot(l.cx - l.x, l.cy - l.y) > 8 ? `<line x1="${l.x}" y1="${l.y}" x2="${l.cx}" y2="${l.cy}" stroke="${color}" stroke-width="1.5"/>` : '';
      return `${leader}<g><rect x="${l.cx - l.w / 2}" y="${l.cy - l.h / 2}" width="${l.w}" height="${l.h}" rx="${l.type === 'building' ? 5 : 16}" fill="${color}" stroke="#fff" stroke-width="2"/><text x="${l.cx}" y="${l.cy + 5}" text-anchor="middle" fill="#fff" font-size="${l.id.length > 4 ? 12 : 14}" font-weight="700" direction="ltr">${l.id}</text></g>`;
    })
    .join('');
  const scale = 100 / metersPerPixel();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#18241f;background:#f5f2e9}header{height:142px;padding:24px 32px;background:#142e27;color:#fff}h1{margin:0 0 10px;font-size:30px}header p{margin:4px 0;color:#e4eee9;font-size:17px}.layout{display:flex;flex-direction:column;direction:ltr;background:#333}.map{position:relative;width:${crop.width}px;height:${crop.height}px;overflow:hidden;background:#333;direction:ltr}.map img{position:absolute;width:256px;height:256px;max-width:none}.map svg{position:absolute;inset:0}.credit{position:absolute;bottom:0;left:0;padding:7px 10px;background:#fffffff0;color:#222;font:12px Arial;direction:ltr}.scale{position:absolute;bottom:38px;left:18px;color:#fff;background:#142e27df;padding:8px 12px;font-size:14px}.scale-line{width:${scale}px;border-top:4px solid #fff;margin-top:5px}.north{position:absolute;top:18px;left:18px;background:#142e27df;color:#fff;padding:8px 14px;font:bold 20px Arial}aside{direction:rtl;padding:22px 24px 40px;border-top:1px solid #c8c2b3;background:#f5f2e9}aside h2{margin:0 0 12px;color:#173d32}aside h3{margin:24px 0 8px}.note{background:#fff8df;border:1px solid #d9bd65;padding:14px 16px;line-height:1.8;font-size:15px}table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}th{background:#dfe9e3;position:static}th,td{padding:8px 7px;border:1px solid #d4d8d2;text-align:right;vertical-align:top}td small{display:block;color:#66736c;margin-top:3px;font-size:10px;direction:ltr}.id{color:#173d32}.poi-hotels{color:#a85f00}.poi-food{color:#a52727}.legend{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0;font-size:14px}.swatch{display:inline-block;width:14px;height:14px;margin-inline-end:5px;vertical-align:-2px}
  </style></head><body><header><h1>تدقيق الحلقة الأولى 0–250 م — جهة ${direction.ar}</h1><p>${buildings.length} مبنى · ${pois.filter((p) => p.category === 'hotels').length} فندقًا · ${pois.filter((p) => p.category === 'food').length} مطعمًا/مقهى · دقة الصورة الأصلية z${ZOOM}</p><p>المسافة من أقرب نقطة خارجية للمضلع إلى سور الساحات · جميع التسميات والمداخل بانتظار تصديق المالك</p></header><div class="layout"><div class="map">${images}<svg width="${crop.width}" height="${crop.height}" viewBox="0 0 ${crop.width} ${crop.height}"><polyline points="${fence}" fill="none" stroke="#fff" stroke-width="8" stroke-opacity=".8"/><polyline points="${fence}" fill="none" stroke="#08734c" stroke-width="4"/>${polygons}${labels}</svg><div class="north">N ↑</div><div class="scale">100 م<div class="scale-line"></div></div><div class="credit">Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community · Data © OpenStreetMap contributors, ODbL</div></div><aside><h2>مفتاح الاعتماد — ${direction.ar}</h2><div class="note"><strong>الأرقام N/E/S/W معرّفات تدقيق داخلية وليست أرقامًا رسمية للمباني.</strong><br>المضلعات من OSM بتاريخ <bdi dir="ltr">${esc(audit.sources.buildings.timestamp)}</bdi>. النقاط البرتقالية (7xx) والحمراء (8xx) هي مواضع المصدر الحالية وليست أبواب مشاة أو مداخل سيارات. لا توجد نقاط خضراء/زرقاء للمداخل لأنها لم تُوثق بعد.${direction.id === 'east' ? '<br><strong>تنبيه E001: مضلع OSM كبير يختلف عن ملامح الصورة الحالية؛ يبقى مرشحًا غير موثق ولا يُعتمد كمبنى قائم.</strong>' : ''}</div><div class="legend"><span><i class="swatch" style="background:${COLORS.hotel}"></i>فندق</span><span><i class="swatch" style="background:${COLORS.construction}"></i>إنشاء في OSM</span><span><i class="swatch" style="background:${COLORS.landmark}"></i>معلم/خدمة عامة</span><span><i class="swatch" style="background:#08734c"></i>السور والبوابات</span></div><h3>المباني المرقّمة</h3><table><thead><tr><th>الرقم</th><th>الاسم والمصدر</th><th>من السور</th><th>بوابة</th><th>الارتفاع</th><th>POI مرشح</th></tr></thead><tbody>${buildingRows(buildings)}</tbody></table><h3>الفنادق والمطاعم في هذه الجهة</h3><table><thead><tr><th>ID</th><th>الاسم</th><th>مبنى مرشح</th><th>بعد النقطة</th><th>بوابة</th></tr></thead><tbody>${poiRows(pois)}</tbody></table></aside></div></body></html>`;
}

function indexHtml(audit) {
  const cards = DIRECTIONS.map(
    (d) => `<a href="${d.prefix}-${d.id}.png"><img src="${d.prefix}-${d.id}.png" alt="خريطة جهة ${d.ar}"><span>جهة ${d.ar} — ${audit.summary.byDirection[d.id]} مبنى</span></a>`,
  ).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>أطلس تدقيق الحلقة الأولى 250م</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f1e8;color:#17251f;font-family:Arial,sans-serif}header,main{max-width:1500px;margin:auto;padding:28px}h1{color:#173d32}summary{padding:18px;background:#fff8df;border:1px solid #d9bd65;line-height:1.9}.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin:24px 0}.cards a{background:#fff;padding:12px;text-decoration:none;color:#173d32;font-weight:bold;border:1px solid #ccd5ce}.cards img{width:100%;height:320px;object-fit:cover;object-position:top left}.cards span{display:block;padding:10px}table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}th,td{padding:8px;border:1px solid #d6dcd6;text-align:right}th{background:#dfe9e3}td small{display:block;color:#68736d}.links a{margin-inline-end:18px}@media(max-width:700px){.cards{grid-template-columns:1fr}.cards img{height:220px}header,main{padding:16px}table{display:block;overflow:auto}}</style></head><body><header><h1>أطلس تدقيق الحلقة الأولى 0–250 م</h1><p>تاريخ التدقيق: 2026-11-10 · ${audit.summary.buildings} مبنى · ${audit.summary.hotels} فندقًا · ${audit.summary.food} مطعمًا/مقهى</p><div class="links"><a href="buildings.csv">جدول المباني CSV</a><a href="pois.csv">جدول الفنادق والمطاعم CSV</a><a href="audit.json">بيانات التدقيق JSON</a></div></header><main><summary><strong>المطلوب اعتماده:</strong> أرقام المباني ومواضع مضلعاتها وتسمياتها وربط الفنادق والمطاعم بها. نقاط 7xx/8xx هي مواضع المصدر وليست مداخل. الارتفاعات ومداخل المشاة والسيارات غير معتمدة ولم تُستنتج آليًا.<br>المصدر: OSM <bdi dir="ltr">${esc(audit.sources.buildings.timestamp)}</bdi> فوق Esri World Imagery. فُحص التقاط navQ المحفوظ ووجد غير مكتمل، ويحوي مرشحين من Mapbox/OSM لا حقائق معتمدة؛ لم يُدمج في المضلعات المرقّمة. الخط الأخضر هو سور الساحات المعتمد بتاريخ ${esc(audit.sources.fence.captured)}.<br><strong>تنبيه خاص:</strong> E001 مضلع OSM كبير يختلف عن ملامح الصورة الحالية، وليس مبنى قائمًا معتمدًا.</summary><section class="cards">${cards}</section><h2>كل المباني</h2><table><thead><tr><th>الرقم</th><th>الاسم والمصدر</th><th>الجهة</th><th>من السور</th><th>بوابة</th><th>الارتفاع</th><th>POI مرشح</th></tr></thead><tbody>${buildingRows(audit.buildings, true)}</tbody></table><h2>كل الفنادق والمطاعم</h2><table><thead><tr><th>ID</th><th>الاسم</th><th>النوع</th><th>مبنى مرشح</th><th>طريقة المطابقة</th><th>بعد النقطة</th><th>بوابة</th></tr></thead><tbody>${audit.pois.map((p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${p.category === 'hotels' ? 'فندق' : 'مطعم/مقهى'}</td><td>${p.matchedBuildingId ?? '—'}</td><td>${esc(p.matchMethod)}</td><td>${p.distanceToFootprintM ?? '—'} م</td><td>${p.nearestGateId}</td></tr>`).join('')}</tbody></table></main></body></html>`;
}

export async function renderAtlas(audit, output) {
  const executablePath =
    process.env.CHROME ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const direction of DIRECTIONS) {
      const html = await pageHtml(audit, direction);
      const crop = boundsFor(audit, direction.id);
      const page = await browser.newPage({ viewport: { width: crop.width, height: 1000 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const failed = await page.locator('.map img').evaluateAll((images) => images.filter((img) => !img.complete || !img.naturalWidth).length);
      if (failed) throw new Error(`${direction.id}: ${failed} imagery tiles did not render`);
      await page.screenshot({ path: resolve(output, `${direction.prefix}-${direction.id}.png`), fullPage: true });
      await page.close();
      console.log(`atlas ${direction.id}: ${crop.width}px map, ${direction.prefix}-${direction.id}.png`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(output, 'index.html'), indexHtml(audit));
}
