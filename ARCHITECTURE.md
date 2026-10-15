# Architecture — Prophet's Mosque Visitor Guide

> **ملخص بالعربية:** التطبيق موقع ثابت (بلا خادم) مبني بـ TypeScript وVite دون إطار عمل. يتكوّن من طبقات: **البيانات** (ملفات JSON) ← **المنطق النقي** (فلاتر، بحث، مسارات، جدول الروضة — بلا واجهة ولا خريطة، ومختبَر بالكامل) ← **الخريطة** (Leaflet) و**الواجهة** (عناصر DOM). كل طبقة تعتمد على التي تحتها فقط. البيانات تُبنى بسكربتات قابلة للإعادة من مصادر موثّقة. اقرأ هذا الملف قبل أي تعديل، و`SPEC.md` لمعرفة ما يجب أن يفعله التطبيق.

Read `SPEC.md` first (what the app must do, acceptance criteria, owner rules, warnings list), then this file (where things live and what may depend on what).

## 1. Shape of the system
- **Static site, no server.** Two pages: `index.html` (landing, pre-rendered Arabic at build time) and `map.html` (the app). Hosted on Vercel from GitHub `main`.
- **PWA.** `vite-plugin-pwa` precaches the app shell, data and street graph; map tiles are *not* cached (licence).
- **Everything runs on the device**: search, routing (Dijkstra on bundled graphs), navigation. The visitor's location never leaves the phone.
- **External requests:** map tiles (Esri imagery / OSM), weather (Open-Meteo, fixed Madinah coordinates). Nothing else.

## 2. Modules (layers) and the dependency rule
```
data/  (JSON source of truth)           scripts/  (build data from sources)
   │
src/data        load + types + overrides         ← pure
src/domain      filters, search, facilities,      ← pure: no DOM, no Leaflet
                parking, rawdah, weather, geo
src/routing     plaza walkways (walk.ts), street  ← pure: no DOM, no Leaflet
                graph (streets.ts), trip planner (plan.ts)
src/location    GPS service, Kalman filter,       ← browser APIs only (no Leaflet except MeMarker)
                route progress, visitor marker
src/i18n        t()/nm()/ds(), strings in 26 languages
src/map         Leaflet: setup, POI layer, markers, route layer, entry point (main.ts)
src/navigation  live navigation on top of location + map
src/ui          header/search, pills, sheet (place card), Rawdah card, admin, icons, theme, toast, weather chip
src/landing     landing page (view is SSR'd at build time)
src/styles      tokens.css (all colours, light/dark), component CSS
```
**Rules** (checked 2026-10-10, no violations):
- A module imports only from modules *above* it: data → domain → routing → location / i18n → ui → map / navigation.
- `domain/` and `routing/` stay free of DOM and Leaflet, so they run in unit tests and could run in another host (a native app, a server).
- `ui/` never imports `map/` or `navigation/`; `map/` and `navigation/` may use `ui/` helpers.
- `ui/markers.ts` builds marker HTML as pure data (no Leaflet); `map/layer.ts` turns it into Leaflet markers.

## 3. Key flows
- **Filter/search → markers:** `ui/pills`, `ui/header` → `domain/visible.visiblePois()` → `map/layer.PoiLayer.set()` → `ui/markers.markerSpec()` (pure HTML spec) → Leaflet markers, reused across moves.
- **Select a place:** marker click / search / `?poi=ID` → `map/main.select()` → `ui/sheet.show()`.
- **Route:** sheet "route" → `map/main.drawRoute()` → `location/LocationService` (on demand) → `routing/plan.planRoutes(from, to, mode)` → the best plan and up to two alternatives, each as legs (walk / drive / garage) → `map/route-layer.show(plans, chosen)` (alternatives drawn as a very faint trace, tap one on the map to choose it; the sheet shows only a slim distance · time · side row) → `navigation/NavigationTracker.start()`.
- **Trip planner (`routing/plan.ts`):** collects candidate routes — inside the Haram the plaza walkways and other ways along them (`walk.walkPaths`); otherwise streets-only and another street way, streets + each of the best gates + walkways, or a short cut across the plazas for the best gate pairs; driving (public roads only, turn by turn: no U-turn, OSM turn restrictions, main roads preferred — `routing/streets.ts`) → each public lot by each car park entrance (Omar ibn al-Khattab street in the south-west, Sultana): streets to the ramp, the owner's drawn car park roads (`routing/garage.ts`: one-way, clockwise, two levels B/A joined by the ramps; in and out by B only; the east side cut between lots 12 and 13) to the lot's entrance on the chosen level (the drive ends there: the visitor parks where they like), then walk from the lot's stairs nearest the destination (a lot missing from the drawing falls back to `ringPath`); or straight to a place outside the Haram. None may cross the mosque building, Al-Baqi' or a restroom building (each restroom is a 12 m square; walkways are bent round them, `walk.aroundBuildings`; a route to a restroom ends at its door, `walk.restroomDoor`: facing the mosque in the inner rows, the outer gates in the outer rows) (only the stretch to an inner gate on the wall may run inside it). `plan.planExit` gives the way out from a lot to the Omar ibn al-Khattab and Sultana exits. In or by the car park (`plan.lotsToAsk`), `ui/garage-ask.ts` asks which lot and level the car is in; `planRoutes(…, { start })` then starts the way there (`garage.garageRouteFromLot` / `garageRouteFrom`) instead of at an entrance. `routing/alternatives.pickRoutes` keeps the best and up to two others that are ≤ 30% longer and ≤ 70% shared with a route already kept; on a re-route a route starting with a U-turn ranks lower.
- **Directions and arrival:** `garage.ts` gives the car park steps (n/e/s/w, ramp up/down, into/out of the lot); `NavigationTracker` locates them along the route and shows the step now and the next one; within 20 m of the end twice → `arrived` (notice, vibration, «إنهاء التتبع» dispatches `route-end-request`). `PositionFilter.setPace('drive')` lets the estimate keep up with a car. No street re-planning within 60 m of the car park leg.
- **Stretch ahead:** on every reading `NavigationTracker.ahead(150)` (`RouteTrack.slice`) → `RouteLayer.focus()` draws it in full; the rest of the route (`.route-base`) is faded by `.is-route-focus`.
- **Live location:** `LocationService` (watchPosition, Kalman `filter.ts`, compass) → `MeMarker` (glide) and `NavigationTracker` (progress via `progress.ts`, away/off-route). Off the route on one of the alternatives (2 readings) → switch to it, no re-planning; off every route (3 readings, 8 s apart at most once) → re-plan from the visitor's position with their heading, redrawn in place without the draw-in.

- **Landmark stories:** map button (`stories-request`) or `?visit=ID` → `ui/stories.Stories.open()` → slides from `domain/visits` (`nextPos`/`prevPos`/`segmentFill`, pure) → «show on map» / «route» hand the place back to `map/main` (`select`, `drawRoute`). Photos live in `public/visits/` and are excluded from the PWA precache; the prayer count is in `localStorage` (`salawat-count`) only.

## 4. Data and how it is built
| File | What | Built by |
|---|---|---|
| `data/pois.json` | all places | owner data + `scripts/places-from-osm.py` → `historic-from-osm.py` → `shops-from-osm.py` (run in that order) |
| `data/i18n.json` | names/descriptions/labels in every language | same scripts + hand edits; the 20 added languages (bn, fr, fa, ru, ms, ha, ml, sw, ps, so, ta, hi, bs, de, zh, am, ku, az, th, es) from `docs/translations/<lang>.json` by `scripts/translations-to-i18n.py` (run last) |
| `data/routing.json` | plaza walkway graph, obstacles, open areas, women's prayer areas | `scripts/routes-from-drawing.py docs/routes/drawing-*.json` |
| `data/streets.json` | walk/drive street graph (OSM) | `scripts/streets-from-osm.py docs/routes/osm/roads-*.json` |
| `data/rules.json` | facility rules, Rawdah gate, map config | hand edits (owner decisions) |
| `data/overrides.json` | metre nudges of positions | hand edits |
| `data/garage.json` | the underground car park roads from the owner's drawing: entrances, exits, entry/exit roads, ramps, each lot's entry and exit (`certain: false` where the owner is not sure; none since 2026-10-14) | `scripts/garage-from-drawing.py docs/routes/garage-*.json` (never by hand) |
| `data/visits.json` | must-visit sites in order of importance: place id, text slides (ar, en; other languages after approval), two or more sources, photos with credit and licence. Their markers glow at every zoom and `ui/stories.ts` plays them (`domain/visits.ts` holds the pure flow) | hand edits (owner decides the order; texts need two sources) |
Sources and decisions: `docs/places/PLACES.md`, `docs/routes/NETWORK.md`. Raw extracts are kept under `docs/` so every build is reproducible.

## 5. Integration points (for embedding, e.g. in Nusuk)
- Deep link: `map.html?poi=<id>` opens a place; `?admin=1` opens the facility simulator.
- Works in a WebView: no cookies, no login, no server; language via `localStorage.lang` or the in-app menu.
- Data is plain JSON with stable ids (see `src/data/types.ts`), so a host app can reuse it.
- Config in one place: `src/config/site.config.ts` (site URL, QR, tiles, organisation name).

## 6. Quality gates
- `npm test` (Vitest: data, domain, routing, streets, i18n, markers, location) — must pass.
- `npm run test:e2e` (Playwright on the production build, phone viewport) — must pass.
- `npm run build` (type-check + build) — must pass.
- `npm run perf` — performance budget from SPEC F13 (see `docs/PERF.md`).
- Every new behaviour gets a unit test for its logic and an e2e test if it is visible.
