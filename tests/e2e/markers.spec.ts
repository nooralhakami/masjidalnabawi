import type { Page } from '@playwright/test';
import { expect, idle, moved, openMap, test, zoomTo } from './fixtures';

// Clearer markers (UI plan phase 3, owner 2026-11-07): the markers stay where they are (no count
// bubbles); a tap on a tight group zooms in there rather than guessing; the chosen one gets a short
// gold ring, never endless and never with «reduce motion».

type Win = { __engine: any };

/** A place's marker on screen, in page coordinates. */
async function onScreen(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const e = (window as unknown as Win).__engine;
    const p = e.poi(i);
    const q = e.map.project([p.lng, p.lat]);
    const r = e.map.getContainer().getBoundingClientRect();
    return { x: r.left + q.x, y: r.top + q.y };
  }, id);
}
const zoom = (page: Page) => page.evaluate(() => (window as unknown as Win).__engine.map.getZoom() as number);

test('a tap between two markers close together zooms in there and opens neither', async ({ page, errors: _ }) => {
  await openMap(page);
  // Restroom blocks 205 and 206 face each other across a walkway: under a fingertip (44 px) apart at 16.
  await zoomTo(page, 16, [39.6111, 24.4683]);
  const a = await onScreen(page, 205);
  const b = await onScreen(page, 206);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(44);
  const before = await zoom(page);
  const done = moved(page);
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await done;
  expect(await zoom(page)).toBeGreaterThan(before + 1.5);
  await expect(page.locator('.pc-title')).toHaveCount(0);
  // Now they are apart: a tap on one opens it.
  await idle(page);
  const a2 = await onScreen(page, 205);
  await page.mouse.click(a2.x, a2.y);
  await expect(page.locator('.pc-title')).toContainText('205');
});

test('the chosen marker gets a short gold ring that stops by itself', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?poi=205');
  await expect(page.locator('.pc-title')).toContainText('205', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__engine.pulse.playing), { timeout: 5_000 }).toBe(false);
  // Choose another: it plays again, then stops (two rings, about 1.2 s).
  const q = await onScreen(page, 205);
  await page.evaluate(() => (window as unknown as Win).__engine.select(206));
  expect(await page.evaluate(() => (window as unknown as Win).__engine.pulse.playing)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__engine.pulse.playing), { timeout: 4_000 }).toBe(false);
  expect(q.x).toBeGreaterThan(0);
});

test.describe('with «reduce motion»', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no ring at all', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=205');
    await expect(page.locator('.pc-title')).toContainText('205', { timeout: 15_000 });
    await page.evaluate(() => (window as unknown as Win).__engine.select(206));
    expect(await page.evaluate(() => (window as unknown as Win).__engine.pulse.playing)).toBe(false);
  });
});
