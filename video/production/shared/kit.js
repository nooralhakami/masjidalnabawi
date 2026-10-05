/* Shared motion kit. One motion language for both films, taken from the app:
   --ease  = cubic-bezier(.2,.7,.2,1)   → "hfEase"   (entrances, exits, camera)
   --spring = cubic-bezier(.22,1.15,.36,1) → "hfSpring" (cards, chips, pins — 15% overshoot only)
   Everything here only builds DOM and adds tweens to a paused timeline: seek-safe, no clocks, no randomness. */
gsap.registerPlugin(CustomEase);
CustomEase.create('hfEase', 'M0,0 C0.2,0.7 0.2,1 1,1');
CustomEase.create('hfSpring', 'M0,0 C0.22,1.15 0.36,1 1,1');
const E = 'hfEase';
const SP = 'hfSpring';

/** The app's icon (src/ui/icons.ts), same 24px grid and stroke. */
function ic(name, size = 24, stroke = 1.75) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** The app's eight-point star mark (brandStar in icons.ts), with pathLength for stroke drawing. */
function star(size, stroke = 1.6) {
  return `<svg class="star" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1" aria-hidden="true"><rect pathLength="1" x="5.5" y="5.5" width="13" height="13" rx="1"/><rect pathLength="1" x="5.5" y="5.5" width="13" height="13" rx="1" transform="rotate(45 12 12)"/><circle pathLength="1" cx="12" cy="12" r="2.4"/></svg>`;
}

/** Draw every stroke of an SVG from nothing (pathLength="1" on the shapes). */
function draw(tl, svgEl, t, dur = 1.4, stagger = 0.18) {
  const parts = svgEl.querySelectorAll('[pathLength]');
  tl.to(parts, { strokeDashoffset: 0, duration: dur, ease: E, stagger }, t);
  // Once drawn, drop the dash so every stroke closes cleanly (Chrome leaves a gap on dashed circles).
  tl.set(parts, { strokeDasharray: 'none' }, t + dur + stagger * (parts.length - 1));
}

/** Split an element's text into whole-word spans (Arabic stays joined: the shaper only ever sees whole words). */
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  return words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = w;
    el.appendChild(s);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    return s;
  });
}

/** Word-by-word reveal: rise 24px + fade, 80–120ms apart. */
function wordsIn(tl, el, t, { stagger = 0.1, dur = 0.7, y = 24 } = {}) {
  const ws = splitWords(el);
  tl.fromTo(ws, { opacity: 0, y }, { opacity: 1, y: 0, duration: dur, ease: E, stagger }, t);
  return ws;
}

/** Letter-by-letter reveal for ONE Arabic title only, with zero-width joiners so letters stay connected. */
const NON_JOINING = new Set('اأإآٱدذرزوؤةءى'.split(''));
function splitArabicChars(el) {
  const chars = [...el.textContent.trim()];
  el.textContent = '';
  const out = [];
  chars.forEach((ch, i) => {
    if (ch === ' ') { el.appendChild(document.createTextNode(' ')); return; }
    const prev = chars[i - 1], next = chars[i + 1];
    const joinPrev = prev && prev !== ' ' && !NON_JOINING.has(prev);
    const joinNext = next && next !== ' ' && !NON_JOINING.has(ch);
    const s = document.createElement('span');
    s.className = 'ch';
    s.textContent = (joinPrev ? '‍' : '') + ch + (joinNext ? '‍' : '');
    el.appendChild(s);
    out.push(s);
  });
  return out;
}

function fadeIn(tl, el, t, { dur = 0.7, y = 24, x = 0, ease = E } = {}) {
  tl.fromTo(el, { opacity: 0, y, x }, { opacity: 1, y: 0, x: 0, duration: dur, ease }, t);
}
function fadeOut(tl, el, t, { dur = 0.5, y = -12 } = {}) {
  tl.to(el, { opacity: 0, y, duration: dur, ease: E }, t);
}
function popIn(tl, el, t, { dur = 0.55, stagger = 0 } = {}) {
  tl.fromTo(el, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: dur, ease: SP, stagger }, t);
}

/** Count a number up (seek-safe: the value is derived from the tween's progress). */
function countUp(tl, el, to, t, dur = 1.1) {
  const o = { v: 0 };
  el.textContent = '0';
  tl.to(o, { v: to, duration: dur, ease: E, onUpdate: () => { el.textContent = String(Math.round(o.v)); } }, t);
}

/* ---------------- phone mockup ---------------- */

/** Build a phone holding the given real screenshots (file names in assets/screens). */
function makePhone(host, shots, { w, h, bezel = 14, r = 64 }) {
  host.style.width = w + 'px';
  host.style.height = h + 'px';
  host.style.setProperty('--ph-b', bezel + 'px');
  host.style.setProperty('--ph-r', r + 'px');
  host.style.setProperty('--ph-ri', r - bezel + 'px');
  host.innerHTML = `<div class="ph-body"></div><div class="ph-screen"><div class="ph-cam">${shots
    .map((s) => `<img class="shot" data-shot="${s}" src="assets/screens/${s}" alt="">`)
    .join('')}</div></div>`;
  const ph = { host, cam: host.querySelector('.ph-cam'), cur: null, z: 1, sw: w - 2 * bezel, sh: h - 2 * bezel };
  return ph;
}

/** Show a screenshot inside the phone: the next one fades in on top, then the previous one is hidden. */
function show(tl, ph, shot, t, dur = 0.35) {
  const next = [...ph.cam.querySelectorAll('img.shot')].find((im) => im.dataset.shot === shot);
  const prev = ph.cur;
  tl.set(next, { zIndex: ++ph.z }, t);
  tl.fromTo(next, { opacity: 0 }, { opacity: 1, duration: dur, ease: 'none' }, t);
  if (prev && prev !== next) tl.set(prev, { opacity: 0 }, t + dur);
  ph.cur = next;
}

/** A tap where a real finger would press, in screenshot fractions (0–1). Gold ring, 450ms. */
function tap(tl, ph, fx, fy, t) {
  const d = document.createElement('div');
  d.className = 'tap';
  d.style.left = fx * 100 + '%';
  d.style.top = fy * 100 + '%';
  d.style.zIndex = 999;
  ph.cam.appendChild(d);
  tl.fromTo(d, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 0.7, duration: 0.15, ease: E }, t);
  tl.to(d, { opacity: 0, scale: 1.25, duration: 0.4, ease: E }, t + 0.15);
}

/** Zoom inside the screen on a detail (fractions of the screenshot). Call zoomOut before zooming elsewhere. */
function zoomIn(tl, ph, fx, fy, scale, t, dur = 1.0) {
  tl.set(ph.cam, { transformOrigin: `${fx * 100}% ${fy * 100}%` }, t);
  tl.to(ph.cam, { scale, duration: dur, ease: E }, t);
}
function zoomOut(tl, ph, t, dur = 0.8) {
  tl.to(ph.cam, { scale: 1, duration: dur, ease: E }, t);
}

/** Gold frame around a region of the screenshot (fractions), drawn above the shot. */
function hilite(tl, ph, box, t, hold) {
  const d = document.createElement('div');
  d.className = 'hilite';
  Object.assign(d.style, { left: box[0] * 100 + '%', top: box[1] * 100 + '%', width: box[2] * 100 + '%', height: box[3] * 100 + '%', zIndex: 998 });
  ph.cam.appendChild(d);
  tl.fromTo(d, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.45, ease: SP }, t);
  tl.to(d, { opacity: 0, duration: 0.35, ease: E }, t + hold);
}

/* ---------------- captions ---------------- */

/** Burned-in captions: [start, end, text]. ≤ 42 characters per line, two lines max (style guide). */
function captions(tl, host, cues) {
  for (const [s, e, text] of cues) {
    const c = document.createElement('div');
    c.className = 'cue';
    const span = document.createElement('span');
    span.textContent = text;
    c.appendChild(span);
    host.appendChild(c);
    tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none' }, s);
    tl.to(c, { opacity: 0, duration: 0.25, ease: 'none' }, e - 0.25);
  }
}

/** Read the composition variables once (captions on/off). */
function vars() {
  try { return window.__hyperframes?.getVariables?.() ?? {}; } catch { return {}; }
}
