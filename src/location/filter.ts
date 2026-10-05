/** Position smoothing and heading for walking visitors. Pure, so it can be unit-tested. */

const R_EARTH = 6_371_000;
const RAD = Math.PI / 180;

/** How sharply a walker can change speed/direction (m/s²): process noise of the model. */
const ACCEL_SIGMA = 1.1;
/** A walker's speed is capped so poor readings can't fling the estimate away (m/s). */
const MAX_EST_SPEED = 3;
/** A reading this many sigmas away AND implying an impossible pace is treated as a glitch. */
const GATE_SIGMAS = 3;
const MAX_WALK_SPEED = 8; // m/s; faster than any walker
/** After this many consecutive "glitches" the visitor really is there: jump to it. */
const ACCEPT_AFTER = 2;
/** Long silence (tunnel, app in background): start fresh from the next reading. */
const RESET_AFTER_MS = 30_000;
/** Never trust a reading more than this, nor less (keeps maths stable). */
const MIN_ACC = 3;
const MAX_ACC = 300;

export interface Reading {
  lat: number;
  lng: number;
  /** Reported 68% accuracy radius in metres. */
  accuracy: number;
  /** ms since epoch */
  time: number;
}

export interface Estimate {
  lat: number;
  lng: number;
  /** Estimated accuracy (1σ) in metres. */
  accuracy: number;
  time: number;
  /** True when this reading was rejected as a glitch (the estimate was only predicted). */
  rejected: boolean;
}

/** One axis of a constant-velocity Kalman filter: position p (m), velocity v (m/s). */
class Axis {
  p = 0;
  v = 0;
  pp = 0; // var(p)
  pv = 0; // cov(p, v)
  vv = 0; // var(v)

  init(p: number, varP: number): void {
    this.p = p;
    this.v = 0;
    this.pp = varP;
    this.pv = 0;
    this.vv = 1.5 * 1.5;
  }

  predict(dt: number): void {
    const q = ACCEL_SIGMA * ACCEL_SIGMA;
    this.p += this.v * dt;
    this.pp += dt * (2 * this.pv + dt * this.vv) + (q * dt ** 4) / 4;
    this.pv += dt * this.vv + (q * dt ** 3) / 2;
    this.vv += q * dt * dt;
  }

  update(z: number, r: number): void {
    const s = this.pp + r;
    const k0 = this.pp / s;
    const k1 = this.pv / s;
    const y = z - this.p;
    this.p += k0 * y;
    this.v += k1 * y;
    const pp = (1 - k0) * this.pp;
    const pv = (1 - k0) * this.pv;
    this.vv -= k1 * this.pv;
    this.pp = pp;
    this.pv = pv;
  }
}

/**
 * Smooths readings with a constant-velocity Kalman filter on local metres. Every reading is
 * weighted by its own accuracy (poor ones are no longer dropped, which froze the marker), and
 * the estimated walking velocity lets the marker keep up with the visitor instead of lagging.
 */
export class PositionFilter {
  private lat0 = 0;
  private lng0 = 0;
  private ex = new Axis(); // east
  private ny = new Axis(); // north
  private time = 0;
  private glitches = 0;
  private ready = false;

  reset(): void {
    this.ready = false;
    this.glitches = 0;
  }

  get initialised(): boolean {
    return this.ready;
  }

  private toXY(lat: number, lng: number): [number, number] {
    return [(lng - this.lng0) * RAD * R_EARTH * Math.cos(this.lat0 * RAD), (lat - this.lat0) * RAD * R_EARTH];
  }

  private toLatLng(x: number, y: number): [number, number] {
    return [this.lat0 + y / (RAD * R_EARTH), this.lng0 + x / (RAD * R_EARTH * Math.cos(this.lat0 * RAD))];
  }

  private start(r: Reading, acc: number): Estimate {
    this.lat0 = r.lat;
    this.lng0 = r.lng;
    this.ex.init(0, acc * acc);
    this.ny.init(0, acc * acc);
    this.time = r.time;
    this.glitches = 0;
    this.ready = true;
    return { lat: r.lat, lng: r.lng, accuracy: acc, time: r.time, rejected: false };
  }

  private estimate(time: number, rejected: boolean): Estimate {
    const [lat, lng] = this.toLatLng(this.ex.p, this.ny.p);
    return { lat, lng, accuracy: Math.sqrt((this.ex.pp + this.ny.pp) / 2), time, rejected };
  }

  /** Estimated walking velocity (m/s, east and north). */
  get velocity(): [number, number] {
    return [this.ex.v, this.ny.v];
  }

  update(r: Reading): Estimate {
    const acc = Math.min(MAX_ACC, Math.max(MIN_ACC, r.accuracy || MAX_ACC));
    if (!this.ready || r.time - this.time > RESET_AFTER_MS) return this.start(r, acc);
    const dt = Math.max(0.05, (r.time - this.time) / 1000);
    const [zx, zy] = this.toXY(r.lat, r.lng);

    // Gate against the prediction: far outside the expected spread AND faster than walking → glitch.
    const px = this.ex.p + this.ex.v * dt;
    const py = this.ny.p + this.ny.v * dt;
    const dist = Math.hypot(zx - px, zy - py);
    const spread = Math.sqrt(this.ex.pp + this.ny.pp + 2 * acc * acc + (2 * dt) ** 2);
    if (dist > GATE_SIGMAS * spread && dist / Math.max(dt, 0.5) > MAX_WALK_SPEED) {
      this.glitches++;
      if (this.glitches <= ACCEPT_AFTER) return { ...this.estimate(r.time, true), ...this.peek(px, py) };
      return this.start(r, acc);
    }
    this.glitches = 0;

    this.ex.predict(dt);
    this.ny.predict(dt);
    this.ex.update(zx, acc * acc);
    this.ny.update(zy, acc * acc);
    // Keep the velocity to walking pace.
    const sp = Math.hypot(this.ex.v, this.ny.v);
    if (sp > MAX_EST_SPEED) {
      this.ex.v *= MAX_EST_SPEED / sp;
      this.ny.v *= MAX_EST_SPEED / sp;
    }
    this.time = r.time;
    return this.estimate(r.time, false);
  }

  private peek(x: number, y: number): { lat: number; lng: number } {
    const [lat, lng] = this.toLatLng(x, y);
    return { lat, lng };
  }
}

/** Great-circle bearing a → b in degrees (0 = north, clockwise). */
export function bearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin((bLng - aLng) * RAD) * Math.cos(bLat * RAD);
  const x = Math.cos(aLat * RAD) * Math.sin(bLat * RAD) - Math.sin(aLat * RAD) * Math.cos(bLat * RAD) * Math.cos((bLng - aLng) * RAD);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const x = (bLng - aLng) * RAD * Math.cos(((aLat + bLat) / 2) * RAD) * R_EARTH;
  const y = (bLat - aLat) * RAD * R_EARTH;
  return Math.hypot(x, y);
}

/**
 * Direction of travel from recent estimates: the bearing over the last few seconds once the
 * visitor has really moved (≥ minMetres), so standing still doesn't spin the arrow.
 */
export class MotionHeading {
  private trail: { lat: number; lng: number; time: number }[] = [];
  constructor(
    private windowMs = 6000,
    private minMetres = 4,
  ) {}

  reset(): void {
    this.trail = [];
  }

  push(e: { lat: number; lng: number; time: number }): number | null {
    this.trail.push(e);
    while (this.trail.length > 2 && e.time - this.trail[0].time > this.windowMs) this.trail.shift();
    const a = this.trail[0];
    if (metres(a.lat, a.lng, e.lat, e.lng) < this.minMetres) return null;
    return bearing(a.lat, a.lng, e.lat, e.lng);
  }

  /** Average walking speed over the window (m/s), 0 when standing. */
  speed(): number {
    if (this.trail.length < 2) return 0;
    const a = this.trail[0];
    const b = this.trail[this.trail.length - 1];
    const dt = (b.time - a.time) / 1000;
    return dt > 0 ? metres(a.lat, a.lng, b.lat, b.lng) / dt : 0;
  }
}
