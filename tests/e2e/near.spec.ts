import type { Page } from '@playwright/test';
import { expect, openMap, test } from './fixtures';

// «Near you now» (UI plan phase 2, owner 2026-11-07): the three buttons over the map, the
// «where are you exactly?» question when the location is missing or weak, and numbered steps underground.

type Win = { __engine: any; __trip: any };

const marks = (page: Page) =>
  page.evaluate(() => ((window as unknown as Win).__engine.route.shownMarks as { kind: string; text?: string }[]).map((m) => `${m.kind}:${m.text ?? ''}`));
const routeCount = (page: Page) => page.evaluate(() => (window as unknown as Win).__engine.route.alternatives.length + ((window as unknown as Win).__engine.route.active ? 1 : 0));
const row = (page: Page) => page.getByRole('group', { name: 'الآن بقربك' });
const where = (page: Page) => page.getByRole('dialog', { name: 'أين أنت بالضبط؟' });

test.describe('without the location', () => {
  test('nearest restroom from a gate the visitor types: asked men or women once, two ways drawn', async ({ page, errors: _ }) => {
    await openMap(page);
    await row(page).getByRole('button', { name: 'أقرب دورة مياه' }).click();
    await page.getByRole('dialog', { name: 'دورات مياه الرجال أم النساء؟' }).getByRole('button', { name: 'للرجال' }).click();
    await expect(where(page)).toBeVisible({ timeout: 15_000 });
    // A number that is no place: said, and the question stays.
    await where(page).getByLabel('رقم البوابة أو الباب أو دورة المياه أمامك').fill('999');
    await where(page).getByRole('button', { name: 'تم' }).click();
    await expect(where(page).getByRole('alert')).toHaveText('لا يوجد مكان بهذا الرقم');
    await where(page).getByLabel('رقم البوابة أو الباب أو دورة المياه أمامك').fill('312');
    await where(page).getByRole('button', { name: 'تم' }).click();
    await expect(where(page)).toHaveCount(0);
    // The nearer one followed, the other one faint: two ways, to a men's (or shared) block.
    await expect.poll(() => routeCount(page), { timeout: 30_000 }).toBe(2);
    await expect(page.locator('.route-card .pc-title')).toContainText(/الرجال|مشترك/);
    // The answer is remembered on this device: the next time, no men-or-women question.
    expect(await page.evaluate(() => localStorage.getItem('near-who'))).toBe('men');
  });

  test('in the underground car park: the lot, then a numbered «up the stairs» on the map', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('near-who', 'women'));
    await openMap(page);
    await row(page).getByRole('button', { name: 'أقرب دورة مياه' }).click();
    await where(page).getByRole('button', { name: 'أنا في المواقف تحت الأرض' }).click();
    await page.getByRole('dialog', { name: 'في أي موقف أنت؟' }).getByRole('button', { name: 'موقف 9', exact: true }).click();
    await expect.poll(() => marks(page), { timeout: 30_000 }).toContain('step:اصعد الدرج إلى الساحة');
    await expect(page.locator('.route-card .pc-title')).toContainText(/النساء|مشترك/);
  });

  test('a dismissed question draws nothing', async ({ page, errors: _ }) => {
    await page.addInitScript(() => localStorage.setItem('near-who', 'men'));
    await openMap(page);
    await row(page).getByRole('button', { name: 'أقرب بوابة' }).click();
    await expect(where(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(where(page)).toHaveCount(0);
    expect(await routeCount(page)).toBe(0);
    await expect(row(page)).toBeVisible();
  });
});

test.describe('a weak fix (the car park, between buildings)', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 300 }, permissions: ['geolocation'] });

  test('worse than 50 m: asked where, and the rough location may be kept', async ({ page, errors: _ }) => {
    await openMap(page);
    await row(page).getByRole('button', { name: 'أقرب بوابة' }).click();
    await expect(where(page)).toBeVisible({ timeout: 20_000 });
    await where(page).getByRole('button', { name: 'استخدم موقعي التقريبي' }).click();
    await expect.poll(() => routeCount(page), { timeout: 30_000 }).toBe(2);
    await expect(page.locator('.route-card .pc-title')).toContainText('بوابة');
  });
});

test.describe('a good fix in the plaza', () => {
  test.use({ geolocation: { latitude: 24.4685, longitude: 39.6084, accuracy: 12 }, permissions: ['geolocation'] });

  test('no question: the nearest gate is drawn at once', async ({ page, errors: _ }) => {
    await openMap(page);
    await row(page).getByRole('button', { name: 'أقرب بوابة' }).click();
    await expect.poll(() => routeCount(page), { timeout: 30_000 }).toBe(2);
    await expect(where(page)).toHaveCount(0);
    await expect(page.locator('.route-card .pc-title')).toContainText('بوابة');
  });
});

test('the next prayer: today’s five, the next one marked; Esc closes', async ({ page, errors: _ }) => {
  await openMap(page);
  const btn = row(page).getByRole('button', { name: /الصلاة القادمة/ });
  await btn.click();
  const panel = page.getByRole('dialog', { name: 'مواقيت الصلاة اليوم في المدينة المنورة' });
  await expect(panel.locator('li')).toHaveCount(5);
  await expect(panel).toContainText('حسب تقويم أم القرى');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
