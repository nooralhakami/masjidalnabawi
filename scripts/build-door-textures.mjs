/**
 * Generates the architectural 1024x1024 texture atlas (`scripts/door-atlas.jpg`) for
 * `public/models/haram-doors-kit.glb` (Masjid al-Nabawi Stage 3 high-craft door upgrade).
 *
 * Uses local macOS `Diwan Thuluth.ttf` + system Chrome via Playwright (zero network access).
 * Compensates for `glb-layer.ts` `pow(texel.rgb, 1.6)` shader darkening so walnut wood,
 * gilded arabesque brass, cream stone lintel, stained transom glass, and star marble floor
 * render at lifelike richness.
 *
 * Usage:
 *   node scripts/build-door-textures.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ATLAS = resolve(HERE, 'door-atlas.jpg');
const FONT_PATH = '/System/Library/Fonts/Supplemental/Diwan Thuluth.ttf';
const FALLBACK_FONT = '/System/Library/Fonts/Supplemental/DecoTypeNaskh.ttc';

function fontBase64() {
  try {
    return readFileSync(FONT_PATH).toString('base64');
  } catch {
    return readFileSync(FALLBACK_FONT).toString('base64');
  }
}

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'HaramThuluth';
    src: url('data:font/ttf;base64,${fontBase64()}') format('truetype');
    font-weight: 100 900;
    font-style: normal;
  }
  html, body { margin: 0; padding: 0; background: #000; }
</style>
</head>
<body>
<canvas id="c" width="1024" height="1024"></canvas>
<script>
window.renderAtlas = async () => {
  await document.fonts.ready;
  await document.fonts.load('48px "HaramThuluth"').catch(() => {});
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');

  const DOOR_ASPECT = 0.565;

  // ---------- Helpers ----------
  function rivet(x, y, r, goldTone = true, sx = DOOR_ASPECT) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, 1.0);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.15);
    if (goldTone) {
      g.addColorStop(0, '#fff7cc');
      g.addColorStop(0.45, '#e8bc4a');
      g.addColorStop(0.85, '#9d6e18');
      g.addColorStop(1, '#3b2406');
    } else {
      g.addColorStop(0, '#d8b468');
      g.addColorStop(0.6, '#875c18');
      g.addColorStop(1, '#2d1c06');
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function scallopBand(x0, y0, x1, y1, horizontal = true) {
    ctx.save();
    ctx.fillStyle = '#3a220d';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const step = 16;
    if (horizontal) {
      const midY = (y0 + y1) / 2;
      const rh = (y1 - y0) * 0.44;
      for (let x = x0 + step / 2; x < x1; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, y0 + 2);
        ctx.quadraticCurveTo(x + step * 0.48, midY, x, y1 - 2);
        ctx.quadraticCurveTo(x - step * 0.48, midY, x, y0 + 2);
        ctx.fillStyle = '#e2b548';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, midY, rh * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = '#6c4412';
        ctx.fill();
      }
    } else {
      const midX = (x0 + x1) / 2;
      const rw = (x1 - x0) * 0.44;
      for (let y = y0 + step / 2; y < y1; y += step) {
        ctx.beginPath();
        ctx.moveTo(x0 + 2, y);
        ctx.quadraticCurveTo(midX, y + step * 0.48, x1 - 2, y);
        ctx.quadraticCurveTo(midX, y - step * 0.48, x0 + 2, y);
        ctx.fillStyle = '#e2b548';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(midX, y, rw * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = '#6c4412';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- 1. LEFT HALF (0..512 x 0..1024): DOUBLE DOOR LEAVES ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 512, 1024);
  ctx.clip();

  // Base dark teak / bronze recessed background
  ctx.fillStyle = '#38200f';
  ctx.fillRect(0, 0, 512, 1024);

  // Diagonal 45° interlocking basketweave field (y: 215..875)
  ctx.save();
  ctx.beginPath();
  ctx.rect(34, 214, 444, 662);
  ctx.clip();
  ctx.fillStyle = '#2d180a';
  ctx.fillRect(34, 214, 444, 662);

  // Draw crisp coffered diagonal lattice bars & recessed pockets (aspect-corrected to true 45° diamonds in 3D)
  const spacing = 68;
  ctx.translate(256, 545);
  ctx.scale(DOOR_ASPECT, 1.0);
  ctx.rotate(Math.PI / 4);
  for (let gx = -800; gx <= 800; gx += spacing) {
    for (let gy = -800; gy <= 800; gy += spacing) {
      // Recessed bevel pocket
      ctx.fillStyle = '#4f2f17';
      ctx.fillRect(gx + 6, gy + 6, spacing - 12, spacing - 12);
      ctx.fillStyle = '#261409';
      ctx.fillRect(gx + 12, gy + 12, spacing - 24, spacing - 24);
      // Warm carved teak interwoven pinwheel ribs
      ctx.fillStyle = '#8b5930';
      ctx.fillRect(gx - 5, gy, 10, spacing);
      ctx.fillRect(gx, gy - 5, spacing, 10);
      // Fine brass inlay line down center of teak ribs
      ctx.fillStyle = '#deb14c';
      ctx.fillRect(gx - 1.4, gy, 2.8, spacing);
      ctx.fillRect(gx, gy - 1.4, spacing, 2.8);
      // Central golden boss medallion in every square pocket
      const bx = gx + spacing / 2;
      const by = gy + spacing / 2;
      const rg = ctx.createRadialGradient(bx - 2, by - 2, 1.2, bx, by, 9);
      rg.addColorStop(0, '#fff5c0');
      rg.addColorStop(0.55, '#dfa83a');
      rg.addColorStop(1, '#4c2c0b');
      ctx.beginPath();
      ctx.arc(bx, by, 8.8, 0, Math.PI * 2);
      ctx.fillStyle = rg;
      ctx.fill();
    }
  }
  ctx.restore();

  // Ornate gilded perimeter trim & arabesque scrollwork borders
  const borderGrad = ctx.createLinearGradient(0, 0, 512, 0);
  borderGrad.addColorStop(0, '#c89228');
  borderGrad.addColorStop(0.08, '#f7d573');
  borderGrad.addColorStop(0.5, '#c89228');
  borderGrad.addColorStop(0.92, '#f7d573');
  borderGrad.addColorStop(1, '#c89228');

  ctx.fillStyle = borderGrad;
  ctx.fillRect(0, 0, 512, 16);        // top edge bar
  ctx.fillRect(0, 0, 14, 912);        // left outer stile
  ctx.fillRect(498, 0, 14, 912);      // right outer stile
  ctx.fillRect(253, 0, 6, 912);       // center astragal strips
  scallopBand(14, 16, 36, 882, false);
  scallopBand(476, 16, 498, 882, false);
  scallopBand(14, 16, 498, 38, true);
  scallopBand(14, 874, 498, 898, true);
  ctx.fillStyle = '#eab949';
  ctx.fillRect(34, 212, 444, 5);
  ctx.fillRect(34, 872, 444, 5);

  // Upper golden frieze (y: 40..148)
  const friezeG = ctx.createLinearGradient(0, 40, 0, 148);
  friezeG.addColorStop(0, '#5a3a11');
  friezeG.addColorStop(0.5, '#3b2408');
  friezeG.addColorStop(1, '#5a3a11');
  ctx.fillStyle = friezeG;
  ctx.fillRect(36, 38, 440, 110);
  // Interwoven gold filigree waves across frieze
  for (let x = 44; x < 468; x += 18) {
    ctx.beginPath();
    ctx.ellipse(x + 9, 93, 8.5, 42, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#f2c85b';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + 9, 93, 4.5, 22, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#9f701a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.strokeStyle = '#f8da7c';
  ctx.lineWidth = 4;
  ctx.strokeRect(38, 40, 436, 106);

  // Left & Right gold corner cartouches with "الله" (aspect-corrected to true circular medallions in 3D)
  for (const cx of [70, 442]) {
    ctx.save();
    ctx.translate(cx, 93);
    ctx.scale(DOOR_ASPECT, 1.0);
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    const cg = ctx.createRadialGradient(-8, -7, 5, 0, 0, 44);
    cg.addColorStop(0, '#fff2b0');
    cg.addColorStop(0.65, '#dfa838');
    cg.addColorStop(1, '#7a5110');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = '#4b2d06';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '56px "HaramThuluth", "Diwan Thuluth", "DecoType Naskh", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4e2f08';
    ctx.fillText('الله', 1.5, 4);
    ctx.fillStyle = '#fff3b8';
    ctx.fillText('الله', 0, 2);
    ctx.restore();
  }

  // Studded horizontal gold band (y: 148..212)
  const studG = ctx.createLinearGradient(0, 148, 0, 212);
  studG.addColorStop(0, '#f3ca62');
  studG.addColorStop(0.5, '#ffe792');
  studG.addColorStop(1, '#c38c25');
  ctx.fillStyle = studG;
  ctx.fillRect(36, 148, 440, 64);
  for (let row = 0; row < 2; row++) {
    const sy = row === 0 ? 166 : 194;
    const offset = row === 0 ? 0 : 18;
    for (let sx = 54 + offset; sx <= 466; sx += 36) {
      rivet(sx, sy, 6.2, false);
    }
  }

  // Bottom brushed brass kickplate with staggered bronze rivets (y: 898..1024)
  const kickG = ctx.createLinearGradient(0, 898, 512, 1024);
  kickG.addColorStop(0, '#c89226');
  kickG.addColorStop(0.28, '#f5d06a');
  kickG.addColorStop(0.5, '#d19b30');
  kickG.addColorStop(0.75, '#f6d470');
  kickG.addColorStop(1, '#b8821d');
  ctx.fillStyle = kickG;
  ctx.fillRect(0, 898, 512, 126);
  ctx.strokeStyle = '#6a460b';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 900, 252, 122);
  ctx.strokeRect(258, 900, 252, 122);
  for (let row = 0; row < 2; row++) {
    const ry = row === 0 ? 934 : 980;
    const ox = row === 0 ? 22 : 40;
    for (let rx = ox; rx <= 490; rx += 38) {
      if (Math.abs(rx - 256) < 10) continue;
      rivet(rx, ry, 6.5, false);
    }
  }

  // Grand central golden medallion (x=256, y=545; scaled by DOOR_ASPECT so it renders 1:1 circular in 3D!)
  const mx = 256, my = 545;
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale(DOOR_ASPECT, 1.0);
  // 16 radiating lotus finials
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const cardinal = k % 4 === 0;
    const rLen = cardinal ? 194 : 174;
    ctx.save();
    ctx.translate(Math.cos(ang) * rLen, Math.sin(ang) * rLen);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.quadraticCurveTo(0, 14, -18, 8);
    ctx.lineTo(-18, -8);
    ctx.quadraticCurveTo(0, -14, 22, 0);
    ctx.fillStyle = '#f5ce68';
    ctx.fill();
    ctx.strokeStyle = '#6b430b';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
  // Scalloped outer medallion disk (matches Blender rx=0.346, rz=0.116)
  const medOut = ctx.createRadialGradient(-22, -26, 26, 0, 0, 166);
  medOut.addColorStop(0, '#fff7c8');
  medOut.addColorStop(0.55, '#ecc152');
  medOut.addColorStop(0.85, '#b67e1c');
  medOut.addColorStop(1, '#4b2d07');
  ctx.beginPath();
  ctx.arc(0, 0, 160, 0, Math.PI * 2);
  ctx.fillStyle = medOut;
  ctx.fill();

  // Dark bronze floral ring
  ctx.beginPath();
  ctx.arc(0, 0, 142, 0, Math.PI * 2);
  ctx.fillStyle = '#3f2608';
  ctx.fill();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 124, Math.sin(a) * 124, 11, 0, Math.PI * 2);
    ctx.strokeStyle = '#f2c75a';
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }

  // Beaded golden inner ring + embossed "محمد رسول الله"
  ctx.beginPath();
  ctx.arc(0, 0, 105, 0, Math.PI * 2);
  const medIn = ctx.createRadialGradient(-14, -16, 8, 0, 0, 105);
  medIn.addColorStop(0, '#fff5bd');
  medIn.addColorStop(0.5, '#e8bc4a');
  medIn.addColorStop(0.88, '#b57e1d');
  medIn.addColorStop(1, '#583709');
  ctx.fillStyle = medIn;
  ctx.fill();
  ctx.strokeStyle = '#3e2405';
  ctx.lineWidth = 4.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 92, 0, Math.PI * 2);
  ctx.strokeStyle = '#734a0d';
  ctx.lineWidth = 2.8;
  ctx.stroke();

  // Crisp RTL calligraphy inside medallion
  ctx.font = '72px "HaramThuluth", "Diwan Thuluth", "DecoType Naskh", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4c2e06';
  ctx.fillText('محمد', 2, -26);
  ctx.fillStyle = '#fff6c6';
  ctx.fillText('محمد', 0, -28);

  ctx.font = '50px "HaramThuluth", "Diwan Thuluth", "DecoType Naskh", serif';
  ctx.fillStyle = '#4c2e06';
  ctx.fillText('رسول الله', 2, 32);
  ctx.fillStyle = '#fff6c6';
  ctx.fillText('رسول الله', 0, 30);
  ctx.restore();

  // Subtle vertical leaf meeting hairline at center
  ctx.fillStyle = 'rgba(28, 16, 6, 0.72)';
  ctx.fillRect(254, 0, 4, 1024);
  ctx.restore();

  // ---------- 2. TOP-RIGHT (512..1024 x 0..256): MARBLE INSCRIPTION PLAQUE ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(512, 0, 512, 256);
  ctx.clip();
  const stG = ctx.createLinearGradient(512, 0, 1024, 256);
  stG.addColorStop(0, '#efe7d8');
  stG.addColorStop(0.5, '#f6efe2');
  stG.addColorStop(1, '#e6dcc9');
  ctx.fillStyle = stG;
  ctx.fillRect(512, 0, 512, 256);
  // Subtle marble vein lines
  ctx.strokeStyle = 'rgba(182, 166, 144, 0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(512 + i * 70, 0);
    ctx.bezierCurveTo(540 + i * 65, 80, 500 + i * 60, 170, 560 + i * 65, 256);
    ctx.stroke();
  }
  // Recessed plaque frame
  ctx.strokeStyle = '#c5b49b';
  ctx.lineWidth = 6;
  ctx.strokeRect(524, 16, 488, 224);
  ctx.strokeStyle = '#d4b26a';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(536, 28, 464, 200);

  // Aspect-corrected rosettes & tall un-stretched bronze Thuluth inscription (lintel 3D ratio ~6.1:1 vs canvas 2:1 -> sx=0.34)
  ctx.save();
  ctx.translate(768, 128);
  ctx.scale(0.34, 1.0);
  for (const rx of [-580, 580]) {
    ctx.beginPath();
    ctx.arc(rx, 0, 62, 0, Math.PI * 2);
    ctx.fillStyle = '#d9cbb4';
    ctx.fill();
    ctx.strokeStyle = '#8b7352';
    ctx.lineWidth = 4;
    ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.save();
      ctx.translate(rx, 0);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(29, 0, 22, 8.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f6efe3';
      ctx.fill();
      ctx.strokeStyle = '#9e7d43';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(rx, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#c89b44';
    ctx.fill();
  }

  // Crisp dark-bronze carved Quranic inscription "ادخلوها بسلام آمنين"
  ctx.font = '96px "HaramThuluth", "Diwan Thuluth", "DecoType Naskh", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4a3212';
  ctx.fillText('ادخلوها بسلام آمنين', 3, 5);
  ctx.fillStyle = '#8a6324';
  ctx.fillText('ادخلوها بسلام آمنين', 0, 1);
  ctx.restore();
  ctx.restore();

  // ---------- 3. MID-RIGHT TOP (512..1024 x 256..396): LEADED TRANSOM GLASS ----------
  ctx.save();
  const tg = ctx.createLinearGradient(512, 256, 512, 396);
  tg.addColorStop(0, '#c2e4fb');
  tg.addColorStop(0.5, '#dff2ff');
  tg.addColorStop(1, '#fff3d4');
  ctx.fillStyle = tg;
  ctx.fillRect(512, 256, 512, 140);
  ctx.strokeStyle = 'rgba(130, 162, 194, 0.35)';
  ctx.lineWidth = 2;
  for (let x = 512; x <= 1024; x += 28) {
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 28, 396); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 28, 256); ctx.lineTo(x, 396); ctx.stroke();
  }
  ctx.restore();

  // ---------- 4. MID-RIGHT BOTTOM-LEFT (512..768 x 396..512): HANGING BRASS LANTERN ----------
  ctx.save();
  const lg = ctx.createLinearGradient(512, 396, 768, 512);
  lg.addColorStop(0, '#f3ca63');
  lg.addColorStop(0.5, '#d8a234');
  lg.addColorStop(1, '#8c6014');
  ctx.fillStyle = lg;
  ctx.fillRect(512, 396, 256, 116);
  ctx.strokeStyle = '#533508';
  ctx.lineWidth = 4;
  ctx.strokeRect(518, 402, 244, 104);
  // Central dark openwork star roundel inside brass lantern wall
  ctx.beginPath();
  ctx.arc(640, 454, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#31210d';
  ctx.fill();
  ctx.strokeStyle = '#ffe994';
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(640, 454);
    ctx.lineTo(640 + Math.cos(a) * 32, 454 + Math.sin(a) * 32);
    ctx.strokeStyle = '#e5b84b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // ---------- 5. MID-RIGHT BOTTOM-RIGHT (768..1024 x 396..512): BRASS NAME PLAQUE ----------
  ctx.save();
  ctx.fillStyle = '#c5922b';
  ctx.fillRect(768, 396, 256, 116);
  ctx.strokeStyle = '#fff0ae';
  ctx.lineWidth = 3;
  ctx.strokeRect(776, 404, 240, 100);
  ctx.strokeStyle = '#533509';
  ctx.lineWidth = 2;
  ctx.strokeRect(784, 412, 224, 84);
  ctx.fillStyle = '#472c08';
  ctx.font = 'bold 26px "HaramThuluth", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('باب المسجد النبوي', 896, 454);
  ctx.restore();

  // ---------- 6. BOTTOM-RIGHT TOP (512..1024 x 512..768): ASHLAR STONE + GRANITE PLINTH ----------
  ctx.save();
  ctx.fillStyle = '#dfc8b3';
  ctx.fillRect(512, 512, 512, 164);
  ctx.strokeStyle = '#b49880';
  ctx.lineWidth = 2;
  for (let row = 0; row < 4; row++) {
    const y = 512 + row * 41;
    ctx.beginPath(); ctx.moveTo(512, y); ctx.lineTo(1024, y); ctx.stroke();
    const ox = row % 2 === 0 ? 0 : 48;
    for (let x = 512 + ox; x < 1024; x += 96) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 41); ctx.stroke();
    }
  }
  // Rose-brown polished granite dado course (y: 676..768)
  const gr = ctx.createLinearGradient(512, 676, 1024, 768);
  gr.addColorStop(0, '#96725c');
  gr.addColorStop(0.5, '#aa846c');
  gr.addColorStop(1, '#84624e');
  ctx.fillStyle = gr;
  ctx.fillRect(512, 676, 512, 92);
  ctx.fillStyle = '#c4a088';
  ctx.fillRect(512, 676, 512, 7);
  ctx.restore();

  // ---------- 7. BOTTOM-RIGHT BOTTOM (512..1024 x 768..1024): MARBLE STAR THRESHOLD FLOOR ----------
  ctx.save();
  ctx.fillStyle = '#f2ede2';
  ctx.fillRect(512, 768, 512, 256);
  // Dark marble perimeter border
  ctx.strokeStyle = '#1e2724';
  ctx.lineWidth = 10;
  ctx.strokeRect(528, 780, 480, 232);
  ctx.strokeStyle = '#c29954';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(538, 790, 460, 212);

  // 8-pointed Islamic star floor medallion centered at (768, 896)
  const fx = 768, fy = 896;
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2;
    const a1 = ((k + 1) / 8) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(a0) * 92, fy + Math.sin(a0) * 92);
    ctx.lineTo(fx + Math.cos(am) * 124, fy + Math.sin(am) * 124);
    ctx.lineTo(fx + Math.cos(a1) * 92, fy + Math.sin(a1) * 92);
    ctx.closePath();
    ctx.fillStyle = '#1d2b26';
    ctx.fill();
  }
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const px = fx + Math.cos(a) * 92, py = fy + Math.sin(a) * 92;
    k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#e5be70';
  ctx.fill();
  ctx.strokeStyle = '#242e2a';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const px = fx + Math.cos(a) * 44, py = fy + Math.sin(a) * 44;
    k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#d4a794';
  ctx.fill();
  ctx.strokeStyle = '#242e2a';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // Apply gentle inverse gamma (1 / 1.38) so glb-layer.ts pow(texel, 1.6) preserves rich warm colors
  const img = ctx.getImageData(0, 0, 1024, 1024);
  const d = img.data;
  const invG = 1 / 1.38;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.round(Math.pow(d[i] / 255, invG) * 255));
    d[i + 1] = Math.min(255, Math.round(Math.pow(d[i + 1] / 255, invG) * 255));
    d[i + 2] = Math.min(255, Math.round(Math.pow(d[i + 2] / 255, invG) * 255));
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.86);
};
</script>
</body>
</html>`;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setContent(HTML);
  const dataUrl = await page.evaluate(() => window.renderAtlas());
  const b64 = dataUrl.split(',')[1];
  writeFileSync(OUT_ATLAS, Buffer.from(b64, 'base64'));
  console.log(`wrote ${OUT_ATLAS}: ${Buffer.from(b64, 'base64').byteLength} bytes`);
} finally {
  await browser.close();
}
