// After the build: every file a chunk loads or preloads (./x.js, ./x.css) must exist in dist/assets.
// vite preview answers a missing file with the page itself, so only this catches it before Vercel's
// 404 does (2026-10-24: the stories would not open because an inlined CSS file was deleted).
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const dir = 'dist/assets';
const have = new Set(readdirSync(dir));
const missing = [];
for (const file of have) {
  if (!file.endsWith('.js')) continue;
  for (const [, ref] of readFileSync(`${dir}/${file}`, 'utf-8').matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)) {
    // ./sw.js and the like resolve from the page, at the site root.
    if (!have.has(ref) && !existsSync(`dist/${ref}`)) missing.push(`${file} → ${ref}`);
  }
}
if (missing.length) {
  console.error(`check-build: ${missing.length} file(s) asked for but not built:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('check-build: every chunk dependency exists');
