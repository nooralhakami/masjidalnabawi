import type { Page } from '@playwright/test';
import { expect, idle, openMap, test } from './fixtures';

// The three new car park vehicle entrances (owner, 2026-10-16): on the map with the car parks'
// pill; Qurban open, the other two closed, until the supervisor changes one; a tap says the name, the state and how to leave.

type Win = { __engine: any };
const PARKING_PILL = 5;

const shown = async (page: Page) => {
  await idle(page);
  return page.evaluate(() => {
    const m = (window as unknown as Win).__engine.map;
    return m.getLayoutProperty('car-entrances', 'visibility') === 'visible'
      ? m.queryRenderedFeatures({ layers: ['car-entrances'] }).map((f: any) => `${f.properties.eid}:${f.properties.open}`).sort()
      : [];
  });
};

async function tapEntrance(page: Page, id: string) {
  // In the middle of the screen, clear of the map's buttons.
  const LL: Record<string, [number, number]> = { quba: [39.607755, 24.465375], qurban: [39.612841, 24.464994], east: [39.615174, 24.468547] };
  await page.evaluate((c) => (window as unknown as Win).__engine.map.jumpTo({ center: c }), LL[id]);
  await idle(page);
  const at = await page.evaluate((eid) => {
    const m = (window as unknown as Win).__engine.map;
    const f = m.queryRenderedFeatures({ layers: ['car-entrances'] }).find((x: any) => x.properties.eid === eid);
    const p = m.project(f.geometry.coordinates);
    const r = m.getContainer().getBoundingClientRect();
    return [r.left + p.x, r.top + p.y];
  }, id);
  await page.mouse.click(at[0], at[1]);
}

async function zoomToEntrances(page: Page) {
  await page.evaluate(() => (window as unknown as Win).__engine.map.jumpTo({ center: [39.6115, 24.4667], zoom: 14.9 }));
}

test('hidden with «All»; with the car parks, all three show: Qurban open, the others closed', async ({ page, errors: _ }) => {
  await openMap(page, 'ar');
  await zoomToEntrances(page);
  expect(await shown(page)).toEqual([]);
  await page.locator('.cat-btn').nth(PARKING_PILL).click();
  await zoomToEntrances(page);
  await expect.poll(() => shown(page)).toEqual(['east:0', 'quba:0', 'qurban:1']);
});

test('a tap says the name, «closed», and for Quba how to leave', async ({ page, errors: _ }) => {
  await openMap(page, 'ar');
  await page.locator('.cat-btn').nth(PARKING_PILL).click();
  await zoomToEntrances(page);
  await expect.poll(() => shown(page)).toHaveLength(3);
  await tapEntrance(page, 'quba');
  await expect(page.locator('.toast')).toContainText('مدخل قباء · مغلق');
  await expect(page.locator('.toast')).toContainText('مخرج عمر بن الخطاب');
});

test('the supervisor opens one: the map and the words change; closing it again', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?admin=1');
  await page.getByLabel('كلمة السر').fill('admin12345');
  await page.getByRole('button', { name: 'دخول' }).click();
  const admin = page.locator('.admin');
  await admin.locator('summary').click();
  const quba = admin.locator('[data-ent="quba"]');
  await expect(quba).toHaveAttribute('aria-pressed', 'false');
  await quba.click();
  await expect(quba).toHaveAttribute('aria-pressed', 'true');
  await expect(admin.locator('.admin-ent').first()).toContainText('مفتوح');

  await page.locator('.cat-btn').nth(PARKING_PILL).click();
  await zoomToEntrances(page);
  await expect.poll(() => shown(page)).toEqual(['east:0', 'quba:1', 'qurban:1']);
  // Folded, the panel leaves the map free for the tap.
  await admin.locator('summary').click();
  await tapEntrance(page, 'quba');
  await expect(page.locator('.toast')).toContainText('مدخل قباء · مفتوح');

  await admin.locator('summary').click();
  await quba.click();
  await zoomToEntrances(page);
  await expect.poll(() => shown(page)).toEqual(['east:0', 'quba:0', 'qurban:1']);
});

test('in English, the words are English', async ({ page, errors: _ }) => {
  await openMap(page, 'en');
  await page.locator('.cat-btn').nth(PARKING_PILL).click();
  await zoomToEntrances(page);
  await expect.poll(() => shown(page)).toHaveLength(3);
  await tapEntrance(page, 'qurban');
  await expect(page.locator('.toast')).toContainText('Qurban entrance · Open');
  await tapEntrance(page, 'east');
  await expect(page.locator('.toast')).toContainText('Eastern area entrance · Closed');
});
