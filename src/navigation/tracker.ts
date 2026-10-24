import type { LatLng } from '../data/types';
import type { LiveFix, LocationService } from '../location/LocationService';
import { AwayDetector, RouteTrack, onAlternative } from '../location/progress';
import type { NavigationState, StepKind, StepView } from '../presentation/route-view';

/**
 * Live navigation, ported from the live app's src/navigation/NavigationTracker.ts (e0c6ca7).
 * The logic, thresholds and order of checks are unchanged. What changed: no Leaflet and no DOM.
 * Positions are LatLng tuples, the visitor marker, the camera, vibration and the wake lock are
 * reached through `NavigationHost`, and the status panel is gone: the UI renders `snapshot`.
 */

export { STATE_LABEL, type NavigationState, type StepKind, type StepView } from '../presentation/route-view';

/** One step of short, clear directions (inside the car park), as given by the route. */
export interface NavStep {
  kind: StepKind;
  path: LatLng[];
}

export interface NavigationSnapshot {
  position: LatLng | null;
  accuracy: number;
  remainingMeters: number;
  remainingMinutes: number;
  state: NavigationState;
  heading: number | null;
  follow: boolean;
  /** Share of the route done, 0–100 (0 until located). */
  progress: number;
  step: StepView | null;
}

/** What the tracker needs from the page: the visitor marker, the camera, and device features. */
export interface NavigationHost {
  showMe(lat: number, lng: number, accuracy: number, heading: number | null): void;
  /** Keep the visitor in sight (the host knows where the top bar and the sheet are). */
  follow(lat: number, lng: number): void;
  vibrate(pattern: number[]): void;
  /**
   * Keep the screen on; resolves to a release function, or null when unavailable. `onReleased` is
   * called if the system lets go of the lock (the page was hidden), so it is asked for again.
   */
  requestWakeLock(onReleased: () => void): Promise<(() => void) | null>;
}

export type TrackerLocation = Pick<LocationService, 'onFix' | 'onStatus' | 'setPace' | 'start' | 'status'>;

/** Starting pace in m/s, refined from the phone's own speed: a calm walk, or old-town traffic. */
export const PACE = { walk: { start: 1.35, min: 0.8, max: 2 }, drive: { start: 5, min: 1, max: 15 } };
/** Worse than this, the status says so (the marker still moves). */
export const LOW_ACCURACY_M = 35;
export const OFF_ROUTE_READS = 3;
/** Readings on an alternative route before switching to it (it is already planned and drawn). */
export const SWITCH_READS = 2;
export const REROUTE_COOLDOWN_MS = 8_000;
/** Arrived: this close to the end of the route (more if the GPS is poor, up to 40 m), twice in a row. */
export const ARRIVE_M = 20;
export const ARRIVE_READS = 2;
/** An instruction for the car park is shown from this far before its first step. */
export const STEP_AHEAD_M = 150;

const STOPPED: NavigationSnapshot = {
  position: null,
  accuracy: 0,
  remainingMeters: 0,
  remainingMinutes: 0,
  state: 'stopped',
  heading: null,
  follow: false,
  progress: 0,
  step: null,
};

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
  private releaseWakeLock: (() => void) | null = null;
  private state: NavigationSnapshot = { ...STOPPED };
  private listeners = new Set<(s: NavigationSnapshot) => void>();

  constructor(
    private location: TrackerLocation,
    private host: NavigationHost,
    private getPath: () => LatLng[],
    /** Called with the visitor's position (and heading, if known) when they have left the route. */
    private onReroute?: (from: LatLng, heading: number | null) => void,
    /** The other routes drawn on the map, and what to do when the visitor walks onto one of them. */
    private getAlternatives: () => LatLng[][] = () => [],
    private onSwitch?: (index: number) => void,
    /** The route's step-by-step directions (inside the car park) and the lot, if any. */
    private getSteps: () => { steps: NavStep[]; lot: number | null } | null = () => null,
    private now: () => number = () => Date.now(),
  ) {}

  onChange(fn: (s: NavigationSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get snapshot(): NavigationSnapshot {
    return this.state;
  }

  get active(): boolean {
    return this.off.length > 0;
  }

  /** The visitor dragged the map: stop following them. */
  userMovedMap(): void {
    if (this.state.follow) {
      this.state.follow = false;
      this.publish();
    }
  }

  /** The page became visible again: the screen lock is released by the system while hidden. */
  pageVisible(): void {
    if (this.active && !this.releaseWakeLock) void this.wakeLock();
  }

  /** «تتبّعني» on or off. */
  toggleFollow(): void {
    this.state.follow = !this.state.follow;
    if (this.state.follow && this.state.position) this.host.follow(...this.state.position);
    this.publish();
  }

  /** «متابعة» after arriving: keep tracking and don't announce the arrival again on this route. */
  keepGoing(): void {
    this.arrivalDismissed = true;
    this.state.state = 'updated';
    this.publish();
  }

  /** Walking or driving: sets the pace used for the minutes left. */
  async start(travel: 'walk' | 'drive' = 'walk'): Promise<void> {
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
    await this.wakeLock();
    const first = await this.location.start();
    if (!first && this.active) this.fail(this.location.status === 'denied' || this.location.status === 'unsupported' ? 'error' : 'signal-lost');
    else if (first) this.onFix(first);
  }

  /** The route was (re)drawn: measure progress on the new path. */
  routeChanged(): void {
    const path = this.getPath();
    this.track = path.length > 1 ? new RouteTrack(path) : null;
    this.alternatives = this.getAlternatives()
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

  stop(): void {
    this.off.forEach((f) => f());
    this.off = [];
    this.track = null;
    this.along = null;
    this.offRouteReads = 0;
    this.away.reset();
    this.speed = this.pace.start;
    this.location.setPace('walk');
    this.state = { ...STOPPED };
    this.releaseWakeLock?.();
    this.releaseWakeLock = null;
    this.publish();
  }

  private async wakeLock(): Promise<void> {
    try {
      this.releaseWakeLock = await this.host.requestWakeLock(() => (this.releaseWakeLock = null));
    } catch {
      /* optional */
    }
  }

  private fail(state: NavigationState): void {
    this.state.state = state;
    this.publish();
  }

  private onFix(f: LiveFix): void {
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
    if (this.offRouteReads >= OFF_ROUTE_READS && alt < 0 && this.onReroute && this.now() - this.lastReroute > REROUTE_COOLDOWN_MS) {
      this.lastReroute = this.now();
      this.onReroute([f.lat, f.lng], f.heading);
      return; // routeChanged() resets progress; the next reading continues on the new route
    }
    const walkingAway = this.away.push(f.time, p.remaining);
    // Close to the route: draw the visitor on it (GPS scatter of a few metres reads as "off route").
    // Further away, show where they really are.
    const snap = p.offset <= Math.min(15, Math.max(6, f.accuracy));
    const shown = snap ? p.point : pos;
    this.host.showMe(shown[0], shown[1], f.accuracy, f.heading);

    // Arrived: at the end of the route (twice in a row, so one jumpy reading does not count).
    const near = p.remaining <= Math.max(ARRIVE_M, Math.min(40, f.accuracy));
    this.arriveReads = near ? this.arriveReads + 1 : 0;
    const arrived = !this.arrivalDismissed && this.arriveReads >= ARRIVE_READS;
    if (arrived && this.state.state !== 'arrived') this.host.vibrate([120, 80, 120]);
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
      position: [shown[0], shown[1]],
      accuracy: f.accuracy,
      remainingMeters: p.remaining,
      remainingMinutes: Math.max(1, Math.ceil(p.remaining / (this.speed * 60))),
      state,
      heading: f.heading,
      follow: this.state.follow,
      progress: 0,
      step: null,
    };
    this.publish();
    if (this.state.follow) this.host.follow(shown[0], shown[1]);
  }

  private publish(): void {
    const s = this.state;
    if (s.state !== 'stopped') {
      const known = s.remainingMeters > 0 || s.state === 'updated';
      const total = this.track?.total ?? 0;
      s.progress = known && total > 0 ? Math.round(Math.min(1, Math.max(0, 1 - s.remainingMeters / total)) * 100) : 0;
      s.step = this.stepView();
    }
    this.listeners.forEach((fn) => fn(s));
  }

  /**
   * Inside the car park (and just before it): the step the visitor is on, with the metres left in
   * it, and the one after (the live app's stepHtml, as data).
   */
  private stepView(): StepView | null {
    if (!this.steps.length || this.along === null) return null;
    const a = this.along;
    if (a < this.steps[0].start - STEP_AHEAD_M || a > this.steps[this.steps.length - 1].end + 5) return null;
    let i = 0;
    while (i < this.steps.length - 1 && this.steps[i + 1].start <= a + 3) i++;
    const cur = a < this.steps[0].start ? null : this.steps[i];
    const next = cur ? this.steps[i + 1] : this.steps[0];
    const left = cur ? Math.max(0, Math.round((cur.end - a) / 5) * 5) : Math.max(0, Math.round((this.steps[0].start - a) / 5) * 5);
    return {
      now: cur ? { kind: cur.kind, meters: left } : null,
      next: next ? { kind: next.kind, meters: cur ? null : left } : null,
      lot: this.lot,
    };
  }
}
