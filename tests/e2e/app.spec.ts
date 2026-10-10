import { count, expect, openMap, search, test } from './fixtures';

test.describe('landing', () => {
  test('opens the map from the hero button', async ({ page, errors: _ }) => {
    await page.goto('./');
    await expect(page.locator('h1')).toHaveText('دليل زوار المسجد النبوي');
    // The adopted printed code, and a link that matches what it encodes.
    await expect(page.locator('#qr-code svg[shape-rendering]')).toBeVisible();
    await expect(page.locator('#map-link')).toHaveValue('https://masjidalnabawi.vercel.app/');
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
    ['all', 313],
    ['gates', 112],
    ['women', 35],
    ['toilets', 40],
    ['hotels', 43],
    ['food', 44],
    ['shopping', 15],
    ['landmarks', 38],
    ['historic', 17],
    ['wheelchair', 8],
    ['parking', 13],
    ['emergency', 11],
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
    await expect.poll(() => count(page)).toBe(40);
    await page.locator('.subpill[data-s="closed"]').click();
    await expect.poll(() => count(page)).toBe(0);
  });
});

test.describe('search and sheet', () => {
  test('shows the named Gate 1 label at zoom 19 and its naming reason', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=1');
    // The map has no zoom buttons; Leaflet's keyboard zoom works once the map has focus.
    // Each step waits for the zoom animation, otherwise Leaflet drops the key press.
    const zoom = async (key: string, times: number) => {
      for (let i = 0; i < times; i++) {
        await page.locator('.leaflet-container').focus();
        await page.keyboard.press(key);
        await page.waitForTimeout(400);
      }
    };
    await zoom('Equal', 3); // the default zoom is 17 (?poi= opens closer); 19 is the maximum
    await expect(page.locator('.gate-label')).toContainText('باب السلام');
    await zoom('Minus', 1);
    await expect(page.locator('.gate-label')).toHaveCount(0);
    await expect(page.locator('.sheet')).toContainText('سبب التسمية');
    // The description appears once, under «سبب التسمية», not again under the title.
    await expect(page.locator('.sheet .gate-about p')).toContainText('المدخل الرئيسي للزيارة');
    await expect(page.locator('.sheet .sh-desc')).toHaveCount(0);
  });

  test('Arabic digits, Enter picks the first result and opens its card', async ({ page, errors: _ }) => {
    // Close 215 for elevator works first (everything starts open).
    await openMap(page, 'ar', '?admin=1');
    const admin = page.locator('.admin');
    await admin.locator('summary').click();
    await admin.locator('select').selectOption('215');
    await admin.locator('[data-act="works"]').click();
    await admin.locator('summary').click();
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

  test("women's turn: Gate 37 needs a Nusuk permit, and a second card leads to the area behind the Rawdah (Gate 21)", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T21:00:00+03:00')); // after Isha in Madinah: women
    await openMap(page);
    await expect(page.locator('.rawdah-card')).toContainText('بتصريح من تطبيق نسك');
    const behind = page.locator('.rawdah-behind');
    await expect(behind).toBeVisible();
    await expect(behind).toContainText('بدون تصريح');
    await behind.click();
    await expect(page.locator('.sheet .sh-title')).toContainText('مدخل منطقة خلف الروضة للنساء');
  });

  test("the morning women's turn (Fajr → 10:00) also offers the area behind the Rawdah", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T08:00:00+03:00'));
    await openMap(page);
    await expect(page.locator('.rawdah-behind')).toBeVisible();
  });

  test("men's turn: no permit line and no behind-the-Rawdah card", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T12:00:00+03:00')); // midday: men
    await openMap(page);
    await expect(page.locator('.rawdah-card')).toBeVisible();
    await expect(page.locator('.rawdah-card')).not.toContainText('نسك');
    await expect(page.locator('.rawdah-behind')).toBeHidden();
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
    // ≈510 m since the owner's west-plaza walkways (2026-10-08); it was ≈615 m round the old ring.
    expect(meters).toBeGreaterThan(470);
    expect(meters).toBeLessThan(550);
    await expect(box).toContainText('7');
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
    ['bn', 'ltr'],
    ['fr', 'ltr'],
    ['fa', 'rtl'],
    ['ru', 'ltr'],
    ['ms', 'ltr'],
    ['ha', 'ltr'],
    ['ml', 'ltr'],
    ['sw', 'ltr'],
    ['ps', 'rtl'],
    ['so', 'ltr'],
    ['ta', 'ltr'],
    ['hi', 'ltr'],
  ];

  test('switching through every language', async ({ page, errors: _ }) => {
    await openMap(page);
    for (const [code, dir] of LANGS) {
      await page.locator('#lang-btn').click();
      await page.locator(`#lang-menu [data-lang="${code}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect.poll(() => count(page)).toBe(313);
      // Digits stay Latin in every language.
      await expect(page.locator('#hdr-sub')).toContainText('313');
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
    await expect(select.locator('option[value="215"]')).toContainText('أعمال مصعد');
    await expect(select.locator('option[value="216"]')).toContainText('أعمال مصعد');
    await admin.locator('[data-act="works"]').click();
    await expect(select.locator('option[value="216"]')).toContainText('مفتوح');
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

test.describe('regressions', () => {
  test('searching while a card is open shows the full results list', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.rawdah-card').click();
    await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'half');
    await search(page, '33');
    await expect(page.locator('#ui-top')).not.toHaveClass(/is-route-compact/);
    await expect(page.locator('.res')).toHaveCount(8);
    for (const r of await page.locator('.res').all()) await expect(r).toBeInViewport();
  });

  test('a place picked while markers are hidden is still marked on the map', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('[data-visibility]').click();
    await expect(page.locator('.mk')).toHaveCount(0);
    await search(page, '215');
    await page.getByRole('combobox').press('Enter');
    await expect(page.locator('.mk.is-selected')).toHaveCount(1);
  });
});

test.describe('route summary without live tracking', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

  test('distance and time stay on screen above the end button', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '204');
    await page.getByRole('combobox').press('Enter');
    await page.locator('[data-act="route"]').click();
    const box = page.locator('.route-box');
    await expect(box).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-act="endroute"]')).toBeInViewport();
    // The navigation bar never covers the sheet.
    await expect(page.locator('.navigation-status')).toBeVisible();
    const nav = (await page.locator('.navigation-status').boundingBox())!;
    const sheet = (await page.locator('.sheet').boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(sheet.y + 1);
  });
});

test.describe('walking robustness', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

  test('a stray tap on the map does not end the route; a new destination stops navigation', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '204');
    await page.getByRole('combobox').press('Enter');
    await page.locator('[data-act="route"]').click();
    await expect(page.locator('path.route-line')).toHaveCount(1);
    await page.mouse.click(60, 300); // empty map area
    await expect(page.locator('path.route-line')).toHaveCount(1);
    await expect(page.locator('.navigation-status')).toBeVisible();

    await search(page, '215');
    await page.getByRole('combobox').press('Enter');
    await expect(page.locator('.sheet .sh-title')).toContainText('215');
    await expect(page.locator('path.route-line')).toHaveCount(0);
    await expect(page.locator('.navigation-status')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/is-navigating/);
  });
});

test('map header theme button switches and remembers the theme', async ({ page, errors: _ }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await openMap(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#map-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('#map-theme')).toHaveAttribute('aria-label', 'الوضع النهاري');
});

test('the QR download is a PNG of the printed code', async ({ page, errors: _ }) => {
  await page.goto('./');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.length).toBeGreaterThan(2000);
});

test('a shared place link (?poi=) opens that place, and the share button builds such a link', async ({ page, context, errors: _ }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await page.goto('map.html?poi=204');
  await expect(page.locator('.sheet .sh-title')).toContainText('204');
  await expect(page.locator('.mk-pin')).toHaveCount(1);
  await page.locator('[data-act="share"]').click();
  await expect(page.locator('.toast')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/map\.html\?poi=204$/);
});

test.describe('live location while walking', () => {
  // Walking south along the west side of the walkway ring (data/routing.json), towards restrooms 204.
  const RING_WEST_LNG = 39.608334;
  test.use({ geolocation: { latitude: 24.4685, longitude: RING_WEST_LNG, accuracy: 10 }, permissions: ['geolocation'] });
  const step = (n: number) => ({ latitude: 24.4685 - (n * 2.5) / 111_320, longitude: RING_WEST_LNG, accuracy: 10 });

  test('"my location" keeps following the visitor (it used to read once and stop)', async ({ page, context, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-btn.is-locate').click();
    const dot = page.locator('.me');
    await expect(dot).toBeVisible();
    await page.waitForTimeout(1500); // fly-to settles
    const before = (await dot.boundingBox())!;
    for (let i = 1; i <= 8; i++) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    const after = (await dot.boundingBox())!;
    // 20 m south at zoom ≥ 18 is well over 15 screen pixels.
    expect(after.y - before.y).toBeGreaterThan(15);
  });

  test('navigation: remaining distance falls walking on, rises walking back, and warns', async ({ page, context, errors: _ }) => {
    await page.goto('map.html?poi=204');
    await expect(page.locator('.sheet .sh-title')).toContainText('204');
    await page.locator('[data-act="route"]').click();
    const metresLeft = async () => Number((await page.locator('.navigation-status .nav-big').nth(1).textContent())!.match(/\d+/)![0]);
    await expect(page.locator('.navigation-status .nav-big')).toHaveCount(2);
    const start = await metresLeft();
    for (let i = 1; i <= 8; i++) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    const mid = await metresLeft();
    expect(mid).toBeLessThan(start - 10);
    for (let i = 7; i >= 0; i--) {
      await context.setGeolocation(step(i));
      await page.waitForTimeout(1000);
    }
    expect(await metresLeft()).toBeGreaterThan(mid + 10);
    await expect(page.locator('.navigation-status')).toHaveAttribute('data-state', 'away');
  });
});

test('the weather chip shows the current temperature in Madinah, labelled in the UI language', async ({ page, errors: _ }) => {
  await openMap(page, 'en');
  const chip = page.locator('.weather-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('33°');
  await expect(chip).toHaveAttribute('aria-label', 'Weather now in Madinah: 33° · Clear');
});

test('key services: one pill for health centres, police, lost children, lost & found and service centres', async ({ page, errors: _ }) => {
  await openMap(page);
  await page.locator('.pill[data-f="emergency"]').click();
  await expect.poll(() => count(page)).toBe(11);
  // Police at gates 2 and 34, and the women's police with lost & found at gate 30.
  await search(page, 'شرطة');
  await expect(page.locator('.res')).toHaveCount(3);
});

test.describe('travelling by car', () => {
  // ~1.5 km south-west of the Haram, on the Quba road side.
  test.use({ geolocation: { latitude: 24.456, longitude: 39.6, accuracy: 15 }, permissions: ['geolocation'] });

  test('walking is the default; the car button drives to the car park under the Haram and is remembered', async ({ page, errors: _ }) => {
    await page.goto('map.html?poi=223');
    const walk = page.locator('.travel-btn[data-mode="walk"]');
    const car = page.locator('.travel-btn[data-mode="drive"]');
    await expect(walk).toHaveAttribute('aria-pressed', 'true');
    await car.click();
    await expect(car).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-act="route"]').click();
    await expect(page.locator('path.route-drive')).toHaveCount(1);
    await expect(page.locator('path.route-garage')).toHaveCount(1);
    await expect(page.locator('.route-ramp')).toBeVisible();
    await expect(page.locator('.route-legs .leg-lot')).toContainText('موقف رقم');
    await page.locator('[data-act="endroute"]').click();
    await expect(page.locator('path.route-drive')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.travel-btn[data-mode="drive"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('on foot from outside the Haram, the walk follows the streets in (no car legs)', async ({ page, errors: _ }) => {
    await page.goto('map.html?poi=204');
    await page.locator('[data-act="route"]').click();
    await expect(page.locator('path.route-line')).toHaveCount(1);
    await expect(page.locator('path.route-drive')).toHaveCount(0);
    const meters = Number((await page.locator('.route-box .fact-v').first().textContent())!.replace(/\D/g, ''));
    expect(meters).toBeGreaterThan(1300);
    expect(meters).toBeLessThan(2600);
  });
});

test('zoomed out, every marker stays in its place but smaller (no merging)', async ({ page, errors: _ }) => {
  await openMap(page);
  const before = await page.locator('.mk').count();
  const out = page.getByRole('button', { name: 'تصغير' });
  for (let i = 0; i < 2; i++) {
    await out.click();
    await page.waitForTimeout(450);
  }
  await expect(page.locator('.leaflet-container')).toHaveClass(/z-(mid|far)/);
  expect(await page.locator('.mk-cluster').count()).toBe(0);
  const dot = page.locator('.mk-s .mk-dot').first();
  expect((await dot.boundingBox())!.width).toBeLessThanOrEqual(6);
  expect(await page.locator('.mk').count()).toBeGreaterThanOrEqual(before);
});

test.describe('smoothness (SPEC F13)', () => {
  test('a small pan keeps the markers already on screen (no rebuild) and the glass blur pauses only while moving', async ({ page, errors: _ }) => {
    await openMap(page);
    // Tag the markers on screen, pan a little, and check they are the same elements afterwards.
    await page.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').forEach((el) => el.setAttribute('data-kept', '1')));
    const before = await page.locator('[data-kept="1"]').count();
    const box = (await page.locator('.leaflet-container').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.55;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 6 });
    expect(await page.evaluate(() => document.body.classList.contains('map-moving'))).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.body.classList.contains('map-moving'))).toBe(false);
    // Most markers survive a 36 px pan (only those crossing the view's padded edge change).
    expect(await page.locator('[data-kept="1"]').count()).toBeGreaterThan(before * 0.8);
  });
});

test.describe('compass', () => {
  test('needle turns with true north on screen (opposite to the map turn) and shows the Kaaba', async ({ page, errors: _ }) => {
    await openMap(page);
    const compass = page.locator('.mc-compass');
    await expect(compass.locator('.kaaba')).toHaveCount(1);
    await page.locator('.mc-rotate .mc-btn').first().click(); // rotate by +15°
    await expect(compass).toHaveClass(/is-rotated/);
    const { pane, needle } = await page.evaluate(() => {
      const t = (document.querySelector('.leaflet-rotate-pane') as HTMLElement).style.transform;
      const rad = Number(/rotate\((-?[\d.e-]+)rad\)/.exec(t)?.[1]);
      const deg = parseFloat((document.querySelector('.mc-compass') as HTMLElement).style.getPropertyValue('--bearing'));
      return { pane: (rad * 180) / Math.PI, needle: deg };
    });
    // The map content (and with it north) turned clockwise by the bearing; the needle must follow north.
    expect(Math.abs(pane)).toBeCloseTo(15, 0);
    expect(needle).toBeCloseTo(pane, 0);
  });
});
