import { test as base, expect, type Page } from '@playwright/test';

// 1×1 transparent PNG served for every map tile, so tests are fast and need no network.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/arcgisonline|openstreetmap|cartocdn/, (r) => r.fulfill({ contentType: 'image/png', body: PIXEL }));
    await use(errors);
    // Every test also asserts a clean console.
    expect(errors, 'console errors').toEqual([]);
  },
});

export { expect };

/** Open the map in a language (saved choice is how the app restores it). */
export async function openMap(page: Page, lang = 'ar', query = '') {
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.goto(`map.html${query}`);
  await expect(page.locator('.hdr')).toBeVisible();
  await expect(page.locator('.mk').first()).toBeAttached();
}

/** Number in the header subtitle ("المدينة المنورة · 201 معلم"). */
export async function count(page: Page): Promise<number> {
  const txt = (await page.locator('#hdr-sub').textContent()) ?? '';
  return Number(txt.match(/(\d+)/g)?.pop());
}

export async function search(page: Page, q: string) {
  const box = page.getByRole('combobox');
  await box.fill(q);
  await expect(page.locator('#results')).toBeVisible();
}
