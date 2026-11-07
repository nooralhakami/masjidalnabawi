import type { Page } from '@playwright/test';
import { expect, openMap, test } from './fixtures';

// First-visit hints (UI plan phase 5, owner 2026-11-07): no welcome screen. Three small bubbles,
// each beside what it is about, one after another; any touch moves on; once only; never after a
// shared link; the page under them always takes the touch.

const firstVisit = (page: Page) => page.addInitScript(() => localStorage.getItem('hints-seen') === null && localStorage.setItem('hints-seen', '0'));
const hint = (page: Page) => page.locator('.hint');
const box = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((el) => el.getBoundingClientRect().toJSON());

test('on a first visit: search here, then the categories, then any marker; each beside its target', async ({ page, errors: _ }) => {
  await firstVisit(page);
  await openMap(page);
  // The map shows at once: no screen in front of it.
  await expect(page.locator('.search-field')).toBeVisible();
  await expect(hint(page)).toHaveAttribute('data-hint', 'search', { timeout: 5_000 });
  await expect(hint(page)).toHaveText('ابحث هنا عن أي باب أو مكان');
  await expect(hint(page)).toHaveAttribute('role', 'status');
  const field = await box(page, '.search-field');
  const b1 = await box(page, '.hint');
  expect(b1.top).toBeGreaterThanOrEqual(field.bottom);
  expect(b1.top - field.bottom).toBeLessThan(24);
  // Inside the screen at 16 px from each side or more.
  const vw = page.viewportSize()!.width;
  expect(b1.left).toBeGreaterThanOrEqual(16);
  expect(b1.right).toBeLessThanOrEqual(vw - 16);

  await page.keyboard.press('Shift');
  await expect(hint(page)).toHaveAttribute('data-hint', 'filters');
  await expect(hint(page)).toHaveText('الفئات: اختر ما تراه على الخريطة');
  const row = await box(page, '.cat-row');
  expect((await box(page, '.hint')).top).toBeGreaterThanOrEqual(row.bottom);

  await page.keyboard.press('Shift');
  await expect(hint(page)).toHaveAttribute('data-hint', 'marker');
  // Over a marker that is really drawn there.
  const b3 = await box(page, '.hint');
  const near = await page.evaluate(
    ([x, y]) =>
      (window as any).__engine.map
        .queryRenderedFeatures([
          [x - 30, y],
          [x + 30, y + 40],
        ])
        .filter((f: any) => f.properties?.id !== undefined).length,
    [b3.left + (await hint(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--arrow-x')))), b3.bottom] as const,
  );
  expect(near).toBeGreaterThan(0);

  await page.keyboard.press('Shift');
  await expect(hint(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hints-seen'))).toBe('1');
});

test('a touch moves on and still reaches the page; seen once, never again', async ({ page, errors: _ }) => {
  await firstVisit(page);
  await openMap(page);
  await expect(hint(page)).toHaveAttribute('data-hint', 'search', { timeout: 5_000 });
  // The bubble takes no touch: a tap on it lands on the category under it.
  expect(await hint(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.getByRole('button', { name: /بوابات الحرم/ }).click();
  await expect(page.getByRole('button', { name: /بوابات الحرم/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(hint(page)).toHaveAttribute('data-hint', 'filters');
  // After a reload they do not come back, even though the visitor left half way.
  await page.reload();
  await page.waitForFunction(() => (window as any).__engine?.map?.loaded());
  await page.waitForTimeout(2_000);
  await expect(hint(page)).toHaveCount(0);
});

test('a shared link to a place: straight to it, no hints', async ({ page, errors: _ }) => {
  await firstVisit(page);
  await openMap(page, 'ar', '?poi=205');
  await expect(page.locator('.pc-title')).toContainText('205', { timeout: 15_000 });
  await page.waitForTimeout(2_000);
  await expect(hint(page)).toHaveCount(0);
});

test('in English too, inside a 320 screen', async ({ page, errors: _ }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await firstVisit(page);
  await openMap(page, 'en');
  await expect(hint(page)).toHaveText('Search here for any gate or place', { timeout: 5_000 });
  for (const h of ['search', 'filters', 'marker']) {
    await expect(hint(page)).toHaveAttribute('data-hint', h);
    const b = await box(page, '.hint');
    expect(b.left).toBeGreaterThanOrEqual(16);
    expect(b.right).toBeLessThanOrEqual(304);
    await page.keyboard.press('Shift');
  }
});
