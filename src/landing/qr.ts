import qrcode from 'qrcode-generator';
import { SITE } from '../config/site.config';

/** URL the QR code opens: QR_URL if set, else map.html on whatever host serves this page. */
export function mapUrl(): string {
  if (SITE.QR_URL) return SITE.QR_URL;
  const base = SITE.SITE_URL || location.href;
  return new URL('./map.html', base).href;
}

function matrix(text: string) {
  // Level M leaves room for the logo badge in the middle while staying robust.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r: number, c: number) => qr.isDark(r, c) };
}

/** Inline SVG QR code (works offline). */
export function qrSvg(text: string, size = 216, color = '#0E4D3A'): string {
  const { n, dark } = matrix(text);
  const q = 2; // quiet zone in modules (the card adds more around it)
  const u = size / (n + q * 2);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${((c + q) * u).toFixed(2)} ${((r + q) * u).toFixed(2)}h${u.toFixed(2)}v${u.toFixed(2)}h-${u.toFixed(2)}z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="${color}"/></svg>`;
}

/** Print-ready PNG (4-module quiet zone, black on white) as a Blob. */
export function qrPng(text: string, px = 1024): Promise<Blob> {
  const { n, dark } = matrix(text);
  const q = 4;
  const u = Math.floor(px / (n + q * 2));
  const size = u * (n + q * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) ctx.fillRect((c + q) * u, (r + q) * u, u, u);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
}
