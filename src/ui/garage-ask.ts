import type { Poi } from '../data/types';
import { t } from '../i18n';
import type { Level } from '../routing/garage';
import type { GarageStart } from '../routing/plan';
import { el, esc } from './dom';

/**
 * Asked when a car route is requested from in or by the underground car park (owner, 2026-10-14):
 * is the car in one of the nearest lots, on the road, or outside — then which level. The answer
 * decides where the way starts. Resolves null if the visitor dismisses it (Esc).
 */
export function askGarageStart(lots: Poi[]): Promise<GarageStart | null> {
  return new Promise((resolve) => {
    const panel = el('div', { class: 'garage-ask', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'garage-ask-q' });
    const before = document.activeElement as HTMLElement | null;
    const done = (v: GarageStart | null) => {
      panel.remove();
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(null);
    };
    const show = (question: string, options: { label: string; primary?: boolean; pick: () => void }[]) => {
      panel.innerHTML = `<strong id="garage-ask-q" class="garage-ask-q">${esc(question)}</strong>${options
        .map((o, i) => `<button type="button" class="garage-ask-opt${o.primary ? ' is-primary' : ''}" data-i="${i}">${esc(o.label)}</button>`)
        .join('')}`;
      panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => options[Number(b.dataset.i)].pick()));
      panel.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const askLevel = (lot: Poi | null) =>
      show(
        t('gq_level'),
        (['B', 'A'] as Level[]).map((level) => ({ label: t('lvl_name', { l: level }), pick: () => done({ lot, level }) })),
      );
    const [first, ...others] = lots;
    show(first ? t('gq_lot', { n: first.id - 900 }) : t('gq_level'), [
      ...(first ? [{ label: t('gq_yes_lot', { n: first.id - 900 }), primary: true, pick: () => askLevel(first) }] : []),
      ...others.map((lot) => ({ label: t('gq_in_lot', { n: lot.id - 900 }), pick: () => askLevel(lot) })),
      { label: t('gq_on_road'), pick: () => askLevel(null) },
      { label: t('gq_outside'), pick: () => done('outside') },
    ]);
    document.addEventListener('keydown', onKey);
    document.body.append(panel);
    panel.querySelector<HTMLButtonElement>('button')?.focus();
  });
}
