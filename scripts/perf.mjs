// Performance budget (docs/SPEC.md §6): pan, zoom and rotate the map on a phone with the CPU slowed
// 4× and report the main-thread cost. Runs against the production build (vite preview).
//
//   npm run perf            (builds first)
//   node scripts/perf.mjs   (uses the existing dist/)
//
// Enforced here (SPEC §6, owner's decision 2026-10-16): no long task over 50 ms while panning or
// rotating, nor over 100 ms while zooming; and the markers add at most 5 ms (p50) to the JavaScript
// of each frame over MapLibre's own floor — the imagery alone, measured in the same run.
// Frame times are printed for comparison only: this container draws WebGL in software
// (SwiftShader), so they say nothing about a phone's GPU; those are measured on a real device
// (docs/PERF.md).
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright-core';

const PORT = 4180;
const THROTTLE = 4;
const BUDGET = { longTaskMs: { pan: 50, rotate: 50, zoom: 100 }, overheadP50Ms: 5 };
// $CHROME if given, else the container's Chromium 1194 if present, else Playwright's own browser.
const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME ?? (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/map.html`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const T0 = Date.now();
const log = (m) => process.env.PERF_DEBUG && console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

async function main() {
  log('start');
  await waitForServer();
  log('server up');
  // ANGLE's SwiftShader backend draws in the GPU process, as a phone's GPU does. Chromium's default
  // software path here (Vulkan SwiftShader) rasterises on the page's own thread instead: 21 s of
  // native main-thread time for two drags, which is this container, not the app (docs/PERF.md).
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  log('browser');
  async function measure(query) {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    // Tiles from the network would make timings depend on the connection: serve a small tile.
    const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    await context.route(/arcgisonline|openstreetmap|cartocdn/, (r) => r.fulfill({ contentType: 'image/png', body: PIXEL }));
    // Time every animation-frame callback, grouped by frame: the JS a frame costs.
    await context.addInitScript(() => {
      const w = window;
      w.__frameJs = [];
      w.__rec = false;
      let frameTs = -1;
      let acc = 0;
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (cb) =>
        raf((ts) => {
          if (ts !== frameTs) {
            if (w.__rec && frameTs >= 0) w.__frameJs.push(acc);
            frameTs = ts;
            acc = 0;
          }
          const t0 = performance.now();
          try {
            cb(ts);
          } finally {
            acc += performance.now() - t0;
          }
        });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Extra query for experiments: PERF_QUERY='gjz=14&fade=0' (see src/map/engine.ts).
    await page.goto(`http://localhost:${PORT}/map.html${query ? `?${query}` : ''}`);
    log('goto');
    await page.waitForFunction(() => window.__engine?.map?.loaded() && window.__engine.map.getLayer('facilities'));
    // 'idle' fires once the map is settled; ask for one more frame so it fires even if it already is.
    await page.evaluate(() => new Promise((r) => (window.__engine.map.once('idle', r), window.__engine.map.triggerRepaint())));
    // PERF_ROUTE=1: measure while a walking route is drawn and followed (phase 5: the route's layers
    // exist only then), from the west plaza to restroom 204, the live app's e2e trip.
    if (process.env.PERF_ROUTE && !query.includes('layers=base')) {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: 24.4685, longitude: 39.6084, accuracy: 15 });
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('open-place', { detail: window.__engine.poi(204) })));
      await page.locator('.pc-actions .btn-block').click();
      await page.locator('.route-card').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      log('route drawn');
    }
    await page.waitForTimeout(800);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    log('throttled');

    await page.evaluate(() => {
      const w = window;
      w.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
      w.__frames = [];
      let last = performance.now();
      const tick = (t) => {
        if (w.__rec) w.__frames.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const begin = () => page.evaluate(() => ((window.__long = []), (window.__frames = []), (window.__frameJs = []), (window.__rec = true)));
    const end = () => page.evaluate(() => ((window.__rec = false), { long: window.__long, frames: window.__frames, js: window.__frameJs }));

    const box = await page.locator('#map').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.55;
    const results = {};

    // Pan: drag the map around several times (at zoom 17, where the most markers and chips show).
    await page.evaluate(() => window.__engine.map.jumpTo({ zoom: 16 }));
    await page.waitForTimeout(800);
    await begin();
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let s = 1; s <= 20; s++) await page.mouse.move(cx + (i % 2 ? -1 : 1) * s * 6, cy + s * 4, { steps: 1 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }
    results.pan = await end();
    log('pan done');

    // Zoom: out and back in with the zoom buttons (animated), across the marker tiers.
    await begin();
    const zin = page.locator('.map-overlay .mc-group').first().locator('button').first();
    const zout = page.locator('.map-overlay .mc-group').first().locator('button').nth(1);
    // With a route the zoom and turn buttons step aside (trip mode): the same calls they make.
    const trip = await page.evaluate(() => document.querySelector('.map-page')?.hasAttribute('data-trip'));
    for (const [b, step] of [
      [zout, -1],
      [zout, -1],
      [zin, 1],
      [zin, 1],
      [zin, 1],
      [zout, -1],
    ]) {
      if (trip) await page.evaluate((s) => window.__engine.zoomBy(s), step);
      else await b.click();
      await page.waitForTimeout(450);
    }
    results.zoom = await end();
    log('zoom done');

    // Rotate: the rotation buttons, several steps each way.
    await begin();
    const rot = page.locator('.map-overlay .mc-group').nth(1).locator('button');
    for (const [btn, deg] of [
      [rot.first(), 15],
      [rot.last(), -15],
    ])
      for (let i = 0; i < 6; i++) {
        if (trip) await page.evaluate((d) => window.__engine.turn(d), deg);
        else await btn.click();
        await page.waitForTimeout(300);
      }
    results.rotate = await end();
    log('rotate done');

    await context.close();
    return results;
  }

  log('full map');
  const full = await measure(process.env.PERF_QUERY ?? '');
  log('floor (imagery only)');
  const floor = await measure('layers=base');
  await browser.close();
  stop();

  let ok = true;
  console.log(
    `CPU throttle ${THROTTLE}x · Pixel 7 · budget: long task ≤ 50 ms (pan, rotate), ≤ 100 ms (zoom); markers add ≤ ${BUDGET.overheadP50Ms} ms JS per frame (p50) over MapLibre alone`,
  );
  console.log('(frame times: software WebGL in this container — for comparison only)\n');
  console.log('gesture  frames  JS/frame p50  p95  | floor p50  p95 | markers +p50 | long tasks  longest ms | frame p50  p95 ms');
  for (const [name, r] of Object.entries(full)) {
    const f = floor[name];
    const over = pct(r.js, 0.5) - pct(f.js, 0.5);
    const longest = r.long.length ? Math.max(...r.long) : 0;
    const pass = over <= BUDGET.overheadP50Ms && longest <= BUDGET.longTaskMs[name];
    ok &&= pass;
    console.log(
      `${name.padEnd(8)} ${String(r.js.length).padStart(6)} ${pct(r.js, 0.5).toFixed(2).padStart(12)} ${pct(r.js, 0.95).toFixed(1).padStart(5)} | ${pct(f.js, 0.5).toFixed(2).padStart(9)} ${pct(f.js, 0.95).toFixed(1).padStart(5)} | ${over.toFixed(2).padStart(12)} | ${String(r.long.length).padStart(10)} ${longest.toFixed(0).padStart(11)} | ${pct(r.frames, 0.5).toFixed(1).padStart(9)} ${pct(r.frames, 0.95).toFixed(1).padStart(6)}  ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  stop();
  process.exit(2);
});
