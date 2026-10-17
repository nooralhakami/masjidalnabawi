// The /design gallery checked in a real browser (docs/PLAN.md phase 2):
//   - no horizontal scroll at 320, 360, 375 and 412 px, in an RTL and an LTR language, light and dark;
//   - every control is at least 44 × 44 px; every icon-only button has a label; no console errors;
//   - screenshots, Arabic and English side by side, light and dark → test-results/design/
//     (docs/design/ keeps reviewed copies as .webp).
// Runs against the dev server (the gallery is never in the production build).
//
//   node scripts/design-audit.mjs            (starts `vite` on port 5180)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 5180;
const BASE = `http://localhost:${PORT}/design.html`;
// Playwright 1.63 expects Chromium 1243; the container has 1194 (CLAUDE.md).
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());

async function up() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('dev server did not start');
}

await up();
const browser = await chromium.launch({ executablePath: CHROME });
const problems = [];
const report = (where, what) => problems.push(`${where}: ${what}`);

for (const theme of ['light', 'dark']) {
  for (const lang of ['ar', 'en']) {
    for (const width of [320, 360, 375, 412]) {
      const where = `${theme} ${lang} ${width}px`;
      const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => report(where, `page error: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && report(where, `console: ${m.text()}`));
      await page.goto(`${BASE}?theme=${theme}&langs=${lang}&fit=1`);
      await page.waitForSelector('.place-card');
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const out = { overflow: document.documentElement.scrollWidth - innerWidth, small: [], unlabeled: [], wide: [] };
        const controls = document.querySelectorAll('.g-column button, .g-column input, .g-column a[href], .g-column [role="radio"], .g-column [role="option"]');
        for (const el of controls) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
          // The sheet is a moving demo: only check what is on screen within its phone frame.
          if (el.closest('.sheet') && el.closest('.sheet').classList.contains('is-closed')) continue;
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) || el.className;
          if (b.width < 43.5 || b.height < 43.5) out.small.push(`${el.tagName.toLowerCase()}.${el.className} «${name}» ${Math.round(b.width)}×${Math.round(b.height)}`);
          if (el.tagName === 'BUTTON' && !el.textContent.trim() && !el.getAttribute('aria-label')) out.unlabeled.push(el.className);
        }
        // Anything wider than the column it sits in (text that does not wrap, rows that do not fit).
        for (const el of document.querySelectorAll('.g-column *')) {
          if (el.closest('.cat-row, .g-swatches, svg')) continue;
          const b = el.getBoundingClientRect();
          if (b.right > innerWidth + 1 || b.left < -1) out.wide.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
        }
        out.wide = [...new Set(out.wide)].slice(0, 8);
        return out;
      });
      if (r.overflow > 0) report(where, `page scrolls sideways by ${r.overflow}px`);
      for (const s of r.small) report(where, `target under 44 px: ${s}`);
      for (const u of r.unlabeled) report(where, `icon button without a label: ${u}`);
      for (const w of r.wide) report(where, `sticks out of the screen: ${w}`);
      await page.close();
    }
  }
  // Side by side, Arabic and English, the whole gallery.
  mkdirSync('test-results/design', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 2 * 412 + 32 + 48, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?theme=${theme}&langs=ar,en`);
  await page.waitForSelector('.place-card');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/design/gallery-${theme}.png`, fullPage: true });
  for (const id of ['cards', 'sheet', 'search', 'rawdah']) {
    await page.goto(`${BASE}?theme=${theme}&langs=ar,en&only=${id}`);
    await page.waitForSelector(`[data-section="${id}"]`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/design/${id}-${theme}.png`, fullPage: true });
  }
  await page.close();
}

await browser.close();
server.kill();
const unique = [...new Set(problems)];
console.log(unique.length ? unique.join('\n') : 'design audit: no problems (4 widths × 2 languages × 2 themes)');
process.exit(unique.length ? 1 : 0);
