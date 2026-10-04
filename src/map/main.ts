import 'leaflet/dist/leaflet.css';
import '../styles/fonts';
import { initPwa } from '../pwa';
import '../styles/main.css';
import '../styles/map.css';
import '../styles/ui.css';
import { POI_BY_ID, RULES } from '../data';
import type { Poi } from '../data/types';
import { Facilities } from '../domain/facilities';
import type { FilterId, ToiletSub } from '../domain/filters';
import { visiblePois } from '../domain/visible';
import { t } from '../i18n';
import { applyLang, initialLang } from '../i18n/dom';
import { AdminPanel } from '../ui/admin';
import { Header } from '../ui/header';
import { Pills } from '../ui/pills';
import { RawdahCard } from '../ui/rawdah-card';
import { Sheet } from '../ui/sheet';
import { PoiLayer } from './layer';
import { Locator } from './locate';
import { RouteLayer } from './route-layer';
import { createMap } from './setup';

applyLang(initialLang());
document.title = t('title');

const state = { filter: 'all' as FilterId, toiletSub: 'all' as ToiletSub, query: '', selected: null as number | null };

const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="map" class="map-root" style="position:fixed;inset:0" role="application"></div>
  <div class="ui-top" id="ui-top"></div>
  <div class="ui-bottom" id="ui-bottom"></div>`;

const fac = new Facilities();
const handle = createMap(document.getElementById('map')!);
const map = handle.map;
const layer = new PoiLayer(map, fac, (p) => select(p, false));
const locator = new Locator(map);
const route = new RouteLayer(map);

const header = new Header({
  onQuery(q) {
    state.query = q;
    refresh();
  },
  onPick: (p) => select(p, true),
  onLang: (l) => applyLang(l),
  status: (id) => fac.status(id),
});
const pills = new Pills(state.filter, state.toiletSub, (f, s) => {
  state.filter = f;
  state.toiletSub = s;
  refresh();
});
const top = document.getElementById('ui-top')!;
top.append(header.root, pills.root);

const rawdah = new RawdahCard(() => {
  const gate = POI_BY_ID.get(RULES.rules.rawdah.gate);
  if (gate) select(gate, true);
});
const bottom = document.getElementById('ui-bottom')!;
bottom.append(rawdah.root);

const sheet = new Sheet(fac, {
  close: () => deselect(),
  goTo: (p) => select(p, true),
  route: (p) => void drawRoute(p),
  endRoute: () => {
    route.clear();
    sheet.setRoute(null);
  },
  state: (s) => bottom.classList.toggle('is-hidden', s !== 'closed'),
});
document.body.append(sheet.root);

if (new URLSearchParams(location.search).get('admin') === '1') {
  const admin = new AdminPanel(fac);
  document.body.append(admin.root);
  document.addEventListener('langchange', () => admin.render());
}

/** Recompute visible POIs for the filter + query, then update map, count and results. */
function refresh() {
  const vis = visiblePois(state.filter, state.toiletSub, state.query, fac);
  layer.set(vis, state.filter);
  header.setCount(vis.length);
  header.showResults(vis, vis.length);
}
fac.onChange(refresh);

/** Centre a point in the map area left between the header and the sheet. */
function focus(p: Poi, zoom: number, fly: boolean) {
  const size = map.getSize();
  const topH = top.getBoundingClientRect().bottom;
  const sheetH = sheet.visibleHeight() || Math.round(window.innerHeight * 0.55);
  const visibleCenterY = (topH + (size.y - sheetH)) / 2;
  const target = map.project([p.lat, p.lng], zoom).add([0, size.y / 2 - visibleCenterY]);
  const center = map.unproject(target, zoom);
  if (fly) map.flyTo(center, zoom, { duration: 0.8 });
  else map.panTo(center, { animate: true });
}

/** Location is requested only now, on demand. */
async function drawRoute(p: Poi) {
  const from = locator.position ?? (await locator.locate());
  if (!from || state.selected !== p.id) return;
  const info = route.show(from, [p.lat, p.lng]);
  sheet.setRoute(info);
  const topH = top.getBoundingClientRect().bottom;
  map.fitBounds(info.bounds, {
    paddingTopLeft: [40, topH + 24],
    paddingBottomRight: [40, sheet.visibleHeight() + 24],
    maxZoom: 19,
  });
}

document.getElementById('map')!.addEventListener('locate-request', async () => {
  const ll = await locator.locate();
  if (ll) map.flyTo(ll, Math.max(map.getZoom(), 18), { duration: 0.8 });
});

function select(p: Poi, fly: boolean) {
  if (state.selected !== p.id) route.clear();
  state.selected = p.id;
  layer.select(p.id);
  sheet.show(p);
  focus(p, fly ? Math.max(map.getZoom(), 19) : map.getZoom(), fly);
}

function deselect() {
  route.clear();
  state.selected = null;
  layer.select(null);
  sheet.hide();
}

map.on('click', () => {
  if (state.selected !== null) deselect();
});

document.addEventListener('langchange', () => {
  document.title = t('title');
  header.relabel();
  pills.render();
  rawdah.render();
  sheet.render();
  handle.relabel();
  refresh();
});

refresh();

// Dev-only handles for debugging in the browser console.
if (import.meta.env.DEV) Object.assign(window, { __map: map, __layer: layer, __fac: fac, __route: route });

initPwa();
