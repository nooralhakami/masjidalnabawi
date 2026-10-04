import { POIS, POI_BY_ID, RULES } from '../data';
import type { Poi, Status, SubCategory } from '../data/types';
import { nearest } from './geo';

const { WORKS_PAIR, ELEV_WOMEN, ELEV_SOON } = RULES.rules;

export const isClosed = (s: Status | undefined): boolean => s === 'maintenance' || s === 'works';

/** Which restroom types can stand in for a closed one. */
const SERVES: Partial<Record<SubCategory, SubCategory[]>> = {
  toilet_men: ['toilet_men', 'toilet_mixed'],
  toilet_women: ['toilet_women', 'toilet_mixed'],
  toilet_mixed: ['toilet_men', 'toilet_women', 'toilet_mixed'],
  toilet_elderly: ['toilet_elderly', 'toilet_accessible'],
  toilet_accessible: ['toilet_accessible', 'toilet_elderly'],
};

interface Live {
  status?: Status;
  worksBy?: number;
}

/**
 * Live open/closed state of facilities. Starts from pois.json (which already holds the demo state
 * from rules.json: maintenance 212/233/236, elevator works at 215 closing 216) and is changed by the admin panel.
 */
export class Facilities {
  private live = new Map<number, Live>();
  private listeners = new Set<() => void>();

  constructor(pois: readonly Poi[] = POIS) {
    for (const p of pois) if (p.status) this.live.set(p.id, { status: p.status, worksBy: p.worksBy });
  }

  status(id: number): Status | undefined {
    return this.live.get(id)?.status;
  }
  worksBy(id: number): number | undefined {
    return this.live.get(id)?.worksBy;
  }
  isOpen(id: number): boolean {
    return this.status(id) === 'open';
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** Elevator works close a women's facility and its paired facility together. */
  setWorks(id: number, on: boolean): void {
    this.live.set(id, { status: on ? 'works' : 'open' });
    const pair = WORKS_PAIR[String(id)];
    if (pair !== undefined) this.live.set(pair, on ? { status: 'works', worksBy: id } : { status: 'open' });
    this.emit();
  }

  /** Admin "change status": open ⇄ maintenance; ending works reopens both facilities. */
  toggleMaintenance(id: number): void {
    const cur = this.live.get(id);
    if (!cur) return;
    if (cur.status === 'works') return this.setWorks(cur.worksBy ?? id, false);
    this.live.set(id, { status: cur.status === 'open' ? 'maintenance' : 'open' });
    this.emit();
  }

  /** The facility whose elevator works affect `id` (itself or its pair), if any. */
  worksOwner(id: number): number | null {
    if (ELEV_WOMEN.includes(id)) return id;
    const by = this.worksBy(id);
    if (by !== undefined) return by;
    const pair = WORKS_PAIR[String(id)];
    return pair !== undefined && ELEV_WOMEN.includes(pair) ? pair : null;
  }

  /** Admin "elevator works": toggles works on the pair together. Returns false when not applicable. */
  toggleElevatorWorks(id: number): boolean {
    const owner = this.worksOwner(id);
    if (owner === null) return false;
    this.setWorks(owner, this.status(owner) !== 'works');
    return true;
  }

  /** Nearest open facility of a compatible type (men → men/mixed, women → women/mixed, …). */
  nearestOpen(p: Poi): { poi: Poi; meters: number } | null {
    const ok = SERVES[p.subCategory];
    if (!ok) return null;
    const cands = POIS.filter((q) => q.id !== p.id && q.category === 'toilets' && ok.includes(q.subCategory) && this.isOpen(q.id));
    const best = nearest(p, cands);
    return best ? { poi: best.item, meters: best.meters } : null;
  }
}

/** Facility across the walkway leading to the same restrooms (201↔202 … 235↔236). */
export function pairOf(p: Poi): Poi | undefined {
  return p.pairWith !== undefined ? POI_BY_ID.get(p.pairWith) : undefined;
}

/** Elevator under construction here: women's sites close for hours during works; men's stay open (info only). */
export function elevatorBadge(p: Poi): 'elev_w' | 'elev' | null {
  if (!ELEV_SOON.includes(p.id)) return null;
  return ELEV_WOMEN.includes(p.id) ? 'elev_w' : 'elev';
}
