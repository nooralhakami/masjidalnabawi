import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Poi } from '../../data/types';
import { tNext } from '../../i18n-next/strings';
import type { GarageStart } from '../../routing/plan';
import type { Spot } from '../../routing/spot';
import { useI18n } from '../i18n';
import { IconButton } from '../kit/Button';

export interface GarageAskProps {
  lots: Poi[];
  /** Where the visitor stands above the car park: the words of the last choice. */
  spot: Spot;
  onAnswer(start: GarageStart | null): void;
}

/** «I am not in the car park», said for where the visitor really is (owner, 2026-10-24). */
const OUTSIDE = { mosque: 'gq_out_mosque', plaza: 'gq_out_plaza', street: 'gq_out_street' } as const;

/**
 * Asked when a car route is requested from in or by the underground car park (owner, 2026-10-14):
 * is the car in one of the nearest lots, on the underground roads that lead to them, or not in the
 * car park at all (in the mosque, the plaza or a street above it) — then which level. The answer
 * decides where the way starts. It is dismissed by its close button, by a tap on the map outside it
 * or by Esc, and nothing is drawn: the visitor presses «start the route» again and answers.
 */
export function GarageAsk({ lots, spot, onAnswer }: GarageAskProps) {
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
  useLayoutEffect(() => box.current?.querySelector<HTMLButtonElement>('.garage-ask-opt')?.focus(), [lot]);

  const [first, ...others] = lots;
  const asking = lot === undefined;
  const question = asking && first ? t('gq_lot', { n: first.id - 900 }) : t('gq_level');
  const options: { label: string; primary?: boolean; pick(): void }[] = asking
    ? [
        ...(first ? [{ label: t('gq_yes_lot', { n: first.id - 900 }), primary: true, pick: () => setLot(first) }] : []),
        ...others.map((l) => ({ label: t('gq_in_lot', { n: l.id - 900 }), pick: () => setLot(l) })),
        { label: tNext('gq_road_under'), pick: () => setLot(null) },
        { label: tNext(OUTSIDE[spot]), pick: () => done('outside') },
      ]
    : (['B', 'A'] as const).map((level) => ({ label: t('lvl_name', { l: level }), pick: () => done({ lot: lot ?? null, level }) }));

  return (
    <>
      {/* A tap on the map, outside the question, closes it (a phone has no Esc). */}
      <div class="garage-ask-scrim" onClick={() => done(null)} aria-hidden="true" />
      <div class="garage-ask" role="dialog" aria-modal="true" aria-labelledby="garage-ask-q" ref={box}>
        <div class="garage-ask-head">
          <strong id="garage-ask-q" class="garage-ask-q">
            {question}
          </strong>
          <IconButton icon="close" label={t('l_close')} class="garage-ask-x" onClick={() => done(null)} />
        </div>
        {options.map((o) => (
          <button type="button" key={o.label} class={`garage-ask-opt${o.primary ? ' is-primary' : ''}`} onClick={o.pick}>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
