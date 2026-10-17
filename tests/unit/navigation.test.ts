import { describe, expect, it, vi } from 'vitest';
import type { LatLng } from '../../src/data/types';
import type { LiveFix, LocationStatus } from '../../src/location/LocationService';
import { NavigationTracker, type NavigationHost, type NavStep, type TrackerLocation } from '../../src/navigation/tracker';

// The live navigation logic, ported from the live app's NavigationTracker without Leaflet or the DOM
// (src/navigation/tracker.ts). These tests pin the behaviour SPEC F6 asks for.

/** Metres → degrees near Madinah (good enough for a few hundred metres). */
const LAT_M = 1 / 110_800;
const LNG_M = 1 / 101_300;
const O: LatLng = [24.468, 39.61];
const at = (east: number, north = 0): LatLng => [O[0] + north * LAT_M, O[1] + east * LNG_M];
/** A straight 300 m route due east. */
const ROUTE: LatLng[] = [at(0), at(100), at(200), at(300)];

class FakeLocation implements TrackerLocation {
  status: LocationStatus = 'idle';
  private fixes = new Set<(f: LiveFix) => void>();
  private statuses = new Set<(s: LocationStatus, extra?: { km: number }) => void>();
  pace = 'walk';
  first: LiveFix | null = null;
  onFix(fn: (f: LiveFix) => void) {
    this.fixes.add(fn);
    return () => this.fixes.delete(fn);
  }
  onStatus(fn: (s: LocationStatus, extra?: { km: number }) => void) {
    this.statuses.add(fn);
    return () => this.statuses.delete(fn);
  }
  setPace(p: 'walk' | 'drive') {
    this.pace = p;
  }
  start() {
    this.status = 'live';
    return Promise.resolve(this.first);
  }
  emit(f: LiveFix) {
    this.fixes.forEach((fn) => fn(f));
  }
  emitStatus(s: LocationStatus) {
    this.statuses.forEach((fn) => fn(s));
  }
}

let clock = 1_000_000;
const fix = (ll: LatLng, accuracy = 5): LiveFix => ({ lat: ll[0], lng: ll[1], accuracy, heading: 90, speed: 1.3, time: (clock += 1000) });

function setup(opts: { alternatives?: LatLng[][]; steps?: { steps: NavStep[]; lot: number | null } } = {}) {
  const loc = new FakeLocation();
  const releases: string[] = [];
  let released: (() => void) | null = null;
  const host: NavigationHost & { me: LatLng[]; followed: LatLng[]; vibrations: number[][] } = {
    me: [],
    followed: [],
    vibrations: [],
    showMe(lat, lng) {
      this.me.push([lat, lng]);
    },
    follow(lat, lng) {
      this.followed.push([lat, lng]);
    },
    vibrate(p) {
      this.vibrations.push(p);
    },
    requestWakeLock: vi.fn(async (onReleased: () => void) => {
      released = onReleased;
      return () => releases.push('released');
    }),
  };
  const reroute = vi.fn();
  const switched = vi.fn();
  let now = 0;
  const nav = new NavigationTracker(
    loc,
    host,
    () => ROUTE,
    reroute,
    () => opts.alternatives ?? [],
    switched,
    () => opts.steps ?? null,
    () => now,
  );
  return { nav, loc, host, reroute, switched, releases, systemRelease: () => released?.(), advance: (ms: number) => (now += ms) };
}

describe('navigation (SPEC F6): progress along the route', () => {
  it('starts locating with the camera following, keeps the screen on, and walks at walking pace', async () => {
    const { nav, loc, host } = setup();
    const started = nav.start('walk');
    expect(nav.snapshot.state).toBe('locating');
    expect(nav.snapshot.follow).toBe(true);
    await started;
    expect(host.requestWakeLock).toHaveBeenCalledTimes(1);
    expect(loc.pace).toBe('walk');
    // No first reading at all: the signal is reported lost (as in the live app).
    expect(nav.snapshot.state).toBe('signal-lost');
  });

  it('remaining metres fall walking on; the visitor is drawn on the route when close to it', async () => {
    const { nav, loc, host } = setup();
    await nav.start();
    loc.emit(fix(at(50, 3)));
    const first = nav.snapshot.remainingMeters;
    loc.emit(fix(at(120, 3)));
    expect(nav.snapshot.state).toBe('updated');
    expect(nav.snapshot.remainingMeters).toBeLessThan(first);
    expect(Math.round(nav.snapshot.remainingMeters)).toBe(180);
    // 3 m off the line is within the snap distance: drawn on the route itself.
    expect(host.me.at(-1)![0]).toBeCloseTo(O[0], 6);
    expect(nav.snapshot.progress).toBe(40);
    expect(host.followed.length).toBe(2);
  });

  it('walking back raises the remaining distance and warns «you are walking away»', async () => {
    const { nav, loc } = setup();
    await nav.start();
    loc.emit(fix(at(150)));
    loc.emit(fix(at(140)));
    loc.emit(fix(at(120)));
    expect(nav.snapshot.state).toBe('away');
  });

  it('poor GPS says so while the marker still moves', async () => {
    const { nav, loc } = setup();
    await nav.start();
    loc.emit(fix(at(60), 50));
    expect(nav.snapshot.state).toBe('low-accuracy');
  });

  it('the stretch ahead is the next metres of the route from where the visitor is', async () => {
    const { nav, loc } = setup();
    await nav.start();
    expect(nav.ahead(150)).toBeNull();
    loc.emit(fix(at(100)));
    const ahead = nav.ahead(150)!;
    expect(ahead[0][1]).toBeCloseTo(at(100)[1], 6);
    expect(ahead.at(-1)![1]).toBeCloseTo(at(250)[1], 6);
  });
});

describe('navigation: arrival', () => {
  it('within 20 m of the end twice in a row: arrived, with one vibration', async () => {
    const { nav, loc, host } = setup();
    await nav.start();
    loc.emit(fix(at(285)));
    expect(nav.snapshot.state).not.toBe('arrived');
    loc.emit(fix(at(290)));
    expect(nav.snapshot.state).toBe('arrived');
    loc.emit(fix(at(295)));
    expect(host.vibrations).toEqual([[120, 80, 120]]);
  });

  it('«متابعة» keeps tracking and does not announce the arrival again', async () => {
    const { nav, loc } = setup();
    await nav.start();
    loc.emit(fix(at(290)));
    loc.emit(fix(at(292)));
    nav.keepGoing();
    expect(nav.snapshot.state).toBe('updated');
    loc.emit(fix(at(296)));
    loc.emit(fix(at(298)));
    expect(nav.snapshot.state).not.toBe('arrived');
  });
});

describe('navigation: leaving the route', () => {
  it('three readings off the route re-plan from the visitor, at most once per 8 s', async () => {
    const { nav, loc, reroute, advance } = setup();
    await nav.start();
    advance(60_000);
    for (let i = 0; i < 3; i++) loc.emit(fix(at(100, 80)));
    expect(reroute).toHaveBeenCalledTimes(1);
    expect(reroute.mock.calls[0][0][0]).toBeCloseTo(at(100, 80)[0], 6);
    for (let i = 0; i < 3; i++) loc.emit(fix(at(100, 80)));
    expect(reroute).toHaveBeenCalledTimes(1);
    advance(8_001);
    loc.emit(fix(at(100, 80)));
    expect(reroute).toHaveBeenCalledTimes(2);
  });

  it('two readings on an alternative already drawn switch to it, without re-planning', async () => {
    const alt = [at(0), at(0, 80), at(300, 80), at(300)];
    const { nav, loc, reroute, switched } = setup({ alternatives: [alt] });
    await nav.start();
    loc.emit(fix(at(100, 80)));
    expect(switched).not.toHaveBeenCalled();
    loc.emit(fix(at(110, 80)));
    expect(switched).toHaveBeenCalledWith(0);
    expect(reroute).not.toHaveBeenCalled();
  });
});

describe('navigation: camera, screen lock, signal', () => {
  it('dragging the map stops following; «تتبّعني» brings it back to the visitor', async () => {
    const { nav, loc, host } = setup();
    await nav.start();
    loc.emit(fix(at(50)));
    nav.userMovedMap();
    expect(nav.snapshot.follow).toBe(false);
    const n = host.followed.length;
    loc.emit(fix(at(60)));
    expect(host.followed.length).toBe(n);
    nav.toggleFollow();
    expect(nav.snapshot.follow).toBe(true);
    expect(host.followed.length).toBe(n + 1);
  });

  it('the screen lock is released on stop, and asked again when the system dropped it', async () => {
    const { nav, host, releases, systemRelease } = setup();
    await nav.start();
    systemRelease();
    nav.pageVisible();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.requestWakeLock).toHaveBeenCalledTimes(2);
    nav.stop();
    expect(releases).toEqual(['released']);
    expect(nav.snapshot.state).toBe('stopped');
    expect(nav.active).toBe(false);
  });

  it('a lost signal or a refused permission shows in the state', async () => {
    const { nav, loc } = setup();
    await nav.start();
    loc.emitStatus('lost');
    expect(nav.snapshot.state).toBe('signal-lost');
    loc.emitStatus('denied');
    expect(nav.snapshot.state).toBe('error');
  });

  it('driving uses the driving pace', async () => {
    const { nav, loc } = setup();
    await nav.start('drive');
    expect(loc.pace).toBe('drive');
    nav.stop();
    expect(loc.pace).toBe('walk');
  });
});

describe('navigation: car park steps (the step now and the next one)', () => {
  const steps: NavStep[] = [
    { kind: 'e', path: [at(100), at(200)] },
    { kind: 'up', path: [at(200), at(250)] },
    { kind: 'lot_in', path: [at(250), at(300)] },
  ];
  it('before the car park (within 150 m): only «then: …» with the metres to it', async () => {
    const { nav, loc } = setup({ steps: { steps, lot: 9 } });
    await nav.start('drive');
    loc.emit(fix(at(20)));
    expect(nav.snapshot.step).toEqual({ now: null, next: { kind: 'e', meters: 80 }, lot: 9 });
  });
  it('in it: the step now with the metres left, then the next one', async () => {
    const { nav, loc } = setup({ steps: { steps, lot: 9 } });
    await nav.start('drive');
    loc.emit(fix(at(160)));
    expect(nav.snapshot.step).toEqual({ now: { kind: 'e', meters: 40 }, next: { kind: 'up', meters: null }, lot: 9 });
  });
});
