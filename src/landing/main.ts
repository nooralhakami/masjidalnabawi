import '../styles/fonts';
import { initPwa } from '../pwa';
import '../styles/main.css';
import '../styles/landing.css';
import { SITE } from '../config/site.config';
import type { LangCode } from '../data/types';
import { getLang, t } from '../i18n';
import { applyLang, initialLang } from '../i18n/dom';
import { applyTheme, currentTheme, savedTheme } from '../ui/theme';
import { toast } from '../ui/toast';
import { imageToPng, mapUrl, qrPng, qrSvg } from './qr';
import { landingHtml } from './view';
import { bindLangMore } from '../ui/lang-menu';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: InstallPromptEvent | null = null;
const url = mapUrl();

/** Re-render for the current language (the prerendered Arabic markup is reused as-is). */
function render(): void {
  document.title = t('title');
  const app = document.getElementById('app')!;
  if (app.dataset.prerendered === getLang()) delete app.dataset.prerendered;
  else app.innerHTML = landingHtml(url);
  fillLive();
  bind();
}

/** Parts that depend on the live host: the QR code and the copyable link. */
function fillLive(): void {
  const box = document.getElementById('qr-code');
  if (box && !SITE.QR_IMAGE && !box.querySelector('svg[shape-rendering]')) box.insertAdjacentHTML('afterbegin', qrSvg(url, 216));
  const link = document.getElementById('map-link') as HTMLInputElement | null;
  if (link) link.value = url;
}

function bind(): void {
  const themeToggle = document.getElementById('theme-toggle');
  const paintTheme = () => {
    const dark = currentTheme() === 'dark';
    themeToggle?.setAttribute('aria-pressed', String(!dark));
    // The label names the mode the button switches to.
    const label = themeToggle?.querySelector('.theme-toggle-label');
    if (label) label.textContent = t(dark ? 'theme_day' : 'theme_night');
  };
  paintTheme();
  themeToggle?.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    paintTheme();
  });

  const btn = document.getElementById('lang-btn')!;
  const menu = document.getElementById('lang-menu')!;
  bindLangMore(menu);
  const toggle = (open = menu.hidden) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus();
  };
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggle();
  });
  document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      applyLang(b.dataset.lang as LangCode);
      document.getElementById('lang-btn')?.focus();
    }),
  );

  document.getElementById('copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.getElementById('map-link') as HTMLInputElement;
      input.select();
      document.execCommand('copy');
    }
    toast(t('l_copied'), 2500);
  });

  const share = document.getElementById('share')!;
  share.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('title'), text: t('l_save'), url });
      } catch {
        /* dismissed */
      }
    } else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast(t('l_copied'), 2500);
    }
  });

  document.getElementById('download')!.addEventListener('click', async () => {
    // A ready-made code is exported as-is (rasterised), so the PNG is exactly what is printed elsewhere.
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

document.addEventListener('click', (ev) => {
  const menu = document.getElementById('lang-menu');
  if (menu && !menu.hidden && !(ev.target as HTMLElement).closest('.lang')) {
    menu.hidden = true;
    document.getElementById('lang-btn')?.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (ev) => {
  const menu = document.getElementById('lang-menu');
  if (ev.key === 'Escape' && menu && !menu.hidden) {
    menu.hidden = true;
    document.getElementById('lang-btn')?.focus();
  }
});

// Offer one-tap install where the browser supports it (Chrome/Android, desktop Chromium).
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installEvent = ev as InstallPromptEvent;
  const b = document.getElementById('install-btn');
  if (b) b.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  toast(t('installed'));
});

// Dark by default on the landing page; a visitor's choice is remembered and shared with the map.
applyTheme(savedTheme() ?? 'dark', false);
applyLang(initialLang());
render();
document.addEventListener('langchange', render);

initPwa();
