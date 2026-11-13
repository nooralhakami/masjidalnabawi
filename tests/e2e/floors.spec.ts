import { expect, idle, openMap, test } from './fixtures';

// The floor switcher (Phase 1, plan §6 row 1): five verified floors in 26 languages, and the map's
// lift/escalator landings follow the chosen floor. The Plaza is the campus ground and has none.

type Win = { __engine: any };

/** The landing ids the map currently holds for the chosen floor (read from the source, not the view). */
function landings(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const s = (window as unknown as Win).__engine.map.getSource('floorLandings');
    return (s.serialize().data.features as any[]).map((f) => Number(f.properties.id)).sort((a, b) => a - b);
  });
}

test.describe('the floor switcher', () => {
  test('shows the five floors top to bottom in Arabic, the Plaza chosen first', async ({ page, errors: _ }) => {
    await openMap(page);
    const group = page.locator('.building-floors');
    await expect(group).toHaveAttribute('aria-label', 'الطوابق');
    const btns = group.locator('.bf-btn');
    await expect(btns).toHaveCount(5);
    expect(await btns.evaluateAll((els) => els.map((e) => e.getAttribute('data-floor')))).toEqual(['24', '12', '11', '94', '95']);
    expect(await btns.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['السطح', 'الأرضي', 'الساحة', 'B1', 'B2']);
    // The Plaza (11) is the default, and the campus ground has no lift or escalator landings.
    await expect(group.locator('.bf-btn[aria-pressed="true"]')).toHaveAttribute('data-floor', '11');
    expect(await landings(page)).toEqual([]);
  });

  test('choosing the roof moves the choice and shows the roof landings, not the ground floor’s', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.bf-btn[data-floor="24"]').click();
    await idle(page);
    await expect(page.locator('.bf-btn[aria-pressed="true"]')).toHaveAttribute('data-floor', '24');
    const ids = await landings(page);
    // The two roof lift shafts (4705, 4706) appear; the ground-floor shafts (4703, 4704) do not.
    expect(ids).toContain(4705);
    expect(ids).toContain(4706);
    expect(ids).not.toContain(4703);
    expect(ids).not.toContain(4704);
  });

  test('choosing B2 shows the lower car-park landings', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.bf-btn[data-floor="95"]').click();
    await idle(page);
    await expect(page.locator('.bf-btn[aria-pressed="true"]')).toHaveAttribute('data-floor', '95');
    const ids = await landings(page);
    expect(ids).toContain(4954); // the B2 lift shaft
    expect(ids).not.toContain(5150); // its B1 partner stays on B1
  });

  test('the chosen floor is remembered across a reload', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.bf-btn[data-floor="24"]').click();
    await idle(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__engine?.map?.loaded() && (window as any).__engine.map.getLayer('facilities'));
    await idle(page);
    await expect(page.locator('.bf-btn[aria-pressed="true"]')).toHaveAttribute('data-floor', '24');
  });

  test('the labels read in English too', async ({ page, errors: _ }) => {
    await openMap(page, 'en');
    const btns = page.locator('.building-floors .bf-btn');
    expect(await btns.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Roof', 'Ground', 'Plaza', 'B1', 'B2']);
    await expect(page.locator('.building-floors')).toHaveAttribute('aria-label', 'Floors');
  });
});
