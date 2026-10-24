import { drawn, expect, idle, moved, openMap, test, zoomTo } from './fixtures';

// The map engine (phase 3): SPEC F1 and N1, the live app's journeys 6, 38, 40 and 41 (docs/PARITY.md),
// and what the GPU map must keep: every place in its own spot, no data rebuilt on a filter.

type Win = { __engine: any; __fac: any };

test.describe('opening view', () => {
  test('fits the Haram as the live app does (Leaflet zoom 16 on a phone), with the imagery credit always shown', async ({ page, errors: _ }) => {
    await openMap(page);
    const v = await page.evaluate(() => {
      const e = (window as unknown as Win).__engine;
      const c = e.map.getCenter();
      return { z: e.legacyZoom, lat: c.lat, lng: c.lng, bearing: e.map.getBearing(), pitch: e.map.getPitch() };
    });
    expect(v.z).toBe(16);
    expect(v.lat).toBeCloseTo(24.46854, 4);
    expect(v.lng).toBeCloseTo(39.61102, 4);
    expect([v.bearing, v.pitch]).toEqual([0, 0]);
    const credit = page.locator('.maplibregl-ctrl-attrib');
    await expect(credit).toBeVisible();
    await expect(credit).toContainText('Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics');
    await expect(credit).toContainText('OpenStreetMap');
    await expect(page.locator('.maplibregl-ctrl-scale')).toBeVisible();
  });

  test('the women’s prayer areas are drawn in pink', async ({ page, errors: _ }) => {
    await openMap(page);
    const n = await page.evaluate(() => new Set((window as unknown as Win).__engine.map.queryRenderedFeatures({ layers: ['women-fill'] }).map((f: any) => f.properties.id)).size);
    expect(n).toBe(2);
  });
});

test.describe('markers: every place in its own spot, smaller when zoomed out (owner: no merging)', () => {
  for (const legacy of [14, 15, 16]) {
    test(`at zoom ${legacy} every place in view is drawn`, async ({ page, errors: _ }) => {
      await openMap(page);
      await zoomTo(page, legacy, [39.6111, 24.4683]);
      const r = await page.evaluate(() => {
        const e = (window as unknown as Win).__engine;
        const b = e.map.getBounds();
        const ids = new Set<number>();
        for (const l of ['facilities', 'facility-dots', 'mixed-dots', 'featured', 'parking', 'outer-dots', 'inner-dots'])
          for (const f of e.map.queryRenderedFeatures({ layers: [l] })) ids.add(Number(f.properties.id));
        const expected = (e.shownIds as number[]).filter((id) => {
          const p = e.poi(id);
          // Inner gates join from 17 under «All» (the live app's visibleAtZoom).
          return p.subCategory !== 'gate_inner' && b.contains([p.lng, p.lat]);
        });
        return { drawn: ids.size, missing: expected.filter((id) => !ids.has(id)), expected: expected.length };
      });
      expect(r.expected).toBeGreaterThan(100);
      expect(r.missing).toEqual([]);
    });
  }

  test('plain dots up to 16 (GPU circles; mixed restrooms as half-and-half images), icon discs from 17', async ({ page, errors: _ }) => {
    await openMap(page);
    expect((await drawn(page, 'facility-dots')).length).toBeGreaterThan(50);
    expect((await drawn(page, 'mixed-dots')).length).toBeGreaterThan(0);
    expect(await drawn(page, 'facilities')).toEqual([]);
    await zoomTo(page, 17);
    expect(await drawn(page, 'facility-dots')).toEqual([]);
    expect((await drawn(page, 'facilities')).length).toBeGreaterThan(20);
  });

  test('outer-gate numbers from 17 (overlapping ones stay dots), inner-gate numbers at 19', async ({ page, errors: _ }) => {
    await openMap(page);
    await zoomTo(page, 16);
    expect(await drawn(page, 'outer-chips')).toEqual([]);
    await zoomTo(page, 17, [39.6111, 24.4705]);
    const chips = await drawn(page, 'outer-chips');
    const dots = await drawn(page, 'outer-dots');
    expect(chips.length).toBeGreaterThan(3);
    expect(dots.length).toBeGreaterThanOrEqual(chips.length);
    await zoomTo(page, 18);
    expect(await drawn(page, 'inner-numbers')).toEqual([]);
    await zoomTo(page, 19);
    expect((await drawn(page, 'inner-numbers')).length).toBeGreaterThan(0);
  });

  test('the named Gate 1 (Bab al-Salam) shows its label at 19, not at 18', async ({ page, errors: _ }) => {
    await openMap(page);
    const gate1 = await page.evaluate(() => {
      const p = (window as unknown as Win).__engine.poi(1);
      return [p.lng, p.lat] as [number, number];
    });
    await zoomTo(page, 18, gate1);
    expect(await drawn(page, 'gate-names')).toEqual([]);
    await zoomTo(page, 19, gate1);
    expect(await drawn(page, 'gate-names')).toContain(1);
    // An unnamed gate never gets a label (Gate 10 has no name, R3).
    expect(await drawn(page, 'gate-names')).not.toContain(10);
  });

  test('a pair of restrooms shows its number between its two markers from 18 (251 men, 253 women)', async ({ page, errors: _ }) => {
    await openMap(page);
    const at = await page.evaluate(() => {
      const e = (window as unknown as Win).__engine;
      const a = e.poi(251);
      const b = e.poi(254);
      return [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2] as [number, number];
    });
    await zoomTo(page, 17, at);
    expect(await drawn(page, 'pairs')).toEqual([]);
    await zoomTo(page, 18, at);
    expect(await drawn(page, 'pairs')).toEqual([251, 253]);
    // Between the two markers on screen.
    const between = await page.evaluate(() => {
      const m = (window as unknown as Win).__engine;
      const e = m.map;
      const [a, b] = [m.poi(251), m.poi(252)].map((p: any) => e.project([p.lng, p.lat]));
      const label = e.queryRenderedFeatures({ layers: ['pairs'] }).find((f: any) => f.properties.id === 251);
      const n = e.project(label.geometry.coordinates);
      return n.x >= Math.min(a.x, b.x) - 1 && n.x <= Math.max(a.x, b.x) + 1 && n.y >= Math.min(a.y, b.y) - 1 && n.y <= Math.max(a.y, b.y) + 1;
    });
    expect(between).toBe(true);
  });
});

test.describe('filters change layer filters, never the data', () => {
  test('a filter, a search and «hide markers»: no data upload, the nine must-visit sites kept unless searching', async ({ page, errors: _ }) => {
    await openMap(page);
    await zoomTo(page, 14, [39.6111, 24.46]);
    const r = await page.evaluate(async () => {
      const e = (window as unknown as Win).__engine;
      const src = e.map.getSource('pois');
      let uploads = 0;
      const orig = src.setData.bind(src);
      src.setData = (...a: any[]) => (uploads++, orig(...a));
      const settle = () => new Promise<void>((r) => (e.map.once('idle', () => r()), e.map.triggerRepaint()));
      const ids = (l: string) => [...new Set(e.map.queryRenderedFeatures({ layers: [l] }).map((f: any) => Number(f.properties.id)))];
      const gates = e.allIds.filter((id: number) => e.poi(id).category === 'gates');
      e.setView({ ids: gates, filter: 'gates', withFeatured: true, hidden: false });
      await settle();
      const withGates = { featured: ids('featured').length, facilities: ids('facility-dots').length + ids('mixed-dots').length, inner: ids('inner-dots').length };
      // A search for one landmark: the must-visit badges go, the match is drawn as a plain marker.
      e.setView({ ids: [516], filter: 'all', withFeatured: false, hidden: false });
      await settle();
      const searching = { featured: ids('featured').length, facilities: [...ids('facility-dots'), ...ids('mixed-dots')] };
      e.setView({ ids: e.allIds, filter: 'all', withFeatured: true, hidden: true });
      await settle();
      const hidden = ['facilities', 'facility-dots', 'mixed-dots', 'featured', 'outer-dots', 'inner-dots', 'parking'].reduce((n, l) => n + ids(l).length, 0);
      return { uploads, withGates, searching, hidden };
    });
    expect(r.uploads).toBe(0);
    expect(r.withGates.facilities).toBe(0);
    expect(r.withGates.featured).toBeGreaterThan(0);
    // With a gates filter, inner gates show at any zoom (visibleAtZoom).
    expect(r.withGates.inner).toBeGreaterThan(0);
    expect(r.searching.featured).toBe(0);
    expect(r.searching.facilities).toEqual([516]);
    expect(r.hidden).toBe(0);
  });
});

test.describe('map buttons', () => {
  test('compass: the needle turns with true north on screen (opposite to the map turn) and shows the Kaaba; it resets north', async ({ page, errors: _ }) => {
    await openMap(page);
    const compass = page.locator('.mc-compass');
    await expect(compass.locator('.kaaba')).toHaveCount(1);
    const turned = moved(page);
    await page.getByRole('button', { name: 'تدوير الخريطة مع عقارب الساعة' }).click();
    await turned;
    await expect(compass).toHaveClass(/is-rotated/);
    const r = await page.evaluate(() => ({
      bearing: (window as unknown as Win).__engine.map.getBearing(),
      needle: parseFloat((document.querySelector('.mc-compass') as HTMLElement).style.getPropertyValue('--north')),
    }));
    // The map content turned clockwise by 15°, so north on screen is at +15°, and the needle with it.
    expect(r.bearing).toBeCloseTo(-15, 0);
    expect(r.needle).toBeCloseTo(15, 0);
    const north = moved(page);
    await page.getByRole('button', { name: 'إعادة الشمال للأعلى' }).click();
    await north;
    expect(await page.evaluate(() => (window as unknown as Win).__engine.map.getBearing())).toBeCloseTo(0, 1);
    await expect(compass).not.toHaveClass(/is-rotated/);
  });

  test('zoom buttons step one whole zoom; the layer button switches to the light map and back', async ({ page, errors: _ }) => {
    await openMap(page);
    const zoomed = moved(page);
    await page.getByRole('button', { name: 'تكبير' }).click();
    await zoomed;
    expect(await page.evaluate(() => (window as unknown as Win).__engine.legacyZoom)).toBeCloseTo(17, 1);
    const vis = () => page.evaluate(() => ['esri', 'light'].map((l) => (window as unknown as Win).__engine.map.getLayoutProperty(l, 'visibility') ?? 'visible'));
    expect(await vis()).toEqual(['visible', 'none']);
    const layers = page.locator('.mc-layers');
    const before = await layers.getAttribute('aria-label');
    await layers.click();
    expect(await vis()).toEqual(['none', 'visible']);
    expect(await layers.getAttribute('aria-label')).not.toBe(before);
    await layers.click();
    expect(await vis()).toEqual(['visible', 'none']);
  });

  test('a tap on a marker picks that place', async ({ page, errors: _ }) => {
    await openMap(page);
    const at = await page.evaluate(() => {
      const p = (window as unknown as Win).__engine.poi(215);
      return [p.lng, p.lat] as [number, number];
    });
    await zoomTo(page, 19, at);
    const picked = page.evaluate(() => new Promise<number>((r) => document.addEventListener('map-tap', (e) => r((e as CustomEvent).detail), { once: true })));
    const box = (await page.locator('#map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + 3, box.y + box.height / 2 - 2);
    expect(await picked).toBe(215);
    // The tap opens its card (phase 4).
    await expect(page.locator('.sheet .pc-title')).toContainText('215');
  });
});

test.describe('language and theme', () => {
  test('in English (left to right) and at night the map redraws its markers without errors', async ({ page, errors: _ }) => {
    await openMap(page, 'en');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    await zoomTo(page, 19, [39.6105, 24.4675]);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      (window as unknown as Win).__engine.restyle();
    });
    await idle(page);
    const images = await page.evaluate(() => (window as unknown as Win).__engine.map.listImages() as string[]);
    expect(images.length).toBeGreaterThan(0);
    // The marker images (the route's own are versioned apart, map/route.ts).
    expect(images.filter((i) => !i.startsWith('rt')).every((i) => i.endsWith('@2'))).toBe(true);
    expect((await drawn(page, 'facilities')).length).toBeGreaterThan(0);
  });
});
