import type { Poi } from '../data/types';
import { POI_BY_ID } from '../data';
import { elevatorBadge, isClosed, pairOf, type Facilities } from '../domain/facilities';
import { nearestOuterGate } from '../domain/nearby';
import { dirName, ds, nm, num, streetName, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';
import { dirVar, poiColor, poiIcon } from './poi-view';
import { rawdahNowHtml } from './rawdah-card';
import type { Category } from '../data/types';

/** Category name above a place's title (the filter pill labels, already in every language). */
const CATEGORY_LABEL: Record<Category, string> = {
  gates: 'p_gates',
  toilets: 'p_toilets',
  parking: 'p_parking',
  landmarks: 'p_landmarks',
  wheelchair: 'p_wheelchair',
  emergency: 'p_emergency',
  women: 'p_women',
  hotels: 'p_hotels',
  food: 'p_food',
  shopping: 'p_shopping',
};

export type SheetState = 'closed' | 'half' | 'full';

/** What the sheet shows about the route being followed. */
export interface RouteSummary {
  meters: number;
  minutes: number;
  nearestEntrance?: number;
  drive?: { meters: number; lot?: number; walkMeters: number; entrance?: 'quba' | 'sultana'; unsure?: boolean; level?: 'A' | 'B'; exit?: 'quba' | 'sultana' };
}

const WALK_M_PER_MIN = 80;

/**
 * Draggable bottom sheet (closed / half / full) with a POI's details.
 */
/** The car park level chosen for driving (B below, the default; A above), remembered. */
function savedLevel(): 'A' | 'B' {
  try {
    return localStorage.getItem('level') === 'A' ? 'A' : 'B';
  } catch {
    return 'B';
  }
}

function savedTravel(): 'walk' | 'drive' {
  try {
    return localStorage.getItem('travel') === 'drive' ? 'drive' : 'walk';
  } catch {
    return 'walk';
  }
}

export class Sheet {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private state: SheetState = 'closed';
  private poi: Poi | null = null;
  private route: RouteSummary | null = null;
  /** How the visitor travels: walking by default, or by car (remembered). */
  private mode: 'walk' | 'drive' = savedTravel();
  private lvl: 'A' | 'B' = savedLevel();

  constructor(
    private fac: Facilities,
    private on: { close(): void; goTo(p: Poi): void; route(p: Poi): void; wayOut(): void; endRoute(): void; share(p: Poi): void; state(s: SheetState): void },
  ) {
    this.root = document.createElement('section');
    this.root.className = 'sheet';
    this.root.dataset.state = 'closed';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.innerHTML = `<button type="button" class="sheet-grab" aria-label=""><span></span></button>
      <div class="sheet-body" id="sheet-body"></div><div class="sheet-foot" id="sheet-foot"></div>`;
    this.body = this.root.querySelector('#sheet-body')!;
    this.foot = this.root.querySelector('#sheet-foot')!;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.on.close();
    });
    this.dragging();
    fac.onChange(() => this.poi && this.render());
  }

  get current(): Poi | null {
    return this.poi;
  }

  show(p: Poi): void {
    const wasClosed = this.state === 'closed';
    this.poi = p;
    this.route = null;
    this.render();
    this.setState(this.state === 'full' ? 'full' : 'half');
    this.body.scrollTop = 0;
    if (wasClosed) (this.root.querySelector('.sh-title') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  get level(): 'A' | 'B' {
    return this.lvl;
  }

  get travel(): 'walk' | 'drive' {
    return this.mode;
  }

  /** Show (or clear) the route summary for the current POI. */
  setRoute(r: RouteSummary | null): void {
    this.route = r;
    this.root.dataset.route = r ? 'active' : 'inactive';
    this.render();
    // Re-snap so the height matches the new content, and let listeners update (header, nav bar).
    this.setState(this.state === 'closed' ? 'closed' : 'half');
  }

  get hasRoute(): boolean {
    return this.route !== null;
  }

  hide(): void {
    this.poi = null;
    this.route = null;
    this.setState('closed');
  }

  /** Visible sheet height in px (to keep the selected marker above it). */
  visibleHeight(): number {
    if (this.state === 'closed') return 0;
    return this.state === 'full' ? this.root.offsetHeight : this.halfHeight();
  }

  private halfHeight(): number {
    if (this.route) {
      // Route mode: exactly the compact summary + the end button, never more than 45% of the screen.
      // The body stretches to fill the sheet, so measure its last child from the sheet's top edge
      // (rects, not offsetTop: the grab handle sits above the body and offsetTop would leave it out).
      const last = this.body.lastElementChild as HTMLElement | null;
      const pad = parseFloat(getComputedStyle(this.body).paddingBottom) || 0;
      const top = this.root.getBoundingClientRect().top;
      const content = (last ? last.getBoundingClientRect().bottom - top : 0) + pad + this.foot.offsetHeight;
      return Math.min(this.root.offsetHeight, Math.ceil(content), Math.round(window.innerHeight * 0.45));
    }
    return Math.min(this.root.offsetHeight, Math.round(window.innerHeight * 0.55));
  }

  private offsetFor(s: SheetState): number {
    const h = this.root.offsetHeight;
    return s === 'full' ? 0 : s === 'half' ? h - this.halfHeight() : h;
  }

  setState(s: SheetState): void {
    this.state = s;
    this.root.dataset.state = s;
    this.root.style.setProperty('--y', s === 'closed' ? '100%' : `${this.offsetFor(s)}px`);
    this.root.style.setProperty('--half', `${this.halfHeight()}px`);
    const grab = this.root.querySelector('.sheet-grab')!;
    grab.setAttribute('aria-expanded', String(s === 'full'));
    this.on.state(s);
  }

  /** Drag the grab handle or header to snap between half, full and closed. */
  private dragging() {
    let startY = 0;
    let startOff = 0;
    let lastY = 0;
    let lastT = 0;
    let v = 0;
    let active = false;
    let moved = false;
    const handle = (e: PointerEvent) => (e.target as HTMLElement).closest('.sheet-grab, .sh-head') !== null;

    this.root.addEventListener('pointerdown', (e) => {
      if (!handle(e) || this.state === 'closed') return;
      active = true;
      moved = false;
      startY = lastY = e.clientY;
      lastT = e.timeStamp;
      startOff = this.offsetFor(this.state);
      v = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 6) return;
      if (!moved) {
        moved = true;
        this.root.classList.add('is-dragging');
      }
      const dt = Math.max(1, e.timeStamp - lastT);
      v = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      const off = Math.max(0, startOff + dy);
      this.root.style.setProperty('--y', `${off}px`);
    });
    const end = () => {
      if (!active) return;
      active = false;
      this.root.classList.remove('is-dragging');
      if (!moved) return;
      const h = this.root.offsetHeight;
      const off = parseFloat(this.root.style.getPropertyValue('--y')) || 0;
      // Fast flicks win; otherwise snap to the nearest stop.
      let next: SheetState;
      if (v > 0.6) next = this.state === 'full' ? 'half' : 'closed';
      else if (v < -0.6) next = 'full';
      else {
        const stops: [SheetState, number][] = [
          ['full', 0],
          ['half', this.offsetFor('half')],
          ['closed', h],
        ];
        next = stops.reduce((a, b) => (Math.abs(b[1] - off) < Math.abs(a[1] - off) ? b : a))[0];
      }
      if (next === 'closed') this.on.close();
      else this.setState(next);
      // Swallow the click that follows a drag.
      const stop = (ev: Event) => ev.stopPropagation();
      this.root.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => this.root.removeEventListener('click', stop, { capture: true }), 0);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private onClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || !this.poi) return;
    const act = b.dataset.act;
    if (act === 'close') {
      if (this.route) this.on.endRoute();
      this.on.close();
    }
    else if (act === 'grab') this.setState(this.state === 'full' ? 'half' : 'full');
    else if (act === 'route') this.on.route(this.poi);
    else if (act === 'endroute') this.on.endRoute();
    else if (act === 'share') this.on.share(this.poi);
    else if (act === 'level') {
      this.lvl = b.dataset.level === 'A' ? 'A' : 'B';
      try {
        localStorage.setItem('level', this.lvl);
      } catch {
        /* private mode */
      }
      this.render();
    }
    else if (act === 'wayout') this.on.wayOut();
    else if (act === 'wayin' && this.poi) this.on.route(this.poi);
    else if (act === 'travel') {
      this.mode = b.dataset.mode === 'drive' ? 'drive' : 'walk';
      try {
        localStorage.setItem('travel', this.mode);
      } catch {
        /* private mode */
      }
      this.render();
    }
    else if (act === 'go') {
      const p = POI_BY_ID.get(Number(b.dataset.id));
      if (p) this.on.goTo(p);
    }
  }

  render(): void {
    const p = this.poi;
    if (!p) return;
    const fac = this.fac;
    const status = fac.status(p.id);
    const closed = isClosed(status);
    const grab = this.root.querySelector('.sheet-grab') as HTMLElement;
    grab.dataset.act = 'grab';
    grab.setAttribute('aria-label', t('sheet_label'));
    this.root.setAttribute('aria-label', nm(p));
    // Category colour tints the top of the card and its icon.
    this.root.style.setProperty('--c', closed ? 'var(--cat-gray)' : poiColor(p));

    const chips: string[] = [`<span class="chip dir" style="--c:${dirVar(p)}"><span class="dot"></span>${esc(t('side', { d: dirName(p.direction) }))}</span>`];
    if (status === 'open') chips.push(`<span class="chip ok"><span class="dot"></span>${esc(t('a_open'))}</span>`);
    else if (status === 'maintenance') chips.push(`<span class="chip warn"><span class="dot"></span>${esc(t('maint'))}</span>`);
    else if (status === 'works') chips.push(`<span class="chip warn"><span class="dot"></span>${esc(t('a_works'))}</span>`);
    chips.push(`<span class="chip">${esc(t('num_label', { id: p.id }))}</span>`);
    if (p.category === 'parking') {
      const sub = p.access === 'subscribers';
      chips.push(`<span class="chip park-access${sub ? ' is-sub' : ''}">${sub ? icon('lock', 13) : ''}${esc(t(sub ? 'park_sub' : 'park_public'))}</span>`);
    }
    const eb = elevatorBadge(p);
    if (eb && !closed) chips.push(`<span class="chip info">${icon('works', 14)}${esc(t('elev'))}</span>`);

    // Why it's closed / what's special about it.
    const notes: string[] = [];
    if (status === 'works') {
      const by = fac.worksBy(p.id);
      notes.push(`<div>${icon('works', 20)}<span>${esc(by ? t('works_p', { id: by }) : t('works'))}</span></div>`);
      if (!by && eb === 'elev_w') notes.push(`<div>${icon('clock', 20)}<span>${esc(t('elev_w'))}</span></div>`);
    } else if (status === 'maintenance') {
      notes.push(`<div>${icon('works', 20)}<span>${esc(t('maint'))}</span></div>`);
    }
    const pair = p.category === 'toilets' ? pairOf(p) : undefined;
    const pairLine = pair
      ? fac.worksBy(p.id) === pair.id
        ? '' // already explained by works_p
        : `<div class="note">${icon('link', 18)}<span>${esc(t('pair', { id: pair.id }))}</span></div>`
      : '';

    const alt = closed ? fac.nearestOpen(p) : null;
    const altBox = alt
      ? `<div class="alt">
          <span class="sh-icon" style="--c:${poiColor(alt.poi)};width:40px;height:40px;border-radius:50%">${poiIcon(alt.poi, 22)}</span>
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px">
            <span class="alt-k">${esc(t('alt_title'))}</span><span class="alt-n">${esc(nm(alt.poi))}</span>
            <span class="alt-m">${esc(t('alt_meta', { m: num(alt.meters), min: Math.max(1, Math.round(alt.meters / WALK_M_PER_MIN)) }))}</span>
          </span>
          <button type="button" class="btn" data-act="go" data-id="${alt.poi.id}">${esc(t('go'))}<span class="flip">${icon('arrowleft', 18)}</span></button>
        </div>`
      : '';

    const rawdah = p.rawdah
      ? `<div class="ro-box"><div class="rawdah-meta" style="margin:0">${rawdahNowHtml()}</div><ul class="ro-sched">${t('ro_s')
          .split(/\s*·\s*/)
          .map((line) => `<li>${esc(line)}</li>`)
          .join('')}</ul></div>`
      : '';

    const gate = nearestOuterGate(p);
    const facts = `<div class="facts">
        <div class="fact"><span class="fact-k">${icon('gate', 16)}${esc(t('near_gate'))}</span>
          <span class="fact-v">${gate ? `${esc(t('gate_n', { id: gate.poi.id }))} · ${esc(t('meters', { m: num(gate.meters) }))}` : '—'}</span></div>
        <div class="fact"><span class="fact-k">${icon('road', 16)}${esc(t('near_street'))}</span>
          <span class="fact-v">${esc(streetName(p.direction))}</span></div>
      </div>`;

    const r = this.route;
    const routeBox = r
      ? `<div class="route-box" role="status">
          <div class="route-stats">
            <span class="rs"><span class="sr-only">${esc(t('r_dist'))}: </span><span class="rs-v">${esc(t('meters', { m: num(Math.round(r.meters / 5) * 5) }))}</span></span>
            <span class="rs"><span class="sr-only">${esc(t(r.drive ? 'r_time_total' : 'r_time'))}: </span><span class="rs-v">${esc(t('r_min', { t: r.minutes }))}</span></span>
            <span class="rs rs-side"><span class="dot" style="--c:${dirVar(p)}"></span><span class="sr-only">${esc(t('side', { d: '' }).trim())}: </span>${esc(dirName(p.direction))}</span>
          </div>
          ${r.nearestEntrance ? `<div class="route-nearest">${esc(t('park_nearest', { n: r.nearestEntrance }))}</div>` : ''}
          ${
            r.drive
              ? `<div class="route-legs">
              <span class="leg leg-drive">${icon('car', 16)}${esc(t('r_drive'))} · ${esc(t('km', { k: (r.drive.meters / 1000).toFixed(1) }))}</span>
              ${r.drive.entrance ? `<span class="leg leg-ent">${esc(t(r.drive.entrance === 'quba' ? 'g_in_quba' : 'g_in_sultana'))}</span>` : ''}
              ${r.drive.exit ? `<span class="leg leg-ent">${esc(t(r.drive.exit === 'quba' ? 'g_out_quba' : 'g_out_sultana'))}</span>` : ''}
              ${r.drive.lot ? `<span class="leg leg-lot">${esc(r.drive.level ? t('r_lot_level', { n: r.drive.lot, l: r.drive.level }) : t('r_lot', { n: r.drive.lot }))}</span>` : ''}
              ${r.drive.walkMeters > 5 ? `<span class="leg leg-walk">${icon('walk', 16)}${esc(t('r_walk'))} · ${esc(t('meters', { m: num(Math.round(r.drive.walkMeters / 5) * 5) }))}</span>` : ''}
            </div>
            ${r.drive.unsure ? `<div class="route-unsure">${esc(t('g_unsure'))}</div>` : ''}`
              : ''
          }
        </div>`
      : '';

    if (r) {
      // While walking: destination + distance/time only, so most of the map stays visible.
      this.body.innerHTML = `
        <div class="sh-head sh-head-route">
          <span class="sh-icon" style="--c:${closed ? 'var(--cat-gray)' : poiColor(p)}">${poiIcon(p, 22)}</span>
          <div style="flex:1;min-width:0"><div class="sh-kicker">${esc(t(r.drive?.exit ? 'r_title_exit' : r.drive ? 'r_title_drive' : 'r_title'))}</div><h2 class="sh-title" tabindex="-1">${esc(nm(p))}</h2></div>
          <button type="button" class="icon-btn lg" data-act="close" aria-label="${esc(t('l_close'))}">${icon('close', 18)}</button>
        </div>
        ${routeBox}`;
      // By car to a lot: switch between the way in and the way out of the car park.
      const swap = r.drive?.lot
        ? r.drive.exit
          ? `<button type="button" class="btn" data-act="wayin">${icon('car', 20)}${esc(t('g_way_in'))}</button>`
          : `<button type="button" class="btn" data-act="wayout">${icon('car', 20)}${esc(t('g_way_out'))}</button>`
        : '';
      this.foot.innerHTML = `${swap}<button type="button" class="btn block danger" data-act="endroute">${icon('close', 20)}${esc(t('route_end'))}</button>`;
      return;
    }

    this.body.innerHTML = `
      <div class="sh-head">
        <span class="sh-icon" style="--c:${closed ? 'var(--cat-gray)' : poiColor(p)}">${poiIcon(p, 26)}</span>
        <div style="flex:1;min-width:0">
          <div class="sh-kicker">${esc(t(p.subCategory === 'historic' ? 'p_historic' : CATEGORY_LABEL[p.category]))}</div>
          <h2 class="sh-title" tabindex="-1">${esc(nm(p))}</h2>
          ${
            // A named gate's description is the story of its name: shown once, under «سبب التسمية».
            p.subCategory === 'gate_inner' && p.name_ar !== `باب رقم ${p.id}`
              ? `<div class="gate-about"><div class="gate-about-k">${esc(t('gate_about'))}</div><p>${esc(ds(p))}</p></div>`
              : `<p class="sh-desc">${esc(ds(p))}</p>`
          }
        </div>
        <button type="button" class="icon-btn lg" data-act="close" aria-label="${esc(t('l_close'))}">${icon('close', 18)}</button>
      </div>
      <div class="chips">${chips.join('')}</div>
      ${notes.length ? `<div class="notice">${notes.join('')}</div>` : ''}
      ${pairLine}
      ${altBox}
      ${rawdah}
      ${facts}`;
    const travel = (m: 'walk' | 'drive', ic: 'walk' | 'car') =>
      `<button type="button" class="travel-btn" data-act="travel" data-mode="${m}" aria-pressed="${this.mode === m}" aria-label="${esc(t(m === 'walk' ? 'travel_walk' : 'travel_drive'))}" title="${esc(t(m === 'walk' ? 'travel_walk' : 'travel_drive'))}">${icon(ic, 20)}</button>`;
    // By car: the car park level to park on (B below, the way in and out; A above, by the ramps).
    const level = (l: 'A' | 'B') =>
      `<button type="button" class="travel-btn level-btn" data-act="level" data-level="${l}" aria-pressed="${this.lvl === l}" aria-label="${esc(t('lvl_name', { l }))}" title="${esc(t('lvl_name', { l }))}">${l}</button>`;
    const levels =
      this.mode === 'drive'
        ? `<div class="levels-row"><span class="levels-k">${esc(t('lvl_title'))}</span><div class="travel levels" role="group" aria-label="${esc(t('lvl_title'))}">${level('B')}${level('A')}</div></div>`
        : '';
    this.foot.innerHTML = `<div class="travel" role="group" aria-label="${esc(t('travel_mode'))}">${travel('walk', 'walk')}${travel('drive', 'car')}</div>${levels}
      <button type="button" class="btn block" data-act="route">${icon(this.mode === 'drive' ? 'car' : 'route', 20)}${esc(t('route'))}</button>
      <button type="button" class="btn btn-square" data-act="share" aria-label="${esc(t('share_place'))}" title="${esc(t('share_place'))}">${icon('share', 20)}</button>`;
  }
}
