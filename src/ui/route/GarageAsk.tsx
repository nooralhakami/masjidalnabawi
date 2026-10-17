import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Poi } from '../../data/types';
import type { GarageStart } from '../../routing/plan';
import { useI18n } from '../i18n';

export interface GarageAskProps {
  lots: Poi[];
  onAnswer(start: GarageStart | null): void;
}

/**
 * Asked when a car route is requested from in or by the underground car park (owner, 2026-10-14):
 * is the car in one of the nearest lots, on the road, or outside — then which level. The answer
 * decides where the way starts. Esc dismisses it (the live app's ui/garage-ask.ts).
 */
export function GarageAsk({ lots, onAnswer }: GarageAskProps) {
  const { t } = useI18n();
  const [lot, setLot] = useState<Poi | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);

  const done = (v: GarageStart | null) => {
    onAnswer(v);
    before.current?.focus?.();
  };
  // Listening from the first paint: a quick Esc must not be missed (useEffect runs a frame later).
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // The first choice takes the focus at each question.
  useLayoutEffect(() => box.current?.querySelector<HTMLButtonElement>('button')?.focus(), [lot]);

  const [first, ...others] = lots;
  const asking = lot === undefined;
  const question = asking && first ? t('gq_lot', { n: first.id - 900 }) : t('gq_level');
  const options: { label: string; primary?: boolean; pick(): void }[] = asking
    ? [
        ...(first ? [{ label: t('gq_yes_lot', { n: first.id - 900 }), primary: true, pick: () => setLot(first) }] : []),
        ...others.map((l) => ({ label: t('gq_in_lot', { n: l.id - 900 }), pick: () => setLot(l) })),
        { label: t('gq_on_road'), pick: () => setLot(null) },
        { label: t('gq_outside'), pick: () => done('outside') },
      ]
    : (['B', 'A'] as const).map((level) => ({ label: t('lvl_name', { l: level }), pick: () => done({ lot: lot ?? null, level }) }));

  return (
    <div class="garage-ask" role="dialog" aria-modal="true" aria-labelledby="garage-ask-q" ref={box}>
      <strong id="garage-ask-q" class="garage-ask-q">
        {question}
      </strong>
      {options.map((o) => (
        <button type="button" key={o.label} class={`garage-ask-opt${o.primary ? ' is-primary' : ''}`} onClick={o.pick}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
