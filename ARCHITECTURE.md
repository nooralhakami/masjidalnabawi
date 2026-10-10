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
src/i18n        t()/nm()/ds(), strings in 18 languages
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
- **Route:** sheet "route" → `map/main.drawRoute()` → `location/LocationService` (on demand) → `routing/plan.planRoute(from, to, mode)` → legs (walk / drive / garage) → `map/route-layer.show()` → `navigation/NavigationTracker.start()`.
- **Trip planner (`routing/plan.ts`):** inside the Haram → plaza walkways (`walk.ts`); otherwise the shortest of streets-only / streets + best gate + walkways / short cut across the plazas; driving → street graph to the best car-park ramp, aisles round the Haram (`ringPath`), stairs up, walk; or straight to a place outside the Haram.
- **Live location:** `LocationService` (watchPosition, Kalman `filter.ts`, compass) → `MeMarker` (glide) and `NavigationTracker` (progress via `progress.ts`, away/off-route, reroute).

## 4. Data and how it is built
| File | What | Built by |
|---|---|---|
| `data/pois.json` | all places | owner data + `scripts/places-from-osm.py` → `historic-from-osm.py` → `shops-from-osm.py` (run in that order) |
| `data/i18n.json` | names/descriptions/labels in every language | same scripts + hand edits; the 12 added languages (bn, fr, fa, ru, ms, ha, ml, sw, ps, so, ta, hi) from `docs/translations/<lang>.json` by `scripts/translations-to-i18n.py` (run last) |
| `data/routing.json` | plaza walkway graph, obstacles, open areas, women's prayer areas | `scripts/routes-from-drawing.py docs/routes/drawing-*.json` |
| `data/streets.json` | walk/drive street graph (OSM) | `scripts/streets-from-osm.py docs/routes/osm/roads-*.json` |
| `data/rules.json` | facility rules, Rawdah gate, map config | hand edits (owner decisions) |
| `data/overrides.json` | metre nudges of positions | hand edits |
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
