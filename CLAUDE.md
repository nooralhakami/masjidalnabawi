# CLAUDE.md — rules for anyone (AI or human) changing this project

Read first: `SPEC.md` (what the app must do — binding) → `ARCHITECTURE.md` (where things live, dependency rule).
The owner is not a programmer: explain changes in plain Arabic, one concept at a time.

## Stack & commands
- TypeScript + Vite, no framework. Leaflet + leaflet-rotate. Vitest, Playwright. Python 3 for data scripts.
- `npm ci` · `npm run dev` (http://localhost:5173/map.html) · `npm test` · `npm run test:e2e` · `npm run build` · `npm run perf`
- Deploy = push to GitHub `main` (Vercel builds it). **Only after the owner says yes.**

## Definition of done
1. Unit tests, e2e tests and build all pass (paste the summary lines).
2. Visible changes checked in the browser at phone size (375×812), light and dark if styling changed.
3. Performance budget (SPEC F13) still met when touching map/markers/layers/CSS on the map.
4. Docs updated when behaviour or data changes (SPEC changelog, ARCHITECTURE, docs/*).
5. Small commits, one concern each, message explains *why*.

## Warnings — stop, warn the owner, wait for a yes (SPEC §7)
- Asking for location before a tap; storing or sending location.
- Changing owner decisions (gate names, parking access, restroom types, Rawdah schedule, approved coordinates).
- Adding religious/historic text not confirmed by two sources.
- Publishing to the live site.
- Copying data from Google Maps or Authority systems without written permission.
- Removing a feature, changing tested behaviour, or adding a new dependency.
- Putting any secret in front-end code.

## Code rules
- Respect the dependency rule in ARCHITECTURE.md; `domain/` and `routing/` stay pure (no DOM, no Leaflet).
- Every user-facing string in all 26 languages (`src/i18n/strings.ts`, `src/i18n/landing-strings.ts`, `data/i18n.json`; data texts of the 20 added languages come from `docs/translations/*.json` via `scripts/translations-to-i18n.py`); tests enforce it. Never hard-code Arabic/English text in components.
- Colours only via tokens in `src/styles/tokens.css`; logical CSS properties (RTL); digits stay Latin.
- The Haramain logo (used with the Authority's permission) is built from `docs/haramain-logo-source.jpg` by `scripts/logo-from-source.py` into a light and a dark transparent PNG; don't recolour it with CSS filters.
- Data: never hand-edit generated files (`streets.json`, `garage.json`, OSM-derived places) — change the script or its source and rebuild. Position nudges go in `data/overrides.json`.
- Map performance: no work proportional to all POIs on every frame; no `backdrop-filter`/blur work during map gestures; reuse markers instead of recreating them.
- Accessibility: real buttons/links, aria-labels on icon buttons, 40–44 px targets, contrast 4.5:1, respect `prefers-reduced-motion`.

## Lessons (mistakes not to repeat)
- v0 once left gate descriptions in Arabic in all languages and corrupted UTF-8 characters → tests now fail on both.
- OSM pedestrian ways often stop short at road crossings and some cut through hotel blocks → streets build links dead ends (35 m) and penalises unnamed footways.
- The nearest street node to a place can be on the wrong street → pick the best node within 150 m.
- A route's draw-in animation measured its length once and hid part of the line after zoom → `pathLength="1"`.
- Owner rejected merging markers into count bubbles: markers stay in place and shrink when zoomed out.
- The live domain is `masjidalnabawi.vercel.app` (not "masjidnabawi").
- Backdrop blur over the moving map stutters on phones; toggling many-selector classes on <body> per gesture costs a 50–60 ms restyle → panels are near-opaque without blur (docs/PERF.md).
- The language menu was cut off on a 360 px phone though it fitted at 375 px → check popovers at 320, 360, 375 and 412 px in an RTL and an LTR language; size them to the space left on screen. After CSS edits, if the dev preview looks unchanged, restart it (it can serve stale CSS); "Outdated Optimize Dep" errors mean clearing `node_modules/.vite`.
