import 'leaflet/dist/leaflet.css';
import '../styles/fonts';
import { initPwa } from '../pwa';
import '../styles/main.css';
import '../styles/map.css';
import '../styles/ui.css';
import '../styles/refresh.css';
import '../styles/stories.css';
import '../styles/library.css';
import { POI_BY_ID, RULES } from '../data';
import type { Poi } from '../data/types';
import { Facilities } from '../domain/facilities';
import { FILTERS, isHidden, type FilterId, type ParkingSub, type ToiletSub } from '../domain/filters';
import { visiblePois } from '../domain/visible';
import { nm, t } from '../i18n';
import { applyLang, initialLang } from '../i18n/dom';
import { AdminPanel } from '../ui/admin';
import { Header } from '../ui/header';
import { Pills } from '../ui/pills';
import { Stories } from '../ui/stories';
import { Library } from '../ui/library';
import { VISIT_LIST } from '../domain/visits';
import { RawdahCard } from '../ui/rawdah-card';
import { Sheet } from '../ui/sheet';
import { PoiLayer } from './layer';
import { LocationService } from '../location/LocationService';
import { MeMarker } from '../location/MeMarker';
import { RouteLayer } from './route-layer';
import { createMap } from './setup';
import { lotsToAsk, planExit, planRoutes, type GarageStart, type Plan } from '../routing/plan';
import { askGarageStart } from '../ui/garage-ask';
import { RouteTrack } from '../location/progress';
import { addWeatherChip } from '../ui/weather-chip';
import { trackMotion } from './motion';
import { NavigationTracker } from '../navigation/NavigationTracker';
import { applyTheme, savedTheme } from '../ui/theme';
import { toast } from '../ui/toast';

applyTheme(savedTheme(), false);
applyLang(initialLang());
document.title = t('title');

const state = { filter: 'all' as FilterId, toiletSub: 'all' as ToiletSub, parkingSub: 'all' as ParkingSub, query: '', selected: null as number | null, markersHidden: false };

const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="map" class="map-root" style="position:fixed;inset:0" role="application"></div>
  <div class="ui-top" id="ui-top"></div>
  <div class="ui-bottom" id="ui-bottom"></div>`;

const fac = new Facilities();
const handle = createMap(document.getElementById('map')!);
const map = handle.map;
addWeatherChip(map);
trackMotion(map);
const layer = new PoiLayer(map, fac, (p) => select(p, false));
// One live location for the whole app: the "my location" button and navigation share it.
const geo = new LocationService();
const me = new MeMarker(map);
geo.onFix((f) => {
  // During navigation the tracker draws the marker (snapped to the route when close).
  if (!navigation.active) me.update(f.lat, f.lng, f.accuracy, f.heading);
});
geo.onStatus((s, extra) => {
  if (s === 'locating') toast(t('locating'), 2500);
  else if (s === 'denied') toast(t('geo_deny'), 6000);
  else if (s === 'unsupported') toast(t('geo_unsup'), 6000);
  else if (s === 'far' && extra) toast(t('geo_far', { k: extra.km < 10 ? extra.km.toFixed(1) : String(Math.round(extra.km)) }), 6000);
  if (s === 'idle' || s === 'denied' || s === 'far') me.remove();
});
const route = new RouteLayer(map);
/** Within this distance of the car park leg, the visitor is in the car park: no re-planning from the streets. */
const IN_CAR_PARK_M = 60;
/** The routes offered for the current trip (best first) and the one being followed. */
let plans: Plan[] = [];
let chosen = 0;

/** Draw the offered routes with `plans[i]` as the one to follow, and keep the sheet and navigation in step. */
function showPlans(next: Plan[], i: number, animate: boolean) {
  plans = next;
  chosen = i;
  const info = route.show(plans, chosen, { animate, onPick: (j) => pickRoute(j) });
  sheet.setRoute(info);
  navigation.routeChanged();
  return info;
}

/** The visitor tapped another of the offered routes on the map. */
function pickRoute(i: number) {
  if (i === chosen || !plans[i] || !route.active) return;
  showPlans(plans, i, false);
}

const navigation = new NavigationTracker(
  map,
  geo,
  me,
  () => route.latLngs,
  (from, heading) => {
    // Left the route: re-plan from where the visitor actually is, the same way (walking or driving),
    // favouring the way they are heading; redrawn in place, without the draw-in or a camera jump.
    const dest = state.selected !== null ? POI_BY_ID.get(state.selected) : undefined;
    if (!dest || !route.active) return;
    // In the car park (or on the way out of it) there is no other way to plan from the streets:
    // keep the drawn route; the visitor gets back on it (GPS underground can wander).
    if (plans[chosen]?.exit) return;
    const garage = plans[chosen]?.legs.find((l) => l.kind === 'garage');
    if (garage && garage.path.length > 1 && new RouteTrack(garage.path).locate([from.lat, from.lng]).offset < IN_CAR_PARK_M) return;
    // The car has moved since the visitor said which lot it was in: on from the road, same level.
    const said = recentAnswer(from.lat, from.lng, true);
    const start: GarageStart | undefined = said === 'outside' ? 'outside' : said ? { lot: null, level: said.level } : undefined;
    void planRoutes([from.lat, from.lng], dest, sheet.travel, { heading, level: sheet.level, start }).then((next) => {
      if (state.selected !== dest.id || !route.active || !next.length) return;
      showPlans(next, 0, false);
      toast(t('rerouted'));
    });
  },
  () => route.alternatives,
  (alt) => {
    // Walking along one of the alternatives on the map: it becomes the route.
    const others = plans.map((_, k) => k).filter((k) => k !== chosen);
    if (others[alt] === undefined) return;
    showPlans(plans, others[alt], false);
    toast(t('r_switched'));
  },
  () => {
    // Short directions inside the car park (way in or way out), with the lot's number.
    const plan = plans[chosen];
    const garage = plan?.legs.find((l) => l.kind === 'garage');
    return garage?.steps?.length ? { steps: garage.steps, lot: plan.lot ? plan.lot.id - 900 : null } : null;
  },
);

/** Live: the next 150 m of the route in full, the rest faint (owner, 2026-10-13). */
const AHEAD_M = 150;
// «إنهاء التتبع» in the arrival notice ends the route, like «إنهاء المسار».
document.addEventListener('route-end-request', () => {
  navigation.stop();
  route.clear();
  sheet.setRoute(null);
});
navigation.onChange((s) => {
  document.body.classList.toggle('is-navigating', s.state !== 'stopped');
  route.focus(s.state === 'stopped' ? null : navigation.ahead(AHEAD_M), plans[chosen]?.mode ?? 'walk');
});

const header = new Header({
  onQuery(q) {
    state.query = q;
    refresh();
  },
  onPick: (p) => select(p, true),
  onLang: (l) => applyLang(l),
  status: (id) => fac.status(id),
});
const pills = new Pills(
  state.filter,
  state.toiletSub,
  (f, s, hidden, parkingSub) => {
    state.filter = f;
    state.toiletSub = s;
    state.parkingSub = parkingSub;
    state.markersHidden = hidden;
    refresh();
  },
  () => Object.fromEntries(FILTERS.map(({ id }) => [id, visiblePois(id, 'all', '', fac, undefined, id === 'parking' ? 'all' : undefined).length])),
);
const top = document.getElementById('ui-top')!;
top.append(header.root, pills.root);

// Landmark stories: opened from the map button (or ?visit=ID), they hand a site back to the map or the route planner.
const stories = new Stories({
  onMap: (p) => select(p, true),
  onRoute: (p) => {
    select(p, true);
    void drawRoute(p);
  },
});
document.body.append(stories.root);
document.getElementById('map')!.addEventListener('stories-request', () => stories.open(0));
const visitParam = Number(new URLSearchParams(location.search).get('visit'));
const visitAt = VISIT_LIST.findIndex((v) => v.poi.id === visitParam);
if (visitAt >= 0) stories.open(visitAt);

// Library: landmarks of the Prophet's Mosque (map button or ?lib=ID).
const library = new Library();
document.body.append(library.root);
document.getElementById('map')!.addEventListener('library-request', () => void library.open());
const libParam = new URLSearchParams(location.search).get('lib');
if (libParam !== null) void library.open(libParam);

const BEHIND_RAWDAH_ID = 604;
const rawdah = new RawdahCard(
  () => {
    const gate = POI_BY_ID.get(RULES.rules.rawdah.gate);
    if (gate) select(gate, true);
  },
  () => {
    // The women's entrance to the area behind the Rawdah, facing Gate 21.
    const entrance = POI_BY_ID.get(BEHIND_RAWDAH_ID);
    if (entrance) select(entrance, true);
  },
);
const bottom = document.getElementById('ui-bottom')!;
bottom.append(rawdah.root);
// The map controls and toasts sit above the Rawdah cards, which grow in the women's turn.
new ResizeObserver(() => document.body.style.setProperty('--rawdah-h', `${rawdah.root.offsetHeight}px`)).observe(rawdah.root);

const sheet = new Sheet(fac, {
  close: () => deselect(),
  goTo: (p) => select(p, true),
  route: (p) => void drawRoute(p),
  wayOut: () => showWayOut(),
  share: (p) => void sharePlace(p),
  endRoute: () => {
    navigation.stop();
    route.clear();
    sheet.setRoute(null);
  },
  state: (s) => {
    bottom.classList.toggle('is-hidden', s !== 'closed');
    // Lets the live-navigation bar sit just above the sheet.
    requestAnimationFrame(syncSheetHeight);
    // Compact header only while walking a route (it would hide search results otherwise).
    top.classList.toggle('is-route-compact', s !== 'closed' && sheet.hasRoute);
  },
});
document.body.append(sheet.root);

/** Visible sheet height as a CSS variable, from its real position once it has settled. */
function syncSheetHeight() {
  const top = sheet.root.dataset.state === 'closed' ? window.innerHeight : sheet.root.getBoundingClientRect().top;
  document.body.style.setProperty('--sheet-h', `${Math.max(0, Math.round(window.innerHeight - top))}px`);
}
sheet.root.addEventListener('transitionend', (e) => e.propertyName === 'transform' && syncSheetHeight());
window.addEventListener('resize', syncSheetHeight);

if (new URLSearchParams(location.search).get('admin') === '1') {
  const admin = new AdminPanel(fac);
  document.body.append(admin.root);
  document.addEventListener('langchange', () => admin.render());
}

/** Recompute visible POIs for the filter + query, then update map, count and results. */
function refresh() {
  const vis = visiblePois(state.filter, state.toiletSub, state.query, fac, undefined, state.parkingSub);
  layer.set(vis, state.filter, state.markersHidden, state.query.trim() === '');
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

/**
 * Where the car is, as the visitor said when the route was asked for in or by the car park (owner,
 * 2026-10-14). Kept for a while, so changing the level or a re-route does not ask again.
 */
let garageAnswer: { start: GarageStart; at: number; pos: [number, number] } | null = null;
const ANSWER_MS = 10 * 60_000;
const ANSWER_M = 40;
/** The answer still holds: given lately, and (unless `moved` is allowed) from about the same place. */
function recentAnswer(lat: number, lng: number, moved = false): GarageStart | undefined {
  if (!garageAnswer || Date.now() - garageAnswer.at > ANSWER_MS) return undefined;
  const m = Math.hypot((lat - garageAnswer.pos[0]) * 111_320, (lng - garageAnswer.pos[1]) * 101_300);
  return moved || m < ANSWER_M ? garageAnswer.start : undefined;
}

/** In or by the car park, ask where the car is (which lot, which level); elsewhere nothing. Null: dismissed. */
async function garageStartFor(lat: number, lng: number): Promise<GarageStart | undefined | null> {
  const known = recentAnswer(lat, lng);
  if (known) return known;
  const lots = lotsToAsk([lat, lng]);
  if (!lots.length) return undefined;
  const start = await askGarageStart(lots);
  if (start) garageAnswer = { start, at: Date.now(), pos: [lat, lng] };
  return start;
}

/** Location is requested only now, on demand. */
async function drawRoute(p: Poi) {
  const fix = geo.fresh() ?? (await geo.start());
  if (!fix || state.selected !== p.id) return;
  const travel = sheet.travel;
  const start = travel === 'drive' ? await garageStartFor(fix.lat, fix.lng) : undefined;
  if (start === null || state.selected !== p.id) return;
  const next = await planRoutes([fix.lat, fix.lng], p, travel, { level: sheet.level, start });
  if (state.selected !== p.id || !next.length) return;
  const plan = next[0];
  if (travel === 'drive' && plan.mode === 'walk') toast(t('drive_fallback'), 5000);
  const info = showPlans(next, 0, true);
  await navigation.start(plan.mode);
  const topH = top.getBoundingClientRect().bottom;
  map.fitBounds(info.bounds, {
    // Room on both sides for the map controls, so a route or an alternative's label is not hidden under them.
    paddingTopLeft: [72, topH + 24],
    paddingBottomRight: [72, sheet.visibleHeight() + 24],
    maxZoom: 19,
  });
}

/** The way out of the car park from the lot just driven to: from its exit to the car park's exits, quickest first. */
function showWayOut() {
  const inbound = plans[chosen];
  if (!inbound?.lot || inbound.exit) return;
  const out = planExit(inbound.lot, inbound.level ?? 'B');
  if (!out.length) return;
  // Tracked live like the way in (GPS works underground in this car park, owner 2026-10-13).
  const info = showPlans(out, 0, true);
  if (!navigation.active) void navigation.start('drive');
  const topH = top.getBoundingClientRect().bottom;
  map.fitBounds(info.bounds, { paddingTopLeft: [72, topH + 24], paddingBottomRight: [72, sheet.visibleHeight() + 24], maxZoom: 19 });
}

/** Share a link that opens this exact place (map.html?poi=ID). */
async function sharePlace(p: Poi) {
  const url = new URL('./map.html', location.href);
  url.searchParams.set('poi', String(p.id));
  const data = { title: nm(p), text: `${nm(p)} — ${t('title')}`, url: url.href };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(url.href);
      toast(t('place_link_copied'));
    }
  } catch {
    // Dismissed share sheet or blocked clipboard.
  }
}

document.getElementById('map-share')?.addEventListener('click', async () => {
  const shareData = { title: t('title'), text: t('title'), url: new URL('./', location.href).href };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(shareData.url);
      toast(t('app_link_copied'));
    }
  } catch {
    // The user may dismiss the native share sheet.
  }
});

document.getElementById('map')!.addEventListener('locate-request', async () => {
  const f = await geo.start();
  if (f) map.flyTo([f.lat, f.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
});

function select(p: Poi, fly: boolean) {
  if (state.selected !== p.id) {
    // A new destination ends the current walk entirely (GPS watch, wake lock, status bar).
    navigation.stop();
    route.clear();
  }
  state.selected = p.id;
  layer.select(p.id);
  sheet.show(p);
  focus(p, fly ? Math.max(map.getZoom(), 19) : map.getZoom(), fly);
}

function deselect() {
  navigation.stop();
  route.clear();
  state.selected = null;
  layer.select(null);
  sheet.hide();
  // Closing the card ends the search too (owner, 2026-10-14): every place comes back on the map,
  // not only those matching the words still in the box.
  if (header.query.trim()) header.clear();
}

map.on('click', () => {
  // While walking a route, a stray tap on the map must not end it (use «إنهاء المسار»).
  if (state.selected !== null && !route.active) deselect();
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

// Deep link: map.html?poi=215 opens that place directly (shared links, printed signs).
{
  const id = Number(new URLSearchParams(location.search).get('poi'));
  const p = Number.isInteger(id) ? POI_BY_ID.get(id) : undefined;
  if (p && !isHidden(p)) map.whenReady(() => setTimeout(() => select(p, true), 50));
}

// Dev-only handles for debugging in the browser console.
if (import.meta.env.DEV) Object.assign(window, { __map: map, __layer: layer, __fac: fac, __route: route, __geo: geo, __me: me });

initPwa();
