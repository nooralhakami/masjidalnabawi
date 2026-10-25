import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, idle, openMap, test } from './fixtures';

// The names over the places a route goes by (owner, 2026-10-25): faint for the gate or restroom block
// being passed, clear for two seconds for one tapped, and a tap on a route opens no card.

type Win = { __engine: any };

function placeAt(id: number): [number, number] {
  const p = (JSON.parse(readFileSync('data/pois.json', 'utf8')) as { id: number; lat: number; lng: number }[]).find((x) => x.id === id)!;
  const o = (JSON.parse(readFileSync('data/overrides.json', 'utf8')) as Record<string, { north?: number; east?: number }>)[String(id)] ?? {};
  return [p.lat + (o.north ?? 0) / 111_320, p.lng + (o.east ?? 0) / (111_320 * Math.cos((p.lat * Math.PI) / 180))];
}

const hints = (page: Page) => page.evaluate(() => (window as unknown as Win).__engine.hints.shown as { near: number | null; tapped: number | null });
const [lat, lng] = placeAt(338);

test.describe('walking by gate 338', () => {
  test.use({ geolocation: { latitude: lat + 2 / 111_320, longitude: lng, accuracy: 10 }, permissions: ['geolocation'] });

  test('the gate walked by is named faintly; a tapped gate is named for two seconds and opens no card', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=215');
    await expect(page.locator('.pc-title')).toContainText('215', { timeout: 15_000 });
    await page.locator('.pc-actions .btn-block').click();
    await expect(page.locator('.route-card')).toBeVisible({ timeout: 20_000 });
    // The faint name of the place being passed.
    await expect.poll(async () => (await hints(page)).near, { timeout: 15_000 }).toBe(338);

    // Tap gate 339 (62 m away) on the map: its name, clear; no card, the route goes on.
    const spot = await page.evaluate(() => {
      const e = (window as unknown as Win).__engine;
      const p = e.poi(339);
      e.map.jumpTo({ center: [p.lng, p.lat], zoom: 18.5 });
      return [p.lng, p.lat] as [number, number];
    });
    await idle(page);
    const pt = await page.evaluate((s) => (window as unknown as Win).__engine.map.project(s) as { x: number; y: number }, spot);
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    await expect.poll(async () => (await hints(page)).tapped, { timeout: 5_000 }).toBe(339);
    await expect(page.locator('.pc-title')).toContainText('215');
    expect(await page.evaluate(() => (window as unknown as Win).__engine.route.active)).toBe(true);
    // Two seconds later it is gone (the faint one for the place being passed stays).
    await expect.poll(async () => (await hints(page)).tapped, { timeout: 6_000 }).toBeNull();
    expect(await page.evaluate(() => (window as unknown as Win).__engine.map.getLayer('hints') !== undefined)).toBe(true);
  });

  test('ending the route takes the names away', async ({ page, errors: _ }) => {
    await openMap(page, 'en', '?poi=215');
    await expect(page.locator('.pc-title')).toContainText('215', { timeout: 15_000 });
    await page.locator('.pc-actions .btn-block').click();
    await expect.poll(async () => (await hints(page)).near, { timeout: 20_000 }).toBe(338);
    await page.evaluate(() => (window as unknown as { __trip: { end(): void } }).__trip.end());
    expect(await hints(page)).toEqual({ near: null, tapped: null });
  });
});
