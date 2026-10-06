// Prepares both HyperFrames projects (official = 16:9, guide = 9:16) from the shared sources:
// self-hosted app fonts, GSAP, the app's own icon set, brand files, a QR for the approved URL,
// the real app screenshots, procedural sound effects, and the composition HTML (src/<name>.html → <name>/index.html).
// Usage: node video/production/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const VIDEO = path.join(REPO, 'video');
const require = createRequire(path.join(REPO, 'package.json'));
const PROJECTS = ['official', 'guide'];
export const APP_URL = 'https://masjidalnabawi.vercel.app';

const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const read = (p) => fs.readFileSync(p, 'utf8');

// ---------- fonts: the app's own @fontsource faces, Arabic + Latin subsets only ----------
const FACES = [
  ['ibm-plex-sans-arabic', [400, 600, 700]],
  ['noto-kufi-arabic', [700]],
  ['noto-naskh-arabic', [400]],
];
const SUBSETS = /-(arabic|latin|latin-ext)-\d+-normal\.woff2/;
function fontCss(destFonts) {
  let css = '';
  for (const [pkg, weights] of FACES) {
    const dir = path.join(REPO, 'node_modules/@fontsource', pkg);
    for (const w of weights) {
      for (const block of read(path.join(dir, `${w}.css`)).split('@font-face').slice(1)) {
        const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
        if (!file || !SUBSETS.test(file)) continue;
        cp(path.join(dir, 'files', file), path.join(destFonts, file));
        css += '@font-face' + block.replace(/src:[^;]+;/, `src: url(assets/fonts/${file}) format('woff2');`).replace(/\/\*[^*]*\*\//g, '').trim() + '\n';
      }
    }
  }
  return css.replace(/font-display: swap;/g, 'font-display: block;');
}

// ---------- the app's icon set (src/ui/icons.ts PATHS) ----------
function icons() {
  const src = read(path.join(REPO, 'src/ui/icons.ts'));
  const start = src.indexOf('{', src.indexOf('const PATHS ='));
  const end = src.indexOf('\n} as const;', start) + 2;
  return Function(`return (${src.slice(start, end)});`)();
}

// ---------- QR for the approved URL (same generator the app uses) ----------
function qrSvg(url) {
  const qrcode = require('qrcode-generator');
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  const n = q.getModuleCount(), m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0F1714"/></svg>`;
}

// ---------- option (A): soft, procedural sound effects (no music) ----------
function sfx(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const ff = (name, args) => {
    const out = path.join(dest, name);
    if (fs.existsSync(out)) return;
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', out]);
  };
  // Quiet warm hall air: brown noise, band-limited, very low.
  ff('roomtone.wav', ['-f', 'lavfi', '-i', 'anoisesrc=color=brown:amplitude=0.6:duration=90:seed=7', '-af', 'highpass=f=60,lowpass=f=900,volume=0.05,afade=t=in:d=3']);
  // Soft glass tap: very short filtered click.
  ff('tap.wav', ['-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*1400*t)*exp(-60*t)+0.25*sin(2*PI*2600*t)*exp(-90*t)':d=0.25", '-af', 'lowpass=f=3500,volume=0.5']);
  // Card slide: short airy noise swell.
  ff('sheet.wav', ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.4:duration=0.55:seed=3', '-af', 'bandpass=f=1800:width_type=o:w=2,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.35,volume=0.25']);
  // Gentle low bell shimmer for the logo moments.
  ff('chime.wav', ['-f', 'lavfi', '-i', "aevalsrc='0.30*sin(2*PI*392*t)*exp(-1.1*t)+0.18*sin(2*PI*587.33*t)*exp(-1.4*t)+0.10*sin(2*PI*783.99*t)*exp(-1.9*t)+0.05*sin(2*PI*1174.66*t)*exp(-2.6*t)':d=3.5", '-af', 'aecho=0.8:0.6:60|120:0.25|0.15,lowpass=f=5000,afade=t=in:d=0.01,volume=0.6']);
  // Route line drawn with light: soft rising shimmer.
  ff('route.wav', ['-f', 'lavfi', '-i', "aevalsrc='0.18*sin(2*PI*(600+500*t/1.6)*t)*sin(PI*t/1.6)+0.08*sin(2*PI*(1200+900*t/1.6)*t)*sin(PI*t/1.6)':d=1.6", '-af', 'lowpass=f=4000,volume=0.5']);
}

// ---------- assemble each project ----------
const ICONS = icons();
const QR = qrSvg(APP_URL);
for (const name of PROJECTS.filter((n) => fs.existsSync(path.join(HERE, 'src', `${n}.html`)))) {
  const proj = path.join(HERE, name);
  const assets = path.join(proj, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const fonts = fontCss(path.join(assets, 'fonts'));
  cp(path.join(HERE, 'node_modules/gsap/dist/gsap.min.js'), path.join(assets, 'gsap.min.js'));
  cp(path.join(HERE, 'node_modules/gsap/dist/CustomEase.min.js'), path.join(assets, 'CustomEase.min.js'));
  cp(path.join(VIDEO, 'assets/brand/haramain-logo-hires.png'), path.join(assets, 'brand/haramain-logo.png'));
  cp(path.join(VIDEO, 'assets/brand/app-icon.svg'), path.join(assets, 'brand/app-icon.svg'));
  fs.writeFileSync(path.join(assets, 'qr.svg'), QR);
  for (const dir of ['assets/phone/clean', 'assets/screens-dark', 'assets/phone/new']) {
    const abs = path.join(VIDEO, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (/\.(png|jpe?g)$/i.test(f)) cp(path.join(abs, f), path.join(assets, 'screens', f));
  }
  sfx(path.join(assets, 'sfx'));
  // Voice-over takes, when provided (video/assets/audio/vo/<project>-ar/NN.wav).
  const vo = path.join(VIDEO, 'assets/audio/vo', `${name}-ar`);
  if (fs.existsSync(vo)) for (const f of fs.readdirSync(vo)) cp(path.join(vo, f), path.join(assets, 'vo', f));
  // Shared stylesheet + composition kit.
  const shared = read(path.join(HERE, 'shared/kit.css')) + '\n' + fonts;
  const kit = read(path.join(HERE, 'shared/kit.js'));
  const html = read(path.join(HERE, 'src', `${name}.html`))
    .replace('/*@@SHARED_CSS@@*/', shared)
    .replace('/*@@KIT_JS@@*/', `const ICONS=${JSON.stringify(ICONS)};const APP_URL=${JSON.stringify(APP_URL)};\n${kit}`);
  fs.writeFileSync(path.join(proj, 'index.html'), html);
  console.log('built', name);
}
