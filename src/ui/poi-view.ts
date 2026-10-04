import type { Poi } from '../data/types';
import { dirName, nm, t } from '../i18n';
import { lookOf, markerSpec } from '../map/markers';
import { icon } from './icons';
import { esc } from './dom';

/** Small marker preview used in result rows. */
export function poiBadge(p: Poi, status: Poi['status']): string {
  return markerSpec(p, 'l', status, false).html;
}

/** Colour variable for a POI's category tint. */
export function poiColor(p: Poi): string {
  const c = lookOf(p).color;
  return c === 'mixed' ? 'var(--cat-women)' : c;
}

export function poiIcon(p: Poi, size = 24): string {
  return icon(lookOf(p).icon, size);
}

export const dirVar = (p: Poi) => `var(--dir-${p.direction})`;

/** "● الجهة الغربية" */
export function sideLabel(p: Poi): string {
  return `<span class="dot" style="--c:${dirVar(p)}"></span>${esc(t('side', { d: dirName(p.direction) }))}`;
}

export const poiName = (p: Poi) => esc(nm(p));
