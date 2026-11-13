import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, idle, test } from './fixtures';
// @ts-expect-error The test packs a synthetic approval with the JavaScript generator directly.
import { buildUrbanGeoJSON } from '../../scripts/build-urban-3d.mjs';

type Win = { __engine: any };
const hasUrban = (page: any) => page.evaluate(() => Boolean((window as unknown as Win).__engine?.map?.getLayer('alharamain-3d-urban')));
const urbanCount = (page: any) => page.evaluate(() => (window as unknown as Win).__engine?.urban?.count ?? -1);
const urbanLoaded = (page: any) => page.evaluate(() => Boolean((window as unknown as Win).__engine?.urban?.loaded));

async function open3D(page: any) {
  await page.addInitScript(() => localStorage.setItem('lang', 'ar'));
  await page.addInitScript(() => localStorage.getItem('hints-seen') === null && localStorage.setItem('hints-seen', '1'));
  // Open flat and mount 3D at once: the default animated tilt is a sustained load the software test
  // renderer (SwiftShader) exhausts itself on; the default-3D opening is covered by map.spec.ts.
  await page.goto('map.html?view=2d');
  await page.waitForFunction(() => (window as any).__engine?.map?.loaded() && (window as any).__engine.map.getLayer('facilities'));
  await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(true, { instant: true }));
}

test.describe('the verified urban 3D layer', () => {
  // One worker, in order: two full 3D scenes at once exhaust the software test renderer (SwiftShader),
  // and a shared GPU process degrades across them. Serial keeps each scene the only load (as map.spec.ts).
  test.describe.configure({ mode: 'serial' });

  test('mounts in 3D, draws nothing without approvals, and comes off in 2D (owner, 2026-11-04)', async ({ page, errors: _ }) => {
    await open3D(page);
    expect(await page.evaluate(() => (window as unknown as Win).__engine.is3D)).toBe(true);
    expect(await hasUrban(page)).toBe(true);
    // The empty approval file loads: no guessed massing (the collection has no features).
    await expect.poll(() => urbanLoaded(page), { timeout: 15_000 }).toBe(true);
    expect(await urbanCount(page)).toBe(0);
    // Repeated toggling never leaks the camera listener or corrupts the layer. Each toggle rebuilds
    // every custom WebGL2 layer, so two cycles are enough to prove it without exhausting SwiftShader.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(false, { instant: true }));
      expect(await hasUrban(page)).toBe(false);
      expect(await page.evaluate(() => (window as unknown as Win).__engine.urban)).toBeNull();
      await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(true, { instant: true }));
      expect(await hasUrban(page)).toBe(true);
    }
    // A theme/language restyle rebuilds the 3D layers, the urban one included.
    await page.evaluate(() => (window as unknown as Win).__engine.restyle());
    await expect.poll(() => hasUrban(page)).toBe(true);
  });

  test('extrudes an approved building, renders it, and stays stable while turning and resizing', async ({ page, errors: _ }) => {
    // A synthetic approval, served only to this test — never written to the shipped data.
    const fence = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/haram-fence.json'), 'utf8'));
    const footprint = [
      [39.61, 24.4745],
      [39.612, 24.4745],
      [39.612, 24.4755],
      [39.61, 24.4755],
    ];
    const { geojson, accepted } = buildUrbanGeoJSON({ buildings: [{ id: 'T1', approved: true, kind: 'hotel', heightM: 60, footprint, source: 'e2e' }] }, fence);
    expect(accepted).toBe(1);
    await page.route('**/models/urban-3d.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(geojson) }));

    // Open flat, then mount 3D at once. The software test renderer (SwiftShader) draws single frames
    // reliably but exhausts itself on a sustained orbit animation; on a real GPU the orbit is fluid.
    await page.addInitScript(() => localStorage.setItem('lang', 'ar'));
    await page.addInitScript(() => localStorage.getItem('hints-seen') === null && localStorage.setItem('hints-seen', '1'));
    await page.goto('map.html?view=2d');
    await page.waitForFunction(() => (window as any).__engine?.map?.loaded() && (window as any).__engine.map.getLayer('facilities'));
    await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(true, { instant: true }));
    await expect.poll(() => urbanCount(page), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await hasUrban(page)).toBe(true);
    // The fade is a second layer (fill-extrusion-opacity takes no data expression).
    expect(await page.evaluate(() => Boolean((window as unknown as Win).__engine.map.getLayer('alharamain-3d-urban-faded')))).toBe(true);

    // Bring the tower into view in a single frame: the native fill-extrusion draws it (as the barriers).
    await page.evaluate(() => (window as unknown as Win).__engine.map.jumpTo({ center: [39.611, 24.475], zoom: 17, pitch: 55, bearing: 0 }));
    await idle(page);
    const rendered = () =>
      page.evaluate(() =>
        (window as unknown as Win).__engine.map.queryRenderedFeatures({ layers: ['alharamain-3d-urban', 'alharamain-3d-urban-faded'] }).map((f: any) => String(f.id)),
      );
    await expect.poll(async () => (await rendered()).includes('T1'), { timeout: 15_000 }).toBe(true);
    // The occlusion fade is stamped on the source feature the two layers' filters read (0 solid / 1 ghosted).
    const occ = await page.evaluate(
      () => (window as unknown as Win).__engine.map.querySourceFeatures('alharamain-urban').find((f: any) => String(f.properties.id) === 'T1')?.properties?.occluded,
    );
    expect([0, 1]).toContain(occ);

    // Turn the camera to a new bearing (a single frame, the same render path as an orbit): still drawn.
    await page.evaluate(() => (window as unknown as Win).__engine.map.jumpTo({ bearing: 60, pitch: 50 }));
    await expect.poll(async () => (await rendered()).includes('T1'), { timeout: 15_000 }).toBe(true);
    expect(await hasUrban(page)).toBe(true);

    // A resize reflows the canvas without dropping the layer or throwing.
    await page.setViewportSize({ width: 844, height: 390 });
    expect(await urbanCount(page)).toBeGreaterThan(0);
    expect(await hasUrban(page)).toBe(true);

    // Coming off to 2D and back never leaks the camera listener or corrupts the loaded data.
    await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(false, { instant: true }));
    expect(await hasUrban(page)).toBe(false);
    await page.evaluate(() => (window as unknown as Win).__engine.toggle3DMode(true, { instant: true }));
    await expect.poll(() => urbanCount(page), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
