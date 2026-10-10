// Performance budget check (SPEC F13): pan, zoom and rotate the map on a slowed-down phone and
// report frame times and long tasks. Runs against the production build (vite preview).
//
//   npm run perf            (builds first)
//   node scripts/perf.mjs   (uses the existing dist/)
//
// Budget: no long task > 100 ms during gestures; 95% of frames < 33 ms on a 4x-throttled CPU.
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const PORT = 4180;
const THROTTLE = 4;
const BUDGET = { longTaskMs: 100, p95FrameMs: 33 };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/map.html`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

async function main() {
  await waitForServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  // Tiles from the network would make timings depend on the connection: serve a blank tile.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await context.route(/arcgisonline|openstreetmap|cartocdn/, (r) => r.fulfill({ contentType: 'image/png', body: PIXEL }));
  await context.route(/open-meteo/, (r) => r.fulfill({ contentType: 'application/json', body: '{"current":{"temperature_2m":30,"weather_code":0,"is_day":1}}' }));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/map.html`);
  await page.waitForSelector('.mk');
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // Collect long tasks and frame intervals in the page.
  await page.evaluate(() => {
    const w = window;
    w.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
    w.__frames = [];
    w.__rec = false;
    let last = performance.now();
    const tick = (t) => {
      if (w.__rec) w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const begin = () => page.evaluate(() => ((window.__long = []), (window.__frames = []), (window.__rec = true)));
  const end = () => page.evaluate(() => ((window.__rec = false), { long: window.__long, frames: window.__frames }));

  const box = await page.locator('.leaflet-container').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.55;
  const results = {};

  // Pan: drag the map around several times.
  await begin();
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let s = 1; s <= 20; s++) await page.mouse.move(cx + (i % 2 ? -1 : 1) * s * 6, cy + s * 4, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  results.pan = await end();

  // Zoom: out and back in with the zoom buttons (animated).
  await begin();
  const zin = page.locator('.mc-zoom .mc-btn').first();
  const zout = page.locator('.mc-zoom .mc-btn').nth(1);
  for (const b of [zout, zout, zin, zin, zin, zout]) {
    await b.click();
    await page.waitForTimeout(450);
  }
  results.zoom = await end();

  // Rotate: the rotation buttons, several steps each way.
  await begin();
  const rot = page.locator('.mc-rotate .mc-btn');
  for (let i = 0; i < 6; i++) {
    await rot.first().click();
    await page.waitForTimeout(200);
  }
  for (let i = 0; i < 6; i++) {
    await rot.last().click();
    await page.waitForTimeout(200);
  }
  results.rotate = await end();

  await browser.close();
  stop();

  let ok = true;
  console.log(`CPU throttle ${THROTTLE}x · Pixel 7 · budget: long task ≤ ${BUDGET.longTaskMs} ms, p95 frame ≤ ${BUDGET.p95FrameMs} ms\n`);
  console.log('gesture  frames  p50 ms  p95 ms  max ms  long tasks  longest ms');
  for (const [name, r] of Object.entries(results)) {
    const p95 = pct(r.frames, 0.95);
    const longest = r.long.length ? Math.max(...r.long) : 0;
    const pass = p95 <= BUDGET.p95FrameMs && longest <= BUDGET.longTaskMs;
    ok &&= pass;
    console.log(
      `${name.padEnd(8)} ${String(r.frames.length).padStart(6)} ${pct(r.frames, 0.5).toFixed(1).padStart(7)} ${p95.toFixed(1).padStart(7)} ${Math.max(0, ...r.frames).toFixed(0).padStart(7)} ${String(r.long.length).padStart(11)} ${longest.toFixed(0).padStart(11)}  ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  stop();
  process.exit(2);
});
