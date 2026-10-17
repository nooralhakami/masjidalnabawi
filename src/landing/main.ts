import '../styles/fonts';
import './landing.css';
import { initPwa } from '../app/pwa';
import { SITE } from '../config/site.config';
import type { LangCode } from '../data/types';
import { getLang, t } from '../i18n';
import { applyLang, initialLang } from '../i18n/dom';
import { loadLang } from '../i18n-next/load';
import { applyTheme, currentTheme, savedTheme } from '../ui/theme';
import { imageToPng, mapUrl, qrPng, qrSvg } from './qr';
import { landingHtml } from './view';

/**
 * The landing page's behaviour (the live app's src/landing/main.ts, without a UI framework: the
 * page is static HTML, prerendered in Arabic; another language re-renders it from view.ts).
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: InstallPromptEvent | null = null;
const url = mapUrl();
let toastTimer = 0;

function toast(text: string, ms = 2500): void {
  const host = document.getElementById('toast-host');
  if (!host) return;
  host.innerHTML = `<div class="toast" role="status"></div>`;
  host.firstElementChild!.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (host.innerHTML = ''), ms);
}

/** Re-render for the current language (the prerendered Arabic markup is reused as is). */
function render(): void {
  document.title = t('title');
  const app = document.getElementById('app')!;
  if (app.dataset.prerendered === getLang()) delete app.dataset.prerendered;
  else app.innerHTML = landingHtml(url);
  fillLive();
  bind();
}

/** The parts that depend on the live host: the QR code and the copyable link. */
function fillLive(): void {
  const box = document.getElementById('qr-code');
  if (box && !SITE.QR_IMAGE && !box.querySelector('svg[shape-rendering]')) box.insertAdjacentHTML('afterbegin', qrSvg(url, 216));
  const link = document.getElementById('map-link') as HTMLInputElement | null;
  if (link) link.value = url;
}

function closeMenu(focus = false) {
  const menu = document.getElementById('lang-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('lang-btn')?.setAttribute('aria-expanded', 'false');
  if (focus) document.getElementById('lang-btn')?.focus();
}

function bind(): void {
  const themeToggle = document.getElementById('theme-toggle')!;
  const paintTheme = () => {
    const dark = currentTheme() === 'dark';
    themeToggle.setAttribute('aria-pressed', String(!dark));
    // The label names the mode the button switches to.
    const label = t(dark ? 'theme_day' : 'theme_night');
    themeToggle.setAttribute('aria-label', label);
    themeToggle.title = label;
  };
  paintTheme();
  themeToggle.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    paintTheme();
  });

  const btn = document.getElementById('lang-btn')!;
  const menu = document.getElementById('lang-menu')!;
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // The menu takes the room left below it on screen (the 360 px lesson).
    menu.style.maxHeight = `${Math.max(160, innerHeight - menu.getBoundingClientRect().top - 12)}px`;
    menu.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  });
  menu.querySelector('.lang-more-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const b = ev.currentTarget as HTMLButtonElement;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    const items = menu.querySelectorAll<HTMLElement>('.lang-more-item');
    items.forEach((li) => (li.hidden = !open));
    if (open) {
      menu.scrollTop = b.closest('li')!.offsetTop - 6;
      items[0]?.querySelector('button')?.focus({ preventScroll: true });
    }
  });
  document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      const l = b.dataset.lang as LangCode;
      void loadLang(l).then(() => {
        applyLang(l);
        document.getElementById('lang-btn')?.focus();
      });
    }),
  );

  document.getElementById('copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      (document.getElementById('map-link') as HTMLInputElement).select();
      document.execCommand('copy');
    }
    toast(t('l_copied'));
  });

  document.getElementById('share')!.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('title'), text: t('l_save'), url });
      } catch {
        /* dismissed */
      }
    } else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast(t('l_copied'));
    }
  });

  document.getElementById('download')!.addEventListener('click', async () => {
    // A ready-made code is exported as is (rasterised), so the PNG is exactly what is printed elsewhere.
    const blob = SITE.QR_IMAGE ? await imageToPng(SITE.QR_IMAGE) : await qrPng(url);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'masjid-nabawi-map-qr.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const install = document.getElementById('install-btn') as HTMLButtonElement;
  install.hidden = !installEvent;
  install.addEventListener('click', async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') toast(t('installed'));
    installEvent = null;
    install.hidden = true;
  });
}

document.addEventListener('click', (ev) => !(ev.target as HTMLElement).closest('.lang') && closeMenu());
document.addEventListener('keydown', (ev) => ev.key === 'Escape' && closeMenu(true));

// One-tap install where the browser offers it (Chrome on Android, desktop Chromium).
addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installEvent = ev as InstallPromptEvent;
  const b = document.getElementById('install-btn');
  if (b) b.hidden = false;
});
addEventListener('appinstalled', () => {
  installEvent = null;
  toast(t('installed'));
});

// Dark by default on the landing page (as the live app); a visitor's choice is remembered and shared with the map.
applyTheme(savedTheme() ?? 'dark', false);
// The prerendered Arabic page is already on screen; another language re-renders once its texts arrive.
const first = initialLang();
void loadLang(first).then(() => {
  applyLang(first);
  render();
  document.addEventListener('langchange', render);
});

initPwa();
