// node render.mjs <out.mp4> [--fps 60] [--sub 2] — renders index.html frame by frame through window.seek(t)
// (pure function of time), blending sub-frames for a light 180° shutter, then encodes with ffmpeg.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = process.env.TEASER_DIR || path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
const FPS = arg('fps', 60), SUB = arg('sub', 2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.join(HERE, 'index.html'));
await p.evaluate(async () => { await document.fonts.ready; });
const T = await p.evaluate(() => window.DURATION);
const N = Math.round(T * FPS);
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
  '-vf', SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB` : 'null',
  '-r', String(FPS), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '14', '-g', '30', '-bf', '2',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let f = 0; f < N; f++) {
  for (let s = 0; s < SUB; s++) {
    // sub-frames sit before the frame time, so frame 0 stays the exact loop frame
    const t = Math.max(0, (f - (SUB - 1 - s) * 0.5 / SUB) / FPS);
    await p.evaluate((t) => window.seek(t), t);
    const buf = await p.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  if (f % 120 === 0) console.log('frame', f, '/', N);
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await b.close();
console.log('done', out, N, 'frames');
