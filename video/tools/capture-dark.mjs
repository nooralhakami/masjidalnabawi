// Dark-theme interaction shots (search, gate sheets, Rawdah schedule, route, language menu) to match the owner's phone shots.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist'), OUT = path.join(ROOT, 'video/assets/screens-dark');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const W = 420, H = 853, DPR = 3; // 1260×2559 ≈ the owner's cropped phone shots (1260×2560)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
async function open(lang = 'ar', geo = false) {
  const c = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, timezoneId: 'Asia/Riyadh', colorScheme: 'dark', serviceWorkers: 'block', geolocation: geo ? { latitude: 24.4663, longitude: 39.61, accuracy: 8 } : undefined, permissions: geo ? ['geolocation'] : [] });
  await c.addInitScript((lg) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lang', lg); }, lang);
  await c.route('**/*', (r) => { const u = new URL(r.request().url());
    if (u.hostname === 'app.local') { const f = path.join(DIST, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname)); return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: MIME[path.extname(f)] || 'application/octet-stream' }) : r.fulfill({ status: 404 }); }
    return r.abort(); });
  const p = await c.newPage(); await p.clock.setFixedTime(new Date('2026-10-05T05:00:00Z'));
  await p.goto('https://app.local/map.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1200);
  // Owner's decision: avoid showing the app's duplicated gate description (the same text appears under the title
  // and again under «سبب التسمية»). Only the first copy is hidden in the video captures; the app code is untouched.
  if (process.env.HIDE_DUP !== '0') await p.addStyleTag({ content: '.sh-desc:has(+ .gate-about){display:none}' });
  return [c, p];
}
const snap = async (p, n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('ok', n); };
const pick = async (p, q) => { await p.fill('#q', ''); await p.type('#q', q, { delay: 50 }); await p.waitForTimeout(500); await p.press('#q', 'Enter'); await p.waitForTimeout(1500); };
const close = async (p) => { await p.locator('.sheet [data-act="close"]').first().click(); await p.waitForTimeout(500); };
let [c, p] = await open();
await p.type('#q', '17', { delay: 60 }); await p.waitForTimeout(600); await snap(p, 'D-search-17');
await p.press('#q', 'Enter'); await p.waitForTimeout(1500); await snap(p, 'D-gate17'); await close(p);
await pick(p, '39'); await snap(p, 'D-gate39'); await close(p);
await pick(p, '1'); await snap(p, 'D-gate1'); await close(p);
await pick(p, '37'); await p.evaluate(() => document.querySelector('.sheet .sheet-grab').click()); await p.waitForTimeout(800); await snap(p, 'D-gate37-full'); await close(p);
await pick(p, '604'); await snap(p, 'D-604'); await close(p);
await p.fill('#q', ''); await p.keyboard.press('Escape'); await p.click('#lang-btn'); await p.waitForTimeout(400); await snap(p, 'D-lang-menu');
await c.close();
[c, p] = await open('ar', true);
await pick(p, '17'); await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(2800); await snap(p, 'D-route-17');
await c.close();
for (const lg of ['en', 'tr', 'ur', 'id', 'uz']) { [c, p] = await open(lg); await pick(p, '17'); await snap(p, `D-gate17-${lg}`); await c.close(); }
await browser.close();
