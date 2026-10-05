import L from 'leaflet';
import type { LatLng } from '../data/types';
import { t } from '../i18n';
import type { LiveFix, LocationService } from '../location/LocationService';
import type { MeMarker } from '../location/MeMarker';
import { AwayDetector, RouteTrack } from '../location/progress';
import { esc } from '../ui/dom';

type NavigationState = 'locating' | 'updated' | 'low-accuracy' | 'away' | 'signal-lost' | 'off-route' | 'error' | 'stopped';
export interface NavigationSnapshot {
  position: L.LatLng | null;
  accuracy: number;
  remainingMeters: number;
  remainingMinutes: number;
  state: NavigationState;
  heading: number | null;
  follow: boolean;
}

const DEFAULT_SPEED = 1.35; // m/s, a calm walking pace
/** Worse than this, the status says so (the marker still moves). */
const LOW_ACCURACY_M = 35;
const OFF_ROUTE_READS = 3;
const REROUTE_COOLDOWN_MS = 15_000;

const LABEL: Record<NavigationState, string> = {
  'off-route': 'nav_off',
  'low-accuracy': 'nav_low',
  away: 'nav_away',
  locating: 'nav_locating',
  'signal-lost': 'nav_lost',
  error: 'nav_error',
  updated: 'nav_ok',
  stopped: 'nav_ok',
};

/**
 * Live walking navigation on top of the shared LocationService: progress along the route
 * (forwards and backwards), remaining distance/time, walking-away and off-route detection with
 * automatic re-routing, and an optional "follow me" camera.
 */
export class NavigationTracker {
  private track: RouteTrack | null = null;
  private along: number | null = null;
  private away = new AwayDetector();
  private offRouteReads = 0;
  private lastReroute = 0;
  private speed = DEFAULT_SPEED;
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
    /** Called with the visitor's position when they have left the route. */
    private onReroute?: (from: L.LatLng) => void,
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

  async start() {
    this.stop();
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
    this.along = null;
    this.offRouteReads = 0;
    this.away.reset();
  }

  stop() {
    this.off.forEach((f) => f());
    this.off = [];
    this.track = null;
    this.along = null;
    this.offRouteReads = 0;
    this.away.reset();
    this.speed = DEFAULT_SPEED;
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
    if (f.speed > 0.4) this.speed = this.speed * 0.8 + Math.min(2, Math.max(0.8, f.speed)) * 0.2;

    const offRoute = p.offset > Math.max(25, f.accuracy * 1.5);
    this.offRouteReads = offRoute ? this.offRouteReads + 1 : 0;
    if (this.offRouteReads >= OFF_ROUTE_READS && this.onReroute && Date.now() - this.lastReroute > REROUTE_COOLDOWN_MS) {
      this.lastReroute = Date.now();
      this.onReroute(L.latLng(f.lat, f.lng));
      return; // routeChanged() resets progress; the next reading continues on the new route
    }
    const walkingAway = this.away.push(f.time, p.remaining);
    // Close to the route: draw the visitor on it (GPS scatter of a few metres reads as "off route").
    // Further away, show where they really are.
    const snap = p.offset <= Math.min(15, Math.max(6, f.accuracy));
    const shown = snap ? p.point : pos;
    this.me.update(shown[0], shown[1], f.accuracy, f.heading);

    const state: NavigationState =
      this.offRouteReads >= OFF_ROUTE_READS ? 'off-route' : walkingAway ? 'away' : f.accuracy > LOW_ACCURACY_M ? 'low-accuracy' : 'updated';
    this.state = {
      position: L.latLng(shown[0], shown[1]),
      accuracy: f.accuracy,
      remainingMeters: p.remaining,
      remainingMinutes: Math.max(1, Math.ceil(p.remaining / (this.speed * 60))),
      state,
      heading: f.heading,
      follow: this.state.follow,
    };
    if (this.state.follow) this.map.panTo(this.state.position!, { animate: true, duration: 0.6, easeLinearity: 0.5 });
    this.publish();
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
        if (!(e.target as HTMLElement).closest('button')) return;
        this.state.follow = !this.state.follow;
        if (this.state.follow && this.state.position) this.map.panTo(this.state.position, { animate: true });
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
    this.panel.innerHTML = `${big}<strong>${esc(label)}</strong><button type="button">${esc(t(s.follow ? 'nav_unfollow' : 'nav_follow'))}</button>${
      known ? `<span class="nav-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${done}"><span style="width:${done}%"></span></span>` : ''
    }`;
  }
}
