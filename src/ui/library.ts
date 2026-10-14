import { sourceLines, type LibFact, type MosqueData, type ShownPlace } from '../domain/library';
import { getLang, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';

/** Loaded on first open (a separate chunk), so the map's first load does not carry the texts. */
let DATA: MosqueData = { sources: {}, places: [] };
let MOSQUE_PLACES: ShownPlace[] = [];
async function load(): Promise<void> {
  if (MOSQUE_PLACES.length) return;
  const m = await import('../domain/mosque-places');
  DATA = m.MOSQUE_DATA;
  MOSQUE_PLACES = m.MOSQUE_PLACES;
}

/** Keep the ﷺ sign from wrapping alone onto a line. */
const sal = (s: string): string => esc(s).replace(/\s*ﷺ/g, '&nbsp;ﷺ');

/**
 * Full-screen library section "Landmarks of the Prophet's Mosque": a list, then one place at a time.
 * The texts are Arabic (no guessed translations); the labels follow the visitor's language. While a
 * place is not approved by a named reviewer, a notice says so at the top. Each paragraph lists its
 * sources (book and volume/page) under it.
 */
export class Library {
  readonly root: HTMLElement;
  private current: ShownPlace | null = null;
  private isOpen = false;
  private opener: Element | null = null;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'library';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.current) this.show(null);
        else this.close();
      }
    });
    document.addEventListener('langchange', () => this.isOpen && this.render());
  }

  get active(): boolean {
    return this.isOpen;
  }

  async open(id?: string): Promise<void> {
    this.opener = document.activeElement;
    await load();
    if (!MOSQUE_PLACES.length) return;
    this.isOpen = true;
    this.root.hidden = false;
    this.show(MOSQUE_PLACES.find((p) => p.id === id) ?? null);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
    if (this.opener instanceof HTMLElement) this.opener.focus({ preventScroll: true });
  }

  private show(p: ShownPlace | null): void {
    this.current = p;
    this.render();
    this.root.querySelector('.lib-body')?.scrollTo({ top: 0 });
    (this.root.querySelector<HTMLElement>(p ? '[data-act="back"]' : '[data-act="close"]'))?.focus({ preventScroll: true });
  }

  private fact(f: LibFact): string {
    const src = sourceLines(f, DATA.sources)
      .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.text)}</a>` : esc(s.text)}</li>`)
      .join('');
    return `<div class="lib-fact">
        ${f.title ? `<h4 lang="ar" dir="rtl">${sal(f.title)}</h4>` : ''}
        <p lang="ar" dir="rtl">${sal(f.ar)}</p>
        <details class="lib-src"><summary>${esc(t('lib_sources'))}</summary><ul lang="ar" dir="rtl">${src}</ul></details>
      </div>`;
  }

  private render(): void {
    const p = this.current;
    const lang = getLang();
    const unreviewed = p ? !p.reviewed : MOSQUE_PLACES.some((x) => !x.reviewed);
    const notice = unreviewed ? `<p class="lib-notice" role="note">${icon('info', 18)}<span>${esc(t('lib_unreviewed'))}</span></p>` : '';
    const arOnly = lang === 'ar' ? '' : `<p class="lib-lang">${esc(t('lib_ar_only'))}</p>`;
    const body = p
      ? `${p.where ? `<h3>${esc(t('lib_where'))}</h3>${this.fact(p.where)}` : ''}
         ${p.story.length ? `<h3>${esc(t('lib_story'))}</h3>${p.story.map((f) => this.fact(f)).join('')}` : ''}`
      : `<ul class="lib-list">${MOSQUE_PLACES.map(
          (x) => `<li><button type="button" class="lib-item" data-act="open" data-id="${esc(x.id)}"><span lang="ar" dir="rtl">${sal(x.name)}</span>${icon('chevleft', 18, 'lib-chev')}</button></li>`,
        ).join('')}</ul>`;
    this.root.setAttribute('aria-label', t('lib_open'));
    this.root.innerHTML = `
      <header class="lib-head">
        ${p ? `<button type="button" class="lib-icon" data-act="back" aria-label="${esc(t('lib_back'))}">${icon('arrowleft', 20, 'lib-back')}</button>` : ''}
        <h2 ${p ? 'lang="ar" dir="rtl"' : ''}>${p ? sal(p.name) : esc(t('lib_open'))}</h2>
        <button type="button" class="lib-icon" data-act="close" aria-label="${esc(t('l_close'))}">${icon('close', 20)}</button>
      </header>
      <div class="lib-body">${notice}${arOnly}${body}</div>`;
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') this.close();
    else if (act === 'back') this.show(null);
    else if (act === 'open') this.show(MOSQUE_PLACES.find((p) => p.id === btn.dataset.id) ?? null);
  }
}
