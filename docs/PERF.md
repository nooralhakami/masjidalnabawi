# Performance log (SPEC F13)

Budget (measured by `npm run perf`: production build, Pixel 7 viewport, CPU throttled 4×, tiles stubbed):
no long task > 100 ms during gestures; 95% of frames < 33 ms; redraw after a move < 50 ms.

> Headless Chrome measures main-thread (CPU) cost well but not GPU cost (blur, large shadows), so
> GPU-heavy effects are judged by design rules (no backdrop blur over the moving map) and checked on a real phone.

## 2026-10-10 — smoothness pass 1

| Measure | Before | After |
|---|---|---|
| Marker redraw after a pan (desktop CPU, ~200 markers) | 5.4 ms — every marker rebuilt | 0.7 ms — markers reused, only those entering/leaving the view change |
| Marker redraw after a zoom step | ~5 ms | 1–3.6 ms (tier change rebuilds what changed look) |
| Redraws per zoom | 2 (`moveend` + `zoomend`) | 1 (`moveend` only) |
| Backdrop blur behind 9 kinds of glass panel | recomputed every frame while the map moves | removed; panels 95% opaque (visually near-identical) |
| Toggling effects at gesture start/end | (tried) style recalculation → long task ~53–63 ms | dropped: nothing to toggle except pausing the route's dash animation |
| Map tiles | `keepBuffer` 2, tiles fetched mid-zoom | `keepBuffer` 4, `updateWhenZooming: false` |
| `npm run perf` (pan / zoom / rotate) | p95 16.8 ms, 0 long tasks | p95 16.8 ms, 0 long tasks (no regression on CPU) |

Lesson: a class on `<body>` that many selectors depend on (especially attribute selectors such as
`[class*='pulse']`) makes the browser restyle the whole page each time it changes — avoid toggling
such classes on every gesture.

## 2026-10-11: glowing must-visit markers
Halo is a static radial-gradient (no blur/filter, no animation). In the cloud sandbox (software rendering, no tiles) `scripts/perf.mjs` gave pan p95 16.8 ms and rotate 16.8 ms (PASS) both with and without the change; zoom FAILED both before (p95 100 ms, 15 long tasks) and after (p95 83 ms, 11 long tasks), so the zoom number is the sandbox, not the change. Re-measure on a real phone/CI before publishing.
