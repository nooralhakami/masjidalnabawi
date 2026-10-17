import type { Page } from '@playwright/test';
import { expect, openMap, test } from './fixtures';

// Trip mode and heading-up (owner, 2026-10-17): with a route on the map, everything but the route
// steps aside; heading-up turns the map so the way ahead points up, and is remembered.

type Win = { __engine: any };
test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 15 }, permissions: ['geolocation'] });

async function route(page: Page) {
  await openMap(page, 'ar', '?poi=204');
  await expect(page.locator('.pc-title')).toContainText('204', { timeout: 15_000 });
  await page.locator('.pc-actions .btn-block').click();
  await expect(page.locator('.route-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.nav-bar')).toBeVisible();
}

const bearing = (page: Page) => page.evaluate(() => (window as unknown as Win).__engine.map.getBearing() as number);

test('a route clears the screen: top bar, pills and side buttons step aside, the compass stays, the card is a strip', async ({ page, errors: _ }) => {
  await route(page);
  await expect(page.locator('.map-page')).toHaveAttribute('data-trip', '');
  await expect(page.locator('.app-top')).toBeHidden();
  await expect(page.locator('.map-overlay-left')).toBeHidden();
  await expect(page.locator('.map-controls .mc-zoom')).toBeHidden();
  await expect(page.locator('.mc-compass')).toBeVisible();
  await expect(page.locator('.sheet.is-peek')).toHaveCount(1);
  // The strip shows the name and the distance and time, whole, with its close button.
  await expect(page.locator('.route-card [data-peek-end]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.route-card .pc-head button, .route-card button[aria-label="إغلاق"]').first()).toBeInViewport();

  // The handle opens the details; ending the route brings everything back.
  await page.locator('.sheet-handle').click();
  await expect(page.locator('.sheet.is-half')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.locator('.route-card .rc-end').click();
  await expect(page.locator('.map-page')).not.toHaveAttribute('data-trip', '');
  await expect(page.locator('.app-top')).toBeVisible();
  await expect(page.locator('.map-overlay-left')).toBeVisible();
});

test('heading-up: the map turns with the route and zooms in; remembered; the compass turns it off', async ({ page, context, errors: _ }) => {
  await route(page);
  const btn = page.locator('.nav-heading');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await bearing(page)).toBe(0);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  // A fix on the route: the camera follows and turns (this route heads off south-east here).
  await context.setGeolocation({ latitude: 24.4684, longitude: 39.6085, accuracy: 8 });
  await expect.poll(() => bearing(page), { timeout: 10_000 }).not.toBe(0);
  // Street level (Leaflet 18 = MapLibre 17), once the camera has eased there.
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__engine.map.getZoom() as number)).toBeGreaterThanOrEqual(16.9);
  expect(await page.evaluate(() => localStorage.getItem('heading-up'))).toBe('1');

  // The compass: north up again, heading-up off.
  await page.locator('.mc-compass button').click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => bearing(page)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('heading-up'))).toBeNull();
});

test('ending a route with the map turned brings north back up', async ({ page, context, errors: _ }) => {
  await page.addInitScript(() => localStorage.setItem('heading-up', '1'));
  await route(page);
  await expect(page.locator('.nav-heading')).toHaveAttribute('aria-pressed', 'true');
  await context.setGeolocation({ latitude: 24.4684, longitude: 39.6085, accuracy: 8 });
  await expect.poll(() => bearing(page), { timeout: 10_000 }).not.toBe(0);
  await page.locator('.sheet-handle').click();
  await page.waitForTimeout(600);
  await page.locator('.route-card .rc-end').click();
  await expect.poll(() => bearing(page)).toBe(0);
});
