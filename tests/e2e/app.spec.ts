import { count, expect, openMap, search, test } from './fixtures';

test.describe('landing', () => {
  test('opens the map from the hero button', async ({ page, errors: _ }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('دليل زوار المسجد النبوي');
    await expect(page.locator('.qr-code > svg')).toBeVisible();
    await expect(page.locator('#map-link')).toHaveValue(/map\.html$/);
    await page.getByRole('link', { name: 'ابدأ استخدام الخريطة' }).click();
    await expect(page).toHaveURL(/map\.html$/);
    await expect(page.locator('.hdr')).toBeVisible();
  });

  test('language choice applies to the landing page and carries to the map', async ({ page, errors: _ }) => {
    await page.goto('./');
    await page.locator('#lang-btn').click();
    await page.locator('#lang-menu [data-lang="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toHaveText("Prophet's Mosque Visitor Guide");
    await page.locator('.btn-cta').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('filters', () => {
  const EXPECTED: [string, number][] = [
    ['all', 201],
    ['gates', 112],
    ['women', 33],
    ['toilets', 38],
    ['hotels', 8],
    ['food', 12],
    ['landmarks', 19],
    ['wheelchair', 8],
    ['parking', 13],
    ['emergency', 2],
  ];

  test('every filter pill shows its POIs', async ({ page, errors: _ }) => {
    await openMap(page);
    for (const [id, n] of EXPECTED) {
      const pill = page.locator(`.pill[data-f="${id}"]`);
      await pill.click();
      await expect(pill).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => count(page), { message: id }).toBe(n);
    }
  });

  test('parking only appears with its pill; restroom sub-filters work', async ({ page, errors: _ }) => {
    await openMap(page);
    await expect(page.locator('.mk-park')).toHaveCount(0);
    await page.locator('.pill[data-f="parking"]').click();
    await expect(page.locator('.mk-park')).toHaveCount(13);

    await page.locator('.pill[data-f="toilets"]').click();
    await page.locator('.subpill[data-s="open"]').click();
    await expect.poll(() => count(page)).toBe(33);
    await page.locator('.subpill[data-s="closed"]').click();
    await expect.poll(() => count(page)).toBe(5);
  });
});

test.describe('search and sheet', () => {
  test('Arabic digits, Enter picks the first result and opens its card', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '٢١٥');
    await expect(page.locator('.res').first()).toContainText('215');
    await page.getByRole('combobox').press('Enter');
    const sheet = page.locator('.sheet');
    await expect(sheet).toHaveAttribute('data-state', 'half');
    await expect(sheet.locator('.sh-title')).toContainText('215');
    // Closed for elevator works → nearest open alternative is 217.
    await expect(sheet.locator('.alt')).toContainText('217');
    await sheet.locator('.alt [data-act="go"]').click();
    await expect(sheet.locator('.sh-title')).toContainText('217');
    await sheet.locator('[data-act="close"]').click();
    await expect(sheet).toHaveAttribute('data-state', 'closed');
  });

  test('parking by level code and English names from any language', async ({ page, errors: _ }) => {
    await openMap(page, 'tr');
    await search(page, '1A');
    await expect(page.locator('.res').first()).toContainText('1');
    await search(page, 'Al Baik');
    await expect(page.locator('.res')).toHaveCount(1);
    await search(page, 'zzqxw');
    await expect(page.locator('.res-none')).toBeVisible();
  });

  test('Rawdah card opens Gate 37 with the live schedule', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.rawdah-card').click();
    await expect(page.locator('.sheet .sh-title')).toContainText('37');
    await expect(page.locator('.sheet .ro-sched li')).toHaveCount(4);
    await expect(page.locator('.sheet .turn')).toBeVisible();
  });
});

test.describe('walking route', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

  test('draws a route from a simulated location to restroom 204', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '204');
    await page.getByRole('combobox').press('Enter');
    await page.locator('[data-act="route"]').click();
    const box = page.locator('.route-box');
    await expect(box).toBeVisible();
    const meters = Number((await box.locator('.fact-v').first().textContent())!.match(/\d+/)![0]);
    expect(meters).toBeGreaterThan(560);
    expect(meters).toBeLessThan(660);
    await expect(box).toContainText('8');
    await expect(page.locator('path.route-line')).toHaveCount(1);
    await expect(page.locator('.me-dot')).toBeVisible();
    await page.locator('[data-act="endroute"]').click();
    await expect(page.locator('path.route-line')).toHaveCount(0);
  });
});

test.describe('far away visitor', () => {
  test.use({ geolocation: { latitude: 21.4225, longitude: 39.8262, accuracy: 20 }, permissions: ['geolocation'] });

  test('the map does not move and a gentle note explains why', async ({ page, errors: _ }) => {
    await openMap(page);
    const before = await page.evaluate(() => document.querySelector('.leaflet-map-pane')!.getAttribute('style'));
    await page.locator('.mc-btn.is-locate').click();
    await expect(page.locator('.toast')).toContainText('كم');
    expect(await page.evaluate(() => document.querySelector('.leaflet-map-pane')!.getAttribute('style'))).toBe(before);
  });
});

test.describe('languages', () => {
  const LANGS: [string, 'rtl' | 'ltr'][] = [
    ['ar', 'rtl'],
    ['en', 'ltr'],
    ['tr', 'ltr'],
    ['ur', 'rtl'],
    ['id', 'ltr'],
    ['uz', 'ltr'],
  ];

  test('switching through all six languages', async ({ page, errors: _ }) => {
    await openMap(page);
    for (const [code, dir] of LANGS) {
      await page.locator('#lang-btn').click();
      await page.locator(`#lang-menu [data-lang="${code}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect.poll(() => count(page)).toBe(201);
      // Digits stay Latin in every language.
      await expect(page.locator('#hdr-sub')).toContainText('201');
    }
  });
});

test.describe('admin simulator', () => {
  test('hidden by default', async ({ page, errors: _ }) => {
    await openMap(page);
    await expect(page.locator('.admin')).toHaveCount(0);
  });

  test('?admin=1: elevator works toggle the pair together', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?admin=1');
    const admin = page.locator('.admin');
    await admin.locator('summary').click();
    const select = admin.locator('select');
    await select.selectOption('215');
    await admin.locator('[data-act="works"]').click();
    await expect(select.locator('option[value="215"]')).toContainText('مفتوح');
    await expect(select.locator('option[value="216"]')).toContainText('مفتوح');
    await admin.locator('[data-act="works"]').click();
    await expect(select.locator('option[value="216"]')).toContainText('أعمال مصعد');
  });
});

test.describe('PWA', () => {
  test('service worker registers and precaches the app (not map tiles)', async ({ page, errors: _ }) => {
    await openMap(page);
    const info = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      let urls: string[] = [];
      for (const k of keys) urls = urls.concat((await (await caches.open(k)).keys()).map((r) => r.url));
      return { state: reg.active?.state, urls };
    });
    expect(info.state).toBe('activated');
    expect(info.urls.some((u) => u.includes('map.html'))).toBe(true);
    expect(info.urls.some((u) => /woff2/.test(u))).toBe(true);
    expect(info.urls.some((u) => /arcgisonline|openstreetmap/.test(u))).toBe(false);
  });

  test('manifest is Arabic, RTL and starts at map.html', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.lang).toBe('ar');
    expect(m.dir).toBe('rtl');
    expect(m.start_url).toBe('./map.html');
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
