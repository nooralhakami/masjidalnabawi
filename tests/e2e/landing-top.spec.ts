import { expect, test } from './fixtures';

// The landing page's top (UI plan phase 6, owner 2026-11-07): a big «open the map» button with the
// next prayer and its time left under it, then a small live map; below them the features, then the
// QR code and installing. The gold pattern in the header only.

test.use({ viewport: { width: 375, height: 812 } });

test('in the first screen: the big button to the map, then the next prayer with the time left', async ({ page, errors: _ }) => {
  // Midday in Madinah: the next prayer is Asr.
  await page.clock.setFixedTime(new Date('2026-11-08T12:30:00+03:00'));
  await page.goto('./');
  const open = page.getByRole('link', { name: 'افتح الخريطة', exact: true });
  await expect(open).toHaveAttribute('href', './map.html');
  const b = (await open.boundingBox())!;
  expect(b.y + b.height).toBeLessThan(812);
  expect(b.height).toBeGreaterThanOrEqual(56);
  expect(b.width).toBeGreaterThan(375 - 2 * 16 - 1);
  const pr = page.locator('#next-prayer');
  await expect(pr).not.toHaveClass(/is-empty/);
  await expect(pr.locator('.pr-name')).toHaveText('العصر');
  await expect(pr.locator('.pr-time')).toHaveText(/^\d{1,2}:\d{2}/);
  await expect(pr.locator('.pr-left')).toContainText('بعد');
  const p = (await pr.boundingBox())!;
  expect(p.y).toBeGreaterThan(b.y + b.height);
  expect(p.y + p.height).toBeLessThan(812);
});

test('the small live map: a link to the map, its live picture drawn after the page shows', async ({ page, errors: _ }) => {
  await page.goto('./');
  const card = page.locator('a.mini-map');
  await expect(card).toHaveAttribute('href', './map.html');
  await expect(card).toHaveAccessibleName('خريطة المسجد النبوي الحية، اضغط لفتحها');
  await expect(card.locator('.mini-credit')).toContainText('OpenStreetMap');
  await expect(card).toHaveClass(/is-live/, { timeout: 30_000 });
  expect(await card.locator('canvas').count()).toBe(1);
  // It does not move: no zoom or drag on it.
  expect(await card.locator('.maplibregl-interactive').count()).toBe(0);
});

test('before any script: the still picture and the prayer line hold their places (nothing jumps)', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.locator('#next-prayer')).toHaveClass(/is-empty/);
  expect((await page.locator('#next-prayer').boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await expect(page.locator('.mini-still img')).toHaveAttribute('src', './mini-map.jpg');
  await ctx.close();
});

test('then the features, then the QR code, then installing; the gold pattern only in the header', async ({ page, errors: _ }) => {
  await page.goto('./');
  const order = await page.locator('main > section').evaluateAll((s) => s.map((x) => x.id));
  expect(order).toEqual(['top', 'features', 'qr', 'install']);
  await expect(page.locator('.hero-pattern')).toHaveCount(1);
  await expect(page.locator('.hero .hero-pattern')).toHaveCount(1);
  expect(Number(await page.locator('.hero-pattern').evaluate((el) => getComputedStyle(el).opacity))).toBeLessThanOrEqual(0.2);
});
