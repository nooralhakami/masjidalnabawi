import { describe, expect, it } from 'vitest';
import { MotionHeading, PositionFilter, bearing, metres } from '../../src/location/filter';
import { AwayDetector, RouteTrack, angleBetween } from '../../src/location/progress';
import { walkPath } from '../../src/routing/walk';
import { POI_BY_ID } from '../../src/data';
import type { LatLng } from '../../src/data';

/** A point `m` metres north / `e` metres east of a base point. */
const offset = ([lat, lng]: LatLng, n: number, e: number): LatLng => [lat + n / 111_320, lng + e / (111_320 * Math.cos((lat * Math.PI) / 180))];
const BASE: LatLng = [24.4685, 39.6084];

/** Walk south at 1.4 m/s, one reading per second, with a deterministic ±jitter. */
function walk(seconds: number, accuracy: number, jitter: number, start = 0) {
  return Array.from({ length: seconds }, (_, i) => {
    const t = start + i;
    const j = Math.sin(t * 2.3) * jitter;
    const [lat, lng] = offset(BASE, -1.4 * t + j, Math.cos(t * 1.7) * jitter);
    return { lat, lng, accuracy, time: t * 1000 };
  });
}

describe('position filter', () => {
  it('follows a steady walk closely (no lag build-up)', () => {
    const f = new PositionFilter();
    let last = f.update(walk(1, 8, 0)[0]);
    for (const r of walk(30, 8, 3)) last = f.update(r);
    const truth = offset(BASE, -1.4 * 29, 0);
    expect(metres(last.lat, last.lng, truth[0], truth[1])).toBeLessThan(4);
  });

  it('keeps moving with poor readings instead of freezing (old code dropped accuracy > 50 m)', () => {
    const f = new PositionFilter();
    let est = f.update(walk(1, 10, 0)[0]);
    const first = est;
    for (const r of walk(40, 60, 4)) est = f.update(r);
    // 40 s × 1.4 m/s ≈ 55 m walked: the estimate must have moved most of that way.
    expect(metres(first.lat, first.lng, est.lat, est.lng)).toBeGreaterThan(45);
    expect(est.rejected).toBe(false);
  });

  it('turning back: the estimate reverses within a few seconds', () => {
    const f = new PositionFilter();
    let est = f.update({ lat: BASE[0], lng: BASE[1], accuracy: 10, time: 0 });
    // 15 s south at 1.4 m/s, then turn round and walk north.
    for (let t = 1; t <= 15; t++) {
      const [lat, lng] = offset(BASE, -1.4 * t, 0);
      est = f.update({ lat, lng, accuracy: 10, time: t * 1000 });
    }
    for (let t = 1; t <= 4; t++) {
      const [lat, lng] = offset(BASE, -1.4 * 15 + 1.4 * t, 0);
      est = f.update({ lat, lng, accuracy: 10, time: (15 + t) * 1000 });
    }
    const truth = offset(BASE, -1.4 * 15 + 1.4 * 4, 0);
    expect(metres(est.lat, est.lng, truth[0], truth[1])).toBeLessThan(5);
  });

  it('smooths jitter: estimates jump less than raw readings', () => {
    const f = new PositionFilter();
    const raw = walk(30, 15, 10);
    let rawJump = 0;
    let estJump = 0;
    let prevEst = f.update(raw[0]);
    for (let i = 1; i < raw.length; i++) {
      const e = f.update(raw[i]);
      rawJump += metres(raw[i - 1].lat, raw[i - 1].lng, raw[i].lat, raw[i].lng);
      estJump += metres(prevEst.lat, prevEst.lng, e.lat, e.lng);
      prevEst = e;
    }
    expect(estJump).toBeLessThan(rawJump * 0.75);
  });

  it('ignores an isolated wild jump, but accepts it when it persists', () => {
    const f = new PositionFilter();
    for (const r of walk(10, 8, 0)) f.update(r);
    const far = offset(BASE, 400, 0);
    const glitch = f.update({ lat: far[0], lng: far[1], accuracy: 10, time: 10_000 });
    expect(glitch.rejected).toBe(true);
    f.update({ lat: far[0], lng: far[1], accuracy: 10, time: 11_000 });
    const accepted = f.update({ lat: far[0], lng: far[1], accuracy: 10, time: 12_000 });
    expect(accepted.rejected).toBe(false);
    expect(metres(accepted.lat, accepted.lng, far[0], far[1])).toBeLessThan(5);
  });

  it('a better reading quickly corrects a coarse first fix', () => {
    const f = new PositionFilter();
    const coarse = offset(BASE, 60, 30);
    f.update({ lat: coarse[0], lng: coarse[1], accuracy: 120, time: 0 });
    const fine = f.update({ lat: BASE[0], lng: BASE[1], accuracy: 6, time: 1500 });
    expect(metres(fine.lat, fine.lng, BASE[0], BASE[1])).toBeLessThan(5);
  });
});

describe('motion heading', () => {
  it('reports the real walking direction once the visitor moves, nothing while standing', () => {
    const h = new MotionHeading();
    expect(h.push({ lat: BASE[0], lng: BASE[1], time: 0 })).toBeNull();
    expect(h.push({ ...{ lat: BASE[0], lng: BASE[1] }, time: 1000 })).toBeNull();
    let dir: number | null = null;
    for (let t = 2; t <= 6; t++) {
      const [lat, lng] = offset(BASE, -1.4 * t, 0);
      dir = h.push({ lat, lng, time: t * 1000 });
    }
    expect(angleBetween(dir!, 180)).toBeLessThan(5); // walking south
    expect(h.speed()).toBeGreaterThan(1);
  });

  it('bearing helper', () => {
    const n = offset(BASE, 50, 0);
    const e = offset(BASE, 0, 50);
    expect(angleBetween(bearing(BASE[0], BASE[1], n[0], n[1]), 0)).toBeLessThan(1);
    expect(angleBetween(bearing(BASE[0], BASE[1], e[0], e[1]), 90)).toBeLessThan(1);
  });
});

describe('route progress', () => {
  const dest = POI_BY_ID.get(204)!;
  const path = walkPath(BASE, [dest.lat, dest.lng]);
  const track = new RouteTrack(path);

  it('remaining distance shrinks walking towards the destination', () => {
    const a = track.locate(path[0]);
    const mid = track.locate(path[Math.floor(path.length / 2)], a.along);
    expect(a.remaining).toBeGreaterThan(mid.remaining);
    expect(track.locate(path[path.length - 1], mid.along).remaining).toBeLessThan(2);
  });

  it('walking back towards the start is followed (old code only searched forward)', () => {
    const far = track.locate(path[Math.floor(path.length * 0.7)]);
    const back = track.locate(path[Math.floor(path.length * 0.2)], far.along);
    expect(back.remaining).toBeGreaterThan(far.remaining + 100);
  });

  it('measures how far off the route the visitor is', () => {
    const p = track.locate(offset(path[2], 0, -30));
    expect(p.offset).toBeGreaterThan(20);
  });

  it('detects walking away from the destination', () => {
    const away = new AwayDetector(20_000, 15);
    expect(away.push(0, 400)).toBe(false);
    expect(away.push(5000, 390)).toBe(false);
    expect(away.push(10_000, 400)).toBe(false);
    expect(away.push(15_000, 410)).toBe(true);
  });
});
