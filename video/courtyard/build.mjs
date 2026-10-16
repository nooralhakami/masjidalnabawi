// Builds courtyard/index.html from courtyard/src.html. Everything shown comes from the app checkout in APP_SRC:
// icons (src/ui/icons.ts), UI strings and language names (data/i18n.json), story texts (data/visits.json),
// the authority's dark-theme logo (public/haramain-logo-dark.png). The QR is generated from the real URL.
// Usage: APP_SRC=<app checkout> node video/courtyard/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_SRC;
const require = createRequire(path.join(HERE, 'package.json'));
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

// icons
const src = read('src/ui/icons.ts');
const a = src.indexOf('{', src.indexOf('const PATHS =')), b = src.indexOf('\n} as const;', a) + 2;
const ALL = Function(`return (${src.slice(a, b)});`)();
const ICONS = Object.fromEntries(['search', 'gate', 'toilets', 'walk', 'car', 'languages', 'globe', 'dome', 'clock', 'close', 'road', 'parking', 'landmark', 'grid', 'women', 'men', 'hotel', 'food', 'bag', 'historic', 'emergency', 'route', 'locate', 'share', 'home', 'sun', 'download', 'check', 'iosshare', 'dots', 'addsq', 'phone', 'layers', 'plus', 'minus', 'chevdown', 'arrowleft'].filter((k) => ALL[k]).map((k) => [k, ALL[k]]));

// strings
const I18N = JSON.parse(read('data/i18n.json'));
const strip = (s) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
const LANGS = ['ar', 'en', 'ur', 'id', 'fr', 'tr', 'bn', 'fa', 'ru', 'ms', 'es', 'hi', 'zh', 'de', 'ha', 'ps', 'uz', 'sw', 'so', 'az', 'ku', 'ml', 'ta', 'am', 'th', 'bs'];
const UI = Object.fromEntries(['ar', 'en', 'ur', 'id', 'tr', 'zh', 'fr', 'ru'].map((l) => {
  const u = I18N[l].ui;
  return [l, { dir: I18N[l].dir, short: I18N[l].short, title: strip(u.title), city: strip(u.city || ''), ph: strip(u.ph), pills: [u.p_all, u.p_gates, u.p_women, u.p_toilets].map(strip) }];
}));
const NAMES = LANGS.map((l) => ({ n: I18N[l].n, dir: I18N[l].dir }));
const visits = JSON.parse(read('data/visits.json'));
const VL = Array.isArray(visits) ? visits : visits.sites;
const story = (id) => VL.find((v) => v.id === id).slides[0].ar;
const DATA = { UI, NAMES, QUBA: story(542), QIBLA: story(543) };

// QR from the real URL (error correction H, so the centre mark never breaks it)
const qrcode = require('qrcode-generator');
const q = qrcode(0, 'H'); q.addData('https://masjidalnabawi.vercel.app/'); q.make();
const n = q.getModuleCount();
let d = '';
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
const QR = `<svg viewBox="0 0 ${n} ${n}" width="100%" height="100%" shape-rendering="crispEdges"><path d="${d}" fill="#0e4d3a"/></svg>`;
console.log('QR modules', n);

// fonts
const T = '../teaser/fonts/';
const face = (fam, url, w, range = '') => `@font-face{font-family:'${fam}';src:url(${url}) format('woff2');font-weight:${w};font-display:block;${range}}`;
let css = '';
for (const w of [400, 600, 700]) for (const s of ['arabic', 'latin']) css += face('IBM Plex Sans Arabic', `${T}ibm-plex-sans-arabic-${s}-${w}-normal.woff2`, w);
for (const w of [400, 700]) for (const s of ['arabic', 'latin']) css += face('Noto Naskh Arabic', `${T}noto-naskh-arabic-${s}-${w}-normal.woff2`, w);
for (const s of ['arabic', 'latin']) css += face('Noto Kufi Arabic', `${T}noto-kufi-arabic-${s}-700-normal.woff2`, 700);
// other scripts for the language names and the Chinese UI: every @fontsource subset, loaded on demand by unicode-range
for (const pkg of ['noto-sans', 'noto-sans-sc', 'noto-sans-bengali', 'noto-sans-devanagari', 'noto-sans-tamil', 'noto-sans-malayalam', 'noto-sans-ethiopic', 'noto-sans-thai']) {
  for (const w of [400, 600]) {
    const f = path.join(HERE, 'node_modules/@fontsource', pkg, `${w}.css`);
    if (!fs.existsSync(f)) continue;
    css += fs.readFileSync(f, 'utf8').replace(/font-family: '[^']+'/g, "font-family: 'Scripts'").replace(/url\(\.\/files\//g, `url(node_modules/@fontsource/${pkg}/files/`).replace(/font-display: swap/g, 'font-display: block');
  }
}

fs.copyFileSync(path.join(APP, 'public/haramain-logo-dark.png'), path.join(HERE, 'haramain-logo-dark.png'));
const html = fs.readFileSync(path.join(HERE, 'src.html'), 'utf8')
  .replace('/*@@FONTS@@*/', css)
  .replace('/*@@DATA@@*/', `const ICONS=${JSON.stringify(ICONS)};const DATA=${JSON.stringify(DATA)};const QR_SVG=${JSON.stringify(QR)};const QR_N=${n};`);
fs.writeFileSync(path.join(HERE, 'index.html'), html);
console.log('built courtyard/index.html');
