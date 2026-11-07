import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HINT_MS, HINTS, nextHint, placeHint, type HintBox, type HintId } from '../../presentation/hints';
import { useI18n } from '../i18n';

/** Where a hint points: a point on the page, and whether the bubble sits under it or over it. */
export interface HintTarget {
  x: number;
  y: number;
  side: 'below' | 'above';
  /** Room between the point and the bubble's arrow (px). */
  gap?: number;
}

const TEXT: Record<HintId, string> = { search: 'hint_search', filters: 'hint_filters', marker: 'hint_marker' };

/**
 * The first-visit hints (UI plan phase 5): one small bubble at a time, beside what it is about.
 * Nothing is blocked: the bubble lets every touch through to the page, and the touch itself moves
 * on to the next hint (a key too). Each also leaves by itself after a few seconds. A hint whose
 * target is not on screen is skipped.
 */
export function FirstHints({ target, onDone }: { target(h: HintId): HintTarget | null; onDone(): void }) {
  const { t } = useI18n();
  const [hint, setHint] = useState<HintId | null>(HINTS[0]);
  const [box, setBox] = useState<HintBox | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const at = hint ? target(hint) : null;

  const next = () => setHint((h) => (h ? nextHint(h) : null));

  // A hint with nothing to point at is passed over; after the last one, done.
  useEffect(() => {
    if (!hint) onDone();
    else if (!at) next();
  }, [hint, !!at]);

  // Any touch or key on the page moves on, and the page still gets it.
  useEffect(() => {
    if (!hint || !at) return;
    const timer = window.setTimeout(next, HINT_MS);
    // Only a touch after this bubble showed: the one that ended the last hint does not end this one too.
    const shown = performance.now();
    const on = (e: Event) => {
      if (e.timeStamp >= shown) next();
    };
    addEventListener('pointerdown', on, { capture: true, passive: true });
    addEventListener('keydown', on, { capture: true });
    return () => {
      clearTimeout(timer);
      removeEventListener('pointerdown', on, { capture: true });
      removeEventListener('keydown', on, { capture: true });
    };
  }, [hint, !!at]);

  // Measured, then placed: centred on its target, inside the gutters.
  useLayoutEffect(() => {
    const b = el.current;
    if (!b || !at) return setBox(null);
    setBox(placeHint(at, at.side, { w: b.offsetWidth, h: b.offsetHeight }, document.documentElement.clientWidth, 16, at.gap));
  }, [hint, at?.x, at?.y]);

  if (!hint || !at) return null;
  return (
    <div
      ref={el}
      key={hint}
      class={`hint is-${box?.side ?? at.side}`}
      role="status"
      data-hint={hint}
      style={{
        left: `${box?.left ?? 0}px`,
        top: `${box?.top ?? 0}px`,
        visibility: box ? 'visible' : 'hidden',
        '--arrow-x': `${box?.arrowX ?? 0}px`,
      }}
    >
      {t(TEXT[hint])}
    </div>
  );
}
