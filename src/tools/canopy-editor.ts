import { AttributionControl, Map as MLMap, setWorkerUrl, type GeoJSONSource, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import seed from '../../data/canopies.json';
import rules from '../../data/rules.json';
import { emptyCanopies, rowBetween, toFile, type Canopies, type Kind } from './canopy-points';
import './canopy-editor.css';

/**
 * The owner's canopy editor (canopies.html, owner 2026-11-05): a dot on the centre of every courtyard
 * canopy and lamp post, over the satellite imagery, to move, add and remove until each stands
 * exactly on the one in the photo; then the file is sent to be saved as data/canopies.json, which
 * the 3D view draws. An owner's tool in Arabic only, not linked from the app.
 */

setWorkerUrl(workerUrl);

type Mode = 'move' | 'umbrella' | 'lamp' | 'row' | 'delete';
const DRAFT = 'canopies.draft.v1';

const load = (): Canopies => {
  try {
    const raw = localStorage.getItem(DRAFT);
    if (raw) return JSON.parse(raw) as Canopies;
  } catch {
    // No storage (private window): start from the file.
  }
  return structuredClone(seed) as Canopies;
};

let data = load();
const undo: string[] = [];
let mode: Mode = 'move';
let rowStart: [number, number] | null = null;
let dragging: { kind: Kind; index: number } | null = null;

const map = new MLMap({
  container: 'map',
  center: [39.6098, 24.468],
  zoom: 16.4,
  minZoom: 15,
  maxZoom: 21,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      esri: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [rules.map.tiles.satellite], attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics' },
      points: { type: 'geojson', data: features() },
    },
    layers: [
      { id: 'esri', type: 'raster', source: 'esri' },
      {
        id: 'dots',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 3, 19, 6, 21, 9],
          'circle-color': ['match', ['get', 'kind'], 'lamp', '#ff9800', '#00e5ff'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1.5,
        },
      },
      { id: 'centres', type: 'circle', source: 'points', paint: { 'circle-radius': 1.2, 'circle-color': '#000' } },
    ],
  },
});
map.touchZoomRotate.disableRotation();
map.addControl(new AttributionControl({ compact: true }), 'bottom-left');

function features(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const f = (kind: Kind) =>
    data[kind].map((c, index) => ({
      type: 'Feature' as const,
      properties: { kind: kind === 'umbrellas' ? 'umbrella' : 'lamp', index },
      geometry: { type: 'Point' as const, coordinates: [...c] },
    }));
  return { type: 'FeatureCollection', features: [...f('umbrellas'), ...f('lamps')] };
}

function redraw(save = true): void {
  (map.getSource('points') as GeoJSONSource | undefined)?.setData(features());
  document.getElementById('counts')!.textContent = `مظلات: ${data.umbrellas.length} · أعمدة إنارة: ${data.lamps.length}`;
  if (!save) return;
  try {
    localStorage.setItem(DRAFT, JSON.stringify(data));
  } catch {
    // Kept in memory only.
  }
}

function remember(): void {
  undo.push(JSON.stringify(data));
  if (undo.length > 60) undo.shift();
}

/** The dot under a finger or the mouse, within 18 px. */
function hit(point: { x: number; y: number }): { kind: Kind; index: number } | null {
  const r = 18;
  const found = map.queryRenderedFeatures(
    [
      [point.x - r, point.y - r],
      [point.x + r, point.y + r],
    ],
    { layers: ['dots'] },
  );
  if (!found.length) return null;
  const nearest = found
    .map((f) => {
      const p = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return { f, d: Math.hypot(p.x - point.x, p.y - point.y) };
    })
    .sort((a, b) => a.d - b.d)[0].f;
  return { kind: nearest.properties.kind === 'lamp' ? 'lamps' : 'umbrellas', index: nearest.properties.index as number };
}

const HINTS: Record<Mode, string> = {
  move: 'اسحب أي نقطة لتضعها على منتصف المظلة تماماً. قرّب الخريطة بإصبعين للدقة.',
  umbrella: 'اضغط على منتصف مظلة لإضافة نقطة لها.',
  lamp: 'اضغط على منتصف عمود إنارة لإضافة نقطة له.',
  row: 'صف مظلات: اضغط على منتصف أول مظلة في الصف، ثم على منتصف آخر مظلة، ثم اكتب عددها.',
  delete: 'اضغط على النقطة التي تريد حذفها.',
};

function setMode(next: Mode): void {
  mode = next;
  rowStart = null;
  document.getElementById('hint')!.textContent = HINTS[mode];
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tools button[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}

// ---------- dragging (move mode) ----------

function startDrag(e: MapMouseEvent | MapTouchEvent): void {
  if (mode !== 'move') return;
  if ('points' in e && e.points.length > 1) return;
  const target = hit(e.point);
  if (!target) return;
  e.preventDefault();
  remember();
  dragging = target;
}
function moveDrag(e: MapMouseEvent | MapTouchEvent): void {
  if (!dragging) return;
  data[dragging.kind][dragging.index] = round([e.lngLat.lng, e.lngLat.lat]);
  redraw(false);
}
function endDrag(): void {
  if (!dragging) return;
  dragging = null;
  redraw();
}
map.on('mousedown', startDrag);
map.on('touchstart', startDrag);
map.on('mousemove', moveDrag);
map.on('touchmove', moveDrag);
map.on('mouseup', endDrag);
map.on('touchend', endDrag);

// ---------- taps (add, row, delete) ----------

map.on('click', (e) => {
  const at = round([e.lngLat.lng, e.lngLat.lat]);
  if (mode === 'umbrella' || mode === 'lamp') {
    remember();
    data[mode === 'umbrella' ? 'umbrellas' : 'lamps'].push(at);
    redraw();
  } else if (mode === 'delete') {
    const target = hit(e.point);
    if (!target) return;
    remember();
    data[target.kind].splice(target.index, 1);
    redraw();
  } else if (mode === 'row') {
    if (!rowStart) {
      rowStart = at;
      document.getElementById('hint')!.textContent = 'الآن اضغط على منتصف آخر مظلة في الصف.';
      return;
    }
    const answer = prompt('كم مظلة في هذا الصف، مع الأولى والأخيرة؟', '6');
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 2 && n <= 40) {
      remember();
      data.umbrellas.push(...rowBetween(rowStart, at, n).map(round));
      redraw();
    }
    setMode('row');
  }
});

function round([lng, lat]: readonly [number, number]): [number, number] {
  return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
}

// ---------- toolbar ----------

async function send(): Promise<void> {
  const text = toFile(data);
  const file = new File([text], 'canopies.json', { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'canopies.json' });
      return;
    }
  } catch {
    // Share cancelled or refused: offer the download instead.
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = 'canopies.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const BUTTONS: [string, () => void, string?][] = [
  ['تحريك', () => setMode('move'), 'move'],
  ['+ مظلة', () => setMode('umbrella'), 'umbrella'],
  ['+ عمود إنارة', () => setMode('lamp'), 'lamp'],
  ['صف مظلات', () => setMode('row'), 'row'],
  ['حذف نقطة', () => setMode('delete'), 'delete'],
  [
    'تراجع',
    () => {
      const last = undo.pop();
      if (last) {
        data = JSON.parse(last) as Canopies;
        redraw();
      }
    },
  ],
  [
    'حذف كل الأعمدة',
    () => {
      if (!confirm(`حذف كل أعمدة الإنارة (${data.lamps.length})؟ يمكنك التراجع.`)) return;
      remember();
      data.lamps = [];
      redraw();
    },
  ],
  [
    'مسح الكل',
    () => {
      if (!confirm('مسح كل النقاط والبدء من الصفر؟ يمكنك التراجع.')) return;
      remember();
      data = emptyCanopies();
      redraw();
    },
  ],
  [
    'بيانات الهيئة',
    () => {
      if (!confirm('الرجوع إلى مواضع ملف الهيئة الأصلية؟ يمكنك التراجع.')) return;
      remember();
      data = structuredClone(seed) as Canopies;
      redraw();
    },
  ],
  ['إرسال الملف', () => void send()],
];

const tools = document.getElementById('tools')!;
for (const [label, run, m] of BUTTONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (m) b.dataset.mode = m;
  if (label === 'إرسال الملف') b.className = 'send';
  if (label.startsWith('حذف كل') || label === 'مسح الكل') b.className = 'danger';
  b.addEventListener('click', run);
  tools.append(b);
}
setMode('move');
redraw(false);
map.on('load', () => redraw(false));
