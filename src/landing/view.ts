import { SITE } from '../config/site.config';
import { LANGS, MORE_LANGS, getLang, pack, t } from '../i18n';
import { esc } from '../presentation/dom';
import { brandStar, icon, type IconName } from '../presentation/icons';
import { nextPrayer } from '../domain/prayer';
import { clock, minutesText } from '../presentation/time';
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

/**
 * The next prayer in Madinah with the time left (UI plan phase 6), under the «open the map» button.
 * Without `now` (the build's prerendered page) the line keeps its place, empty, until main.ts fills
 * it: a time baked in at build time would be wrong.
 */
export function prayerStrip(now?: Date): string {
  const p = now ? nextPrayer(now) : null;
  return `<p class="prayer-strip${p ? '' : ' is-empty'}" id="next-prayer">
          <span class="pr-ic" aria-hidden="true">${icon('prayer', 20)}</span>
          <span class="pr-text"><span class="pr-label">${e('pr_next')}</span>
          <b class="pr-name">${p ? e(`pr_${p.name}`) : '&nbsp;'}</b> <span class="pr-time">${p ? esc(clock(p.at, getLang())) : ''}</span></span>
          <span class="pr-left">${p ? e('pr_in', { t: minutesText(p.minutesLeft, t) }) : ''}</span>
        </p>`;
}

export function landingHtml(url: string, now?: Date): string {
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
      <div class="hero-head">
        <img class="haramain-logo logo-light" src="./haramain-logo.png" width="720" height="393" alt="شعار الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي" decoding="async" />
        <img class="haramain-logo logo-dark" src="./haramain-logo-dark.png" width="720" height="393" alt="" aria-hidden="true" decoding="async" />
        <h1>${e('title')}</h1>
      </div>
      <div class="hero-act">
        <a class="btn-cta btn-open" href="./map.html">${e('l_open_map')}<span class="flip">${icon('arrowleft', 22)}</span></a>
        ${prayerStrip(now)}
      </div>
      <a class="mini-map" href="./map.html" aria-label="${e('l_live_alt')}">
        <picture class="mini-still"><source type="image/webp" srcset="./mini-map-1x.webp 600w, ./mini-map-700.webp 700w, ./mini-map.webp 1200w" sizes="(min-width: 900px) 520px, calc(100vw - 32px)" /><img src="./mini-map.jpg" width="600" height="375" alt="" decoding="async" fetchpriority="high" /></picture>
        <div class="mini-canvas" id="mini-map" aria-hidden="true"></div>
        <span class="mini-tag"><span class="mini-dot" aria-hidden="true"></span>${e('l_live')}</span>
        <small class="mini-credit" dir="ltr">© Esri, Maxar, Earthstar Geographics · © OpenStreetMap</small>
      </a>
      <div class="hero-more">
        <p class="lead">${e('hero_p', { n: LANGS.length })}</p>
        <a class="btn-sec" href="#install">${icon('download', 20)}${e('l_install')}</a>
      </div>
    </div>
  </section>

  <section id="features" class="wrap section">
    <div class="section-head"><span class="eyebrow">${e('nav_features')}</span><h2>${e('f_h')}</h2><p class="muted">${e('f_p')}</p></div>
    <dl class="stats">${stats.map(([n, k]) => `<div><dd>${n}</dd><dt>${e(k)}</dt></div>`).join('')}</dl>
    <div class="cards">${FEATURES.map(([ic, tk, dk]) => `<article class="l-card feature"><span class="feature-icon">${icon(ic, 24)}</span><h3>${e(tk, vars)}</h3><p class="muted">${e(dk, vars)}</p></article>`).join('')}</div>
  </section>

  <section id="qr" class="wrap section">
    <div class="qr-panel">
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
      <p class="credit on-dark-muted"><span>${esc(t('credit_role'))}</span> <strong>${esc(t('credit_name'))}</strong></p>
    </div>
  </footer>
  <div class="toast-host" id="toast-host" aria-live="polite"></div>`;
}
