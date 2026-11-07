import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { POIS } from '../../data';
import type { Poi } from '../../data/types';
import { placeByNumber, type NearWho } from '../../domain/near';
import type { WhereAnswer } from '../../state/store';
import { useI18n } from '../i18n';
import { IconButton } from '../kit/Button';

/** The car park's lots, by number (lot 1 is id 901). */
const LOTS = POIS.filter((p) => p.category === 'parking').sort((a, b) => a.id - b.id);

/** Esc closes, and the first field or choice takes the focus (from the first paint: a quick Esc is not missed). */
function useDialog(box: { current: HTMLElement | null }, close: () => void, step: unknown) {
  const before = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useLayoutEffect(() => box.current?.querySelector<HTMLElement>('input, .garage-ask-opt')?.focus(), [step]);
  return () => before.current?.focus?.();
}

/**
 * «Where are you exactly?» (owner, 2026-11-07): the location is missing or worse than 50 m — as it
 * always is in the underground car park. The visitor types the number in front of them (an outer
 * gate, a mosque door, a restroom block: every one is numbered on site), or says they are in the car
 * park and picks the lot; or keeps the rough location. Dismissed by its close button, a tap outside
 * it or Esc: then nothing is drawn.
 */
export function WhereAsk({ rough, onAnswer }: { rough: boolean; onAnswer(a: WhereAnswer): void }) {
  const { t } = useI18n();
  const [lots, setLots] = useState(false);
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const back = useDialog(box, () => done(null), lots);
  const done = (a: WhereAnswer) => {
    onAnswer(a);
    back();
  };
  const submit = (e: Event) => {
    e.preventDefault();
    const place = placeByNumber(Number(value.trim()));
    if (place) done({ place });
    else setWrong(true);
  };
  const lotNo = (l: Poi) => l.id - 900;

  return (
    <>
      <div class="garage-ask-scrim" onClick={() => done(null)} aria-hidden="true" />
      <div class="garage-ask where-ask" role="dialog" aria-modal="true" aria-labelledby="where-ask-q" ref={box}>
        <div class="garage-ask-head">
          <strong id="where-ask-q" class="garage-ask-q">
            {lots ? t('where_lot_q') : t('where_q')}
          </strong>
          <IconButton icon="close" label={t('l_close')} class="garage-ask-x" onClick={() => done(null)} />
        </div>
        {lots ? (
          <div class="where-lots">
            {LOTS.map((l) => (
              <button type="button" key={l.id} class="garage-ask-opt where-lot" onClick={() => done({ lot: l })}>
                {t('where_lot_n', { n: lotNo(l) })}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p class="where-hint">{t('where_hint')}</p>
            <form class="where-form" onSubmit={submit}>
              <label class="where-label" for="where-num">
                {t('where_num')}
              </label>
              <div class="where-field">
                <input
                  id="where-num"
                  class={`where-input${wrong ? ' is-wrong' : ''}`}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={3}
                  size={4}
                  value={value}
                  aria-invalid={wrong}
                  aria-describedby={wrong ? 'where-wrong' : undefined}
                  onInput={(e) => {
                    setValue((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''));
                    setWrong(false);
                  }}
                />
                <button type="submit" class="garage-ask-opt is-primary where-go" disabled={!value}>
                  {t('where_go')}
                </button>
              </div>
              {wrong ? (
                <span id="where-wrong" class="where-wrong" role="alert">
                  {t('where_none')}
                </span>
              ) : null}
            </form>
            <button type="button" class="garage-ask-opt" onClick={() => setLots(true)}>
              {t('where_lot')}
            </button>
            {rough ? (
              <button type="button" class="garage-ask-opt" onClick={() => done('rough')}>
                {t('where_rough')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** «Men's or women's restrooms?»: asked the first time only, then remembered on this device. */
export function WhoAsk({ onAnswer }: { onAnswer(w: NearWho | null): void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const back = useDialog(box, () => done(null), 0);
  const done = (w: NearWho | null) => {
    onAnswer(w);
    back();
  };
  return (
    <>
      <div class="garage-ask-scrim" onClick={() => done(null)} aria-hidden="true" />
      <div class="garage-ask" role="dialog" aria-modal="true" aria-labelledby="who-ask-q" ref={box}>
        <div class="garage-ask-head">
          <strong id="who-ask-q" class="garage-ask-q">
            {t('near_who_q')}
          </strong>
          <IconButton icon="close" label={t('l_close')} class="garage-ask-x" onClick={() => done(null)} />
        </div>
        <button type="button" class="garage-ask-opt" onClick={() => done('men')}>
          {t('near_men')}
        </button>
        <button type="button" class="garage-ask-opt" onClick={() => done('women')}>
          {t('near_women')}
        </button>
      </div>
    </>
  );
}
