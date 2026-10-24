import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, idle, openMap, test } from './fixtures';

// Routes and live navigation (phase 5): the live app's journeys 14, 15, 24, 25, 29–33, 36, 37 and
// 42–48 (docs/PARITY.md), with its expected numbers and its simulated locations; new selectors only.

type Win = { __engine: any; __trip: any };

/** The «route from my location» button on the place card. */
const routeBtn = (page: Page) => page.locator('.pc-actions .btn-block');
const card = (page: Page) => page.locator('.route-card');
const navBar = (page: Page) => page.locator('.nav-bar');

/** How many features of a route layer the map draws now (after it has settled). */
async function drawn(page: Page, layer: string, part?: string): Promise<number> {
  await idle(page);
  return page.evaluate(
    ([l, p]) => {
      const m = (window as unknown as Win).__engine.map;
      // A layer the route does not need is not there at all (map/route.ts).
      return m.getLayer(l) ? m.queryRenderedFeatures({ layers: [l] }).filter((f: any) => !p || f.properties.part === p).length : 0;
    },
    [layer, part] as const,
  );
}
/** The route's marks besides its lines (labels and car park marks), as kind:text. */
const marks = (page: Page) => page.evaluate(() => ((window as unknown as Win).__engine.route.shownMarks as { kind: string; text?: string }[]).map((m) => `${m.kind}:${m.text ?? ''}`));
const routeActive = (page: Page) => page.evaluate(() => (window as unknown as Win).__engine.route.active as boolean);
const metresOf = async (page: Page) => Number((await card(page).locator('.rs-v').first().textContent())!.replace(/\D/g, ''));

/** A place's position as the app shows it (data/pois.json with data/overrides.json applied). */
function placeAt(id: number): [number, number] {
  const p = (JSON.parse(readFileSync('data/pois.json', 'utf8')) as { id: number; lat: number; lng: number }[]).find((x) => x.id === id)!;
  const o = (JSON.parse(readFileSync('data/overrides.json', 'utf8')) as Record<string, { north?: number; east?: number }>)[String(id)] ?? {};
  return [p.lat + (o.north ?? 0) / 111_320, p.lng + (o.east ?? 0) / (111_320 * Math.cos((p.lat * Math.PI) / 180))];
}

/** With a route, the card is a slim strip (trip mode, owner 2026-10-17): open it to reach its buttons. */
async function showCard(page: Page) {
  await expect(page.locator('.sheet.is-peek')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sheet-handle').click();
  await expect(page.locator('.sheet.is-half')).toHaveCount(1);
  // The sheet's spring settles.
  await page.waitForTimeout(600);
}

async function openAndRoute(page: Page, id: number, lang = 'ar') {
  await openMap(page, lang, `?poi=${id}`);
  // Three browsers drawing WebGL in software share this machine: a card can take a few seconds.
  await expect(page.locator('.pc-title')).toContainText(String(id === 909 ? 9 : id === 912 ? 12 : id), { timeout: 15_000 });
  await routeBtn(page).click();
}

test.describe('walking from the west plaza', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

  test('draws a route from a simulated location to restroom 204', async ({ page, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    // ≈510 m since the owner's west-plaza walkways (2026-10-08).
    const m = await metresOf(page);
    expect(m).toBeGreaterThan(470);
    expect(m).toBeLessThan(550);
    await expect(card(page).locator('.route-box')).toContainText('7');
    expect(await drawn(page, 'route-walk')).toBeGreaterThan(0);
    expect(await drawn(page, 'route-arrows')).toBeGreaterThan(3);
    await expect(page.locator('.me-dot')).toBeVisible();
    await showCard(page);
    await card(page).locator('.rc-end').click();
    expect(await routeActive(page)).toBe(false);
    expect(await drawn(page, 'route-walk')).toBe(0);
  });

  test('distance and time stay on screen above the end button; the bar never covers the sheet', async ({ page, errors: _ }) => {
    await openAndRoute(page, 204);
    await showCard(page);
    await expect(card(page).locator('.route-box')).toBeInViewport({ ratio: 1, timeout: 20_000 });
    await expect(card(page).locator('.rc-end')).toBeInViewport();
    await expect(navBar(page)).toBeVisible();
    // Once the sheet has settled (its spring can take a moment on a loaded machine).
    await expect
      .poll(async () => {
        const bar = (await navBar(page).boundingBox())!;
        const sheetTop = await page.evaluate(() => document.querySelector('.sheet')!.getBoundingClientRect().top);
        return bar.y + bar.height - sheetTop;
      })
      .toBeLessThanOrEqual(1);
    const bar = (await navBar(page).boundingBox())!;
    // The map's buttons rise above the bar while navigating.
    const zoom = (await page.locator('.map-controls').first().boundingBox())!;
    expect(zoom.y + zoom.height).toBeLessThanOrEqual(bar.y + 1);
  });

  test('a stray tap on the map does not end the route; a new destination stops navigation', async ({ page, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(card(page)).toBeVisible({ timeout: 20_000 });
    await page.mouse.click(60, 300); // empty map
    await page.waitForTimeout(300);
    expect(await routeActive(page)).toBe(true);
    await expect(navBar(page)).toBeVisible();

    // A new destination (search is out of the way during a route, owner 2026-10-17: a place opened
    // from elsewhere in the app, as a story's «على الخريطة»).
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('open-place', { detail: (window as unknown as Win).__engine.poi(215) })));
    await expect(page.locator('.pc-title')).toContainText('215', { timeout: 15_000 });
    expect(await routeActive(page)).toBe(false);
    await expect(navBar(page)).toHaveCount(0);
  });
});

test.describe('far away visitor', () => {
  test.use({ geolocation: { latitude: 21.4225, longitude: 39.8262, accuracy: 20 }, permissions: ['geolocation'] });

  test('the map does not move and a gentle note explains why', async ({ page, errors: _ }) => {
    await openMap(page);
    const at = () => page.evaluate(() => JSON.stringify((window as unknown as Win).__engine.map.getCenter()));
    const before = await at();
    await page.locator('.mc-locate').click();
    await expect(page.locator('.toast')).toContainText('كم');
    expect(await at()).toBe(before);
    await expect(page.locator('.me')).toHaveCount(0);
  });
});

test.describe('location is asked only on a tap', () => {
  test('opening the map and a card asks nothing', async ({ page, context, errors: _ }) => {
    await page.addInitScript(() => {
      (window as unknown as { __asked: number }).__asked = 0;
      const g = navigator.geolocation;
      const count = () => ((window as unknown as { __asked: number }).__asked += 1);
      for (const k of ['getCurrentPosition', 'watchPosition'] as const) {
        const f = g[k].bind(g);
        (g as any)[k] = (...a: unknown[]) => (count(), (f as any)(...a));
      }
    });
    await context.clearPermissions();
    await openMap(page, 'ar', '?poi=204');
    await expect(page.locator('.pc-title')).toContainText('204');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
  });
});

test.describe('live location while walking', () => {
  // Walking south along the west side of the walkway ring (data/routing.json), towards restrooms 204.
  const RING_WEST_LNG = 39.608334;
  test.use({ geolocation: { latitude: 24.4685, longitude: RING_WEST_LNG, accuracy: 10 }, permissions: ['geolocation'] });
  const step = (n: number) => ({ latitude: 24.4685 - (n * 2.5) / 111_320, longitude: RING_WEST_LNG, accuracy: 10 });
  const left = async (page: Page) => Number((await page.locator('.nav-big.nav-m').textContent())!.replace(/\D/g, ''));

  test('"my location" keeps following the visitor (it used to read once and stop)', async ({ page, context, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-locate').click();
    const dot = page.locator('.me');
    await expect(dot).toBeVisible();
    await page.waitForTimeout(1500); // the flight settles
    const before = (await dot.boundingBox())!;
    for (let i = 1; i <= 8; i++) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    const after = (await dot.boundingBox())!;
    // 20 m south at zoom ≥ 18 is well over 15 screen pixels.
    expect(after.y - before.y).toBeGreaterThan(15);
  });

  test('while walking, the next stretch is in full colour and the rest of the route faint', async ({ page, context, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(page.locator('.nav-big')).toHaveCount(2, { timeout: 20_000 });
    for (let i = 1; i <= 3; i++) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(800);
    }
    expect(await page.evaluate(() => (window as unknown as Win).__engine.route.isFocused)).toBe(true);
    expect(await drawn(page, 'route-focus')).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as Win).__engine.map.getPaintProperty('route-walk', 'line-opacity'))).toBeLessThan(0.5);
    await showCard(page);
    await card(page).locator('.rc-end').click();
    expect(await drawn(page, 'route-focus')).toBe(0);
  });

  test('arriving: a notice offers to end tracking; «إنهاء التتبع» ends the route', async ({ page, context, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(page.locator('.nav-big')).toHaveCount(2, { timeout: 20_000 });
    // The route ends at the restroom's door (owner, 2026-10-14), 7.5 m south of its middle.
    const mid = placeAt(204);
    const end = [mid[0] - 7.5 / 111_320, mid[1]];
    // A jump this far is taken as real only from the third reading (src/location/filter.ts), then twice at the end.
    for (let i = 0; i < 6; i++) {
      await context.setGeolocation({ latitude: end[0], longitude: end[1] + i * 1e-7, accuracy: 5 });
      await page.waitForTimeout(800);
    }
    await expect(navBar(page)).toHaveAttribute('data-state', 'arrived');
    await expect(page.locator('.nav-arrived')).toContainText('وصلت');
    await page.locator('.nav-end').click();
    await expect(navBar(page)).toHaveCount(0);
    expect(await routeActive(page)).toBe(false);
  });

  test('«متابعة» keeps tracking and does not ask again', async ({ page, context, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(page.locator('.nav-big')).toHaveCount(2, { timeout: 20_000 });
    const mid = placeAt(204);
    const end = [mid[0] - 7.5 / 111_320, mid[1]];
    for (let i = 0; i < 6; i++) {
      await context.setGeolocation({ latitude: end[0], longitude: end[1] + i * 1e-7, accuracy: 5 });
      await page.waitForTimeout(800);
    }
    await page.locator('.nav-keep').click();
    await context.setGeolocation({ latitude: end[0], longitude: end[1] + 0.000001, accuracy: 5 });
    await page.waitForTimeout(1500);
    await expect(navBar(page)).not.toHaveAttribute('data-state', 'arrived');
    expect(await routeActive(page)).toBe(true);
  });

  test('remaining distance falls walking on, rises walking back, and warns', async ({ page, context, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(page.locator('.nav-big')).toHaveCount(2, { timeout: 20_000 });
    const start = await left(page);
    for (let i = 1; i <= 8; i++) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    const mid = await left(page);
    expect(mid).toBeLessThan(start - 10);
    for (let i = 7; i >= 0; i--) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    expect(await left(page)).toBeGreaterThan(mid + 10);
    await expect(navBar(page)).toHaveAttribute('data-state', 'away');
    await expect(page.locator('.nav-label')).toContainText('تبتعد');
  });
});

test.describe('travelling by car', () => {
  // ~1.5 km south-west of the Haram, on the Quba road side.
  test.use({ geolocation: { latitude: 24.456, longitude: 39.6, accuracy: 15 }, permissions: ['geolocation'] });

  test('walking is the default; the car button drives to the car park under the Haram and is remembered', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=223');
    const walk = page.getByRole('radio', { name: 'مشياً' });
    const car = page.getByRole('radio', { name: 'بالسيارة' });
    await expect(walk).toHaveAttribute('aria-checked', 'true');
    await car.click();
    await expect(car).toHaveAttribute('aria-checked', 'true');
    await routeBtn(page).click();
    await expect(card(page).locator('.leg-lot')).toContainText('موقف رقم', { timeout: 30_000 });
    expect(await drawn(page, 'route-car', 'drive')).toBeGreaterThan(0);
    expect(await drawn(page, 'route-car', 'garage')).toBeGreaterThan(0);
    expect((await marks(page)).filter((m) => m.startsWith('ramp:'))).toEqual(['ramp:P']);
    await showCard(page);
    await card(page).locator('.rc-end').click();
    expect(await drawn(page, 'route-car', 'drive')).toBe(0);
    await page.reload();
    await expect(page.getByRole('radio', { name: 'بالسيارة' })).toHaveAttribute('aria-checked', 'true');
  });

  test('on foot from outside the Haram, the walk follows the streets in (no car legs)', async ({ page, errors: _ }) => {
    await openAndRoute(page, 204);
    await expect(card(page)).toBeVisible({ timeout: 30_000 });
    expect(await drawn(page, 'route-walk')).toBeGreaterThan(0);
    expect(await drawn(page, 'route-car', 'drive')).toBe(0);
    const m = await metresOf(page);
    expect(m).toBeGreaterThan(1300);
    expect(m).toBeLessThan(2600);
  });
});

test.describe('by car to the car park under the Haram (owner’s drawing, 2026-10-13)', () => {
  test.use({ geolocation: { latitude: 24.476, longitude: 39.611, accuracy: 8 }, permissions: ['geolocation'] }); // north, First Ring Road

  test('choosing a lot shows the way in: streets to the entrance, the car park roads, and where to turn into the lot', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 909);
    await expect(card(page).locator('.leg-ent')).toContainText('سلطانة', { timeout: 30_000 });
    await expect(card(page).locator('.leg-lot')).toContainText('9');
    expect(await marks(page)).toContain('lot-gate:9B');
    expect(await drawn(page, 'route-car', 'garage')).toBeGreaterThan(0);
    // Lot 9 is on the north side, which the owner is sure of: no note about the east side.
    await expect(page.locator('.route-unsure')).toHaveCount(0);
    // Level B: no yellow edge, no legend.
    expect(await drawn(page, 'route-edge')).toBe(0);
    await expect(page.locator('.route-legend')).toHaveCount(0);
  });

  test('in the car park, a short instruction: the step now with its metres, then the next one', async ({ page, context, errors: _ }) => {
    await page.addInitScript(() => {
      localStorage.setItem('travel', 'drive');
      localStorage.setItem('level', 'A');
    });
    await openAndRoute(page, 909);
    await expect.poll(() => marks(page), { timeout: 30_000 }).toContain('lot-gate:9A');
    // Drive into the car park: along its first road from the Sultana mouth (data/garage.json).
    const lane = (JSON.parse(readFileSync('data/garage.json', 'utf8')) as { lanes: { id: string; path: [number, number][] }[] }).lanes.find((l) => l.id === 'sultana-in')!.path;
    for (const p of [lane[1], lane[1], lane[1], lane[2], lane[2], lane[3]]) {
      await context.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: 6 });
      await page.waitForTimeout(800);
    }
    await expect(page.locator('.nav-bar .step-banner')).toBeVisible();
    await expect(page.locator('.nav-bar .step-banner small')).toContainText('ثم');
  });

  test('level A goes up the yellow ramp; the way out comes down the green one to an exit', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openMap(page, 'ar', '?poi=909');
    const B = page.getByRole('radio', { name: 'الدور B' });
    const A = page.getByRole('radio', { name: 'الدور A' });
    await expect(B).toHaveAttribute('aria-checked', 'true');
    await A.click();
    await expect(A).toHaveAttribute('aria-checked', 'true');
    await routeBtn(page).click();
    await expect.poll(() => marks(page), { timeout: 30_000 }).toContain('lot-gate:9A');
    expect((await marks(page)).filter((m) => m.startsWith('level-ramp'))).toEqual(['level-ramp:↑A']);
    await expect(card(page).locator('.leg-lot')).toContainText('A');
    // The way on level A has a yellow edge and a «الدور A» label; the card explains the edge.
    expect(await drawn(page, 'route-edge')).toBeGreaterThan(0);
    expect(await marks(page)).toContain('level-label:الدور A');
    await expect(page.locator('.route-legend')).toBeVisible();
    // The way out: from the bay, down to level B, to an exit.
    await showCard(page);
    await card(page).locator('.rc-wayout').click();
    await expect(card(page).locator('.leg-ent')).toContainText('مخرج');
    expect((await marks(page)).filter((m) => m.startsWith('level-ramp'))).toEqual(['level-ramp:↓B']);
    await expect(card(page).locator('.pc-kicker')).toContainText('الخروج');
    // And back to the way in.
    await card(page).locator('.rc-wayin').click();
    await expect.poll(() => marks(page), { timeout: 30_000 }).toContain('lot-gate:9A');
  });
});

test.describe('in the car park, the visitor says where the car is (owner, 2026-10-14)', () => {
  // On the inner north road on level B, by the yellow ramp.
  test.use({ geolocation: { latitude: 24.47017, longitude: 39.612778, accuracy: 10 }, permissions: ['geolocation'] });

  test('asks which lot (nearest first), then which level; the way starts there, not at an entrance', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 912);
    const ask = page.locator('.garage-ask');
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await expect(ask.locator('.garage-ask-opt')).toHaveCount(4); // two lots, on the road, outside
    await expect(ask.locator('.garage-ask-opt').first()).toBeFocused();
    await ask.locator('.garage-ask-opt', { hasText: 'على الطرق تحت الأرض المؤدية إلى المواقف' }).click();
    await ask.locator('.garage-ask-opt', { hasText: 'B' }).click();
    await expect(ask).toHaveCount(0);
    await expect.poll(() => marks(page), { timeout: 30_000 }).toContain('lot-gate:12B');
    await expect(card(page).locator('.leg-ent')).toHaveCount(0);
    expect((await marks(page)).filter((m) => m.startsWith('ramp:'))).toEqual([]);
  });

  test('«outside the car park»: in from the streets by an entrance, as before', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 912);
    await page.locator('.garage-ask .garage-ask-opt').last().click();
    await expect(card(page).locator('.leg-ent')).toBeVisible({ timeout: 30_000 });
  });

  test('the question has a close button and closes on a tap outside it; the card comes back and nothing is drawn (owner, 2026-10-24)', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 912);
    await expect(page.locator('.garage-ask')).toBeVisible({ timeout: 30_000 });
    await page.locator('.garage-ask-x').click();
    await expect(page.locator('.garage-ask')).toHaveCount(0);
    expect(await routeActive(page)).toBe(false);
    // Again: press «start the route» and answer anew; this time close it with a tap on the map.
    await openAndRoute(page, 912);
    await expect(page.locator('.garage-ask')).toBeVisible({ timeout: 30_000 });
    await page.mouse.click(200, 120);
    await expect(page.locator('.garage-ask')).toHaveCount(0);
    expect(await routeActive(page)).toBe(false);
  });

  test('«not in the car park» says where the visitor is (the plaza here), and «on the road» says it means the underground roads', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 912);
    const ask = page.locator('.garage-ask');
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await expect(ask.locator('.garage-ask-opt').nth(2)).toHaveText('على الطرق تحت الأرض المؤدية إلى المواقف');
    await expect(ask.locator('.garage-ask-opt').last()).toHaveText(/ساحة الحرم|داخل المسجد|شارع بجانب المواقف/);
  });

  test('Esc dismisses the question and draws nothing', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('travel', 'drive'));
    await openAndRoute(page, 912);
    await expect(page.locator('.garage-ask')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.garage-ask')).toHaveCount(0);
    expect(await routeActive(page)).toBe(false);
    await expect(page.locator('.place-card')).toBeVisible();
  });
});

test.describe('alternative routes', () => {
  // South plaza → Gate 21 (north): round the mosque by the west or by the east side.
  const START = { latitude: 24.4668, longitude: 39.6111, accuracy: 8 };
  test.use({ geolocation: START, permissions: ['geolocation'] });

  test('the sheet is a slim summary; the other routes are faint on the map and tapping one chooses it', async ({ page, errors: _ }) => {
    await openAndRoute(page, 21);
    const stats = card(page).locator('.route-stats');
    await expect(stats).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => window.innerHeight - document.querySelector('.sheet')!.getBoundingClientRect().top), { message: 'visible sheet height' })
      .toBeLessThan(230);
    // The other routes are drawn, but nearly transparent.
    const n = await drawn(page, 'route-alt');
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => (window as unknown as Win).__engine.map.getPaintProperty('route-alt', 'line-opacity'))).toBeLessThanOrEqual(0.2);
    // Tapping one on the map (its time label) makes it the route: the summary changes.
    const before = await stats.textContent();
    const at = await page.evaluate(() => {
      const e = (window as unknown as Win).__engine;
      const f = e.map.queryRenderedFeatures({ layers: ['route-marks'] }).find((x: any) => x.properties.kind === 'alt');
      const p = e.map.project(f.geometry.coordinates);
      const r = e.map.getContainer().getBoundingClientRect();
      return [r.left + p.x, r.top + p.y];
    });
    await page.mouse.click(at[0], at[1]);
    await expect(stats).not.toHaveText(before!);
    expect(await routeActive(page)).toBe(true);
  });

  test('walking onto another offered route switches to it, without re-planning', async ({ page, context, errors: _ }) => {
    // The best route goes round the west side; the other one up the east side of the walkway ring.
    const ring = (JSON.parse(readFileSync('data/routing.json', 'utf8')) as { walkway_ring: [number, number][] }).walkway_ring;
    const eastLng = Math.max(...ring.map((p) => p[1]));
    await openAndRoute(page, 21);
    const stats = card(page).locator('.route-stats');
    await expect(stats).toBeVisible({ timeout: 20_000 });
    const before = await stats.textContent();
    // Walking north up the east side, ~30 m a step.
    for (let i = 0; i < 5; i++) {
      await context.setGeolocation({ latitude: 24.4674 + (i * 30) / 111_320, longitude: eastLng, accuracy: 8 });
      await page.waitForTimeout(900);
    }
    await expect(page.locator('.toast')).toContainText('تحوّل المسار');
    await expect(stats).not.toHaveText(before!);
  });
});

test('in English (left to right), the route card and the bar are in English', async ({ page, context, errors: _ }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.4685, longitude: 39.6084, accuracy: 15 });
  await openAndRoute(page, 204, 'en');
  await expect(card(page).locator('.pc-kicker')).toHaveText('Walking route', { timeout: 20_000 });
  await expect(card(page).locator('.rc-end')).toContainText('End route');
  await expect(navBar(page)).toBeVisible();
});
