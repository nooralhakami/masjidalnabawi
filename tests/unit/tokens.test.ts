import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrast of the design tokens in both themes (docs/DESIGN.md §1-e): text ≥ 4.5:1, control
// boundaries, focus rings and stand-alone glyphs ≥ 3:1. Read from the CSS itself, so a token
// edited later is checked too.

const CSS = readFileSync(join(__dirname, '../../src/styles/tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector}`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  return Object.fromEntries([...CSS.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LIGHT = block(":root,\n[data-theme='light'] {");
const DARK = { ...LIGHT, ...block("[data-theme='dark'] {") };
const DEVICE_DARK = block(':root:not([data-theme]) {');

type RGB = [number, number, number];
function rgb(value: string): RGB {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB;
  throw new Error(`not a solid colour: ${value}`);
}
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** color-mix(in srgb, a share, b) */
const mix = (a: RGB, share: number, b: RGB): RGB => a.map((c, i) => Math.round(c * share + b[i] * (1 - share))) as RGB;

const THEMES = { light: LIGHT, dark: DARK } as const;
const c = (t: Record<string, string>, name: string) => rgb(t[name]);

/** [foreground, background, minimum] — what the components actually put on what. */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'surface-2'],
  ['ink', 'field'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['muted', 'field'],
  ['heading', 'surface'],
  ['heading', 'surface-2'],
  ['heading', 'field'],
  ['success', 'surface-2'],
  ['muted', 'line'],
  ['accent-ink', 'accent'],
  ['accent-ink', 'accent-pressed'],
  ['danger', 'surface'],
  ['danger', 'danger-tint'],
  ['success', 'success-tint'],
  ['warn', 'warn-tint'],
];
const UI_PAIRS: [string, string][] = [
  ['outline', 'surface'],
  ['outline', 'surface-2'],
  ['outline', 'field'],
  ['focus', 'surface'],
  ['focus', 'surface-2'],
  ['focus', 'bg'],
];
/** Category colours carry white glyphs (icons), never white text. */
const GLYPH_ON = ['cat-men', 'cat-women', 'cat-acc', 'cat-hotel', 'cat-food', 'cat-land', 'cat-emg', 'cat-shop', 'cat-hist', 'cat-park-sub', 'dir-south', 'dir-west', 'dir-north', 'dir-east', 'route-drive', 'route-level-b'];
// --route-walk is a line colour only (lighter at night to read over the imagery); the walk toggle uses --green-700.

describe('design tokens: contrast', () => {
  for (const [theme, t] of Object.entries(THEMES)) {
    describe(theme, () => {
      for (const [fg, bg] of TEXT_PAIRS) it(`text ${fg} on ${bg} ≥ 4.5:1`, () => expect(ratio(c(t, fg), c(t, bg))).toBeGreaterThanOrEqual(4.5));
      for (const [fg, bg] of UI_PAIRS) it(`${fg} against ${bg} ≥ 3:1`, () => expect(ratio(c(t, fg), c(t, bg))).toBeGreaterThanOrEqual(3));
      for (const name of GLYPH_ON) it(`white glyph on ${name} ≥ 3:1`, () => expect(ratio([255, 255, 255], c(t, name))).toBeGreaterThanOrEqual(3));
      it('a closed place: ink glyph on the grey ≥ 3:1 (white would be 2.7:1)', () => {
        expect(ratio(rgb(LIGHT['ink-800']), c(t, 'cat-gray'))).toBeGreaterThanOrEqual(3);
      });
      it('travel toggle: white text on walking green and on driving blue ≥ 4.5:1', () => {
        expect(ratio([255, 255, 255], c(t, 'green-700'))).toBeGreaterThanOrEqual(4.5);
        expect(ratio([255, 255, 255], c(t, 'route-drive'))).toBeGreaterThanOrEqual(4.5);
      });
      it('level A (yellow) carries ink text ≥ 4.5:1', () => expect(ratio(rgb(LIGHT['ink-800']), c(t, 'route-level-a'))).toBeGreaterThanOrEqual(4.5));
      it('a selected category: ink text on its 14% tint of the surface ≥ 4.5:1, and its colour as a 3px edge ≥ 3:1', () => {
        for (const name of GLYPH_ON.filter((n) => n.startsWith('cat-'))) {
          const tint = mix(c(t, name), 0.14, c(t, 'surface-2'));
          expect(ratio(c(t, 'ink'), tint), name).toBeGreaterThanOrEqual(4.5);
          if (theme === 'light') expect(ratio(c(t, name), c(t, 'surface-2')), name).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }

  it('the gold is a hairline, never text: below 4.5:1 on the light surface, as DESIGN.md says', () => {
    expect(ratio(c(LIGHT, 'gold-500'), c(LIGHT, 'surface'))).toBeLessThan(4.5);
  });

  it('the device-setting dark theme is the same as the chosen dark theme', () => {
    const chosen = block("[data-theme='dark'] {");
    expect(DEVICE_DARK).toEqual(chosen);
  });

  it('category colours are the owner’s (DESIGN.md §1-c)', () => {
    expect([LIGHT['cat-men'], LIGHT['cat-women'], LIGHT['cat-acc'], LIGHT['cat-hotel'], LIGHT['cat-food'], LIGHT['cat-land'], LIGHT['cat-emg']]).toEqual(['#1f64a8', '#83409b', '#0e8478', '#6a4e39', '#c0601c', '#5a3e9c', '#c3362c']);
  });
});
