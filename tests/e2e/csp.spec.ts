import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openMap, test } from './fixtures';

// The Content-Security-Policy from vercel.json, enforced here on every page the build serves (vite
// preview sends no headers of its own). A blocked script, style, image, tile or worker shows up as a
// CSP violation, and as a console error the fixture already fails on.
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const CSP = vercel.headers.find((h) => h.source === '/(.*)')!.headers.find((h) => /^Content-Security-Policy/.test(h.key))!.value;

async function enforce(page: Page) {
  await page.route(
    (url) => url.pathname.endsWith('/') || url.pathname.endsWith('.html'),
    async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
    },
  );
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test.describe('the Content-Security-Policy blocks nothing the guide needs', () => {
  test('landing page', async ({ page, errors: _ }) => {
    await enforce(page);
    await page.goto('./');
    await expect(page.locator('h1')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('map, stories and library', async ({ page, errors: _ }) => {
    await enforce(page);
    await openMap(page);
    await expect(page.locator('.weather-chip')).toBeVisible();
    await page.locator('.mc-stories').click();
    await expect(page.locator('.stories')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.mc-library').click();
    await expect(page.locator('.library')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('supervisor page', async ({ page, errors: _ }) => {
    await enforce(page);
    await openMap(page, 'ar', '?admin=1');
    await expect(page.getByLabel('كلمة السر')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
