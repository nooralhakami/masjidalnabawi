import type { Page } from '@playwright/test';
import { expect, idle, openMap, test } from './fixtures';

// Purposeful motion (UI plan phase 4, owner 2026-11-07): the card grows out of the tapped marker,
// the route draws itself in about 600 ms, a gold ring on arrival, a light tap felt on Android —
// and none of the movement with «reduce motion».

type Win = { __engine: any; __buzz: number[] };

/** Count the light taps (navigator.vibrate) the page asks for. */
const countBuzz = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__buzz = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: number) => (w.__buzz.push(p), true) });
  });
const buzz = (page: Page) => page.evaluate(() => (window as unknown as Win).__buzz);

/** Tap a place's marker where it is on screen. */
async function tapPlace(page: Page, id: number) {
  const q = await page.evaluate((i) => {
    const e = (window as unknown as Win).__engine;
    const p = e.poi(i);
    const pt = e.map.project([p.lng, p.lat]);
    const r = e.map.getContainer().getBoundingClientRect();
    return { x: r.left + pt.x, y: r.top + pt.y };
  }, id);
  await page.mouse.click(q.x, q.y);
  return q;
}
/** Close in on a place (legacy zoom 19), its marker alone under the finger. */
async function closeTo(page: Page, id: number) {
  await page.evaluate((i) => {
    const e = (window as unknown as Win).__engine;
    const p = e.poi(i);
    e.map.jumpTo({ center: [p.lng, p.lat], zoom: 18 });
  }, id);
  await idle(page);
}
/** A CSS time token in ms (the build writes 600ms as .6s). */
const drawMs = (page: Page) =>
  page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--m-draw').trim();
    return v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000;
  });
const cardMotion = (page: Page) =>
  page.locator('.card-in').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, ms: Number.parseFloat(cs.animationDuration) * 1000, origin: cs.transformOrigin };
  });

test('a tapped marker: the card grows out of it within 400 ms, and the phone gives a light tap', async ({ page, errors: _ }) => {
  await countBuzz(page);
  await openMap(page);
  await closeTo(page, 212);
  const q = await tapPlace(page, 212);
  await expect(page.locator('.pc-title')).toContainText('212');
  const m = await cardMotion(page);
  expect(m.name).toBe('card-in');
  expect(m.ms).toBeGreaterThan(0);
  expect(m.ms).toBeLessThanOrEqual(400);
  // It grows from the marker's place across the sheet, not from the middle.
  const left = await page.locator('.sheet').evaluate((el) => el.getBoundingClientRect().left);
  expect(Number.parseFloat(m.origin)).toBeCloseTo(q.x - left, -1);
  expect(await buzz(page)).toEqual([8]);
});

test('«near you now» gives a light tap too; the route draws in 600 ms', async ({ page, errors: _ }) => {
  await countBuzz(page);
  await page.addInitScript(() => localStorage.setItem('near-who', 'men'));
  await openMap(page);
  expect(await drawMs(page)).toBe(600);
  await page.getByRole('group', { name: 'الآن بقربك' }).getByRole('button', { name: 'أقرب بوابة' }).click();
  expect((await buzz(page)).length).toBeGreaterThanOrEqual(1);
});

test.describe('with «reduce motion»', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no growing card, no ring, no draw-in: everything simply appears', async ({ page, errors: _ }) => {
    await openMap(page);
    await closeTo(page, 212);
    await tapPlace(page, 212);
    await expect(page.locator('.pc-title')).toContainText('212');
    expect((await cardMotion(page)).name).toBe('none');
    expect(await page.evaluate(() => (window as unknown as Win).__engine.pulse.playing)).toBe(false);
    expect(await drawMs(page)).toBe(0);
    await idle(page);
  });
});
