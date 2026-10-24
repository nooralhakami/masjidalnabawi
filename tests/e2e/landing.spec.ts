import { readFileSync } from 'node:fs';
import { expect, openMap, test } from './fixtures';

// Phase 7: the landing page and the installable app — the live app's journeys 1–3, 20, 21 and 27
// (docs/PARITY.md), with its expected texts and numbers.

test.describe('landing', () => {
  test('opens the map from the hero button; the QR code and the link encode the printed address', async ({ page, errors: _ }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('دليل زوار المسجد النبوي');
    await expect(page.locator('#qr-code svg[shape-rendering]')).toBeVisible();
    await expect(page.locator('#map-link')).toHaveValue('https://masjidalnabawi.vercel.app/');
    await page.getByRole('link', { name: 'ابدأ استخدام الخريطة' }).click();
    await expect(page).toHaveURL(/map\.html$/);
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('the page is there before any script runs (prerendered in Arabic)', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('دليل زوار المسجد النبوي');
    await expect(page.locator('.stats dd').first()).toHaveText('316');
    await ctx.close();
  });

  test('language choice applies to the landing page and carries to the map', async ({ page, errors: _ }) => {
    await page.goto('./');
    await page.locator('#lang-btn').click();
    await page.locator('#lang-menu [data-lang="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toHaveText("Prophet's Mosque Visitor Guide");
    await page.locator('.btn-cta').first().click();
    await expect(page).toHaveURL(/map\.html$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the QR download is a PNG of the printed code', async ({ page, errors: _ }) => {
    await page.goto('./');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  test('copy puts the map link on the clipboard and says so', async ({ page, context, errors: _ }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./');
    await page.locator('#copy').click();
    await expect(page.locator('.toast')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://masjidalnabawi.vercel.app/');
  });
});

test("the landing page's number of places is the number the map offers (All + parking)", async ({ page, errors: _ }) => {
  await page.goto('./');
  const places = Number((await page.locator('.stats dd').first().textContent())!.trim());
  await openMap(page);
  const pill = (i: number) => page.locator('.cat-row .cat-btn').nth(i);
  const all = Number(await pill(0).locator('.cat-n').textContent());
  const parking = Number(await pill(5).locator('.cat-n').textContent());
  expect(places).toBe(all + parking);
});

test.describe('PWA', () => {
  test('the service worker registers and precaches the app (not map tiles, not story photos)', async ({ page, errors: _ }) => {
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
    expect(info.urls.some((u) => u.includes('index.html'))).toBe(true);
    expect(info.urls.some((u) => /woff2/.test(u))).toBe(true);
    expect(info.urls.some((u) => /arcgisonline|openstreetmap/.test(u))).toBe(false);
    expect(info.urls.some((u) => /\/visits\//.test(u))).toBe(false);
  });

  test('manifest is Arabic, RTL and starts at map.html', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.lang).toBe('ar');
    expect(m.dir).toBe('rtl');
    expect(m.start_url).toBe('./map.html');
    expect(m.description).toContain('26');
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  test('after one visit the interface opens without a connection', async ({ page, context, errors }) => {
    await openMap(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Wait until the precache has every file, then cut the network.
    await page.waitForFunction(async () => (await caches.keys()).length > 0 && navigator.serviceWorker.controller !== null, null, { timeout: 15_000 }).catch(() => page.reload());
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('دليل زوار المسجد النبوي');
    await page.goto('map.html');
    await expect(page.getByRole('combobox')).toBeVisible();
    await context.setOffline(false);
    // Offline, the map tiles and the weather cannot load (expected, and never cached); any other error still fails.
    const rest = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
    errors.splice(0, errors.length, ...rest);
  });
});

test.describe('translations, one file per language', () => {
  const watch = (page: import('@playwright/test').Page) => {
    const files: string[] = [];
    page.on('request', (r) => /\/i18n\/\w+\.json$/.test(r.url()) && files.push(r.url().split('/').pop()!));
    return files;
  };

  test('in Arabic no translation file is fetched (Arabic and English ship with the page)', async ({ page, errors: _ }) => {
    const files = watch(page);
    await openMap(page, 'ar');
    expect(files).toEqual([]);
  });

  test('in Turkish only its own file is fetched, before the page shows Turkish', async ({ page, errors: _ }) => {
    const files = watch(page);
    await openMap(page, 'tr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.locator('.cat-row .cat-btn').first()).toContainText('Tümü');
    expect(files).toEqual(['tr.json']);
  });
});

test('no placeholder organisation name in the footer (owner: hidden until there is one)', async ({ page, errors: _ }) => {
  await page.goto('./');
  const footer = page.locator('.footer');
  await expect(footer).toBeVisible();
  await expect(footer).not.toContainText('ORG_NAME');
  await expect(footer.locator('.nav-title')).toBeVisible();
});
