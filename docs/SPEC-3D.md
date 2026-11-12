# SPEC-3D — the 3D view and step-free routing, as built

> Restored and written [2026-11-12] (Phase 0, G14): the code has referenced this file since the
> 3D view and the accessible route were built, but it was never deposited. It records **what is
> implemented today**, nothing more. The upgrade beyond it (floors, crowds, prayer, surroundings)
> is governed by the owner-approved comprehensive plan (2026-11-12) and its decision gates D1–D10.

## §1. The 3D view mode

- **State.** `view3d` signal (`state/store.ts`). The map page opens in 3D at once unless `?view=2d`
  (owner, 2026-11-06; `app/map-main.tsx`). The layers button steps 3D → satellite → light
  (`NEXT_VIEW`, `ui/shell/MapControls.tsx`); stepping back to «3D» re-enters the mode.
- **Camera (`MapEngine.toggle3DMode`, `map/engine.ts`).**
  - On: `maxPitch` 85°, `maxZoom` 22 (`MAX_ZOOM_3D`, close enough for the models' detail, owner
    2026-11-07), touch pitch enabled, then `easeTo` pitch 45° / bearing 22° over 1000 ms.
  - Off: touch pitch disabled, `easeTo` pitch 0° / bearing 0° over 800 ms with the zoom clamped to
    the live app's maximum; when the move ends, pitch is locked to 0° again (SPEC §9-6) and the
    flat zoom limit returns.
  - Reduced motion (or `instant`): both moves take 0 ms.
- **What the mode draws (`sync3DLayer` and the custom layers).** Under the markers:
  - `alharamain-3d-ground`: a background of the hour's ground colour where imagery has not loaded;
  - near imagery, the plaza sectors' official colours (`alharamain-plaza` fill, navQ);
  - the plazas' paving in WebGL2 (`PlazaMarbleLayer`), the prayer carpets (`RugLayer`, laid whole
    by `map/rug-layout.ts` toward the qibla, bearing 176.24° — D5), the lamps' pools of light;
  - the green barriers round the courtyards' prayer areas and the beige panels round the women's
    areas (fill-extrusion, about 1 m / 1.1 m high);
  - the models (`HaramGlbLayer`: the Mosque, 243 canopies, the outer fence, the restroom blocks —
    `data-next/alharamain-3d.ts`), the mountains (`TerrainLayer`, SRTM), the lanterns' halos at
    night (`LampGlowLayer`), and the crowd (`CrowdLayer`).
- **The metric frame.** Every model stands in Web Mercator metres about the Mosque's anchor
  [39.611752, 24.466806], x east, y south — defined with the walk frame and the conversions
  between them in `domain/frames.ts` (D6). The flat map's routing keeps the ported walk frame.

## §2-a. Step-free accessible routing

- **State.** `accessibleRoute` signal, persisted (`accessible-route` = '1'). The plan carries
  `accessible: true` and, when one is found, `accessibleNode` (`routing/plan.ts`).
- **Pace.** 60 m/min (`ACCESSIBLE_WALK_M_PER_MIN`, `routing/accessible.ts`) vs the standard 80.
- **The vertical nodes** (`data-next/vertical-nodes.ts`): 99 nodes extracted from Al-Haramain
  navQ's `vertical_nodes.geojson` — 16 elevators, 80 escalators, 3 accessible gates. Each carries
  `id`, `type`, `venueId` (4 the Mosque, 20 the courtyards), `floorId` (12/24 the Mosque's levels,
  94/95 the courtyards'), position, and `closed` (all open today).
- **Choosing a node** (`nearestVerticalNode`): open elevators and escalators within 120 m by
  default, nearest first; an elevator is preferred when it stands within 35 m, or within 15 m of
  the nearest escalator.
- **A parking lot's entrance** (`pickAccessibleEntrance`): among the lot's entrances, the walk
  distance minus a bonus for the entrance's own node (elevator 80 m, escalator 30 m; nodes sought
  within 40 m, venue 20).
- **A destination's node** (`accessibleNodeForPoi`): venue by kind (inner gates → 4, toilets and
  parking → 20), within 80 m, else any within 250 m. When the node stands 4–35 m from the
  destination it becomes a waypoint (`via`) the route passes through.
- **Limits as built.** The nodes carry floor ids, but the routing graph is still the ground's:
  no route yet climbs between floors, and the floor switcher does not exist. Multi-floor routing
  on the 99 nodes' edges is Phase 1 of the comprehensive plan. Three route expectations remain
  deferred as `it.fails` (owner, 2026-11-08, `docs/DECISIONS.md`): two ways from the east street to
  restroom 233, east plaza → 327 within the same bound, and the north line inside gates 364–355.

## Sources

- navQ (`vertical_nodes.geojson`, the venues and their 3D models): the owner's permission document
  is pending deposit (D8); extraction and redistribution of Mapbox content remain prohibited.
- SRTM terrain: public domain. The fence line: the Authority's PDF, via the owner (2026-11-08).
- The qibla bearing 176.24°: the great circle from the Haram to the Kaaba (21.4225 N, 39.8262 E),
  checked in `tests/unit/frames.test.ts`.