import type { Poi, Status } from '../data/types';
import type { FilterId } from '../domain/filters';
import { isClosed } from '../domain/facilities';
import { icon, type IconName } from '../ui/icons';

/** Zoom tiers drive marker size and progressive disclosure. */
export type Tier = 's' | 'm' | 'l';
export const tierOf = (zoom: number): Tier => (zoom <= 16 ? 's' : zoom < 18 ? 'm' : 'l');

/** Facility marker diameter per tier: ≤16 → 10px, 17 → 14px, ≥18 → 20px. */
export const FACILITY_SIZE: Record<Tier, number> = { s: 10, m: 14, l: 20 };

/** Transparent hit area around every marker. */
export const HIT = 32;

const DIR_VAR = { south: 'var(--dir-south)', west: 'var(--dir-west)', north: 'var(--dir-north)', east: 'var(--dir-east)' } as const;

interface Look {
  icon: IconName;
  color: string;
}

export function lookOf(p: Poi): Look {
  switch (p.subCategory) {
    case 'toilet_men':
      return { icon: 'men', color: 'var(--cat-men)' };
    case 'toilet_women':
      return { icon: 'women', color: 'var(--cat-women)' };
    case 'toilet_mixed':
      return { icon: 'mixed', color: 'mixed' };
    case 'toilet_elderly':
      return { icon: 'elevator', color: 'var(--cat-acc)' };
    case 'toilet_accessible':
      return { icon: 'accessible', color: 'var(--cat-acc)' };
    case 'wheelchair_zone':
      return { icon: 'cart', color: 'var(--cat-acc)' };
    case 'hotel':
      return { icon: 'hotel', color: 'var(--cat-hotel)' };
    case 'food':
      return { icon: 'food', color: 'var(--cat-food)' };
    case 'women_service':
      return { icon: 'prayer', color: 'var(--cat-women)' };
    case 'parking':
      return { icon: 'parking', color: 'var(--cat-men)' };
    case 'gate_outer':
    case 'gate_inner':
      return { icon: 'gate', color: DIR_VAR[p.direction] };
    default:
      return p.category === 'emergency' ? { icon: 'emergency', color: 'var(--cat-emg)' } : { icon: 'landmark', color: 'var(--cat-land)' };
  }
}

/**
 * Progressive disclosure: zoomed out (≤16) shows only outer gates and facilities;
 * inner gates and wheelchair zones appear from 17. A specific filter pill shows its POIs at any zoom.
 */
export function visibleAtZoom(p: Poi, tier: Tier, filter: FilterId, selected: boolean): boolean {
  if (selected || tier !== 's' || filter !== 'all') return true;
  return p.subCategory !== 'gate_inner' && p.subCategory !== 'wheelchair_zone';
}

export interface MarkerSpec {
  html: string;
  className: string;
  zIndex: number;
  /** Icon box size and anchor; defaults to the 32px hit area centred on the point. */
  size?: [number, number];
  anchor?: [number, number];
}

/** Selected facility pin: 48×60 box whose tip sits on the point. */
export const PIN_SIZE: [number, number] = [48, 60];
export const PIN_ANCHOR: [number, number] = [24, 57];

/** Approximate on-screen size of an outer-gate chip, for decluttering. */
export function chipSize(p: Poi, tier: Tier): [number, number] {
  const digits = String(p.id).length;
  // Includes the side-colour dot (6px + 3px gap) before the number.
  return tier === 'm' ? [digits * 6.2 + 22, 17] : [digits * 7 + 24, 19];
}

/** Axis-aligned overlap test for screen boxes centred on points. */
export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap = 2): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2;
}

/**
 * Marker HTML for a POI at a zoom tier. Pure — no Leaflet.
 * `compact` draws an outer gate as a dot even when zoomed in (its chip would overlap another).
 */
export function markerSpec(p: Poi, tier: Tier, status: Status | undefined, selected: boolean, compact = false): MarkerSpec {
  const look = lookOf(p);
  const closed = isClosed(status);
  const cls = ['mk', `mk-${tier}`];
  if (selected) cls.push('is-selected');
  if (closed) cls.push('is-closed');
  let inner: string;
  let z = 0;

  if (p.subCategory === 'gate_outer') {
    // Number chip edged in the side colour; a 6px dot when zoomed out.
    inner =
      (tier === 's' || compact) && !selected
        ? `<span class="mk-gdot" style="--c:${look.color}"></span>`
        : `<span class="mk-chip" style="--c:${look.color}">${p.id}</span>`;
    z = 100;
  } else if (p.subCategory === 'gate_inner') {
    const c = p.women ? 'var(--cat-women)' : look.color;
    inner =
      tier === 'l' || selected
        ? `<span class="mk-inum" style="--c:${c}">${p.id}</span>`
        : `<span class="mk-gdot mk-gdot-in" style="--c:${c}"></span>`;
    z = 50;
  } else if (p.category === 'parking') {
    inner = `<span class="mk-park">P${p.id - 900}</span>`;
    z = 200;
  } else {
    const d = FACILITY_SIZE[tier];
    const bg = closed ? 'var(--cat-gray)' : look.color;
    const isMixed = bg === 'mixed';
    const mixed = isMixed ? ' mk-mixed' : '';
    // The glow needs a real colour: mixed restrooms glow purple.
    const c = isMixed ? 'var(--cat-women)' : bg;
    if (selected) {
      cls.push('mk-pinwrap');
      return {
        html: `<span class="mk-pin${mixed}" style="--c:${c}">${icon(look.icon, 24)}</span>`,
        className: cls.join(' '),
        zIndex: 1000,
        size: PIN_SIZE,
        anchor: PIN_ANCHOR,
      };
    }
    const glyph = d >= 13 ? icon(look.icon, 24) : '';
    inner = `<span class="mk-dot${mixed}" style="--d:${d}px;--c:${c}">${glyph}</span>`;
    z = 300;
  }
  return { html: inner, className: cls.join(' '), zIndex: selected ? 1000 : z };
}
