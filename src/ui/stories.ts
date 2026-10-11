import type { Poi } from '../data/types';
import {
  SLIDE_MS,
  VISIT_LIST,
  imageFor,
  isPrayerSlide,
  nextPos,
  prevPos,
  segmentFill,
  slideLang,
  slideText,
  type Pos,
} from '../domain/visits';
import { getLang, nm, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';

/** The prayer itself stays in Arabic in every language; the meaning is translated beside it. */
export const SALAWAT_AR = 'اللهم صل وسلم على نبينا محمد';

const COUNT_KEY = 'salawat-count';
/** A press held this long pauses the story (a quick tap moves on). */
const HOLD_MS = 220;

/** The visitor's count of prayers on the Prophet ﷺ, kept on this device only. */
export function readSalawat(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

let memoryCount = 0;
export function addSalawat(): number {
  const n = Math.max(readSalawat(), memoryCount) + 1;
  memoryCount = n;
  try {
    localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    // Private window or blocked storage: the count lives until the page closes.
  }
  return n;
}

/** Escape text and keep the ﷺ sign (a wide calligraphic ligature) from wrapping alone onto a line. */
const sal = (s: string): string => esc(s).replace(/\s*ﷺ/g, '&nbsp;<span class="st-sal">ﷺ</span>');

export interface StoriesHandlers {
  /** Show the site on the map (the stories close). */
  onMap(p: Poi): void;
  /** Plan a route to the site (the stories close). */
  onRoute(p: Poi): void;
}

/**
 * Full-screen landmark stories, WhatsApp-status style: one top segment per site, each site a few
 * photo/text slides ending with a prayer on the Prophet ﷺ. Tap the sides to move, hold to pause,
 * swipe down to close. Images load only when shown. With reduced motion nothing advances by itself.
 */
export class Stories {
  readonly root: HTMLElement;
  private pos: Pos = { site: 0, slide: 0 };
  private elapsed = 0;
  private last = 0;
  private raf = 0;
  private isOpen = false;
  private userPaused = false;
  private held = false;
  private holdTimer = 0;
  private justHeld = false;
  private sourcesOpen = false;
  private opener: Element | null = null;
  private swipe: { x: number; y: number } | null = null;
  private reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private on: StoriesHandlers) {
    this.root = document.createElement('section');
    this.root.className = 'stories';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('pointercancel', () => this.endHold());
    document.addEventListener('langchange', () => this.isOpen && this.render());
    document.addEventListener('visibilitychange', () => this.isOpen && (this.last = 0));
  }

  open(site = 0): void {
    if (!VISIT_LIST.length) return;
    this.opener = document.activeElement;
    this.pos = { site: Math.min(Math.max(site, 0), VISIT_LIST.length - 1), slide: 0 };
    this.elapsed = 0;
    this.userPaused = false;
    this.sourcesOpen = false;
    this.isOpen = true;
    this.root.hidden = false;
    this.render();
    (this.root.querySelector('[data-act="close"]') as HTMLElement | null)?.focus({ preventScroll: true });
    this.start();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.endHold();
    this.root.hidden = true;
    this.root.innerHTML = '';
    if (this.opener instanceof HTMLElement) this.opener.focus({ preventScroll: true });
  }

  get active(): boolean {
    return this.isOpen;
  }

  private get paused(): boolean {
    return this.userPaused || this.held || this.sourcesOpen || this.reduce.matches;
  }

  private start(): void {
    cancelAnimationFrame(this.raf);
    this.last = 0;
    const tick = (now: number) => {
      if (!this.isOpen) return;
      const dt = this.last ? Math.min(now - this.last, 100) : 0;
      this.last = now;
      if (!this.paused && !document.hidden) {
        this.elapsed += dt;
        if (this.elapsed >= SLIDE_MS) this.step(1);
      }
      this.paintBars();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Move one slide on or back; past the last slide the stories end. */
  private step(dir: 1 | -1): void {
    const to = dir === 1 ? nextPos(VISIT_LIST, this.pos) : prevPos(VISIT_LIST, this.pos);
    if (!to) {
      if (dir === 1) this.close();
      else this.elapsed = 0;
      return;
    }
    this.goTo(to);
  }

  private goTo(p: Pos): void {
    this.pos = p;
    this.elapsed = 0;
    this.sourcesOpen = false;
    this.render();
  }

  private paintBars(): void {
    const bars = this.root.querySelectorAll<HTMLElement>('.st-bar > i');
    const progress = this.reduce.matches ? 0 : this.elapsed / SLIDE_MS;
    bars.forEach((b, i) => b.style.setProperty('--f', String(segmentFill(VISIT_LIST, this.pos, i, progress))));
  }

  private render(): void {
    const v = VISIT_LIST[this.pos.site];
    const lang = getLang();
    const prayer = isPrayerSlide(v, this.pos.slide);
    const img = imageFor(v, this.pos.slide);
    const count = readSalawat();
    const bars = VISIT_LIST.map(() => `<span class="st-bar"><i></i></span>`).join('');
    const media = img
      ? `<img class="st-img" src="${esc(img.src)}" alt="${esc(img.alt[lang] ?? img.alt.en)}" decoding="async"${img.focus ? ` style="object-position:${esc(img.focus)}"` : ''} />`
      : `<div class="st-art" aria-hidden="true">${icon('landmark', 120)}</div>`;
    let body: string;
    if (prayer) {
      body = `<div class="st-pray">
          <p class="st-pray-ar" lang="ar" dir="rtl">${esc(SALAWAT_AR)}</p>
          ${lang === 'ar' ? '' : `<p class="st-pray-meaning">${sal(t('st_pray_meaning'))}</p>`}
          <button type="button" class="st-pray-btn" data-act="pray">${sal(t('st_pray_btn'))}</button>
          <p class="st-pray-count" id="st-count" aria-live="polite">${sal(count ? t('st_pray_count', { n: count }) : '')}</p>
        </div>`;
    } else {
      const s = v.slides[this.pos.slide];
      body = `<p class="st-text" lang="${slideLang(s, lang)}" dir="auto">${esc(slideText(s, lang))}</p>`;
    }
    const credit = img ? `<p class="st-credit">${esc(t('st_image_by', { by: img.by, license: img.license }))}</p>` : '';
    const keep = this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.act : undefined;
    this.root.setAttribute('aria-label', t('st_open'));
    this.root.classList.toggle('is-paused', this.paused);
    this.root.innerHTML = `
      <div class="st-media">${media}</div>
      <div class="st-scrim" aria-hidden="true"></div>
      <div class="st-bars" aria-hidden="true">${bars}</div>
      <header class="st-head">
        <span class="st-rank" dir="ltr" aria-hidden="true">${this.pos.site + 1} / ${VISIT_LIST.length}</span>
        <h2 class="st-name">${esc(nm(v.poi))}</h2>
        ${this.reduce.matches ? '' : `<button type="button" class="st-icon" data-act="pause" aria-label="${esc(t(this.userPaused ? 'st_play' : 'st_pause'))}">${icon(this.userPaused ? 'play' : 'pause', 20)}</button>`}
        <button type="button" class="st-icon" data-act="close" aria-label="${esc(t('l_close'))}">${icon('close', 20)}</button>
      </header>
      <button type="button" class="st-zone st-zone-prev" data-act="prev" aria-label="${esc(t('st_prev'))}"></button>
      <button type="button" class="st-zone st-zone-next" data-act="next" aria-label="${esc(t('st_next'))}"></button>
      <footer class="st-foot">
        ${body}
        ${credit}
        <div class="st-actions">
          <button type="button" class="st-btn" data-act="map">${icon('dome', 18)}<span>${esc(t('st_on_map'))}</span></button>
          <button type="button" class="st-btn" data-act="route">${icon('route', 18)}<span>${esc(t('st_route'))}</span></button>
          <button type="button" class="st-btn st-btn-quiet" data-act="sources" aria-expanded="false">${icon('link', 18)}<span>${esc(t('st_sources'))}</span></button>
        </div>
        ${prayer ? '' : `<div class="st-salawat"><span lang="ar" dir="rtl">${esc(SALAWAT_AR)}</span><button type="button" class="st-mini" data-act="pray" aria-label="${esc(t('st_pray_btn'))}"><span aria-hidden="true">ﷺ</span><b>${count}</b></button></div>`}
      </footer>`;
    this.preload();
    this.paintBars();
    // Keep keyboard focus on the same control after the slide changes.
    (this.root.querySelector<HTMLElement>(`[data-act="${keep ?? 'close'}"]`) ?? this.root.querySelector<HTMLElement>('[data-act="close"]'))?.focus({ preventScroll: true });
  }

  /** Pause button and look, without redrawing the slide (that would restart its photo). */
  private paintPause(): void {
    this.root.classList.toggle('is-paused', this.paused);
    const b = this.root.querySelector<HTMLElement>('[data-act="pause"]');
    if (!b) return;
    b.innerHTML = icon(this.userPaused ? 'play' : 'pause', 20);
    b.setAttribute('aria-label', t(this.userPaused ? 'st_play' : 'st_pause'));
  }

  /** Show or hide the list of sources for the current site; the story waits while it is open. */
  private paintSources(): void {
    const foot = this.root.querySelector('.st-foot');
    const btn = this.root.querySelector<HTMLElement>('[data-act="sources"]');
    this.root.querySelector('.st-sources')?.remove();
    btn?.setAttribute('aria-expanded', String(this.sourcesOpen));
    if (this.sourcesOpen && foot) {
      const ul = document.createElement('ul');
      ul.className = 'st-sources';
      ul.innerHTML = VISIT_LIST[this.pos.site].sources
        .map((s) => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener noreferrer">${esc(s.t)}</a></li>`)
        .join('');
      foot.querySelector('.st-actions')?.before(ul);
    }
    this.paintPause();
  }

  /** Fetch the next slide's photo ahead of time so the change is instant. */
  private preload(): void {
    const n = nextPos(VISIT_LIST, this.pos);
    if (!n) return;
    const img = imageFor(VISIT_LIST[n.site], n.slide);
    if (img) new Image().src = img.src;
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    // A press held to pause must not also count as a tap.
    if (this.justHeld && btn.classList.contains('st-zone')) {
      this.justHeld = false;
      return;
    }
    const v = VISIT_LIST[this.pos.site];
    switch (btn.dataset.act) {
      case 'close':
        this.close();
        break;
      case 'next':
        this.step(1);
        break;
      case 'prev':
        this.step(-1);
        break;
      case 'pause':
        this.userPaused = !this.userPaused;
        this.paintPause();
        break;
      case 'sources':
        this.sourcesOpen = !this.sourcesOpen;
        this.paintSources();
        break;
      case 'map': {
        const p = v.poi;
        this.close();
        this.on.onMap(p);
        break;
      }
      case 'route': {
        const p = v.poi;
        this.close();
        this.on.onRoute(p);
        break;
      }
      case 'pray': {
        const n = addSalawat();
        const live = this.root.querySelector('#st-count');
        if (live) live.innerHTML = sal(t('st_pray_count', { n }));
        const mini = this.root.querySelector('.st-mini b');
        if (mini) mini.textContent = String(n);
        break;
      }
    }
  }

  private onDown(e: PointerEvent): void {
    if (!(e.target as HTMLElement).closest('.st-zone')) return;
    this.swipe = { x: e.clientX, y: e.clientY };
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.held = true;
      this.justHeld = true;
      this.root.classList.add('is-paused');
    }, HOLD_MS);
  }

  private onUp(e: PointerEvent): void {
    const s = this.swipe;
    this.endHold();
    // A downward swipe closes, like dismissing a status.
    if (s && e.clientY - s.y > 90 && Math.abs(e.clientX - s.x) < 70) {
      this.justHeld = true;
      this.close();
    }
  }

  private endHold(): void {
    window.clearTimeout(this.holdTimer);
    this.swipe = null;
    if (this.held) {
      this.held = false;
      this.root.classList.toggle('is-paused', this.paused);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const forward = (e.key === 'ArrowRight') !== rtl;
      e.preventDefault();
      this.step(forward ? 1 : -1);
      return;
    }
    // Keep Tab inside the stories while they are open.
    if (e.key === 'Tab') {
      const items = [...this.root.querySelectorAll<HTMLElement>('button:not(.st-zone), a[href]')];
      if (!items.length) return;
      const first = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}
