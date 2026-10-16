// Builds teaser/index.html from teaser/src.html: inlines the app's own icon paths (src/ui/icons.ts of the app
// checkout in APP_SRC) and the self-hosted font faces. Usage: APP_SRC=<app checkout> node video/teaser/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_SRC || path.resolve(HERE, '../..');
const src = fs.readFileSync(path.join(APP, 'src/ui/icons.ts'), 'utf8');
const a = src.indexOf('{', src.indexOf('const PATHS ='));
const b = src.indexOf('\n} as const;', a) + 2;
const ALL = Function(`return (${src.slice(a, b)});`)();
const NEED = ['search', 'gate', 'toilets', 'walk', 'car', 'languages', 'globe', 'dome', 'clock', 'close', 'road', 'parking', 'landmark', 'grid', 'women', 'hotel', 'food', 'bag', 'historic', 'emergency', 'route', 'locate'];
const ICONS = Object.fromEntries(NEED.map((k) => [k, ALL[k]]));

const face = (fam, file, w) => `@font-face{font-family:'${fam}';src:url(fonts/${file}) format('woff2');font-weight:${w};font-display:block;}`;
let css = '';
for (const w of [400, 600, 700]) for (const s of ['arabic', 'latin']) css += face('IBM Plex Sans Arabic', `ibm-plex-sans-arabic-${s}-${w}-normal.woff2`, w);
for (const w of [400, 700]) for (const s of ['arabic', 'latin']) css += face('Noto Naskh Arabic', `noto-naskh-arabic-${s}-${w}-normal.woff2`, w);
for (const s of ['arabic', 'latin']) css += face('Noto Kufi Arabic', `noto-kufi-arabic-${s}-700-normal.woff2`, 700);

const html = fs.readFileSync(path.join(HERE, 'src.html'), 'utf8')
  .replace('/*@@FONTS@@*/', css)
  .replace('/*@@ICONS@@*/', `const ICONS=${JSON.stringify(ICONS)};`);
fs.writeFileSync(path.join(HERE, 'index.html'), html);
console.log('built teaser/index.html');
