// Dark-theme captures of the current app (main) for the v2 film. Run from an app checkout with `npx vite` on :5173:
//   node capture-v2.mjs <out-dir>
// External hosts (map tiles, weather) are blocked in the build environment, so the map shows its dark background.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const W = 420, H = 853, DPR = 3;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function open(url, { geo = false, travel = 'walk' } = {}) {
  const c = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true,
    timezoneId: 'Asia/Riyadh', colorScheme: 'dark', serviceWorkers: 'block',
    geolocation: geo ? { latitude: 24.4668, longitude: 39.6111, accuracy: 8 } : undefined,
    permissions: geo ? ['geolocation'] : [],
  });
  await c.addInitScript((tr) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lang', 'ar'); localStorage.setItem('travel', tr); }, travel);
  await c.route('**/*', (r) => (new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort()));
  const p = await c.newPage();
  // 21:00 Madinah time: the Rawdah card reads «الآن: وقت النساء».
  await p.clock.setFixedTime(new Date('2026-10-11T21:00:00+03:00'));
  await p.goto(BASE + url);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  return [c, p];
}
const snap = async (p, n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('ok', n); };
const pick = async (p, q) => { await p.fill('#q', ''); await p.type('#q', q, { delay: 50 }); await p.waitForTimeout(500); await p.press('#q', 'Enter'); await p.waitForTimeout(1500); };
const close = async (p) => { const b = p.locator('.sheet [data-act="close"]').first(); if (await b.count()) { await b.click(); await p.waitForTimeout(500); } };
const pill = async (p, f) => { await p.locator(`.pill[data-f="${f}"]`).click(); await p.waitForTimeout(1200); };

// Landing page: hero, numbers, quick-share QR.
let [c, p] = await open('/');
await snap(p, 'L-hero');
await p.locator('.stats').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -260)); await snap(p, 'L-stats');
await p.locator('.qr-panel').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -40)); await snap(p, 'L-qr');
await c.close();

// Map: search, gate cards, Rawdah schedule, filters, language menu.
[c, p] = await open('/map.html');
await snap(p, 'M-map');
await p.type('#q', '17', { delay: 60 }); await p.waitForTimeout(700); await snap(p, 'M-search-17');
await p.press('#q', 'Enter'); await p.waitForTimeout(1500); await snap(p, 'M-gate17'); await close(p);
await pick(p, '37'); await p.evaluate(() => document.querySelector('.sheet .sheet-grab')?.click()); await p.waitForTimeout(900); await snap(p, 'M-gate37-full'); await close(p);
await p.fill('#q', ''); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
for (const f of ['women', 'toilets', 'hotels', 'food', 'parking', 'emergency', 'historic']) { await pill(p, f); await snap(p, `M-f-${f}`); }
await pill(p, 'all');
await p.click('#lang-btn'); await p.waitForTimeout(500); await snap(p, 'M-lang-menu');
await c.close();

// Walking route from the south plaza to Gate 17, then by car.
[c, p] = await open('/map.html', { geo: true });
await pick(p, '17'); await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(3500); await snap(p, 'M-route-walk-17');
await c.close();
[c, p] = await open('/map.html', { geo: true });
await pick(p, '333'); await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(3500); await snap(p, 'M-route-walk-333');
await c.close();
[c, p] = await open('/map.html', { geo: true, travel: 'drive' });
await pick(p, '17'); await snap(p, 'M-drive-card'); await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(3500); await snap(p, 'M-route-drive-17');
await c.close();

// Landmark stories (Arabic originals only).
for (const id of [542, 531, 516, 544]) { [c, p] = await open(`/map.html?visit=${id}`); await p.waitForTimeout(1200); await snap(p, `S-${id}`); await c.close(); }
await browser.close();
