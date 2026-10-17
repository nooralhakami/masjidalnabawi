import { SITE } from '../config/site.config';
import { LANGS, MORE_LANGS, getLang, pack, t } from '../i18n';
import { esc } from '../presentation/dom';
import { brandStar, icon, type IconName } from '../presentation/icons';
import { COUNTS } from './counts';
import { qrSvg } from './qr';

/**
 * The landing page (SPEC F10, N13) for the current language, as HTML. Pure (no DOM), so the build
 * prerenders the Arabic page into index.html and it paints before any script runs; main.ts only
 * adds the live parts (QR for this host, copy, share, PNG, install, theme, language).
 *
 * The texts are the live app's (landing-strings, 26 languages). Rules kept: no «free», and no
 * promise to work without internet (the approved wording: «تبقى واجهتها متاحة حتى مع ضعف الاتصال»).
 */

const FEATURES: [IconName, string, string][] = [
  ['gate', 'l_f1t', 'l_f1d'],
  ['toilets', 'l_f2t', 'l_f2d'],
  ['accessible', 'l_f3t', 'l_f3d'],
  ['parking', 'f4t', 'f4d'],
  ['languages', 'f5t', 'f5d'],
  ['route', 'f6t', 'f6d'],
];

const e = (k: string, v?: Record<string, string | number>) => esc(t(k, v));
const brand = (size = 44) => `<span class="brand" style="width:${size}px;height:${size}px">${brandStar(Math.round(size * 0.58))}</span>`;
/** The language count and native names, filled into the texts so they never go stale. */
const langVars = () => ({ n: LANGS.length, list: LANGS.map((c) => pack(c).n).join(' · ') });

/** The language menu (the map's LanguageMenu, as static markup): the widespread first, the rest folded. */
export function langMenuItems(current = getLang()): string {
  const open = MORE_LANGS.has(current);
  const item = (c: (typeof LANGS)[number], more: boolean) =>
    `<li${more ? ` class="lang-more-item"${open ? '' : ' hidden'}` : ''}><button type="button" data-lang="${c}" lang="${c}" dir="${pack(c).dir}" aria-current="${c === current}"><span>${esc(pack(c).n)}</span><small>${pack(c).short}</small></button></li>`;
  const label = e('lang_more');
  return [
    ...LANGS.filter((c) => !MORE_LANGS.has(c)).map((c) => item(c, false)),
    `<li class="lang-more"><button type="button" class="lang-more-btn" aria-expanded="${open}" aria-label="${label}" title="${label}">${icon('chevdown', 18)}</button></li>`,
    ...LANGS.filter((c) => MORE_LANGS.has(c)).map((c) => item(c, true)),
  ].join('');
}

function qrBlock(url: string): string {
  if (SITE.QR_IMAGE) return `<img class="qr-image" src="${esc(SITE.QR_IMAGE)}" width="216" height="216" alt="${e('qr_alt')}" />`;
  return `<div class="qr-code" id="qr-code" aria-label="${e('qr_alt')}" role="img">${url ? qrSvg(url, 216) : ''}<span class="qr-logo">${brand(36)}</span></div>`;
}

function installCard(kind: 'android' | 'ios'): string {
  const keys = kind === 'android' ? ['a1', 'a2', 'a3'] : ['i1', 'i2', 'i3'];
  const hint = kind === 'android' ? icon('dots', 16) : icon('iosshare', 16);
  return `<article class="l-card install-card">
    <div class="install-head">
      <span class="install-ic" aria-hidden="true">${hint}</span>
      <div><h3>${e(kind === 'android' ? 'and_t' : 'ios_t')}</h3><p class="muted">${e('from_browser', { b: kind === 'android' ? 'Chrome' : 'Safari' })}</p></div>
    </div>
    <ol class="steps">${keys.map((k, i) => `<li><span class="step-n">${i + 1}</span><span>${e(k)}</span></li>`).join('')}</ol>
  </article>`;
}

export function landingHtml(url: string): string {
  const l = getLang();
  const stats: [number, string][] = [
    [COUNTS.places, 'st_places'],
    [COUNTS.gates, 'st_gates'],
    [COUNTS.parking, 'st_parking'],
    [LANGS.length, 'st_langs'],
  ];
  const vars = langVars();
  return `
  <header class="l-nav">
    <div class="wrap l-nav-in">
      <a href="#top" class="nav-brand">${brand(40)}<span class="nav-titles"><span class="nav-title">${e('title')}</span><span class="muted small">${e('city')}</span></span></a>
      <div class="nav-actions">
        <button type="button" class="l-icon theme-toggle" id="theme-toggle" aria-label="${e('theme_toggle')}" title="${e('theme_toggle')}">${icon('sun', 18)}</button>
        <div class="lang">
          <button type="button" class="l-pill" id="lang-btn" aria-haspopup="true" aria-expanded="false" aria-controls="lang-menu" aria-label="${e('lang_title')}: ${esc(pack(l).n)}">
            ${icon('globe', 18)}<span>${esc(pack(l).short)}</span>
          </button>
          <ul class="lang-menu" id="lang-menu" hidden aria-label="${e('lang_title')}">${langMenuItems(l)}</ul>
        </div>
      </div>
    </div>
  </header>

  <main>
  <section id="top" class="hero">
    <div class="hero-pattern" aria-hidden="true"></div>
    <div class="wrap hero-grid">
      <div class="hero-text">
        <img class="haramain-logo logo-light" src="./haramain-logo.png" width="720" height="393" alt="شعار الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي" decoding="async" />
        <img class="haramain-logo logo-dark" src="./haramain-logo-dark.png" width="720" height="393" alt="" aria-hidden="true" decoding="async" />
        <span class="tag">${icon('phone', 16)}${e('l_tag')}</span>
        <h1>${e('title')}</h1>
        <p class="lead">${e('hero_p', { n: LANGS.length })}</p>
        <div class="row">
          <a class="btn-cta" href="./map.html">${e('l_open')}<span class="flip">${icon('arrowleft', 20)}</span></a>
          <a class="btn-sec" href="#install">${icon('download', 20)}${e('l_install')}</a>
        </div>
        <dl class="stats">${stats.map(([n, k]) => `<div><dd>${n}</dd><dt>${e(k)}</dt></div>`).join('')}</dl>
      </div>
      <div class="hero-visual" aria-hidden="false">
        <div class="phone">
          <picture><source type="image/webp" srcset="./preview-map-1x.webp 304w, ./preview-map.webp 608w" sizes="280px" /><img src="./preview-map.jpg" width="304" height="658" alt="${e('preview_alt')}" decoding="async" fetchpriority="high" /></picture>
        </div>
        <div class="callout c1"><span class="tile">${icon('dome', 20)}</span><span><b>${e('co1')}</b><small>${e('co1s')}</small></span></div>
        <div class="callout c2"><span class="tile">${icon('check', 20)}</span><span><b>${e('co2')}</b><small>${e('co2s')}</small></span></div>
      </div>
    </div>
  </section>

  <section id="qr" class="wrap section">
    <div class="qr-panel">
      <div class="hero-pattern on-dark" aria-hidden="true"></div>
      <div class="qr-text">
        <span class="eyebrow">${e('l_share')}</span>
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
    <div class="cards">${FEATURES.map(([ic, tk, dk]) => `<article class="l-card feature"><span class="feature-icon">${icon(ic, 24)}</span><h3>${e(tk, vars)}</h3><p class="muted">${e(dk, vars)}</p></article>`).join('')}</div>
  </section>

  <section id="install" class="wrap section">
    <div class="section-row">
      <div class="section-head"><span class="eyebrow">${e('l_install')}</span><h2>${e('inst_h')}</h2><p class="muted">${e('inst_p')}</p></div>
      <button type="button" class="btn-gold" id="install-btn" hidden>${icon('addsq', 20)}${e('inst_now')}</button>
    </div>
    <div class="cards two">${installCard('android')}${installCard('ios')}</div>
    <div class="assure"><span class="assure-icon">${icon('check', 20)}</span><p>${e('l_inst_n')}</p></div>
  </section>
  </main>

  <footer class="footer">
    <div class="wrap footer-in">
      <div class="footer-top">
        <div class="nav-brand">${brand(44)}<span class="nav-titles"><span class="nav-title">${e('title')}</span>${SITE.ORG_NAME ? `<span class="small on-dark-muted">${esc(SITE.ORG_NAME)}</span>` : ''}</span></div>
        <nav class="footer-langs" aria-label="${e('lang_title')}">${LANGS.map((c) => `<button type="button" data-lang="${c}" lang="${c}" aria-current="${c === l}">${esc(pack(c).n)}</button>`).join('')}</nav>
      </div>
      <hr />
      <p class="on-dark-muted">${e('disclaimer')}</p>
    </div>
  </footer>
  <div class="toast-host" id="toast-host" aria-live="polite"></div>`;
}
