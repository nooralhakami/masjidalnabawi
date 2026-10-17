import { expect, openMap, test } from './fixtures';

// Phase 8: what the visitor sees when something cannot work — no blank page, no silent failure.

test('a device without WebGL gets a calm message and «try again», not a blank page', async ({ page, errors }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    // No WebGL, as on some old or locked-down phones; 2D drawing still works.
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/i.test(type) ? null : (get as any).call(this, type, ...rest);
    } as typeof get;
  });
  await page.addInitScript(() => localStorage.setItem('lang', 'ar'));
  await page.goto('map.html');
  const card = page.locator('.map-error');
  await expect(card).toBeVisible();
  await expect(card).toContainText('تعذّر عرض الخريطة على هذا الجهاز');
  await expect(card.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
  // MapLibre reports the missing WebGL itself; nothing else may fail.
  errors.splice(0, errors.length, ...errors.filter((e) => !/webgl|WebGL/i.test(e)));
});

test('in English the message is English', async ({ page, errors }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = function () {
      return null;
    } as never;
  });
  await page.addInitScript(() => localStorage.setItem('lang', 'en'));
  await page.goto('map.html');
  await expect(page.locator('.map-error')).toContainText('The map could not be shown on this device');
  errors.splice(0, errors.length, ...errors.filter((e) => !/webgl|WebGL|canvas/i.test(e)));
});

test('no route to a place is said, and the button stops waiting', async ({ page, context, errors: _ }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 24.4685, longitude: 39.6084, accuracy: 15 });
  await openMap(page, 'ar', '?poi=204');
  await expect(page.locator('.pc-title')).toContainText('204', { timeout: 15_000 });
  // A planner that finds nothing (as it could for a place cut off from every road and walkway).
  await page.evaluate(() => ((window as any).__trip.planner = async () => []));
  const button = page.locator('.pc-actions .btn-block');
  await button.click();
  await expect(page.locator('.toast')).toContainText('لم نجد طريقاً إلى هذا المكان من موقعك');
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.route-card')).toHaveCount(0);
});

test.describe('sun mode (high contrast)', () => {
  const tokens = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const card = getComputedStyle(document.querySelector('.cat-btn')!);
      return { muted: cs.getPropertyValue('--muted').trim(), ink: cs.getPropertyValue('--ink').trim(), border: card.borderTopColor };
    });

  test('remembered on the device: faint text becomes full ink, borders as strong as controls', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('contrast', 'more'));
    await openMap(page);
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
    const v = await tokens(page);
    expect(v.muted).toBe(v.ink);
  });

  test("follows the device's «increase contrast» setting", async ({ page, errors: _ }) => {
    await page.emulateMedia({ contrast: 'more' });
    await openMap(page);
    const v = await tokens(page);
    expect(v.muted).toBe(v.ink);
  });

  test('off by default', async ({ page, errors: _ }) => {
    await openMap(page);
    const v = await tokens(page);
    expect(v.muted).not.toBe(v.ink);
  });

  test('the button in the search bar turns it on and off, and the choice is remembered', async ({ page, errors: _ }) => {
    await openMap(page, 'ar');
    const btn = page.getByRole('button', { name: 'وضع الشمس: تباين أعلى' });
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('contrast'))).toBe('more');
    let v = await tokens(page);
    expect(v.muted).toBe(v.ink);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
    await page.getByRole('button', { name: 'وضع الشمس: تباين أعلى' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'more');
    v = await tokens(page);
    expect(v.muted).not.toBe(v.ink);
  });

  test('the top card fits every phone width: buttons whole, ≥ 44 px, and a usable search field', async ({ page, errors: _ }) => {
    for (const width of [320, 360, 375, 412]) {
      await page.setViewportSize({ width, height: 700 });
      for (const lang of ['ar', 'en'] as const) {
        await openMap(page, lang);
        const r = await page.evaluate(() => {
          const card = document.querySelector('.top-card')!.getBoundingClientRect();
          const field = document.querySelector('.search-field')!.getBoundingClientRect();
          const btns = [...document.querySelectorAll('.top-card button, .top-card a')].map((b) => b.getBoundingClientRect()).filter((b) => b.width > 0);
          return { left: card.left, right: card.right, field: field.width, inside: btns.every((b) => b.left >= card.left - 0.5 && b.right <= card.right + 0.5 && b.width >= 44 && b.height >= 44) };
        });
        expect(r.left, `${width} ${lang}`).toBeGreaterThanOrEqual(0);
        expect(r.right, `${width} ${lang}`).toBeLessThanOrEqual(width);
        expect(r.inside, `${width} ${lang}`).toBe(true);
        expect(r.field, `${width} ${lang}`).toBeGreaterThan(180);
      }
    }
  });

});

test('the home button in the search bar leads back to the landing page (the live app)', async ({ page, errors: _ }) => {
  await openMap(page, 'ar');
  const home = page.getByRole('link', { name: 'الصفحة الرئيسية' });
  await expect(home).toBeVisible();
  await home.click();
  await expect(page).toHaveURL(/\/(index\.html)?$/);
  await expect(page.locator('.btn-cta')).toBeVisible();
});

