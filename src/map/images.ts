import { icon, type IconName } from '../presentation/icons';

/**
 * Marker images for the GPU map, drawn on a canvas in the live app's shapes (its map.css):
 * facility dots and icon discs, outer-gate number chips, inner-gate numbers, car park chips,
 * must-visit badges with their halo, restroom pair numbers and gate name labels.
 *
 * Why images: text and icons are drawn by the browser with the app's own fonts (correct Arabic, no
 * glyph server), and an image is made only when the map first needs it (styleimagemissing), so
 * nothing is drawn up front. Colours come from the CSS tokens, read when an image is drawn; a theme
 * change bumps the image version and the map asks for fresh ones.
 */

export interface Palette {
  get(token: string): string;
}

/** Reads colour tokens from the page (tokens.css), cached until the theme changes. */
export function cssPalette(el: Element = document.documentElement): Palette & { reset(): void } {
  let cache = new Map<string, string>();
  return {
    get(token) {
      let v = cache.get(token);
      if (!v) {
        v = getComputedStyle(el).getPropertyValue(`--${token}`).trim() || '#888';
        cache.set(token, v);
      }
      return v;
    },
    reset() {
      cache = new Map();
    },
  };
}

/** Icon SVGs rasterised once (white and ink strokes), so drawing a marker later is synchronous. */
export class IconAtlas {
  private images = new Map<string, HTMLImageElement>();

  async load(names: readonly IconName[], colors: readonly string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const n of names)
      for (const c of colors) {
        // As a stand-alone image an SVG needs its namespace (inline in the page it does not).
        const svg = icon(n, 24)
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
          .replace('stroke="currentColor"', `stroke="${c}"`)
          .replace('stroke-width="1.75"', 'stroke-width="2.4"')
          .replace(/fill="currentColor"/g, `fill="${c}"`);
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        this.images.set(`${n}|${c}`, img);
        jobs.push(img.decode().catch(() => undefined));
      }
    await Promise.all(jobs);
  }

  get(name: IconName, color: string): HTMLImageElement | undefined {
    const img = this.images.get(`${name}|${color}`);
    return img && img.complete && img.naturalWidth > 0 ? img : undefined;
  }
}

export interface Drawn {
  data: ImageData;
  pixelRatio: number;
}

const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif';

function canvas(w: number, h: number, ratio: number): [CanvasRenderingContext2D, () => Drawn] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * ratio);
  c.height = Math.ceil(h * ratio);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(ratio, ratio);
  return [ctx, () => ({ data: ctx.getImageData(0, 0, c.width, c.height), pixelRatio: ratio })];
}

/** A token colour (#rrggbb) at an opacity, for canvas shadows. */
function alpha(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgb(${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)} / ${a})` : hex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A disc in one colour, or half men's blue and half women's purple for mixed restrooms. */
function fillDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, pal: Palette) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (color === 'mixed') {
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0.5, pal.get('cat-men'));
    g.addColorStop(0.5, pal.get('cat-women'));
    ctx.fillStyle = g;
  } else ctx.fillStyle = pal.get(color);
  ctx.fill();
}

export interface Drawer {
  /** Draw the image for a map image id, or null if the id is not ours. */
  draw(id: string): Drawn | null;
}

/**
 * Image ids (all end in @<version>):
 *   dot:<color>:<closed>          small facility dot (8 px base)
 *   fac:<icon>.<color>:<closed>   facility disc with its icon (20 px base)
 *   feat:<icon>                   must-visit badge with halo (24 px base)
 *   pin:<icon>.<color>:<closed>   the chosen place's pin (48 × 60, tip on the spot)
 *   gate:<id>                     outer-gate number chip (19 px tall base)
 *   inum:<id>:<color>             inner-gate number (18 px)
 *   park:<n>:<sub>                car park chip («P n», lock for subscribers)
 *   pair:<n>:<color>              restroom pair number
 *   name:<id>                     a named gate's label (text from labelOf)
 *   cent:<id>:<open>              a new car park vehicle entrance: car disc, name and open/closed
 *   hint:<id>:<f|s>               a place's name over it on a route: f = faint (the one gone by),
 *                                 s = clear (the one tapped, for two seconds)
 */
export function createDrawer(opts: {
  palette: Palette;
  icons: IconAtlas;
  ratio: number;
  labelOf(id: number): string;
  dirOf(id: number): string;
  /** A new vehicle entrance's words (src/data-next/car-entrances.ts), in the visitor's language. */
  entranceOf?(id: string, open: boolean): { name: string; state: string } | null;
}): Drawer {
  const { palette: pal, icons, ratio } = opts;
  const white = '#ffffff';
  const ink = () => pal.get('ink-800');

  const dot = (color: string, closed: boolean): Drawn => {
    // 8 px dot with a 1.5 px white ring (the live app's .mk-s .mk-dot).
    const [ctx, out] = canvas(12, 12, ratio);
    ctx.beginPath();
    ctx.arc(6, 6, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = white;
    ctx.fill();
    fillDisc(ctx, 6, 6, 4, closed ? 'cat-gray' : color, pal);
    return out();
  };

  const fac = (iconName: IconName, color: string, closed: boolean): Drawn => {
    // 20 px disc, 2 px white ring, a soft glow in its colour, the icon at 62% (.mk-dot at tier l).
    const S = 34;
    const c = S / 2;
    const [ctx, out] = canvas(S, S, ratio);
    const fill = closed ? 'cat-gray' : color;
    ctx.save();
    ctx.shadowColor = alpha(pal.get(fill === 'mixed' ? 'cat-women' : fill), 0.45);
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(c, c, 12, 0, Math.PI * 2);
    ctx.fillStyle = white;
    ctx.fill();
    ctx.restore();
    fillDisc(ctx, c, c, 10, fill, pal);
    // Closed: grey with a dark icon (white on grey is 2.7:1, DESIGN §1-e) and the live app's strike.
    const glyph = icons.get(iconName, closed ? ink() : white);
    if (glyph) ctx.drawImage(glyph, c - 6.2, c - 6.2, 12.4, 12.4);
    if (closed) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, 10, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c - 10, c - 10);
      ctx.lineTo(c + 10, c + 10);
      ctx.stroke();
      ctx.restore();
    }
    return out();
  };

  const feat = (iconName: IconName): Drawn => {
    // 24 px bronze badge with its icon and a warm static halo 18 px round it (.mk-star + .mk-halo).
    const S = 60;
    const c = S / 2;
    const [ctx, out] = canvas(S, S, ratio);
    const halo = ctx.createRadialGradient(c, c, 0, c, c, 30);
    halo.addColorStop(0, 'rgb(255 214 120 / 0.85)');
    halo.addColorStop(0.35, 'rgb(255 214 120 / 0.45)');
    halo.addColorStop(0.7, 'rgb(255 214 120 / 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(c, c, 14, 0, Math.PI * 2);
    ctx.fillStyle = white;
    ctx.fill();
    ctx.restore();
    fillDisc(ctx, c, c, 12, 'cat-hist', pal);
    const glyph = icons.get(iconName, white);
    if (glyph) ctx.drawImage(glyph, c - 7.5, c - 7.5, 15, 15);
    return out();
  };

  const chip = (id: number): Drawn => {
    // Number chip with a dot in the side colour (.mk-chip at tier l: 19 px, 10.5 px bold).
    ctxMeasure.font = `600 10.5px ${FONT}`;
    const text = String(id);
    const tw = ctxMeasure.measureText(text).width;
    const w = Math.ceil(5 + 6 + 3 + tw + 6);
    const [ctx, out] = canvas(w + 4, 23, ratio);
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.22)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    roundRect(ctx, 2, 1, w, 19, 9.5);
    ctx.fillStyle = pal.get('surface-2');
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(2 + 5 + 3, 10.5, 3, 0, Math.PI * 2);
    ctx.fillStyle = pal.get(opts.dirOf(id));
    ctx.fill();
    ctx.fillStyle = pal.get('ink');
    ctx.font = `600 10.5px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 2 + 5 + 6 + 3, 11);
    return out();
  };

  const inum = (id: number, color: string): Drawn => {
    // 18 px disc in the side colour (or women's purple), white number, 1.5 px white ring (.mk-inum).
    const [ctx, out] = canvas(22, 22, ratio);
    ctx.beginPath();
    ctx.arc(11, 11, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = white;
    ctx.fill();
    fillDisc(ctx, 11, 11, 9, color, pal);
    ctx.fillStyle = white;
    ctx.font = `600 9.5px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(id), 11, 11.5);
    return out();
  };

  const park = (n: number, sub: boolean): Drawn => {
    // «P n» chip, «P» apart from the number and read left to right in every language (owner,
    // 2026-10-13); crimson with a lock badge for subscribers (.mk-park, .mk-park-lock).
    ctxMeasure.font = `600 10.5px ${FONT}`;
    const num = String(n);
    const w = Math.max(30, Math.ceil(6 + 7 + 3 + ctxMeasure.measureText(num).width + 6));
    const top = 7;
    const [ctx, out] = canvas(w + 8, 20 + top + 6, ratio);
    const x = 4;
    const color = pal.get(sub ? 'cat-park-sub' : 'cat-men');
    roundRect(ctx, x - 2, top - 2, w + 4, 24, 9);
    ctx.fillStyle = white;
    ctx.fill();
    roundRect(ctx, x, top, w, 20, 7);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = white;
    ctx.textBaseline = 'middle';
    ctx.font = `700 10.5px ${FONT}`;
    const pw = ctx.measureText('P').width;
    const tw = pw + 3 + ctxMeasure.measureText(num).width;
    const sx = x + (w - tw) / 2;
    ctx.fillText('P', sx, top + 10.5);
    ctx.font = `600 10.5px ${FONT}`;
    ctx.fillText(num, sx + pw + 3, top + 10.5);
    if (sub) {
      const lx = x + w / 2 - 8;
      roundRect(ctx, lx, 0, 16, 14, [5, 5, 3, 3]);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = white;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const lock = icons.get('lock', white);
      if (lock) ctx.drawImage(lock, lx + 3, 2, 10, 10);
    }
    return out();
  };

  const pair = (n: number, color: string): Drawn => {
    // White pill edged and lettered in the pair's colour (.pair-no).
    ctxMeasure.font = `600 12px ${FONT}`;
    const w = Math.max(34, Math.ceil(ctxMeasure.measureText(String(n)).width + 14));
    const [ctx, out] = canvas(w + 6, 28, ratio);
    ctx.save();
    ctx.shadowColor = 'rgb(30 42 38 / 0.3)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    roundRect(ctx, 3, 3, w, 22, 11);
    ctx.fillStyle = white;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 4, 4, w - 2, 20, 10);
    ctx.strokeStyle = pal.get(color);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = pal.get(color);
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 3 + w / 2, 14.5);
    return out();
  };

  const name = (id: number): Drawn => {
    // A boxed label, up to 190 px, cut with an ellipsis (.gate-label).
    const text = opts.labelOf(id);
    ctxMeasure.font = `600 11px ${FONT}`;
    let label = text;
    while (ctxMeasure.measureText(label).width > 176 && label.length > 2) label = label.slice(0, -2) + '…';
    const w = Math.ceil(ctxMeasure.measureText(label).width + 14);
    const [ctx, out] = canvas(w + 6, 28, ratio);
    ctx.save();
    ctx.shadowColor = 'rgb(14 77 58 / 0.12)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, 3, 3, w, 22, 6);
    ctx.fillStyle = pal.get('surface-2');
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 3.5, 3.5, w - 1, 21, 6);
    ctx.strokeStyle = pal.get('line-strong');
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = pal.get('ink');
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The browser shapes Arabic and orders mixed-direction text itself.
    ctx.direction = /[֐-ࣿ]/.test(label) ? 'rtl' : 'ltr';
    ctx.fillText(label, 3 + w / 2, 14.5);
    return out();
  };

  const hint = (id: number, clear: boolean): Drawn => {
    // The name over its place on a route (owner, 2026-10-25). Faint: small, no border, a see-through
    // ground, the ink itself at full strength (so it still reads; faint is size and weight, not contrast).
    // Clear: larger, bold, solid, edged.
    const size = clear ? 13 : 10.5;
    const weight = clear ? 700 : 500;
    const text = opts.labelOf(id);
    ctxMeasure.font = `${weight} ${size}px ${FONT}`;
    let label = text;
    while (ctxMeasure.measureText(label).width > 190 && label.length > 2) label = label.slice(0, -2) + '…';
    const pad = clear ? 9 : 6;
    const H = clear ? 26 : 19;
    const w = Math.ceil(ctxMeasure.measureText(label).width + pad * 2);
    const [ctx, out] = canvas(w + 6, H + 6, ratio);
    if (clear) {
      ctx.save();
      ctx.shadowColor = 'rgb(0 0 0 / 0.3)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    }
    roundRect(ctx, 3, 3, w, H, clear ? 8 : 6);
    ctx.fillStyle = clear ? pal.get('surface-2') : alpha(pal.get('surface-2'), 0.78);
    ctx.fill();
    if (clear) {
      ctx.restore();
      roundRect(ctx, 3.5, 3.5, w - 1, H - 1, 8);
      ctx.strokeStyle = pal.get('line-strong');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = pal.get('ink');
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = /[֐-ࣿ]/.test(label) ? 'rtl' : 'ltr';
    ctx.fillText(label, 3 + w / 2, 3 + H / 2 + 0.5);
    return out();
  };

  const pin = (iconName: IconName, color: string, closed: boolean): Drawn => {
    // The chosen place: a 48 × 60 pin, its tip on the spot, the category's disc and icon (.mk-pin).
    const W = 48;
    const H = 60;
    const [ctx, out] = canvas(W, H, ratio);
    const fill = closed ? 'cat-gray' : color;
    const c = { x: W / 2, y: 22 };
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(c.x, H - 3);
    ctx.bezierCurveTo(c.x - 6, H - 14, c.x - 20, c.y + 12, c.x - 20, c.y);
    ctx.arc(c.x, c.y, 20, Math.PI, 0);
    ctx.bezierCurveTo(c.x + 20, c.y + 12, c.x + 6, H - 14, c.x, H - 3);
    ctx.fillStyle = white;
    ctx.fill();
    ctx.restore();
    fillDisc(ctx, c.x, c.y, 17, fill, pal);
    const glyph = icons.get(iconName, closed ? ink() : white);
    if (glyph) ctx.drawImage(glyph, c.x - 12, c.y - 12, 24, 24);
    return out();
  };

  const entrance = (id: string, open: boolean): Drawn | null => {
    // A chip like a gate's label, with a car disc: grey and edged in red while closed, the car park's
    // blue and edged in green when open. The words say it too (colour is never the only sign).
    const words = opts.entranceOf?.(id, open);
    if (!words) return null;
    const text = `${words.name} · ${words.state}`;
    ctxMeasure.font = `700 11px ${FONT}`;
    const tw = Math.ceil(ctxMeasure.measureText(text).width);
    const H = 30;
    const w = 26 + tw + 12;
    const [ctx, out] = canvas(w + 6, H + 6, ratio);
    ctx.save();
    ctx.shadowColor = 'rgb(14 77 58 / 0.18)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, 3, 3, w, H, H / 2);
    ctx.fillStyle = pal.get('surface-2');
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 4, 4, w - 2, H - 2, (H - 2) / 2);
    ctx.strokeStyle = pal.get(open ? 'success' : 'danger');
    ctx.lineWidth = 2;
    ctx.stroke();
    // The disc at the start of the reading direction: on the right in Arabic, Urdu, Persian, Pashto.
    const rtl = document.documentElement.dir === 'rtl';
    const cx = rtl ? 3 + w - H / 2 : 3 + H / 2;
    fillDisc(ctx, cx, 3 + H / 2, 10, open ? 'cat-men' : 'cat-gray', pal);
    const glyph = icons.get('car', open ? white : ink());
    if (glyph) ctx.drawImage(glyph, cx - 7, 3 + H / 2 - 7, 14, 14);
    ctx.fillStyle = pal.get('ink');
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.fillText(text, rtl ? 3 + 8 + tw / 2 : 3 + 26 + tw / 2 + 4, 3 + H / 2 + 0.5);
    return out();
  };

  const ctxMeasure = document.createElement('canvas').getContext('2d')!;

  return {
    draw(full) {
      const id = full.replace(/@\d+$/, '');
      const [kind, a, b] = id.split(':');
      switch (kind) {
        case 'dot':
          return dot(a, b === '1');
        case 'fac': {
          const [ic, color] = a.split('.');
          return fac(ic as IconName, color, b === '1');
        }
        case 'feat':
          return feat(a as IconName);
        case 'pin': {
          const [ic, color] = a.split('.');
          return pin(ic as IconName, color, b === '1');
        }
        case 'gate':
          return chip(Number(a));
        case 'inum':
          return inum(Number(a), b);
        case 'park':
          return park(Number(a), b === '1');
        case 'pair':
          return pair(Number(a), b);
        case 'name':
          return name(Number(a));
        case 'cent':
          return entrance(a, b === '1');
        case 'hint':
          return hint(Number(a), b === 's');
        default:
          return null;
      }
    },
  };
}
