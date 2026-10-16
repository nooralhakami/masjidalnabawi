// node stills.mjs <out-dir> t1,t2,... — one PNG per time from index.html via seek(t).
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [out, list] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('file://' + path.join(process.env.CY_DIR, 'index.html'));
await p.evaluate(async () => { await document.fonts.ready; });
for (const t of list.split(',').map(Number)) { await p.evaluate((t) => window.seek(t), t); await p.screenshot({ path: `${out}/still-${t.toFixed(2)}.png` }); console.log('ok', t); }
await b.close();
