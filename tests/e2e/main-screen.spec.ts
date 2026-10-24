import type { Page } from '@playwright/test';
import { expect, idle, openMap, test } from './fixtures';

// The main screen (phase 4): search, the filter pills and the place card over the map. The live
// app's journeys 4, 5, 7, 8, 9, 22, 23, 26, 28 and 35 (docs/PARITY.md), with its expected numbers.

type Win = { __engine: any; __fac: any };

/** How many places the chosen pill says it shows. */
async function pillCount(page: Page): Promise<number> {
  return Number(await page.locator('.cat-btn[aria-pressed="true"] .cat-n').textContent());
}

/** How many places the map was given to show (the filter and the search, before featured sites). */
function mapCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Win).__engine.view.ids.length as number);
}

async function search(page: Page, q: string) {
  await page.getByRole('combobox').fill(q);
  await expect(page.locator('#search-results')).toBeVisible();
}

const pill = (page: Page, n: number) => page.locator('.cat-row .cat-btn').nth(n);
const sheet = (page: Page) => page.locator('.sheet');

test.describe('filters', () => {
  // The live app's counts (tests/e2e/app.spec.ts there), in the order of the pills.
  const EXPECTED: [string, number][] = [
    ['all', 303],
    ['gates', 112],
    ['women', 35],
    ['toilets', 40],
    // Historic sites and car parks after the restrooms (owner, 2026-10-17).
    ['historic', 17],
    ['parking', 13],
    ['hotels', 43],
    ['food', 44],
    ['shopping', 15],
    ['landmarks', 38],
    ['emergency', 9],
  ];

  test('every filter pill shows its places, and the map is given exactly those', async ({ page, errors: _ }) => {
    await openMap(page);
    for (const [i, [id, n]] of EXPECTED.entries()) {
      await pill(page, i).click();
      await expect(pill(page, i), id).toHaveAttribute('aria-pressed', 'true');
      expect(await pillCount(page), id).toBe(n);
      await expect.poll(() => mapCount(page), { message: id }).toBe(n);
    }
  });

  test('parking only appears with its pill; restroom sub-filters work', async ({ page, errors: _ }) => {
    await openMap(page);
    const parks = () =>
      page.evaluate(() => (window as unknown as Win).__engine.view.ids.filter((id: number) => (window as unknown as Win).__engine.poi(id).category === 'parking').length);
    expect(await parks()).toBe(0);
    await pill(page, 5).click();
    await expect.poll(parks).toBe(13);

    await pill(page, 3).click();
    await expect(page.locator('.seg')).toHaveCount(3);
    await page.locator('.seg').nth(1).click();
    await expect.poll(() => mapCount(page)).toBe(40);
    expect(await pillCount(page)).toBe(40);
    await page.locator('.seg').nth(2).click();
    await expect.poll(() => mapCount(page)).toBe(0);
    expect(await pillCount(page)).toBe(0);
    // Leaving the restrooms resets their sub-filter.
    await pill(page, 0).click();
    await expect(page.locator('.seg')).toHaveCount(0);
  });

  test('key services: one pill for health centres, police, lost children, lost & found and service centres', async ({ page, errors: _ }) => {
    await openMap(page);
    await pill(page, 10).click();
    await expect.poll(() => mapCount(page)).toBe(9);
    // Only the women's police with lost & found at gate 30 remains.
    await search(page, 'شرطة');
    await expect(page.locator('#search-results .search-row')).toHaveCount(1);
  });
});

test.describe('search and card', () => {
  test('Arabic digits, Enter picks the first result and opens its card; a closed restroom offers the nearest open one', async ({ page, errors: _ }) => {
    await openMap(page);
    // Close 215 for elevator works first (everything starts open), as the live test does from its admin panel.
    await page.evaluate(() => (window as unknown as Win).__fac.toggleElevatorWorks(215));
    await search(page, '٢١٥');
    const first = page.locator('#search-results .search-row').first();
    await expect(first).toContainText('215');
    // The typed part is highlighted.
    await expect(first.locator('mark')).toHaveText('215');
    await page.getByRole('combobox').press('Enter');
    await expect(sheet(page)).toHaveClass(/is-half/);
    await expect(sheet(page).locator('.pc-title')).toContainText('215');
    await expect(sheet(page).locator('.pc-title')).toBeFocused();
    await expect(sheet(page).locator('.pc-alt')).toContainText('217');
    // The alternative comes right after the chips (owner, 2026-10-16): tapped with the card half open.
    await expect(sheet(page)).toHaveClass(/is-half/);
    await expect(sheet(page).locator('.pc-alt button')).toBeInViewport({ ratio: 1 });
    await sheet(page).locator('.pc-alt button').click();
    await expect(sheet(page).locator('.pc-title')).toContainText('217');
    await sheet(page).getByRole('button', { name: 'إغلاق' }).click();
    await expect(sheet(page)).toHaveClass(/is-closed/);
  });

  test('closing the card after a search brings every place back; tapping a filled box shows the results again (owner, 2026-10-14)', async ({ page, errors: _ }) => {
    await openMap(page);
    const all = await mapCount(page);
    await search(page, '38');
    await expect.poll(() => mapCount(page)).toBeLessThan(all);
    await page.getByRole('combobox').press('Enter');
    await expect(sheet(page)).toHaveClass(/is-half/);
    await expect(page.locator('#search-results')).toHaveCount(0);
    // The words are still there: tapping the box shows their results without typing again.
    await page.getByRole('combobox').click();
    await expect(page.locator('#search-results')).toBeVisible();
    await page.getByRole('combobox').press('Escape');
    await expect(page.getByRole('combobox')).toHaveValue('');
    await page.getByRole('combobox').fill('38');
    await page.getByRole('combobox').press('Enter');
    await sheet(page).getByRole('button', { name: 'إغلاق' }).click();
    await expect(sheet(page)).toHaveClass(/is-closed/);
    await expect(page.getByRole('combobox')).toHaveValue('');
    await expect.poll(() => mapCount(page)).toBe(all);
  });

  test('parking by level code and English names from any language; «no results»', async ({ page, errors: _ }) => {
    await openMap(page, 'tr');
    await search(page, '1A');
    await expect(page.locator('#search-results .search-row').first()).toContainText('1');
    await search(page, 'Al Baik');
    await expect(page.locator('#search-results .search-row')).toHaveCount(1);
    await search(page, 'zzqxw');
    await expect(page.locator('.search-empty')).toBeVisible();
  });

  test('↑ ↓ move through the results and Enter opens the one chosen', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '21');
    const box = page.getByRole('combobox');
    const rows = page.locator('#search-results .search-row');
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    const id = (await rows.nth(1).getAttribute('id'))!;
    await expect(box).toHaveAttribute('aria-activedescendant', id);
    const name = (await rows.nth(1).locator('.search-row-name').textContent())!;
    await box.press('Enter');
    await expect(sheet(page).locator('.pc-title')).toHaveText(name);
  });

  test('recent searches: offered in an empty box, and cleared on request', async ({ page, errors: _ }) => {
    await openMap(page);
    await search(page, '215');
    await page.getByRole('combobox').press('Enter');
    await sheet(page).getByRole('button', { name: 'إغلاق' }).click();
    await page.getByRole('combobox').click();
    const panel = page.locator('#search-results');
    await expect(panel).toContainText('215');
    await panel.locator('.search-row').first().click();
    await expect(page.getByRole('combobox')).toHaveValue('215');
    await expect(page.locator('#search-results .search-row').first()).toContainText('215');
    await page.getByRole('combobox').fill('');
    await panel.locator('.search-head-btn').click();
    await expect(page.locator('#search-results')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('recent-searches'))).toBeNull();
  });
});

test('Gate 1’s card gives its naming reason, once, not again under the title', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?poi=1');
  const card = sheet(page);
  await expect(card.locator('.pc-about')).toContainText('سبب التسمية');
  await expect(card.locator('.pc-about')).toContainText('المدخل الرئيسي للزيارة');
  await expect(card.locator('.pc-desc')).toHaveCount(0);
});

test.describe('regressions', () => {
  test('searching while a card is open shows the full results list', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?poi=204');
    await expect(sheet(page)).toHaveClass(/is-half/);
    await search(page, '33');
    const rows = page.locator('#search-results .search-row');
    await expect(rows).toHaveCount(8);
    for (const r of await rows.all()) await expect(r).toBeInViewport();
  });

  test('a place picked while markers are hidden is still marked on the map', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.cat-eye').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__engine.shownIds.length)).toBe(0);
    await search(page, '215');
    await page.getByRole('combobox').press('Enter');
    await expect(sheet(page).locator('.pc-title')).toContainText('215');
    await idle(page);
    const pins = await page.evaluate(() => (window as unknown as Win).__engine.map.queryRenderedFeatures({ layers: ['selected'] }).map((f: any) => Number(f.properties.id)));
    expect([...new Set(pins)]).toEqual([215]);
  });
});

test('the theme button switches and remembers the theme', async ({ page, errors: _ }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await openMap(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.theme-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('.theme-btn')).toHaveAttribute('aria-label', 'الوضع النهاري');
});

test('a shared place link (?poi=) opens that place, and the share button builds such a link', async ({ page, context, errors: _ }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await openMap(page, 'ar', '?poi=204');
  await expect(sheet(page).locator('.pc-title')).toContainText('204');
  await idle(page);
  const pins = await page.evaluate(() => (window as unknown as Win).__engine.map.queryRenderedFeatures({ layers: ['selected'] }).length);
  expect(pins).toBe(1);
  await sheet(page).locator('.pc-share').click();
  await expect(page.locator('.toast')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/map\.html\?poi=204$/);
});

test('the sheet steps between half and full from its handle, and Esc closes it', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?poi=204');
  await expect(sheet(page)).toHaveClass(/is-half/);
  const handle = page.locator('.sheet-handle');
  await handle.click();
  await expect(sheet(page)).toHaveClass(/is-full/);
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await handle.press('ArrowDown');
  await expect(sheet(page)).toHaveClass(/is-half/);
  await handle.press('Escape');
  await expect(sheet(page)).toHaveClass(/is-closed/);
});
