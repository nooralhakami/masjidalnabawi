import type { Page } from '@playwright/test';
import { expect, openMap, test } from './fixtures';

// Phase 6: the Rawdah card, languages, the admin simulator, the weather, the landmark stories and
// the library — the live app's journeys 10–13, 16–19, 34 and 49–56 (docs/PARITY.md), its expected
// texts and numbers, new selectors only.

const rawdah = (page: Page) => page.locator('.rawdah-card:not(.rawdah-behind)');
const pillCount = async (page: Page) => (await page.locator('.cat-btn[aria-pressed="true"] .cat-n').textContent())!;

test.describe('Rawdah card', () => {
  test("women's turn: Gate 37 needs a Nusuk permit, and a second card leads to the area behind the Rawdah (Gate 21)", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T21:00:00+03:00')); // after Isha in Madinah: women
    await openMap(page);
    await expect(rawdah(page)).toContainText('بتصريح من تطبيق نسك');
    const behind = page.locator('.rawdah-behind');
    await expect(behind).toBeVisible();
    await expect(behind).toContainText('بدون تصريح');
    await behind.click();
    await expect(page.locator('.sheet .pc-title')).toContainText('مدخل منطقة خلف الروضة للنساء');
    // With a card open the Rawdah cards step aside.
    await expect(page.locator('.rawdah-host')).toHaveCount(0);
  });

  test("the morning women's turn (Fajr → 10:00) also offers the area behind the Rawdah", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T08:00:00+03:00'));
    await openMap(page);
    await expect(page.locator('.rawdah-behind')).toBeVisible();
  });

  test("men's turn: no permit line and no behind-the-Rawdah card", async ({ page, errors: _ }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T12:00:00+03:00')); // midday: men
    await openMap(page);
    await expect(rawdah(page)).toBeVisible();
    await expect(rawdah(page)).not.toContainText('نسك');
    await expect(page.locator('.rawdah-behind')).toHaveCount(0);
  });

  test('the Rawdah card opens Gate 37 with the live schedule; the map buttons sit above the cards', async ({ page, errors: _ }) => {
    await openMap(page);
    const card = (await page.locator('.rawdah-host').boundingBox())!;
    const tools = (await page.locator('.map-overlay-left .map-controls').boundingBox())!;
    expect(tools.y + tools.height).toBeLessThanOrEqual(card.y);
    await rawdah(page).click();
    await expect(page.locator('.sheet .pc-title')).toContainText('37');
    await expect(page.locator('.sheet .pc-rawdah li')).toHaveCount(4);
    await expect(page.locator('.sheet .turn')).toBeVisible();
  });
});

test.describe('languages', () => {
  const LANGS: [string, 'rtl' | 'ltr'][] = [
    ['ar', 'rtl'],
    ['en', 'ltr'],
    ['tr', 'ltr'],
    ['ur', 'rtl'],
    ['id', 'ltr'],
    ['uz', 'ltr'],
    ['bn', 'ltr'],
    ['fr', 'ltr'],
    ['fa', 'rtl'],
    ['ru', 'ltr'],
    ['ms', 'ltr'],
    ['ha', 'ltr'],
    ['ml', 'ltr'],
    ['sw', 'ltr'],
    ['ps', 'rtl'],
    ['so', 'ltr'],
    ['ta', 'ltr'],
    ['hi', 'ltr'],
    ['bs', 'ltr'],
    ['de', 'ltr'],
    ['zh', 'ltr'],
    ['am', 'ltr'],
    ['ku', 'ltr'],
    ['az', 'ltr'],
    ['th', 'ltr'],
    ['es', 'ltr'],
  ];

  test('menu: Arabic and English first, the less widespread languages folded under an arrow', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('#lang-btn').click();
    const codes = await page.locator('#lang-menu [data-lang]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.lang));
    expect(codes.slice(0, 2)).toEqual(['ar', 'en']);
    const bs = page.locator('#lang-menu [data-lang="bs"]');
    await expect(bs).toBeHidden();
    await page.locator('#lang-menu .lang-more-btn').click();
    await expect(page.locator('#lang-menu .lang-more-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(bs).toBeVisible();
    await bs.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bs');
    // The current language is one of the folded ones, so the menu opens unfolded.
    await page.locator('#lang-btn').click();
    await expect(page.locator('#lang-menu [data-lang="bs"]')).toBeVisible();
    // Esc closes it.
    await page.keyboard.press('Escape');
    await expect(page.locator('#lang-menu')).toHaveCount(0);
  });

  test('switching through every language: direction follows, digits stay Latin, the map keeps its places', async ({ page, errors: _ }) => {
    test.setTimeout(180_000);
    await openMap(page);
    for (const [code, dir] of LANGS) {
      await page.locator('#lang-btn').click();
      const item = page.locator(`#lang-menu [data-lang="${code}"]`);
      if (!(await item.isVisible())) await page.locator('#lang-menu .lang-more-btn').click();
      await item.click();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      expect(await pillCount(page), code).toBe('304');
      await expect.poll(() => page.evaluate(() => (window as any).__engine.view.ids.length), { message: code }).toBe(304);
    }
  });

  test('the menu fits the screen at 320 px, folded and unfolded', async ({ page, errors: _ }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openMap(page, 'en');
    await page.locator('#lang-btn').click();
    await page.locator('#lang-menu .lang-more-btn').click();
    const box = (await page.locator('#lang-menu').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
  });
});

test.describe('admin simulator', () => {
  test('hidden by default', async ({ page, errors: _ }) => {
    await openMap(page);
    await expect(page.locator('.admin')).toHaveCount(0);
  });

  test('?admin=1: elevator works toggle the pair together (after the password)', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?admin=1');
    await expect(page.locator('.admin')).toHaveCount(0);
    await page.getByLabel('كلمة السر').fill('admin12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    const admin = page.locator('.admin');
    await admin.locator('summary').click();
    const select = admin.locator('select');
    await select.selectOption('215');
    await admin.locator('[data-act="works"]').click();
    await expect(select.locator('option[value="215"]')).toContainText('أعمال مصعد');
    await expect(select.locator('option[value="216"]')).toContainText('أعمال مصعد');
    await admin.locator('[data-act="works"]').click();
    await expect(select.locator('option[value="216"]')).toContainText('مفتوح');
  });

  // Owner, 2026-10-16: offered only for «ADMIN» typed in the search box, then the password.
  test('«ADMIN» in the search box offers it; «admin» or «Admin» does not', async ({ page, errors: _ }) => {
    await openMap(page, 'ar');
    const box = page.getByRole('combobox');
    for (const word of ['admin', 'Admin', 'ADMI']) {
      await box.fill(word);
      await page.waitForTimeout(350);
      await expect(page.locator('#res-admin')).toHaveCount(0);
    }
    await box.fill('ADMIN');
    await expect(page.locator('#res-admin')).toBeVisible();
    await box.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(box).toHaveValue('');
  });

  test('a wrong password is said and keeps it shut; the right one opens it', async ({ page, errors: _ }) => {
    await openMap(page, 'ar');
    await page.getByRole('combobox').fill('ADMIN');
    await page.locator('#res-admin').click();
    const pass = page.getByLabel('كلمة السر');
    await pass.fill('admin');
    await pass.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('كلمة السر غير صحيحة');
    await expect(page.locator('.admin')).toHaveCount(0);
    await pass.fill('admin12345');
    await page.getByRole('button', { name: 'دخول' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.admin')).toBeVisible();
  });

  test('Esc closes the password window and nothing opens', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?admin=1');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.admin')).toHaveCount(0);
  });
});

test('the weather chip shows the current temperature in Madinah, labelled in the UI language', async ({ page, errors: _ }) => {
  await openMap(page, 'en');
  const chip = page.locator('.weather-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('33°');
  await expect(chip).toHaveAttribute('aria-label', 'Weather now in Madinah: 33° · Clear');
});

test.describe('landmark stories', () => {
  test('open from the map button: one segment per site, Quba first; tapping moves on; close returns to the map', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-stories').click();
    const stories = page.locator('.stories');
    await expect(stories).toBeVisible();
    await expect(stories).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.st-bar')).toHaveCount(9);
    await expect(page.locator('.st-name')).toHaveText('مسجد قباء');
    await expect(page.locator('.st-rank')).toHaveText('1 / 9');
    const first = await page.locator('.st-text').textContent();
    await page.locator('[data-act="next"]').click();
    await expect(page.locator('.st-text')).not.toHaveText(first!);
    await page.locator('[data-act="prev"]').click();
    await expect(page.locator('.st-text')).toHaveText(first!);
    await page.locator('[data-act="close"]').click();
    await expect(stories).toHaveCount(0);
    await expect(page.locator('.mc-stories')).toBeFocused();
  });

  test('every site ends with the prayer on the Prophet ﷺ; the count is kept on the device', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-stories').click();
    // Quba has 3 text slides, so the 4th is the prayer.
    for (let i = 0; i < 3; i++) await page.locator('[data-act="next"]').click();
    await expect(page.locator('.st-pray-ar')).toHaveText('اللهم صل وسلم على نبينا محمد');
    await page.locator('.st-pray-btn').click();
    await page.locator('.st-pray-btn').click();
    await expect(page.locator('#st-count')).toContainText('2');
    expect(await page.evaluate(() => localStorage.getItem('salawat-count'))).toBe('2');
    await page.keyboard.press('Escape');
    await expect(page.locator('.stories')).toHaveCount(0);
    // Another visit continues from the saved count.
    await page.locator('.mc-stories').click();
    await expect(page.locator('.st-mini b')).toHaveText('2');
  });

  test('the story advances by itself, and pauses with the pause button', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-stories').click();
    const first = await page.locator('.st-text').textContent();
    await page.locator('[data-act="pause"]').click();
    await page.waitForTimeout(6500);
    await expect(page.locator('.st-text')).toHaveText(first!);
    await page.locator('[data-act="pause"]').click();
    // A 6 s slide; on a loaded machine frames come slowly and each counts at most 500 ms, so allow 20 s.
    await expect(page.locator('.st-text')).not.toHaveText(first!, { timeout: 20_000 });
  });

  test('the map shows the site and the sources are listed; a shared link (?visit=) opens that site', async ({ page, errors: _ }) => {
    await openMap(page, 'ar', '?visit=543');
    await expect(page.locator('.st-name')).toHaveText('مسجد القبلتين');
    await page.locator('[data-act="sources"]').click();
    await expect(page.locator('.st-sources a')).toHaveCount(2);
    await page.locator('[data-act="map"]').click();
    await expect(page.locator('.stories')).toHaveCount(0);
    await expect(page.locator('.sheet .pc-title')).toContainText('مسجد القبلتين');
  });

  test("texts and buttons come in the visitor's language", async ({ page, errors: _ }) => {
    await openMap(page, 'tr');
    await page.locator('.mc-stories').click();
    await expect(page.locator('.st-text')).toHaveAttribute('lang', 'tr');
    await expect(page.locator('.st-text')).toContainText('İslam');
    await expect(page.locator('[data-act="map"]')).toContainText('Haritada göster');
  });

  test('a long press pauses the story (no copy/save menu on the photo), and shows no credit line', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-stories').click();
    await expect(page.locator('.st-credit')).toHaveCount(0);
    await expect(page.locator('.st-img')).toHaveCSS('pointer-events', 'none');
    const stories = page.locator('.stories');
    const prevented = await page.evaluate(() => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.querySelector('.st-img')!.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    const text = await page.locator('.st-text').textContent();
    const box = (await page.locator('.st-zone-next').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(stories).toHaveClass(/is-paused/);
    await page.mouse.up();
    await expect(stories).not.toHaveClass(/is-paused/);
    // Releasing a hold does not count as a tap: still on the same slide.
    await expect(page.locator('.st-text')).toHaveText(text!);
  });

  test('the photos are not fetched before the stories open', async ({ page, errors: _ }) => {
    const photos: string[] = [];
    page.on('request', (r) => r.url().includes('/visits/') && photos.push(r.url()));
    await openMap(page);
    await page.waitForTimeout(500);
    expect(photos).toEqual([]);
    await page.locator('.mc-stories').click();
    await expect.poll(() => photos.length).toBeGreaterThan(0);
  });
});

test.describe("library: landmarks of the Prophet's Mosque", () => {
  test('opens from the map button with the not-reviewed notice, a place, its sources, and closes', async ({ page, errors: _ }) => {
    await openMap(page);
    await page.locator('.mc-library').click();
    const lib = page.locator('.library');
    await expect(lib).toBeVisible();
    await expect(lib.locator('.lib-notice')).toContainText('لم يُراجَع');
    const items = lib.locator('.lib-item');
    expect(await items.count()).toBeGreaterThanOrEqual(10);
    await items.first().click();
    await expect(lib.locator('.lib-head h2')).toContainText('خوخة آل عمر');
    await expect(lib.locator('.lib-notice')).toBeVisible();
    // A fact still waiting for a second source is never shown.
    await expect(lib).not.toContainText('ينقصه');
    await lib.locator('.lib-src summary').first().click();
    await expect(lib.locator('.lib-src li').first()).toContainText('—');
    await lib.locator('[data-act="back"]').click();
    await expect(lib.locator('.lib-item').first()).toBeVisible();
    await lib.locator('[data-act="close"]').click();
    await expect(lib).toHaveCount(0);
    await expect(page.locator('.mc-library')).toBeFocused();
  });
});

test('library: the companions follow the mosque landmarks, in their groups, with the notice; a group can be picked', async ({ page, errors: _ }) => {
  await openMap(page, 'ar', '?lib=umar');
  const lib = page.locator('.library');
  await expect(lib.locator('.lib-head h2')).toContainText('عمر بن الخطاب');
  await expect(lib.locator('.lib-notice')).toBeVisible();
  await expect(lib.locator('.lib-body h3').first()).toBeVisible();
  await expect(lib).not.toContainText('ينقصه');
  await lib.locator('[data-act="back"]').click();
  await expect(lib.locator('.lib-group')).toHaveCount(7);
  for (const name of ['سعد بن معاذ', 'أبو هريرة', 'خالد بن الوليد', 'خديجة', 'مصعب بن عمير']) await expect(lib.locator('.lib-item', { hasText: name })).toBeVisible();
  // The group filter: only the ten promised Paradise.
  await lib.locator('.lib-chip', { hasText: 'العشرة المبشرون بالجنة' }).click();
  await expect(lib.locator('.lib-group')).toHaveCount(1);
  await expect(lib.locator('.lib-item', { hasText: 'أبو هريرة' })).toHaveCount(0);
  await expect(lib.locator('.lib-item', { hasText: 'عمر بن الخطاب' })).toBeVisible();
});

test('library in English: the labels in English, a line that the texts are Arabic only', async ({ page, errors: _ }) => {
  await openMap(page, 'en');
  await page.locator('.mc-library').click();
  await expect(page.locator('.lib-head h2')).toHaveText('Islamic Library');
  await expect(page.locator('.lib-lang')).toBeVisible();
});
