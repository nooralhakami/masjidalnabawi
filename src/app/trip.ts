import { POI_BY_ID } from '../data';
import type { LatLng, Poi } from '../data/types';
import { t } from '../i18n';
import { tNext } from '../i18n-next/strings';
import { LocationService } from '../location/LocationService';
import { RouteTrack } from '../location/progress';
import type { MapEngine } from '../map/engine';
import { mapZoom } from '../map/zoom';
import { NavigationTracker, type NavigationHost } from '../navigation/tracker';
import { lotsToAsk, planExit, planRoutes, type GarageStart, type Plan } from '../routing/plan';
import { spotOf } from '../routing/spot';
import { bearing } from '../presentation/route-view';
import { garageQ, headingUp, level, nav, notify, route, selected, setHeadingUp, sheet, travel } from '../state/store';

/** Within this distance of the car park leg, the visitor is in the car park: no re-planning from the streets. */
const IN_CAR_PARK_M = 60;
/** Live: the next 150 m of the route in full, the rest faint (owner, 2026-10-13). */
const AHEAD_M = 150;
/** Where the car is, as the visitor said (owner, 2026-10-14), holds this long and this near. */
const ANSWER_MS = 10 * 60_000;
const ANSWER_M = 40;
/** Heading-up: the way ahead over this many metres sets which way is up; turns under this many degrees wait. */
const HEADING_AHEAD_M = 40;
const HEADING_MIN_TURN = 6;

export interface TripLayout {
  /** Bottom of the search bar and pills, in px from the top. */
  top(): number;
  /** The sheet's visible height, in px. */
  sheet(): number;
  /** Top of the navigation bar, in px from the top (or the sheet's top when there is none). */
  bar(): number;
}

/**
 * A trip: location on demand, the routes offered, the one followed, and live navigation. The wiring
 * of the live app's map/main.ts (drawRoute, showPlans, pickRoute, the re-route and switch callbacks,
 * the way out, the car park question), unchanged in what it decides; the drawing is map/route.ts,
 * the card and the bar are ui/route/, both following the `route` and `nav` signals.
 */
export class Trip {
  readonly geo = new LocationService();
  readonly tracker: NavigationTracker;
  private plans: Plan[] = [];
  private chosen = 0;
  /** Heading-up just turned on: the follows zoom to street level until the map is there (a new fix can interrupt one ease). */
  private closeUp = false;
  private garageAnswer: { start: GarageStart; at: number; pos: LatLng } | null = null;
  /** The route planner (routing/plan.ts); a test can put one that finds nothing. */
  planner = planRoutes;

  constructor(
    private engine: MapEngine,
    private layout: TripLayout,
  ) {
    const me = engine.me;
    this.geo.onFix((f) => {
      // During navigation the tracker draws the dot (snapped to the route when close).
      if (!this.tracker.active) me.update(f.lat, f.lng, f.accuracy, f.heading);
    });
    this.geo.onStatus((s, extra) => {
      if (s === 'locating') notify(t('locating'), 'info', 2500);
      else if (s === 'denied') notify(t('geo_deny'), 'error', 6000);
      else if (s === 'unsupported') notify(t('geo_unsup'), 'error', 6000);
      else if (s === 'far' && extra) notify(t('geo_far', { k: extra.km < 10 ? extra.km.toFixed(1) : String(Math.round(extra.km)) }), 'error', 6000);
      if (s === 'idle' || s === 'denied' || s === 'far') me.remove();
    });

    const host: NavigationHost = {
      showMe: (lat, lng, acc, heading) => me.update(lat, lng, acc, heading),
      follow: (lat, lng) => this.follow(lat, lng),
      vibrate: (p) => {
        try {
          navigator.vibrate?.(p);
        } catch {
          /* optional */
        }
      },
      requestWakeLock: async (onReleased) => {
        const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(e: 'release', fn: () => void): void }> } }).wakeLock;
        if (!wl) return null;
        const lock = await wl.request('screen');
        lock.addEventListener('release', onReleased);
        return () => void lock.release().catch(() => undefined);
      },
    };

    this.tracker = new NavigationTracker(
      this.geo,
      host,
      () => engine.route.latLngs,
      (from, heading) => this.reroute(from, heading),
      () => engine.route.alternatives,
      (alt) => {
        // Walking along one of the alternatives on the map: it becomes the route.
        const others = this.plans.map((_, k) => k).filter((k) => k !== this.chosen);
        if (others[alt] === undefined) return;
        this.showPlans(this.plans, others[alt], false);
        notify(t('r_switched'));
      },
      () => {
        // Short directions inside the car park (way in or way out), with the lot's number.
        const plan = this.plans[this.chosen];
        const garage = plan?.legs.find((l) => l.kind === 'garage');
        return garage?.steps?.length ? { steps: garage.steps, lot: plan.lot ? plan.lot.id - 900 : null } : null;
      },
    );
    this.tracker.onChange((s) => {
      nav.value = s.state === 'stopped' ? null : { ...s };
      engine.route.focus(s.state === 'stopped' ? null : this.tracker.ahead(AHEAD_M), this.plans[this.chosen]?.mode ?? 'walk');
    });
    // The visitor moved the map themself: stop following them (the bar's button brings it back).
    engine.map.on('dragstart', (e) => e.originalEvent && this.tracker.userMovedMap());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.tracker.pageVisible());
  }

  get active(): boolean {
    return this.engine.route.active;
  }

  /** «Draw the route from my location»: location is requested only now, on this tap. */
  async draw(p: Poi): Promise<void> {
    const fix = this.geo.fresh() ?? (await this.geo.start());
    if (!fix || selected.value !== p.id) return;
    const mode = travel.value;
    const start = mode === 'drive' ? await this.garageStartFor(fix.lat, fix.lng) : undefined;
    if (start === null || selected.value !== p.id) return;
    const next = await this.planner([fix.lat, fix.lng], p, mode, { level: level.value, start });
    if (selected.value !== p.id) return;
    if (!next.length) {
      // Said, not silent: the button stops spinning and nothing is drawn.
      notify(tNext('route_none'), 'error');
      return;
    }
    if (mode === 'drive' && next[0].mode === 'walk') notify(t('drive_fallback'), 'info', 5000);
    const info = this.showPlans(next, 0, true);
    await this.tracker.start(next[0].mode);
    await this.frame();
    this.fit(info.bounds);
  }

  /** The way out of the car park from the lot just driven to: from its exit to the car park's exits, quickest first. */
  async wayOut(): Promise<void> {
    const inbound = this.plans[this.chosen];
    if (!inbound?.lot || inbound.exit) return;
    const out = planExit(inbound.lot, inbound.level ?? 'B');
    if (!out.length) return;
    // Tracked live like the way in (GPS works underground in this car park, owner 2026-10-13).
    const info = this.showPlans(out, 0, true);
    if (!this.tracker.active) void this.tracker.start('drive');
    await this.frame();
    this.fit(info.bounds);
  }

  /** «إنهاء المسار», a new destination, or closing the card: the trip ends entirely (GPS watch, wake lock, bar). */
  end(): void {
    // A map turned with the route goes back to north up.
    if (this.engine.map.getBearing() !== 0) this.engine.map.easeTo({ bearing: 0, duration: reduce() ? 0 : 500 });
    this.tracker.stop();
    this.engine.route.clear();
    this.plans = [];
    route.value = null;
  }

  /**
   * Heading-up on or off (owner, 2026-10-17). On: follow the visitor again and turn the map so the
   * way ahead points up. Off: back to north up, the visitor still followed.
   */
  setHeadingUp(on: boolean): void {
    setHeadingUp(on);
    if (on) {
      // Street level, as a navigation app: the turns ahead readable.
      this.closeUp = true;
      if (!this.tracker.snapshot.follow) this.tracker.toggleFollow();
      else {
        const p = this.tracker.snapshot.position;
        if (p) this.follow(p[0], p[1]);
      }
    } else this.engine.map.easeTo({ bearing: 0, duration: reduce() ? 0 : 500 });
  }

  /** «My location»: show the visitor and keep watching (it used to read once and stop). */
  async locate(): Promise<void> {
    const f = await this.geo.start();
    if (f) this.engine.map.flyTo({ center: [f.lng, f.lat], zoom: Math.max(this.engine.map.getZoom(), mapZoom(18)), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800 });
  }

  /** Draw the offered routes with `plans[i]` as the one to follow, and keep the card and navigation in step. */
  private showPlans(next: Plan[], i: number, animate: boolean) {
    this.plans = next;
    this.chosen = i;
    const info = this.engine.route.show(next, i, { animate, onPick: (j) => this.pick(j) });
    const { bounds: _, ...summary } = info;
    route.value = summary;
    this.tracker.routeChanged();
    return info;
  }

  /** The visitor tapped another of the offered routes on the map. */
  private pick(i: number) {
    if (i === this.chosen || !this.plans[i] || !this.engine.route.active) return;
    this.showPlans(this.plans, i, false);
  }

  /**
   * Left the route: re-plan from where the visitor actually is, the same way (walking or driving),
   * favouring the way they are heading; redrawn in place, without the draw-in or a camera jump.
   */
  private reroute(from: LatLng, heading: number | null) {
    const id = selected.value;
    const dest = id !== null ? POI_BY_ID.get(id) : undefined;
    if (!dest || !this.engine.route.active) return;
    // In the car park (or on the way out of it) there is no other way to plan from the streets:
    // keep the drawn route; the visitor gets back on it (GPS underground can wander).
    if (this.plans[this.chosen]?.exit) return;
    const garage = this.plans[this.chosen]?.legs.find((l) => l.kind === 'garage');
    if (garage && garage.path.length > 1 && new RouteTrack(garage.path).locate(from).offset < IN_CAR_PARK_M) return;
    // The car has moved since the visitor said which lot it was in: on from the road, same level.
    const said = this.recentAnswer(from[0], from[1], true);
    const start: GarageStart | undefined = said === 'outside' ? 'outside' : said ? { lot: null, level: said.level } : undefined;
    void planRoutes(from, dest, travel.value, { heading, level: level.value, start }).then((next) => {
      if (selected.value !== dest.id || !this.engine.route.active || !next.length) return;
      this.showPlans(next, 0, false);
      notify(t('rerouted'));
    });
  }

  /** The answer still holds: given lately, and (unless `moved` is allowed) from about the same place. */
  private recentAnswer(lat: number, lng: number, moved = false): GarageStart | undefined {
    const a = this.garageAnswer;
    if (!a || Date.now() - a.at > ANSWER_MS) return undefined;
    const m = Math.hypot((lat - a.pos[0]) * 111_320, (lng - a.pos[1]) * 101_300);
    return moved || m < ANSWER_M ? a.start : undefined;
  }

  /** In or by the car park, ask where the car is (which lot, which level); elsewhere nothing. Null: dismissed. */
  private async garageStartFor(lat: number, lng: number): Promise<GarageStart | undefined | null> {
    const known = this.recentAnswer(lat, lng);
    if (known) return known;
    const lots = lotsToAsk([lat, lng]);
    if (!lots.length) return undefined;
    // The place card steps down to its handle while the question is asked, so the two do not pile up
    // (owner, 2026-10-24); a dismissed question brings it back, to press «start the route» again.
    const before = sheet.value;
    sheet.value = 'peek';
    const start = await new Promise<GarageStart | null>((answer) => (garageQ.value = { lots, spot: spotOf([lat, lng]), answer }));
    garageQ.value = null;
    if (start) this.garageAnswer = { start, at: Date.now(), pos: [lat, lng] };
    else if (sheet.value === 'peek') sheet.value = before;
    return start;
  }

  /** Frame every offered route between the top bar and the sheet, with room for the map buttons on both sides. */
  private fit(bounds: [[number, number], [number, number]]) {
    const pad = { top: this.layout.top() + 24, bottom: this.layout.sheet() + 24, left: 72, right: 72 };
    const c = this.engine.map.getContainer();
    // A screen too small for the padding: keep the route in view anyway.
    if (pad.top + pad.bottom >= c.clientHeight - 40) pad.top = pad.bottom = 24;
    // fitBounds adds its padding to the camera's current one (left by following the visitor): start from none.
    this.engine.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    this.engine.map.fitBounds(bounds, { padding: pad, maxZoom: mapZoom(19), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800 });
  }

  /**
   * Keep the visitor in sight: in the middle of the map left visible between the top bar and the
   * navigation bar (the middle of the screen is under the bar).
   */
  private follow(lat: number, lng: number) {
    const h = this.engine.map.getContainer().clientHeight;
    const top = this.layout.top();
    const bar = this.layout.bar();
    const padding = bar > top + 80 ? { top, bottom: Math.max(0, h - bar), left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 };
    const heading = this.headingAhead();
    // Heading-up: the visitor in the lower part of the view, so more of the way ahead shows.
    if (heading !== undefined) padding.top += Math.round((h - padding.top - padding.bottom) * 0.35);
    if (this.closeUp && this.engine.map.getZoom() >= mapZoom(18) - 0.05) this.closeUp = false;
    const zoom = this.closeUp ? mapZoom(18) : undefined;
    this.engine.map.easeTo({ center: [lng, lat], padding, bearing: heading ?? this.engine.map.getBearing(), zoom, duration: reduce() ? 0 : 600 });
  }

  /**
   * Heading-up: the direction of the route over the next 40 m (steadier than the phone's compass
   * when walking slowly). Small turns are left alone, so the map does not wobble.
   */
  private headingAhead(): number | undefined {
    if (!headingUp.value) return undefined;
    const ahead = this.tracker.ahead(HEADING_AHEAD_M);
    if (!ahead || ahead.length < 2) return undefined;
    const [a, b] = [ahead[0], ahead[ahead.length - 1]];
    if (Math.hypot((b[0] - a[0]) * 111_320, (b[1] - a[1]) * 101_300) < 5) return undefined;
    const to = bearing(a, b);
    const now = this.engine.map.getBearing();
    const turn = Math.abs(((to - now + 540) % 360) - 180);
    return turn < HEADING_MIN_TURN ? now : to;
  }

  /** After the card has drawn the route summary (its height decides the camera's room). */
  private frame(): Promise<void> {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
  }
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
