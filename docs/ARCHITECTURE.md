# Architecture — Prophet's Mosque Visitor Guide («next»)

> **ملخص بالعربية:** موقع ثابت بلا خادم، بطبقات تعتمد كل منها على ما تحتها فقط:
> **data ← domain ← routing ← location / i18n ← presentation ← state ← ui / map ← app**.
> الطبقات الخمس الأولى منقولة حرفياً من التطبيق الحالي، وهي التي تضمن أن البحث والمسارات وجدول الروضة ونتائج المواقف تبقى مطابقة.
> الجديد ثلاث طبقات:
> - **state:** حالة مشتركة بـsignals.
> - **ui:** مكوّنات Preact فوق الخريطة.
> - **map:** MapLibre GL، كل العلامات فيها طبقة GPU واحدة.

## 1. Shape of the system
- **Static site, no server, no accounts, no tracking.** Two pages: `index.html` (landing, Arabic prerendered at build time) and `map.html` (the app). Hosted later on a *new* Vercel project.
- **Everything runs on the device.** Search, routing (Dijkstra on the bundled graphs) and navigation run on the phone. The visitor's position never leaves it.
- **External requests:**
  - Map tiles: Esri World Imagery, and OSM standard tiles for the light base.
  - Weather: Open-Meteo, at fixed Madinah coordinates.
  - Nothing else. In particular there is no glyph or font server.
- **PWA:** the app shell, the data and the street graph are precached. Map tiles and story photos are never precached (tile licence, first-load weight).

## 2. Layers and the dependency rule
```
data/  (JSON source of truth, byte-identical to the live app)      scripts/ (rebuild data/ from documented sources)
   │
src/data          load + types + overrides                      ┐
src/domain        filters, search, facilities, parking, rawdah, │  ported verbatim from e0c6ca7
                  weather, geo, nearby, visits, library         │  pure: no DOM, no map library
src/routing       plaza walkways, streets, garage, plan, alts   │
src/location      LocationService, Kalman filter, RouteTrack    │  browser APIs only (MeMarker dropped)
src/i18n          t()/nm()/ds(), 26 languages, dir              ┘
src/presentation  pure view-model: marker look (tier, colour,     ← ported from ui/markers.ts + ui/poi-view.ts,
                  icon, size, visibility), card fields, labels      no DOM: unit-tested
src/navigation    NavigationTracker logic (progress, away, off-   ← ported logic; emits snapshots, no Leaflet, no DOM
                  route, switch, arrival, car-park steps)
src/state         signals: lang, theme, filter, query, selected, ← tiny, no DOM
                  sheet detent, travel, level, route, nav snapshot
src/ui            Preact components over the map                 ← never imports map/
src/map           MapLibre: setup, sources, layers, sprites,      ← never imports ui/
                  route layer, me-marker, camera
src/app           wiring for map.html (the only place ui ↔ map meet)
src/landing       landing page (view SSR'd at build time)
src/styles        tokens.css + Tailwind v4 entry + component CSS
```
**Rules.** They are enforced by `tests/unit/architecture.test.ts`, extended for the new folders.
1. A module imports only from layers above it in the diagram.
2. `domain/`, `routing/`, `presentation/` and `navigation/` never touch the DOM or `maplibre-gl`.
3. `ui/` and `map/` don't import each other. They meet only through `state/` signals and the wiring in `src/app/`.
4. Ported files keep their paths (`src/domain/search.ts` …), so a diff with the live app stays readable.

## 3. Folder tree
```
data/ scripts/ public/ docs/                 ported + new docs
src/
  data/ domain/ routing/ location/ i18n/     ported
  i18n-next/     strings.ts — strings the live app never had, in the 26 languages (checked first by ui/i18n)
  presentation/  marker-look.ts  search-view.ts (groups, 8 shown, highlight)  icons.ts
  navigation/    tracker.ts (ported logic)  steps.ts
  state/         store.ts (signals: filter, sub-filters, typed/query, selected, sheet, travel, level, toast, recent, weather)  persist.ts (localStorage, try/catch)
  ui/
    kit/         Button IconButton Chip Toggle FloorSwitch Toast Skeleton Icon Ring
    shell/       TopBar SearchBar CategoryRow SubFilters MapControls WeatherChip
    sheet/       BottomSheet (spring) PlaceCard RouteCard StepBanner ArrivalCard GarageAsk
    search/      SearchArea (debounce 200 ms, ↑↓ Enter Esc, grouped results, recent searches)
    rawdah/      RawdahCard
    stories/     StoryViewer + stories.css (lazy chunk, loaded on first open)
    library/     Library + library.css (lazy chunk, with its texts: domain/mosque-places)
    admin/       AdminPanel (lazy chunk, only with ?admin=1)
    lang/        LanguageMenu
    rawdah/      RawdahCard, RawdahHost (30 s refresh; reports its height for the map's buttons)
  map/
    setup.ts       map, Esri + light raster sources, bounds, attribution, scale, rotation, compass
    zoom.ts        legacyZoom() — the one bridge between MapLibre zoom and the app's Leaflet-era thresholds
    pois.ts        one GeoJSON source, layers, filter expressions, feature-state (selected / closed)
    sprites.ts     icons, number chips and Arabic labels drawn once to canvas → map.addImage
    women-areas.ts fill layer from routing.json
    route.ts       base / focus / alternatives / arrows / car-park casings / markers (as built: layers exist only while a route is shown, and only those it needs)
    me.ts          visitor dot (one DOM marker), glide, heading cone; accuracy as a GPU circle layer
    camera.ts      fly/fit with safe insets for top bar and sheet; reduced motion
  app/            map-main.tsx (entry: engine, store → map effects, ?poi=) · App.tsx (everything over the map) · trip.ts (location on demand, plans, re-route, switch, way out, car park question, live navigation)
  landing/        view.ts (pure HTML string, prerendered in Arabic at build) · main.ts (no framework: theme, language, copy/share/PNG, install) · qr.ts (ported) · landing.css
  styles/         tokens.css · base.css · …
  design/         /design gallery (dev only, never in the production build)
tests/unit/  tests/e2e/  scripts/perf.mjs
```

## 4. Key flows
- **Filter / search → map.**
  - `ui` writes `filter` / `query` signals.
  - `app` computes `visiblePois()` (ported) into a `Set<number>` of ids.
  - `map/pois` applies one `setFilter(['in', ['get','id'], ['literal', ids]])` per layer.
  - Nothing is rebuilt and no GeoJSON is re-uploaded. Each change is O(n) once, not per frame.
- **Marker look.**
  - The look comes from `presentation/marker-look.ts` (ported rules: tier by zoom, 8/14/20 px, 4/5 px when zoomed out, gate chips from 17, inner numbers and names from 19, gold halo for the 9 must-visit sites, lock for subscriber lots).
  - It is baked into feature properties once at load, and expressed as zoom `step`/`interpolate` expressions.
  - The GPU does the rest.
- **Selection.**
  - Triggered by a marker tap, a search result or `?poi=ID`.
  - `selected` signal → `feature-state` on the place, and a filter that hides the other places (current behaviour).
  - `camera.flyTo` into the visible gap between the top bar and the sheet, and the sheet springs to half.
  - As built (phase 4): `App.select()` sets `selected` and `sheet`; an effect in `map-main` calls `engine.select(id)` (a `selected` layer with the pin, every other layer filtered off) and `engine.focus(id, {top, bottom})` uses MapLibre camera padding (top bar bottom + 8, half-sheet height). Closing the card also clears the search (owner, 2026-10-14).
  - A map tap: the engine picks the nearest marker within 16 px and sends `map-tap`; nothing near → the card closes.
  - `?poi=ID` is read once in `map-main` and handed to `App` as `initial`, opened when the card is mounted (an event sent earlier was lost: a race seen in the e2e run).
- **Route (as built, phase 5).**
  - `app/trip.ts` holds the trip: the live app's drawRoute / showPlans / pickRoute / re-route / switch / way-out wiring, unchanged in what it decides.
  - It writes the `route` (summary), `nav` (tracker snapshot) and `garageQ` (the car park question) signals; `ui/route/` (RouteCard, NavBar, GarageAsk) renders them; `map/route.ts` draws.
  - The car park question is a Promise answered by the UI (no DOM in the trip).
  - Camera: `fitBounds` after the sheet has settled to its fitted height (the sheet's `fit` mode: content height, ≤ 45% of the screen); padding is reset first, because MapLibre adds fitBounds' padding to the current one.
  - Nav types the UI needs (`StepView`, `NavView`, `STATE_LABEL`) live in `presentation/route-view.ts`, so ui/ never imports navigation/. The architecture test now also checks `.tsx` files.
- **Route.**
  - The sheet's button triggers a location request, only now.
  - In or by the car park, `GarageAsk` asks where the car is.
  - `routing/plan.planRoutes` is lazy-imported on the first route.
  - `map/route.show(plans)` draws the route, and `navigation/tracker` starts.
  - Snapshots go to the `nav` signal, so the UI counters and the step banner update and `map/route.focus(ahead150)` follows.
  - Updating the "ahead" line is a `setData` on a ≤150 m line: tiny and bounded.
- **Deep links (as built).** `map-main` reads `?poi=`, `?visit=`, `?lib=`, `?admin=1` once and hands them to `App` as props, opened when it mounts (events sent earlier were lost, phase 4).
- **Landing and PWA (phase 7).** `vite.config.ts`:
  - `prerenderLanding` writes the Arabic landing into index.html.
  - `inlineCss` puts each page's CSS in its HTML.
  - `VitePWA` precaches the shell (both pages, chunks, Arabic/Latin fonts), never map tiles or story photos.
  - `app/pwa.ts` registers the service worker from each page; updates apply on the next visit.
- **Lazy parts.** `App` loads the stories, the library and the admin panel with dynamic `import()` on first use; their CSS is imported by the component, so Vite splits it with them.
- **Language.**
  - Changing the `lang` signal sets `<html lang/dir>`, and the UI re-renders.
  - The map relabels: only the label sprites of the new language are drawn.
  - No reload.

## 5. Map: decisions and known pitfalls
- **Zoom scale.** MapLibre's world is 512 px at zoom 0. With 256 px raster tiles, MapLibre zoom = Leaflet zoom − 1.
  - Every threshold in the ported rules is a *Leaflet* zoom: default 17, max 19, 16/15/14 shrink steps, 17 gate chips, 18 pair numbers, 19 inner names.
  - They all pass through `legacyZoom()` in `map/zoom.ts`.
  - A test checks that the opening view frames the same outer-gate bounds as the live app.
- **Base layers.** Raster Esri (`tileSize: 256`, `maxzoom` 19 in tile terms) and OSM light.
  - Attribution is always visible: «Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics» + «© OpenStreetMap».
  - The first tiles are preloaded in `map.html` before JS, as in the live app, recomputed for MapLibre's scale.
- **Labels and marker images.** No external glyph server and no text layers. Every marker (dots, icon discs, number chips, car-park chips, must-visit badges with their halo, pair numbers, gate-name labels) is an image drawn on a canvas in the live app's shapes (`map/images.ts`), with the app's fonts, so the browser shapes Arabic. An image is drawn the first time the map needs it (`map.setMissingStyleImageResolver`, MapLibre 6; the old `styleimagemissing` event can no longer supply one), and the rest are drawn ahead in idle time. Image ids end in `@<version>`; a theme or language change bumps the version and the layers ask for fresh images.
- **Marker rules.** `presentation/marker-look.ts` turns each place into feature properties (kind, colour token, icon, image key); a unit test checks it agrees with the live app's `markerSpec` for all 324 places. Facility markers never collide (`icon-allow-overlap` + `icon-ignore-placement`: nothing is merged or hidden); only outer-gate chips and gate-name labels collide, as the live app declutters them.
- **Worker.** MapLibre 6 runs its worker from a separate module: `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` + `setWorkerUrl(workerUrl)`, so Vite bundles it with its shared chunk. Version 6 has no default export: import by name.
- **Rotation.** Two-finger rotate and the ±15° buttons.
  - The compass needle follows true north, with the Kaaba mark toward the qibla.
  - Pitch is locked to 0 (SPEC §9-6).
- **Routes.**
  - Line layers with `lineMetrics: true`; the draw-in animates the `line-gradient` progress.
  - Level A gets a yellow casing; ramps get a yellow (up) or green (down) casing.
  - Arrows are a symbol layer with `symbol-placement: line`, spacing ≈ 55 m converted per zoom.
  - Alternatives are faint lines with a wide invisible hit line and a time label.
- **Map buttons.** As in the live app, whatever the language: zoom and rotation on the right, the other buttons (base map now; stories, library, my location later) on the left. +15° turns the map clockwise (MapLibre bearing −15); the compass needle shows where north is on screen.
- **Visitor dot.** One DOM marker, glide 900 ms ease-out.
  - The accuracy circle is a GeoJSON circle (fill).
  - The heading cone is compensated for bearing.
- **Marker pop-in.** A new filter (or markers shown again) fades the marker layers in: opacity 0 for one frame, then a 200 ms paint transition back to 1 (`MapEngine.pop`, the live app's `.mk-pop`). Only on a tap, never during a gesture; skipped with reduced motion. The nine must-visit sites and the open card's pin do not fade.
- **Trip mode and heading-up (2026-10-17).**
  - **Trip mode:** while a route shows, `.map-page[data-trip]` (set once when the route starts or ends, by an effect in `map-main.tsx`) slides the top bar and fades the left column and the zoom and turn buttons. The compass stays. The sheet steps down to a peek that ends under the card's `[data-peek-end]` (the route's distance and time).
  - **Heading-up:** `Trip.follow` sets the camera's bearing to the direction of the next 40 m of the route (`tracker.ahead`) and ignores turns under 6°. When the mode is turned on, the follows zoom to street level until the map is there. The visitor sits in the lower part of the view (extra top padding). The setting is the `headingUp` signal (`state/store.ts`, key `heading-up`).
- **Gesture hygiene.**
  - Nothing toggles classes on `<body>` during gestures.
  - No `backdrop-filter`.
  - No `move` listeners doing O(n) work.
  - UI panels are near-opaque (≥ 95%).

## 6. Dependencies (each with its reason; sizes are measured in Phase 1)
| Package | Why | Status |
|---|---|---|
| `maplibre-gl` 6.11.0 | WebGL map: markers on the GPU instead of ~300 DOM nodes; shapes Arabic itself (no glyph server) | approved 2026-10-16 · ≈ 285 KB + worker ≈ 143 KB gzip (`docs/spikes/2026-10-16-maplibre.md`) |
| `preact` 10.29.8 + `@preact/signals` 2.11.3 | component UI with fine-grained updates | approved 2026-10-16 · ≈ 8.7 KB gzip together |
| `vite`, `typescript`, `tailwindcss` + `@tailwindcss/vite`, `vite-plugin-pwa`, `workbox-window`, `vitest`, `@playwright/test` | build, styling, PWA, tests | as in the live app |
| `adhan`, `qrcode-generator`, `@fontsource/{noto-kufi-arabic, ibm-plex-sans-arabic, noto-naskh-arabic}` | Rawdah times, QR, fonts | as in the live app |
| ~~`leaflet`, `leaflet-rotate`, `@types/leaflet`~~ | — | removed |
Versions are pinned exactly (no `^`) and locked by `package-lock.json`. Only versions published at least two weeks earlier are used, unless a fix requires a newer one.

## 7. Code splitting and loading
- **Initial chunk:** app shell, map, top bar, category row, sheet and place card.
- **Lazy chunks:**
  - `routing`, together with `streets.json` and `garage.json`, on the first route.
  - `search` palette, on first focus.
  - `stories`, `library` and `admin`.
- `i18n.json` (1.18 MB, all 26 languages) is split at build time into one file per language. Only the visitor's language loads; the tests keep reading the original file.
  - As built (phase 8): the `splitI18n` plugin serves `data/i18n.json` and the four string modules of `src/i18n` with Arabic and English in full, plus name/short/dir for the other 24. Each of those becomes `i18n/<code>.json`.
  - `src/i18n-next/load.ts` fetches the visitor's file and merges it into the packs `src/i18n` built, which `pack()` returns by reference.
  - The page awaits this before its first draw, and again on a language change. The service worker precaches the 24 files.
- Fonts use `font-display: swap`, with Arabic + Latin subsets precached and other scripts on demand.

## 8. Integration points (unchanged)
- Deep links: `map.html?poi=<id>`, `?visit=<id>`, `?lib=<id>`, `?admin=1` (asks for the supervisor password), `?lang=<code>`.
- The supervisor's page: «ADMIN» typed in the search box offers it, then `ui/admin/AdminGate.tsx` asks for the password, checked against a SHA-256 in `state/admin.ts`. This hides the page; it is not protection, as the check runs in the browser. Changes stay on that device until a server exists.
- Works inside a WebView: no cookies, no login, no server.
- Plain JSON data with stable ids.
- Site config lives in `src/config/site.config.ts`: site URL, QR, light tiles, organisation name.
- New data added by «next» (the live app's `data/` stays as it is) lives in `src/data-next/`. It imports nothing but types: first `car-entrances.ts`, three new vehicle entrances to the car park. They are shown by the map's `car-entrances` layer (with the parking pill only), and their open/closed state is `state/entrances.ts`, changed from the supervisor's page.
- Hosting: static files from `dist/`. `vercel.json` sets the Vite build for a new, separate Vercel project, `sw.js` uncached and hashed assets immutable (README «النشر»).

## 9. Quality gates
- `npm test`: Vitest, the ported unit tests + parity + new presentation, state and sheet-physics tests.
- `npm run test:e2e`: Playwright on the production build at phone size. The live app's journeys are rewritten one by one (`docs/PARITY.md`).
- `npm run build`: type-check + build.
- `npm run perf`: main-thread budgets (SPEC §6); frame times on a real device (`docs/CHECKLIST.md`, step 11).
