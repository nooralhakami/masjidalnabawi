import { SITE } from '../config/site.config';
import { COUNTS } from './counts';
import { LANGS, getLang, pack, t } from '../i18n';
import { esc } from '../ui/dom';
import { brandStar, icon, type IconName } from '../ui/icons';
import { qrSvg } from './qr';

/**
 * Landing page markup for the current language. Pure (no DOM), so the build can
 * prerender it into index.html and the browser paints content before any JS runs.
 * With an empty `url` the QR code is left for the browser to fill in (it needs the live host).
 */
const counts = {
  ...COUNTS,
  langs: LANGS.length,
};

const FEATURES: [IconName, string, string][] = [
  ['gate', 'l_f1t', 'l_f1d'],
  ['toilets', 'l_f2t', 'l_f2d'],
  ['accessible', 'l_f3t', 'l_f3d'],
  ['parking', 'f4t', 'f4d'],
  ['languages', 'f5t', 'f5d'],
  ['route', 'f6t', 'f6d'],
];

const brand = (size = 44) => `<span class="brand" style="width:${size}px;height:${size}px">${brandStar(Math.round(size * 0.58))}</span>`;
const e = (k: string, v?: Record<string, string | number>) => esc(t(k, v));

function qrBlock(url: string): string {
  if (SITE.QR_IMAGE) return `<img src="${esc(SITE.QR_IMAGE)}" width="216" height="216" alt="${e('qr_alt')}" />`;
  return `<div class="qr-code" id="qr-code" aria-label="${e('qr_alt')}" role="img">${url ? qrSvg(url, 216) : ''}<span class="qr-logo">${brand(36)}</span></div>`;
}

function phoneSteps(kind: 'android' | 'ios'): string {
  const keys = kind === 'android' ? ['a1', 'a2', 'a3'] : ['i1', 'i2', 'i3'];
  const mock =
    kind === 'android'
      ? `<div class="mini-bar"><span class="mini-url"></span><span class="mini-hl">${icon('dots', 14)}</span></div>
         <div class="mini-menu"><span></span><span style="width:70%"></span><span class="mini-add">${icon('addsq', 11)}${e('nav_install')}</span></div>`
      : `<div class="mini-bar"><span class="mini-url"></span></div>
         <div class="mini-tab"><span></span><span class="mini-hl ios">${icon('iosshare', 15)}</span><span></span></div>`;
  return `<article class="card install-card">
    <div class="mini-phone" aria-hidden="true"><div class="mini-screen">${mock}
      <div class="mini-body"><div class="mini-row">${brand(22)}<span></span></div><span class="mini-img"></span><span></span><span style="width:60%"></span></div>
    </div></div>
    <div class="install-text">
      <div><h3>${e(kind === 'android' ? 'and_t' : 'ios_t')}</h3><p class="muted">${e('from_browser', { b: kind === 'android' ? 'Chrome' : 'Safari' })}</p></div>
      <ol class="steps">${keys.map((k, i) => `<li><span class="step-n">${i + 1}</span><span>${e(k)}</span></li>`).join('')}</ol>
    </div>
  </article>`;
}

export function landingHtml(url: string): string {
  const l = getLang();
  const stats: [number, string][] = [
    [counts.places, 'st_places'],
    [counts.gates, 'st_gates'],
    [counts.parking, 'st_parking'],
    [counts.langs, 'st_langs'],
  ];
  return `
  <header class="wrap nav">
    <a href="#top" class="nav-brand">${brand(44)}<span><span class="nav-title">${e('title')}</span><span class="muted small">${e('city')}</span></span></a>
    <nav class="nav-links" aria-label="${e('nav_features')}">
      <a href="#features">${e('nav_features')}</a><a href="#qr">${e('nav_qr')}</a><a href="#install">${e('nav_install')}</a>
    </nav>
    <div class="nav-actions">
      <div class="lang">
        <button type="button" class="pill-btn" id="lang-btn" aria-haspopup="true" aria-expanded="false" aria-label="${e('lang_title')}: ${esc(pack(l).n)}">
          ${icon('globe', 18)}<span>${esc(pack(l).n)}</span>${icon('chevdown', 14)}
        </button>
        <ul class="lang-menu" id="lang-menu" hidden aria-label="${e('lang_title')}">
          ${LANGS.map((c) => `<li><button type="button" data-lang="${c}" lang="${c}" dir="${pack(c).dir}" aria-current="${c === l}">${esc(pack(c).n)}<small>${pack(c).short}</small></button></li>`).join('')}
        </ul>
      </div>
      <a class="btn-cta sm" href="./map.html">${e('l_open_short')}<span class="flip">${icon('arrowleft', 16)}</span></a>
    </div>
  </header>

  <main>
  <section id="top" class="hero">
    <div class="hero-pattern" aria-hidden="true"></div>
    <div class="wrap hero-grid">
      <div class="hero-text">
        <span class="tag">${icon('phone', 16)}${e('l_tag')}</span>
        <h1>${e('title')}</h1>
        <p class="lead">${e('hero_p')}</p>
        <div class="row">
          <a class="btn-cta" href="./map.html">${e('l_open')}<span class="flip">${icon('arrowleft', 20)}</span></a>
          <a class="btn-sec" href="#install">${icon('download', 20)}${e('l_install')}</a>
        </div>
        <dl class="stats">${stats.map(([n, k]) => `<div><dt>${e(k)}</dt><dd>${n}</dd></div>`).join('')}</dl>
      </div>
      <div class="hero-visual">
        <div class="callout c1"><span class="tile">${icon('dome', 21)}</span><span><b>${e('co1')}</b><small>${e('co1s')}</small></span></div>
        <div class="callout c2"><span class="tile">${icon('check', 21)}</span><span><b>${e('co2')}</b><small>${e('co2s')}</small></span></div>
        <div class="phone"><picture><source type="image/webp" srcset="./preview-map-1x.webp 304w, ./preview-map.webp 608w" sizes="304px" /><img src="./preview-map.jpg" width="304" height="658" alt="${e('preview_alt')}" decoding="async" loading="lazy" /></picture></div>
      </div>
    </div>
  </section>

  <section id="qr" class="wrap section-tight">
    <div class="qr-panel">
      <div class="hero-pattern on-dark" aria-hidden="true"></div>
      <div class="qr-text">
        <span class="eyebrow gold">${e('l_share')}</span>
        <h2>${e('l_qr_h')}</h2>
        <p>${e('l_qr_p')}</p>
        <div class="link-field">
          <label for="map-link">${e('l_link')}</label>
          <div class="link-box"><input id="map-link" dir="ltr" readonly value="${esc(url)}" />
            <button type="button" class="btn-copy" id="copy">${icon('copy', 17)}<span>${e('l_copy')}</span></button></div>
        </div>
        <div class="row">
          <button type="button" class="btn-outline" id="share">${icon('share', 18)}${e('share')}</button>
          <button type="button" class="btn-outline" id="download">${icon('download', 18)}${e('dl_png')}</button>
        </div>
      </div>
      <figure class="qr-card">
        <div class="qr-frame">${qrBlock(url)}</div>
        <figcaption>${e('l_scan')}</figcaption>
      </figure>
    </div>
  </section>

  <section id="features" class="wrap section">
    <div class="section-head"><span class="eyebrow">${e('nav_features')}</span><h2>${e('f_h')}</h2><p class="muted">${e('f_p')}</p></div>
    <div class="cards">${FEATURES.map(([ic, tk, dk]) => `<article class="card feature"><span class="feature-icon">${icon(ic, 26)}</span><h3>${e(tk)}</h3><p class="muted">${e(dk)}</p></article>`).join('')}</div>
  </section>

  <section id="install" class="wrap section">
    <div class="section-row">
      <div class="section-head"><span class="eyebrow">${e('l_install')}</span><h2>${e('inst_h')}</h2><p class="muted">${e('inst_p')}</p></div>
      <button type="button" class="btn-gold" id="install-btn" hidden>${icon('addsq', 20)}${e('inst_now')}</button>
    </div>
    <div class="cards two">${phoneSteps('android')}${phoneSteps('ios')}</div>
    <div class="assure"><span class="assure-icon">${icon('check', 20)}</span><p>${e('l_inst_n')}</p></div>
  </section>
  </main>

  <footer class="footer">
    <div class="wrap footer-in">
      <div class="footer-top">
        <div class="nav-brand">${brand(48)}<span><span class="nav-title">${e('title')}</span><span class="small on-dark-muted">${esc(SITE.ORG_NAME)}</span></span></div>
        <nav class="footer-langs" aria-label="${e('lang_title')}">${LANGS.map((c) => `<button type="button" data-lang="${c}" lang="${c}" aria-current="${c === l}">${esc(pack(c).n)}</button>`).join('')}</nav>
      </div>
      <hr />
      <p class="on-dark-muted">${e('disclaimer')}</p>
    </div>
  </footer>`;
}
