import L from 'leaflet';
import type { LatLng } from '../data/types';
import { t } from '../i18n';
import type { LiveFix, LocationService } from '../location/LocationService';
import type { MeMarker } from '../location/MeMarker';
import { AwayDetector, RouteTrack, onAlternative } from '../location/progress';
import { esc } from '../ui/dom';

type NavigationState = 'locating' | 'updated' | 'low-accuracy' | 'away' | 'signal-lost' | 'off-route' | 'error' | 'stopped' | 'arrived';
export interface NavigationSnapshot {
  position: L.LatLng | null;
  accuracy: number;
  remainingMeters: number;
  remainingMinutes: number;
  state: NavigationState;
  heading: number | null;
  follow: boolean;
}

/** Starting pace in m/s, refined from the phone's own speed: a calm walk, or old-town traffic. */
const PACE = { walk: { start: 1.35, min: 0.8, max: 2 }, drive: { start: 5, min: 1, max: 15 } };
/** Worse than this, the status says so (the marker still moves). */
const LOW_ACCURACY_M = 35;
const OFF_ROUTE_READS = 3;
/** Readings on an alternative route before switching to it (it is already planned and drawn). */
const SWITCH_READS = 2;
const REROUTE_COOLDOWN_MS = 8_000;
/** Arrived: this close to the end of the route (more if the GPS is poor, up to 40 m), twice in a row. */
const ARRIVE_M = 20;
const ARRIVE_READS = 2;
/** An instruction for the car park is shown from this far before its first step. */
const STEP_AHEAD_M = 150;

/** One step of short, clear directions (inside the car park), as given by the route. */
export interface NavStep {
  kind: 'n' | 'e' | 's' | 'w' | 'up' | 'down' | 'lot_in' | 'lot_out';
  path: LatLng[];
}

/** The text of a step. */
const stepText = (kind: NavStep['kind'], lot: number | null): string =>
  kind === 'lot_in' || kind === 'lot_out' ? t(`g_step_${kind}`, { n: lot ?? '' }) : t(`g_step_${kind}`);

const LABEL: Record<NavigationState, string> = {
  'off-route': 'nav_off',
  'low-accuracy': 'nav_low',
  away: 'nav_away',
  locating: 'nav_locating',
  'signal-lost': 'nav_lost',
  error: 'nav_error',
  updated: 'nav_ok',
  stopped: 'nav_ok',
  arrived: 'nav_arrived',
};

/**
 * Live walking navigation on top of the shared LocationService: progress along the route
 * (forwards and backwards), remaining distance/time, walking-away and off-route detection, and an
 * optional "follow me" camera. Off the route, a visitor who has taken one of the alternative routes
 * on the map is switched to it at once; otherwise the route is re-planned from where they are,
 * favouring the way they are heading.
 */
export class NavigationTracker {
  private track: RouteTrack | null = null;
  private along: number | null = null;
  private away = new AwayDetector();
  private offRouteReads = 0;
  private alternatives: RouteTrack[] = [];
  /** The car park's steps, each with where it starts and ends along the route. */
  private steps: { kind: NavStep['kind']; start: number; end: number }[] = [];
  private lot: number | null = null;
  private arriveReads = 0;
  /** The visitor chose «متابعة» after arriving: no more arrival notice on this route. */
  private arrivalDismissed = false;
  private altReads: number[] = [];
  private lastReroute = 0;
  private pace = PACE.walk;
  private speed = PACE.walk.start;
  private off: (() => void)[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private panel?: HTMLElement;
  private state: NavigationSnapshot = { position: null, accuracy: 0, remainingMeters: 0, remainingMinutes: 0, state: 'stopped', heading: null, follow: false };
  private listeners = new Set<(s: NavigationSnapshot) => void>();

  constructor(
    private map: L.Map,
    private location: LocationService,
    private me: MeMarker,
    private getPath: () => L.LatLng[],
    /** Called with the visitor's position (and heading, if known) when they have left the route. */
    private onReroute?: (from: L.LatLng, heading: number | null) => void,
    /** The other routes drawn on the map, and what to do when the visitor walks onto one of them. */
    private getAlternatives: () => L.LatLng[][] = () => [],
    private onSwitch?: (index: number) => void,
    /** The route's step-by-step directions (inside the car park) and the lot, if any. */
    private getSteps: () => { steps: NavStep[]; lot: number | null } | null = () => null,
  ) {
    map.on('dragstart', () => {
      if (this.state.follow) {
        this.state.follow = false;
        this.publish();
      }
    });
    document.addEventListener('langchange', () => this.renderPanel());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.active && !this.wakeLock) void this.requestWakeLock();
    });
  }

  onChange(fn: (s: NavigationSnapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get snapshot() {
    return this.state;
  }

  get active(): boolean {
    return this.off.length > 0;
  }

  /** Walking or driving: sets the pace used for the minutes left. */
  async start(travel: 'walk' | 'drive' = 'walk') {
    this.stop();
    this.pace = PACE[travel];
    this.location.setPace(travel);
    this.speed = this.pace.start;
    this.routeChanged();
    this.state = { ...this.state, state: 'locating', follow: true };
    this.off.push(
      this.location.onFix((f) => this.onFix(f)),
      this.location.onStatus((s) => {
        if (s === 'lost') this.fail('signal-lost');
        else if (s === 'denied' || s === 'unsupported') this.fail('error');
      }),
    );
    this.publish();
    await this.requestWakeLock();
    const first = await this.location.start();
    if (!first && this.active) this.fail(this.location.status === 'denied' || this.location.status === 'unsupported' ? 'error' : 'signal-lost');
    else if (first) this.onFix(first);
  }

  /** The route was (re)drawn: measure progress on the new path. */
  routeChanged() {
    const path = this.getPath().map((p) => [p.lat, p.lng] as LatLng);
    this.track = path.length > 1 ? new RouteTrack(path) : null;
    this.alternatives = this.getAlternatives()
      .map((alt) => alt.map((p) => [p.lat, p.lng] as LatLng))
      .filter((alt) => alt.length > 1)
      .map((alt) => new RouteTrack(alt));
    this.altReads = this.alternatives.map(() => 0);
    // Where each step starts and ends along the route (located in order, so a road driven twice —
    // the same footprint on levels B and A — is matched to the right pass).
    const given = this.getSteps();
    this.lot = given?.lot ?? null;
    this.steps = [];
    let prev: number | null = null;
    for (const st of given?.steps ?? []) {
      if (!this.track || st.path.length < 2) continue;
      const a: number = this.track.locate(st.path[0], prev).along;
      const b: number = this.track.locate(st.path[st.path.length - 1], a).along;
      this.steps.push({ kind: st.kind, start: a, end: Math.max(a, b) });
      prev = b;
    }
    this.arriveReads = 0;
    this.arrivalDismissed = false;
    this.along = null;
    this.offRouteReads = 0;
    this.away.reset();
  }

  /** The stretch of the route ahead of the visitor (from where they are, `m` metres on), once located. */
  ahead(m: number): LatLng[] | null {
    return this.track && this.along !== null ? this.track.slice(this.along, this.along + m) : null;
  }

  stop() {
    this.off.forEach((f) => f());
    this.off = [];
    this.track = null;
    this.along = null;
    this.offRouteReads = 0;
    this.away.reset();
    this.speed = this.pace.start;
    this.location.setPace('walk');
    this.state = { position: null, accuracy: 0, remainingMeters: 0, remainingMinutes: 0, state: 'stopped', heading: null, follow: false };
    this.panel?.remove();
    this.panel = undefined;
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.publish();
  }

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
      }
    } catch {
      /* optional */
    }
  }

  private fail(state: NavigationState) {
    this.state.state = state;
    this.publish();
  }

  private onFix(f: LiveFix) {
    if (!this.track) return;
    const pos: LatLng = [f.lat, f.lng];
    const p = this.track.locate(pos, this.along);
    this.along = p.along;
    if (f.speed > 0.4) this.speed = this.speed * 0.8 + Math.min(this.pace.max, Math.max(this.pace.min, f.speed)) * 0.2;

    const offRoute = p.offset > Math.max(25, f.accuracy * 1.5);
    this.offRouteReads = offRoute ? this.offRouteReads + 1 : 0;
    // Off the route but on one of the alternatives already drawn: switch to it.
    const alt = offRoute ? onAlternative(this.alternatives, pos, f.accuracy) : -1;
    this.altReads = this.altReads.map((n, i) => (i === alt ? n + 1 : 0));
    if (alt >= 0 && this.altReads[alt] >= SWITCH_READS && this.onSwitch) {
      this.onSwitch(alt);
      return; // routeChanged() follows; the next reading continues on the chosen route
    }
    if (this.offRouteReads >= OFF_ROUTE_READS && alt < 0 && this.onReroute && Date.now() - this.lastReroute > REROUTE_COOLDOWN_MS) {
      this.lastReroute = Date.now();
      this.onReroute(L.latLng(f.lat, f.lng), f.heading);
      return; // routeChanged() resets progress; the next reading continues on the new route
    }
    const walkingAway = this.away.push(f.time, p.remaining);
    // Close to the route: draw the visitor on it (GPS scatter of a few metres reads as "off route").
    // Further away, show where they really are.
    const snap = p.offset <= Math.min(15, Math.max(6, f.accuracy));
    const shown = snap ? p.point : pos;
    this.me.update(shown[0], shown[1], f.accuracy, f.heading);

    // Arrived: at the end of the route (twice in a row, so one jumpy reading does not count).
    const near = p.remaining <= Math.max(ARRIVE_M, Math.min(40, f.accuracy));
    this.arriveReads = near ? this.arriveReads + 1 : 0;
    const arrived = !this.arrivalDismissed && this.arriveReads >= ARRIVE_READS;
    if (arrived && this.state.state !== 'arrived') navigator.vibrate?.([120, 80, 120]);
    const state: NavigationState = arrived
      ? 'arrived'
      : this.offRouteReads >= OFF_ROUTE_READS
        ? 'off-route'
        : walkingAway
          ? 'away'
          : f.accuracy > LOW_ACCURACY_M
            ? 'low-accuracy'
            : 'updated';
    this.state = {
      position: L.latLng(shown[0], shown[1]),
      accuracy: f.accuracy,
      remainingMeters: p.remaining,
      remainingMinutes: Math.max(1, Math.ceil(p.remaining / (this.speed * 60))),
      state,
      heading: f.heading,
      follow: this.state.follow,
    };
    this.publish();
    if (this.state.follow) this.followTo(this.state.position!);
  }

  /**
   * Keep the visitor in sight: in the middle of the map left visible between the top bar and the
   * tracking bar (the middle of the screen is under the bar).
   */
  private followTo(pos: L.LatLng) {
    const size = this.map.getSize();
    const mapTop = this.map.getContainer().getBoundingClientRect().top;
    const top = (document.getElementById('ui-top')?.getBoundingClientRect().bottom ?? mapTop) - mapTop;
    const bar = this.panel ? this.panel.getBoundingClientRect().top - mapTop : size.y;
    const y = bar > top + 80 ? (top + bar) / 2 : size.y / 2;
    const at = this.map.latLngToContainerPoint(pos);
    this.map.panBy([at.x - size.x / 2, at.y - y], { animate: true, duration: 0.6, easeLinearity: 0.5 });
  }

  private publish() {
    this.renderPanel();
    this.listeners.forEach((fn) => fn(this.state));
  }

  private renderPanel() {
    if (this.state.state === 'stopped') return;
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = 'navigation-status';
      this.panel.setAttribute('role', 'status');
      this.panel.setAttribute('aria-live', 'polite');
      this.panel.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!b) return;
        if (b.dataset.nav === 'end') {
          // The map ends the route (src/map/main.ts), as «إنهاء المسار» does.
          document.dispatchEvent(new CustomEvent('route-end-request'));
          return;
        }
        if (b.dataset.nav === 'keep') {
          this.arrivalDismissed = true;
          this.state.state = 'updated';
          this.publish();
          return;
        }
        this.state.follow = !this.state.follow;
        if (this.state.follow && this.state.position) this.followTo(this.state.position);
        this.publish();
      });
      document.body.append(this.panel);
    }
    const s = this.state;
    this.panel.dataset.state = s.state;
    const known = s.remainingMeters > 0 || s.state === 'updated';
    const total = this.track?.total ?? 0;
    const big = known
      ? `<span class="nav-big">${s.remainingMinutes}<small> ${esc(t('dur_m', { m: '' }).trim())}</small></span><span class="nav-big" style="font-size:18px">${Math.round(s.remainingMeters / 5) * 5}<small> ${esc(t('meters', { m: '' }).trim())}</small></span>`
      : '';
    const label = s.state === 'low-accuracy' ? `${t('nav_low')} · ${t('nav_acc', { m: Math.round(s.accuracy) })}` : t(LABEL[s.state]);
    const done = known && total > 0 ? Math.round(Math.min(1, Math.max(0, 1 - s.remainingMeters / total)) * 100) : 0;
    if (s.state === 'arrived') {
      this.panel.innerHTML = `<strong class="nav-arrived">${esc(t('nav_arrived'))}</strong>
        <button type="button" class="nav-end" data-nav="end">${esc(t('nav_arrived_end'))}</button>
        <button type="button" data-nav="keep">${esc(t('nav_arrived_keep'))}</button>`;
      return;
    }
    this.panel.innerHTML = `${big}<strong>${esc(label)}</strong><button type="button" data-nav="follow">${esc(t(s.follow ? 'nav_unfollow' : 'nav_follow'))}</button>${this.stepHtml()}${
      known ? `<span class="nav-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${done}"><span style="width:${done}%"></span></span>` : ''
    }`;
  }

  /**
   * Inside the car park (and just before it): the step the visitor is on, with the metres left in
   * it, and the one after — short and clear.
   */
  private stepHtml(): string {
    if (!this.steps.length || this.along === null) return '';
    const a = this.along;
    if (a < this.steps[0].start - STEP_AHEAD_M || a > this.steps[this.steps.length - 1].end + 5) return '';
    let i = 0;
    while (i < this.steps.length - 1 && this.steps[i + 1].start <= a + 3) i++;
    const cur = a < this.steps[0].start ? null : this.steps[i];
    const next = cur ? this.steps[i + 1] : this.steps[0];
    const left = cur ? Math.max(0, Math.round((cur.end - a) / 5) * 5) : Math.max(0, Math.round((this.steps[0].start - a) / 5) * 5);
    const now = cur ? `${esc(stepText(cur.kind, this.lot))} · ${esc(t('meters', { m: left }))}` : '';
    const then = next ? `${esc(t('g_then'))}: ${esc(stepText(next.kind, this.lot))}${cur ? '' : ` · ${esc(t('meters', { m: left }))}`}` : '';
    return `<span class="nav-step">${now ? `<b>${now}</b>` : ''}${then ? `<small>${then}</small>` : ''}</span>`;
  }
}
