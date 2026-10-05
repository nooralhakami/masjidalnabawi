import type { LangCode, Poi } from '../data/types';
import { LANGS, getLang, pack, t } from '../i18n';
import { brandStar, icon } from './icons';
import { applyTheme, currentTheme } from './theme';
import { $, esc } from './dom';
import { poiBadge, poiName, sideLabel } from './poi-view';

const MAX_RESULTS = 8;

export interface HeaderOptions {
  onQuery(q: string): void;
  onPick(p: Poi): void;
  onLang(l: LangCode): void;
  status(id: number): Poi['status'];
}

/**
 * Header card: brand, live count, language menu, and the search box with its results list.
 */
export class Header {
  readonly root: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private menu!: HTMLElement;
  private langBtn!: HTMLButtonElement;
  private results: Poi[] = [];
  private total = 0;
  private active = -1;
  private timer = 0;

  constructor(private opts: HeaderOptions) {
    this.root = document.createElement('header');
    this.root.className = 'hdr';
    this.root.innerHTML = `
      <div class="hdr-row">
        <div class="brand">${brandStar(24)}</div>
        <div class="hdr-titles"><h1 class="hdr-title" data-i="title"></h1><div class="hdr-sub" id="hdr-sub"></div></div>
  <button type="button" class="pill-btn" id="lang-btn" aria-haspopup="true" aria-expanded="false">
  ${icon('globe', 18)}<span id="lang-short"></span>${icon('chevdown', 14)}
  </button>
  <div class="map-quick-actions" data-aria="app_actions" role="group">
  <button class="map-quick-action" id="map-theme" type="button"></button>
  <a class="map-quick-action" href="./" data-aria="go_home">${icon('home', 18)}</a>
  <button class="map-quick-action" id="map-share" type="button" data-aria="share_app">${icon('share', 18)}</button>
  </div>

      </div>
      <ul class="lang-menu" id="lang-menu" hidden></ul>
      <div class="search" role="search">
        <label class="search-box">
          ${icon('search', 20)}
          <span class="sr-only" data-i="ph"></span>
          <input id="q" type="search" autocomplete="off" enterkeyhint="search" role="combobox"
            aria-autocomplete="list" aria-controls="results" aria-expanded="false" />
          <button type="button" class="icon-btn" id="q-clear" hidden>${icon('close', 16)}</button>
        </label>
        <div class="results" id="results" role="listbox" hidden></div>
      </div>`;
    this.input = $('#q', this.root) as HTMLInputElement;
    this.list = $('#results', this.root);
    this.menu = $('#lang-menu', this.root);
    this.langBtn = $('#lang-btn', this.root) as HTMLButtonElement;
    this.bind();
    this.relabel();
  }

  private bind() {
    const clear = $('#q-clear', this.root);
    this.input.addEventListener('input', () => {
      clear.hidden = !this.input.value;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.opts.onQuery(this.input.value), 200);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!this.results.length) return;
        e.preventDefault();
        const n = Math.min(this.results.length, MAX_RESULTS);
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.paintActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Flush a pending debounce so Enter acts on what was typed.
        clearTimeout(this.timer);
        this.opts.onQuery(this.input.value);
        const p = this.results[Math.max(0, this.active)];
        if (p) this.pick(p);
      } else if (e.key === 'Escape') {
        if (this.input.value) this.clear();
        else this.input.blur();
      }
    });
    clear.addEventListener('click', () => {
      this.clear();
      this.input.focus();
    });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!b) return;
      const p = this.results.find((r) => r.id === Number(b.dataset.id));
      if (p) this.pick(p);
    });

    this.langBtn.addEventListener('click', () => this.toggleMenu());
    $('#map-theme', this.root).addEventListener('click', () => {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      this.paintTheme();
    });
    this.menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]');
      if (!b) return;
      this.toggleMenu(false);
      this.opts.onLang(b.dataset.lang as LangCode);
      this.langBtn.focus();
    });
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.root.contains(e.target as Node)) this.toggleMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) {
        this.toggleMenu(false);
        this.langBtn.focus();
      }
    });
  }

  private toggleMenu(open = this.menu.hidden) {
    this.menu.hidden = !open;
    this.langBtn.setAttribute('aria-expanded', String(open));
    if (open) (this.menu.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus();
  }

  private pick(p: Poi) {
    this.showResults([], 0, false);
    this.input.blur();
    this.opts.onPick(p);
  }

  clear(): void {
    this.input.value = '';
    $('#q-clear', this.root).hidden = true;
    clearTimeout(this.timer);
    this.opts.onQuery('');
  }

  get query(): string {
    return this.input.value;
  }

  setCount(n: number): void {
    $('#hdr-sub', this.root).textContent = `${t('city')} · ${t('cnt', { n })}`;
  }

  /** Render up to 8 results (or the no-results message) under the search box. */
  showResults(results: Poi[], total: number, open = this.input.value.trim().length > 0 && document.activeElement === this.input): void {
    this.results = results.slice(0, MAX_RESULTS);
    this.total = total;
    this.active = this.results.length ? 0 : -1;
    this.list.hidden = !open;
    this.input.setAttribute('aria-expanded', String(open));
    if (!open) return;
    if (!this.results.length) {
      this.list.innerHTML = `<div class="res-none" role="status">${esc(t('nores2'))}</div>`;
      return;
    }
    const head =
      total > this.results.length
        ? `<div class="results-head"><span>${esc(t('results'))}</span><span>${esc(t('res_more', { n: this.results.length, total }))}</span></div>`
        : `<div class="results-head"><span>${esc(t('results'))}</span><span>${this.results.length}</span></div>`;
    this.list.innerHTML =
      head +
      this.results
        .map(
          (p, i) => `<button type="button" class="res" role="option" id="res-${p.id}" data-id="${p.id}" aria-selected="${i === 0}">
            <span class="res-icon">${poiBadge(p, this.opts.status(p.id))}</span>
            <span><span class="res-name">${poiName(p)}</span><span class="res-meta">${sideLabel(p)}</span></span>
          </button>`,
        )
        .join('');
    this.paintActive();
  }

  private paintActive() {
    this.list.querySelectorAll('.res').forEach((b, i) => b.setAttribute('aria-selected', String(i === this.active)));
    const cur = this.results[this.active];
    if (cur) {
      this.input.setAttribute('aria-activedescendant', `res-${cur.id}`);
      document.getElementById(`res-${cur.id}`)?.scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }

  /** The theme button shows (and names) the mode it switches to. */
  private paintTheme(): void {
    const b = $('#map-theme', this.root);
    const dark = currentTheme() === 'dark';
    b.innerHTML = icon(dark ? 'sun' : 'moon', 18);
    b.setAttribute('aria-label', t(dark ? 'theme_day' : 'theme_night'));
    b.title = t(dark ? 'theme_day' : 'theme_night');
    b.setAttribute('aria-pressed', String(dark));
  }

  /** Re-apply all translated text (after a language change). */
  relabel(): void {
    this.paintTheme();
    this.root.querySelectorAll<HTMLElement>('[data-i]').forEach((e) => (e.textContent = t(e.dataset.i!)));
    this.root.querySelectorAll<HTMLElement>('[data-aria]').forEach((e) => {
      e.setAttribute('aria-label', t(e.dataset.aria!));
      e.title = t(e.dataset.aria!);
    });
    this.input.placeholder = t('ph');
    this.input.setAttribute('aria-label', t('ph'));
    $('#q-clear', this.root).setAttribute('aria-label', t('clear'));
    const l = getLang();
    $('#lang-short', this.root).textContent = pack(l).short;
    this.langBtn.setAttribute('aria-label', `${t('lang_title')}: ${pack(l).n}`);
    this.menu.setAttribute('aria-label', t('lang_title'));
    this.menu.innerHTML = LANGS.map(
      (c) =>
        `<li><button type="button" data-lang="${c}" lang="${c}" dir="${pack(c).dir}" aria-current="${c === l}">${esc(pack(c).n)}<small>${pack(c).short}</small></button></li>`,
    ).join('');
    if (!this.list.hidden) this.showResults(this.results, this.total);
  }
}
