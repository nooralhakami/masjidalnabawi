import { expect, openMap, test } from './fixtures';

// Phase 9: the features of docs/PARITY.md §ج that had no journey of their own yet.

type Win = { __engine: any };

test.describe('a link with ?lang=', () => {
  test('opens the map in that language and direction, and remembers it', async ({ page, errors: _ }) => {
    await page.goto('map.html?lang=en');
    await page.waitForFunction(() => (window as unknown as Win).__engine?.map?.loaded());
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#lang-btn')).toContainText('EN');
    expect(await page.evaluate(() => localStorage.getItem('lang'))).toBe('en');
  });

  test('a right-to-left language (Urdu) turns the page right to left', async ({ page, errors: _ }) => {
    await page.goto('map.html?lang=ur');
    await page.waitForFunction(() => (window as unknown as Win).__engine?.map?.loaded());
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  });

  test('an unknown code is ignored', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
    await page.goto('map.html?lang=xx');
    await page.waitForFunction(() => (window as unknown as Win).__engine?.map?.loaded());
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });
});

test.describe('during a route', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

  test('the screen is kept awake while tracking, and let go when the route ends', async ({ page, errors: _ }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __wake: string[] };
      w.__wake = [];
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async (type: string) => {
            w.__wake.push(`request:${type}`);
            return { release: async () => void w.__wake.push('release'), addEventListener: () => undefined };
          },
        },
      });
    });
    await openMap(page, 'ar', '?poi=204');
    await expect(page.locator('.pc-title')).toContainText('204', { timeout: 15_000 });
    await page.locator('.pc-actions .btn-block').click();
    await expect(page.locator('.route-card')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: string[] }).__wake)).toContain('request:screen');
    await expect(page.locator('.sheet.is-peek')).toHaveCount(1, { timeout: 20_000 });
    await page.locator('.sheet-handle').click();
    await page.waitForTimeout(600);
    await page.locator('.route-card .rc-end').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: string[] }).__wake)).toContain('release');
  });

  test('leaving the route: it is redrawn from where the visitor is, and said', async ({ page, context, errors: _ }) => {
    await openMap(page, 'ar', '?poi=204');
    await expect(page.locator('.pc-title')).toContainText('204', { timeout: 15_000 });
    await page.locator('.pc-actions .btn-block').click();
    await expect(page.locator('.route-card')).toBeVisible({ timeout: 20_000 });
    // Off to the west, away from every offered route, a few readings in a row.
    for (let i = 1; i <= 6; i++) {
      await context.setGeolocation({ latitude: 24.4685, longitude: 39.6084 - (i * 25) / 101_300, accuracy: 8 });
      await page.waitForTimeout(900);
    }
    await expect(page.locator('.toast')).toContainText('أُعيد رسم المسار من موقعك', { timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as Win).__engine.route.active)).toBe(true);
  });

  test('walking to a car park lot: arrows on its four entrances, the nearest one named', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=909');
    await expect(page.locator('.pc-title')).toContainText('9', { timeout: 15_000 });
    await page.locator('.pc-actions .btn-block').click();
    await expect(page.locator('.route-card')).toBeVisible({ timeout: 20_000 });
    const marks = await page.evaluate(() => ((window as unknown as Win).__engine.route.shownMarks as { kind: string; text?: string }[]).map((m) => `${m.kind}:${m.text ?? ''}`));
    const entrances = marks.filter((m) => m.startsWith('entrance:'));
    expect(entrances).toHaveLength(4);
    expect(entrances.filter((m) => m === 'entrance:nearest')).toHaveLength(1);
    const label = marks.filter((m) => m.startsWith('entrance-label:'));
    expect(label).toHaveLength(1);
    expect(label[0].length).toBeGreaterThan('entrance-label:'.length);
  });
});

test.describe('markers pop in on a new filter (SPEC §5)', () => {
  const opacity = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const m = (window as unknown as Win).__engine.map;
      return { icon: m.getPaintProperty('facilities', 'icon-opacity'), dots: m.getPaintProperty('facility-dots', 'circle-opacity'), fade: m.getPaintProperty('facilities', 'icon-opacity-transition') };
    });

  test('a category tap fades the markers in over 200 ms and leaves them fully drawn', async ({ page, errors: _ }) => {
    await openMap(page);
    expect((await opacity(page)).icon).toBeUndefined();
    await page.locator('.cat-btn').nth(1).click();
    await expect.poll(async () => (await opacity(page)).icon).toBe(1);
    const o = await opacity(page);
    expect(o.dots).toBe(1);
    expect(o.fade).toEqual({ duration: 200, delay: 0 });
  });

  test('not with reduced motion', async ({ page, errors: _ }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMap(page);
    await page.locator('.cat-btn').nth(1).click();
    await page.waitForTimeout(400);
    expect((await opacity(page)).icon).toBeUndefined();
  });
});

test('a chosen gate: its number 1.35 times larger, with its name beside it from 19 (the live app)', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?poi=37');
  await expect(page.locator('.pc-title')).toContainText('37', { timeout: 15_000 });
  await page.evaluate(() => (window as unknown as Win).__engine.map.jumpTo({ zoom: 18.2 }));
  const r = await page.evaluate(
    () =>
      new Promise<{ sel: string[]; names: string[]; size: unknown }>((done) => {
        const m = (window as unknown as Win).__engine.map;
        m.once('idle', () =>
          done({
            sel: m.queryRenderedFeatures({ layers: ['selected'] }).map((f: any) => String(f.properties.id)),
            names: m.queryRenderedFeatures({ layers: ['gate-names'] }).map((f: any) => String(f.properties.id)),
            size: m.getLayoutProperty('selected', 'icon-size'),
          }),
        );
        m.triggerRepaint();
      }),
  );
  expect(r.sel).toEqual(['37']);
  expect(r.names).toEqual(['37']);
  expect(JSON.stringify(r.size)).toContain('1.35');
});

