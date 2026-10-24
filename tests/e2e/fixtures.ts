import { existsSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

// 1×1 transparent PNG served for every map tile, so tests are fast and need no network.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** Messages from the software WebGL of the test browser, not from the app. */
const NOISE = /GL Driver Message|GroupMarkerNotSet|swiftshader|WebGL-|preloaded using link preload/i;

export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    // As Vercel does, a built file that does not exist is a 404 (vite preview would send the page instead).
    await page.route(/\/assets\//, (r) => {
      const path = new URL(r.request().url()).pathname;
      return existsSync(new URL(`../../dist${path}`, import.meta.url)) ? r.fallback() : r.fulfill({ status: 404, body: 'Not found' });
    });
    await page.route(/arcgisonline|openstreetmap|cartocdn/, (r) => r.fulfill({ contentType: 'image/png', body: PIXEL }));
    await page.route(/api\.open-meteo\.com/, (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 33.4, weather_code: 0, is_day: 1 } }) }),
    );
    await use(errors);
    // Every test also asserts a clean console.
    expect(errors, 'console errors').toEqual([]);
  },
});

export { expect };

/** Open the map in a language and wait until it has drawn. */
export async function openMap(page: Page, lang = 'ar', query = '') {
  await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
  await page.goto(`map.html${query}`);
  await page.waitForFunction(() => (window as any).__engine?.map?.loaded() && (window as any).__engine.map.getLayer('facilities'));
  await idle(page);
}

/** Wait until the map has finished drawing (tiles and symbols placed). */
export async function idle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        const m = (window as any).__engine.map;
        m.once('idle', () => r());
        m.triggerRepaint();
      }),
  );
}

/** Jump to a Leaflet (legacy) zoom over a point and wait for the map to settle. */
export async function zoomTo(page: Page, legacy: number, center: [number, number] = [39.6111, 24.4683]) {
  await page.evaluate(([z, c]) => (window as any).__engine.map.jumpTo({ zoom: (z as number) - 1, center: c }), [legacy, center] as const);
  await idle(page);
}

/** Ids of the places drawn in a map layer right now (in the view, after collisions). */
export async function drawn(page: Page, layer: string): Promise<number[]> {
  return page.evaluate(
    (l) => [...new Set((window as any).__engine.map.queryRenderedFeatures({ layers: [l] }).map((f: any) => Number(f.properties.id)))].sort((a: any, b: any) => a - b) as number[],
    layer,
  );
}

/** Resolves when the map's next movement (zoom, turn, pan) has ended: start it before the click. */
export function moved(page: Page): Promise<void> {
  // A flag polled from the test, not a promise awaited in the page: awaiting one, the browser
  // reported it «garbage collected» now and then under load.
  return page
    .evaluate(() => {
      const w = window as any;
      w.__moved = false;
      w.__engine.map.once('moveend', () => (w.__moved = true));
    })
    .then(() => page.waitForFunction(() => (window as any).__moved === true))
    .then(() => undefined);
}
