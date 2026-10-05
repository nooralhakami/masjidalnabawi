import { MotionHeading, PositionFilter, metres } from './filter';

/** The mosque, for the "too far away" check. */
const MOSQUE = { lat: 24.4672, lng: 39.6111 };
const MAX_KM = 3;
const FIRST_FIX_TIMEOUT_MS = 12_000;
const SIGNAL_LOST_MS = 20_000;
/** Below this walking speed the arrow follows the compass instead of the direction of travel. */
const MOVING_SPEED = 0.6;

export interface LiveFix {
  lat: number;
  lng: number;
  /** Filtered accuracy (m). */
  accuracy: number;
  /** Direction the visitor is walking or facing (degrees), or null when unknown. */
  heading: number | null;
  /** Walking speed (m/s). */
  speed: number;
  time: number;
}

export type LocationStatus = 'idle' | 'locating' | 'live' | 'lost' | 'denied' | 'unsupported' | 'far';

interface OrientationWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/**
 * The visitor's live position for the whole app (the "my location" button and navigation share it).
 * - Asks only when the visitor taps a button, then keeps watching while the page is visible.
 * - Shows a quick approximate fix first (last known position), refined by high-accuracy readings.
 * - Smooths readings with a constant-velocity Kalman filter and derives the walking direction;
 *   when standing, the phone's compass gives the facing direction.
 */
export class LocationService {
  private watchId: number | null = null;
  private filter = new PositionFilter();
  private motion = new MotionHeading();
  private compass: number | null = null;
  private compassOn = false;
  private lostTimer = 0;
  private wanted = false;
  private fixListeners = new Set<(f: LiveFix) => void>();
  private statusListeners = new Set<(s: LocationStatus, extra?: { km: number }) => void>();
  current: LiveFix | null = null;
  status: LocationStatus = 'idle';

  constructor() {
    document.addEventListener('visibilitychange', () => {
      // Save battery while hidden; resume (and re-acquire) when the visitor comes back.
      if (document.visibilityState === 'hidden') this.clearWatch();
      else if (this.wanted && this.watchId === null) this.watch();
    });
  }

  onFix(fn: (f: LiveFix) => void): () => void {
    this.fixListeners.add(fn);
    return () => this.fixListeners.delete(fn);
  }

  onStatus(fn: (s: LocationStatus, extra?: { km: number }) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  get running(): boolean {
    return this.wanted;
  }

  /** A fix from the last few seconds, else null. */
  fresh(maxAgeMs = 10_000): LiveFix | null {
    return this.current && Date.now() - this.current.time < maxAgeMs ? this.current : null;
  }

  /**
   * Start watching (call from a tap so iOS can ask for compass access).
   * Resolves with the first usable fix, or null when unavailable/denied/too far.
   */
  start(): Promise<LiveFix | null> {
    this.enableCompass(); // must run synchronously inside the tap on iOS
    const recent = this.fresh();
    if (this.wanted && recent) return Promise.resolve(recent);
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      this.setStatus('unsupported');
      return Promise.resolve(null);
    }
    this.wanted = true;
    if (!this.current) this.setStatus('locating');
    return new Promise((resolve) => {
      let done = false;
      const finish = (f: LiveFix | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offFix();
        offStatus();
        resolve(f);
      };
      const offFix = this.onFix((f) => finish(f));
      const offStatus = this.onStatus((s) => {
        if (s === 'denied' || s === 'far' || s === 'unsupported') finish(null);
      });
      const timer = window.setTimeout(() => finish(this.current), FIRST_FIX_TIMEOUT_MS);
      // Quick approximate fix (cached / network) so something appears at once…
      navigator.geolocation.getCurrentPosition(
        (p) => this.onReading(p),
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 4000 },
      );
      // …then continuous high-accuracy readings.
      this.watch();
    });
  }

  stop(): void {
    this.wanted = false;
    this.clearWatch();
    this.filter.reset();
    this.motion.reset();
    this.current = null;
    this.setStatus('idle');
  }

  private watch() {
    if (this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onReading(p),
      (e) => this.onError(e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    this.armLost();
  }

  private clearWatch() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    clearTimeout(this.lostTimer);
  }

  private armLost() {
    clearTimeout(this.lostTimer);
    this.lostTimer = window.setTimeout(() => {
      if (this.wanted && document.visibilityState === 'visible') this.setStatus('lost');
    }, SIGNAL_LOST_MS);
  }

  private setStatus(s: LocationStatus, extra?: { km: number }) {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s, extra));
  }

  private onError(e: GeolocationPositionError) {
    if (e.code === e.PERMISSION_DENIED) {
      this.stop();
      this.setStatus('denied');
    } else if (e.code === e.TIMEOUT) this.setStatus('lost');
  }

  private onReading(pos: GeolocationPosition) {
    if (!this.wanted) return;
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    // Too far from the mosque: stop and explain (the map should not jump to another city).
    const km = metres(lat, lng, MOSQUE.lat, MOSQUE.lng) / 1000;
    if (km > MAX_KM) {
      this.stop();
      this.setStatus('far', { km });
      return;
    }
    this.armLost();
    const time = pos.timestamp || Date.now();
    const est = this.filter.update({ lat, lng, accuracy, time });
    const moving = this.motion.push(est);
    const speed = this.motion.speed();
    const gps = pos.coords.heading;
    const heading =
      moving !== null && speed >= MOVING_SPEED ? moving : this.compass ?? (gps != null && !Number.isNaN(gps) && speed >= MOVING_SPEED ? gps : null);
    this.current = { lat: est.lat, lng: est.lng, accuracy: est.accuracy, heading, speed, time: Date.now() };
    if (this.status !== 'live') this.setStatus('live');
    this.fixListeners.forEach((fn) => fn(this.current!));
  }

  // ---------- compass ----------
  private enableCompass() {
    if (this.compassOn) return;
    this.compassOn = true;
    const Ev = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const listen = () => {
      const handler = (e: Event) => this.onOrientation(e as OrientationWithCompass);
      // Android/Chrome: absolute orientation; iOS: webkitCompassHeading on the plain event.
      window.addEventListener('deviceorientationabsolute', handler);
      window.addEventListener('deviceorientation', handler);
    };
    if (Ev && typeof Ev.requestPermission === 'function') {
      Ev.requestPermission().then((r) => r === 'granted' && listen()).catch(() => undefined);
    } else listen();
  }

  private onOrientation(e: OrientationWithCompass) {
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h === null) return;
    const angle = (screen.orientation?.angle ?? 0) as number;
    h = (h + angle + 360) % 360;
    // Low-pass on the circle so the arrow doesn't shiver.
    if (this.compass === null) this.compass = h;
    else {
      const d = ((h - this.compass + 540) % 360) - 180;
      this.compass = (this.compass + d * 0.25 + 360) % 360;
    }
  }
}
