// Captures real UI screenshots of the built app (dist/) at phone size for the promo video.
// Usage: npm run build && CHROME_PATH=/path/to/chrome node video/tools/capture-screens.mjs
// Env: W,H (CSS px, default 430x932), DPR (default 3), BLOCK_TILES=1 to skip map tiles.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'video/assets/screens');
const W = +(process.env.W || 430), H = +(process.env.H || 932), DPR = +(process.env.DPR || 3);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
// Madinah is UTC+3. 08:00 → women's Rawdah turn; 13:00 → men's.
const WOMEN_TIME = new Date('2026-10-05T05:00:00Z');
const GEO = { latitude: 24.4663, longitude: 39.61, accuracy: 8 };
const shots = [];

async function ctx(browser, { theme = 'light', lang = 'ar', geo = false, time = WOMEN_TIME } = {}) {
  const c = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', colorScheme: theme, serviceWorkers: 'block', geolocation: geo ? GEO : undefined, permissions: geo ? ['geolocation'] : [] });
  await c.addInitScript(([th, lg]) => { try { localStorage.setItem('theme', th); localStorage.setItem('lang', lg); } catch {} }, [theme, lang]);
  await c.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'app.local') {
      const f = path.join(DIST, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      return fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ body: fs.readFileSync(f), contentType: MIME[path.extname(f)] || 'application/octet-stream' }) : r.fulfill({ status: 404 });
    }
    if (process.env.BLOCK_TILES !== '0' && /arcgisonline|openstreetmap|cartocdn/.test(u.hostname)) return r.abort();
    return r.continue();
  });
  const p = await c.newPage();
  if (time) await p.clock.setFixedTime(time);
  return [c, p];
}
async function snap(p, name, desc) {
  if (ONLY && !ONLY.test(name)) return;
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  shots.push({ name, desc });
  console.log('ok', name);
}
const settle = (p) => p.evaluate(() => document.fonts.ready).then(() => p.waitForTimeout(800));
async function search(p, q) { await p.fill('#q', ''); await p.type('#q', q, { delay: 60 }); await p.waitForTimeout(500); }
async function pick(p, q) { await search(p, q); await p.press('#q', 'Enter'); await p.waitForTimeout(1400); }
async function close(p) { const b = p.locator('.sheet [data-act="close"]').first(); if (await b.isVisible()) await b.click(); await p.waitForTimeout(500); }
async function filter(p, f) { await p.click(`.pill[data-f="${f}"]`); await p.waitForTimeout(700); }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'app.local' } : undefined });
let c, p;

// ---- Landing (dark is the page's default) ----
for (const theme of ['dark', 'light']) {
  [c, p] = await ctx(browser, { theme });
  await p.goto('https://app.local/'); await settle(p);
  await snap(p, `L-${theme}-01-hero`, `الصفحة الرئيسية (${theme}): الشعار والعنوان وزرّا البدء والتثبيت`);
  for (const [id, n, d] of [['.stats', '02-stats', 'أرقام المعالم والبوابات واللغات'], ['#qr', '03-qr', 'لوحة الباركود والرابط'], ['#features', '04-features', 'المزايا'], ['#install', '05-install', 'طريقة التثبيت أندرويد/آيفون']]) {
    await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), id);
    await snap(p, `L-${theme}-${n}`, d);
  }
  await c.close();
}

// ---- Map (light, Arabic, women's Rawdah time) ----
[c, p] = await ctx(browser);
await p.goto('https://app.local/map.html'); await settle(p);
await snap(p, 'M-01-all', 'الخريطة: الكل، البحث، التصنيفات، بطاقة الروضة');
await filter(p, 'gates'); await snap(p, 'M-02-gates', 'تصنيف بوابات الحرم (خارجية وداخلية)');
await filter(p, 'women'); await snap(p, 'M-03-women', 'الخدمات النسائية: أبواب القسم النسائي ودوراته ومصلياته');
await filter(p, 'toilets'); await snap(p, 'M-04-toilets', 'دورات المياه');
await filter(p, 'wheelchair'); await snap(p, 'M-05-wheelchair', 'عربات كبار السن');
await filter(p, 'parking'); await snap(p, 'M-06-parking', 'المواقف مع فلتر للجميع/للمشتركين');
await filter(p, 'all');
await search(p, 'باب'); await snap(p, 'S-01-search-gate-name', 'البحث بالاسم: نتائج الأبواب');
await search(p, '17'); await snap(p, 'S-02-search-number', 'البحث برقم الباب');
await p.press('#q', 'Enter'); await p.waitForTimeout(1600); await snap(p, 'G-01-gate17-women', 'باب عمر بن الخطاب 17: القسم النسائي وسبب التسمية');
await close(p);
await pick(p, '1'); await snap(p, 'G-02-gate1-salam', 'باب السلام رقم 1');
await p.evaluate(() => { const s = document.querySelector('.sheet'); s.querySelector('.sheet-grab').click(); }); await p.waitForTimeout(700); await snap(p, 'G-03-gate1-full', 'بطاقة باب السلام موسّعة');
await close(p);
await pick(p, '310'); await snap(p, 'G-04-outer-310', 'بوابة خارجية 310: الجهة وأقرب شارع');
await close(p);
await pick(p, '37'); await snap(p, 'G-05-gate37-rawdah', 'باب 37: مدخل الروضة وجدول النساء/الرجال الحي');
await close(p);
await pick(p, '604'); await snap(p, 'W-01-behind-rawdah-women', 'مدخل منطقة خلف الروضة للنساء');
await close(p);
await pick(p, '601'); await snap(p, 'W-02-women-prayer', 'مصلى القسم النسائي');
await close(p);
await pick(p, '219'); await snap(p, 'W-03-women-toilets', 'مجمع دورات النساء');
await close(p);
await pick(p, '202'); await snap(p, 'W-04-mixed-toilets', 'مجمع مشترك: علوي للنساء وسفلي للرجال');
await close(p);
await search(p, ''); await p.fill('#q', ''); await p.keyboard.press('Escape');
await p.click('#lang-btn'); await p.waitForTimeout(400); await snap(p, 'X-01-lang-menu', 'اللغات الست');
await p.keyboard.press('Escape');
await p.click('.rawdah-card'); await p.waitForTimeout(1500); await snap(p, 'X-02-rawdah-card-tap', 'الضغط على بطاقة الروضة يفتح باب 37');
await c.close();

// ---- Route + live navigation ----
[c, p] = await ctx(browser, { geo: true });
await p.goto('https://app.local/map.html'); await settle(p);
await p.click('.mc-btn.is-locate'); await p.waitForTimeout(2000); await snap(p, 'R-01-my-location', 'موقعي الآن');
await pick(p, '21');
await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(2600); await snap(p, 'R-02-route-gate21', 'مسار المشي إلى باب الملك فهد 21 مع الملاحة الحية');
await close(p);
await pick(p, '17');
await p.click('.sheet [data-act="route"]'); await p.waitForTimeout(2600); await snap(p, 'R-03-route-women-gate17', 'مسار المشي إلى باب نسائي 17');
await c.close();

// ---- Dark map + other languages ----
[c, p] = await ctx(browser, { theme: 'dark' });
await p.goto('https://app.local/map.html'); await settle(p);
await snap(p, 'D-01-map-dark', 'الخريطة في الوضع الليلي');
await pick(p, '17'); await snap(p, 'D-02-gate17-dark', 'بطاقة باب 17 ليلاً');
await c.close();
for (const lg of ['en', 'ur', 'id', 'tr']) {
  [c, p] = await ctx(browser, { lang: lg });
  await p.goto('https://app.local/map.html'); await settle(p);
  await pick(p, '17'); await snap(p, `I-${lg}-gate17`, `بطاقة باب 17 بلغة ${lg}`);
  await c.close();
}
[c, p] = await ctx(browser, { lang: 'en', theme: 'dark' });
await p.goto('https://app.local/'); await settle(p); await snap(p, 'I-en-landing', 'الصفحة الرئيسية بالإنجليزية');
await c.close();

fs.writeFileSync(path.join(OUT, 'INDEX.json'), JSON.stringify(shots, null, 1));
await browser.close();
