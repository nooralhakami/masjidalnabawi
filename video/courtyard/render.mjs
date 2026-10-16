// node render.mjs <out.mp4> [--fps 60] [--from F] [--to F] — renders index.html frame by frame through
// window.seek(t) (a pure function of time; no sub-frame blending, so text stays sharp on camera moves),
// then encodes with ffmpeg. Frame ranges let several chunks render in parallel (concat them afterwards).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
const HERE = process.env.CY_DIR;
const out = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
const FPS = arg('fps', 60);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.join(HERE, 'index.html'));
await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
const T = await p.evaluate(() => window.DURATION);
const N = Math.round(T * FPS), F0 = arg('from', 0), F1 = Math.min(arg('to', N), N);
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '14', '-g', String(FPS), '-bf', '2',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let f = F0; f < F1; f++) {
  await p.evaluate((t) => window.seek(t), f / FPS);
  const buf = await p.screenshot({ type: 'png' });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if ((f - F0) % 300 === 0) console.log(out, 'frame', f, '/', F1);
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await b.close();
console.log('done', out, F1 - F0, 'frames');
