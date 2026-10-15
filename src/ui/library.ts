import { sourceLines, type LibFact, type ShownCompanion, type ShownPlace } from '../domain/library';
import { getLang, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';

type Sources = Record<string, { t: string; u?: string }>;
type Entry = { kind: 'place'; item: ShownPlace } | { kind: 'companion'; item: ShownCompanion };

/** Loaded on first open (a separate chunk), so the map's first load does not carry the texts. */
let PLACE_SOURCES: Sources = {};
let COMPANION_SOURCES: Sources = {};
let PLACES: ShownPlace[] = [];
let COMPANIONS: ShownCompanion[] = [];
let loaded = false;
async function load(): Promise<void> {
  if (loaded) return;
  const m = await import('../domain/mosque-places');
  PLACE_SOURCES = m.MOSQUE_DATA.sources;
  COMPANION_SOURCES = m.COMPANION_DATA.sources;
  PLACES = m.MOSQUE_PLACES;
  COMPANIONS = m.COMPANIONS;
  loaded = true;
}

/** Groups of companions, in the order of the plan's list (docs/PLAN-ISLAMIC-LIBRARY.md, appendix A). */
const GROUPS = ['ten', 'mothers', 'family', 'early', 'ansar'] as const;

/** Keep the ﷺ sign from wrapping alone onto a line. */
const sal = (s: string): string => esc(s).replace(/\s*ﷺ/g, '&nbsp;ﷺ');

/**
 * Full-screen library: the landmarks of the Prophet's Mosque and the companions — a list, then one
 * entry at a time. The texts are Arabic (no guessed translations); the labels follow the visitor's
 * language. While an entry is not approved by a named reviewer, a notice says so at the top. Each
 * paragraph lists its sources (book and volume/page) under it.
 */
export class Library {
  readonly root: HTMLElement;
  private current: Entry | null = null;
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

  /** Open the list, or straight on one place or companion by id (`?lib=ID`). */
  async open(id?: string): Promise<void> {
    this.opener = document.activeElement;
    await load();
    if (!PLACES.length && !COMPANIONS.length) return;
    this.isOpen = true;
    this.root.hidden = false;
    this.show(id ? this.find(id) : null);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
    if (this.opener instanceof HTMLElement) this.opener.focus({ preventScroll: true });
  }

  private find(id: string): Entry | null {
    const p = PLACES.find((x) => x.id === id);
    if (p) return { kind: 'place', item: p };
    const c = COMPANIONS.find((x) => x.id === id);
    return c ? { kind: 'companion', item: c } : null;
  }

  private show(e: Entry | null): void {
    this.current = e;
    this.render();
    this.root.querySelector('.lib-body')?.scrollTo({ top: 0 });
    this.root.querySelector<HTMLElement>(e ? '[data-act="back"]' : '[data-act="close"]')?.focus({ preventScroll: true });
  }

  private fact(f: LibFact, sources: Sources): string {
    const src = sourceLines(f, sources)
      .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.text)}</a>` : esc(s.text)}</li>`)
      .join('');
    return `<div class="lib-fact">
        ${f.title ? `<h4 lang="ar" dir="rtl">${sal(f.title)}</h4>` : ''}
        <p lang="ar" dir="rtl">${sal(f.ar)}</p>
        <details class="lib-src"><summary>${esc(t('lib_sources'))}</summary><ul lang="ar" dir="rtl">${src}</ul></details>
      </div>`;
  }

  private item(id: string, name: string): string {
    return `<li><button type="button" class="lib-item" data-act="open" data-id="${esc(id)}"><span lang="ar" dir="rtl">${sal(name)}</span>${icon('chevleft', 18, 'lib-chev')}</button></li>`;
  }

  private list(): string {
    const parts: string[] = [];
    if (PLACES.length) parts.push(`<h3>${esc(t('lib_open'))}</h3><ul class="lib-list">${PLACES.map((p) => this.item(p.id, p.name)).join('')}</ul>`);
    if (COMPANIONS.length) {
      parts.push(`<h3 class="lib-part">${esc(t('lib_tab_companions'))}</h3>`);
      for (const g of GROUPS) {
        const cs = COMPANIONS.filter((c) => c.group === g);
        if (cs.length) parts.push(`<h4 class="lib-group">${esc(t(`lib_grp_${g}`))}</h4><ul class="lib-list">${cs.map((c) => this.item(c.id, c.name)).join('')}</ul>`);
      }
      const other = COMPANIONS.filter((c) => !(GROUPS as readonly string[]).includes(c.group));
      if (other.length) parts.push(`<ul class="lib-list">${other.map((c) => this.item(c.id, c.name)).join('')}</ul>`);
    }
    return parts.join('');
  }

  private detail(e: Entry): string {
    if (e.kind === 'place') {
      const p = e.item;
      return `${p.where ? `<h3>${esc(t('lib_where'))}</h3>${this.fact(p.where, PLACE_SOURCES)}` : ''}
         ${p.story.length ? `<h3>${esc(t('lib_story'))}</h3>${p.story.map((f) => this.fact(f, PLACE_SOURCES)).join('')}` : ''}`;
    }
    return e.item.fields.map((x) => `<h3>${esc(t(`lib_f_${x.field}`))}</h3>${x.facts.map((f) => this.fact(f, COMPANION_SOURCES)).join('')}`).join('');
  }

  private render(): void {
    const e = this.current;
    const lang = getLang();
    const unreviewed = e ? !e.item.reviewed : [...PLACES, ...COMPANIONS].some((x) => !x.reviewed);
    const notice = unreviewed ? `<p class="lib-notice" role="note">${icon('info', 18)}<span>${esc(t('lib_unreviewed'))}</span></p>` : '';
    const arOnly = lang === 'ar' ? '' : `<p class="lib-lang">${esc(t('lib_ar_only'))}</p>`;
    this.root.setAttribute('aria-label', t('lib_title'));
    this.root.innerHTML = `
      <header class="lib-head">
        ${e ? `<button type="button" class="lib-icon" data-act="back" aria-label="${esc(t('lib_back'))}">${icon('arrowleft', 20, 'lib-back')}</button>` : ''}
        <h2 ${e ? 'lang="ar" dir="rtl"' : ''}>${e ? sal(e.item.name) : esc(t('lib_title'))}</h2>
        <button type="button" class="lib-icon" data-act="close" aria-label="${esc(t('l_close'))}">${icon('close', 20)}</button>
      </header>
      <div class="lib-body">${notice}${arOnly}${e ? this.detail(e) : this.list()}</div>`;
  }

  private onClick(ev: MouseEvent): void {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') this.close();
    else if (act === 'back') this.show(null);
    else if (act === 'open') this.show(this.find(btn.dataset.id ?? ''));
  }
}
