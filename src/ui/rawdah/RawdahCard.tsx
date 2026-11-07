import { useEffect, useRef, useState } from 'preact/hooks';
import { splitDuration, type RawdahState } from '../../domain/rawdah';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';
import { Ring } from '../kit/Ring';

/**
 * The Rawdah, live: a ring with the time left in the current turn, «now: women's/men's time ·
 * switches in …». In the women's turn: Gate 37 needs a Nusuk permit, and a second card leads to
 * the area behind the Rawdah (Gate 21, no permit). Texts are the live app's (ro_* keys, R5).
 *
 * The two are one card's two faces (owner, 2026-11-07: more map): swiped side to side (the
 * browser's own scroll snapping, so it follows the finger and the language's direction), with a dot
 * for each under it. While the map moves the card is `compact`: the permit lines step aside, the
 * ring and the time left stay.
 */
export function RawdahCard({ state, onOpen, onBehind, compact = false }: { state: RawdahState; onOpen(): void; onBehind(): void; compact?: boolean }) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState(0);
  // Which face shows: the nearer to the track's start (scrollLeft is negative in RTL).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const on = () => setFace(Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth)));
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  const show = (i: number) => {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    // By how far the face stands from the track's edge (the same in either direction).
    const by = card.getBoundingClientRect().left - el.getBoundingClientRect().left;
    const to = el.scrollLeft + by;
    setFace(i);
    el.scrollTo({ left: to, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // Where a smooth scroll does not run (a page in the background), the face still changes.
    window.setTimeout(() => {
      if (Math.abs(el.scrollLeft - to) > 2) el.scrollTo({ left: to });
    }, 500);
  };
  const women = state.turn === 'women';
  const color = women ? 'var(--cat-women)' : 'var(--cat-men)';
  const { h, m } = splitDuration(state.minutesLeft);
  const left = h ? t('dur_hm', { h, m }) : t('dur_m', { m });
  return (
    <div class={`rawdah-stack${compact ? ' is-compact' : ''}`}>
      <div class="rawdah-track" ref={track}>
        <button type="button" class="rawdah-card" onClick={onOpen}>
          <Ring left={1 - state.progress} color={color}>
            <Icon name="dome" size={22} />
          </Ring>
          <span class="rawdah-body">
            <span class="rawdah-title">
              {t('ro_title')} · {t('gate_n', { id: 37 })}
            </span>
            <span class="rawdah-now">
              <span class={`turn turn-${state.turn}`}>{t('ro_now', { who: t(women ? 'ro_women' : 'ro_men') })}</span>
              <span class="rawdah-left">{t('ro_switch', { t: left })}</span>
            </span>
            {women ? (
              <span class="rawdah-permit">
                <Icon name="lock" size={14} />
                {t('ro_permit')}
              </span>
            ) : null}
          </span>
          <Icon name="chevleft" size={20} flip />
        </button>
        {women ? (
          <button type="button" class="rawdah-card rawdah-behind" onClick={onBehind}>
            <span class="rawdah-tile">
              <Icon name="women" size={20} />
            </span>
            <span class="rawdah-body">
              <span class="rawdah-title">{t('ro_behind')}</span>
              <span class="rawdah-free">
                <Icon name="check" size={14} />
                {t('ro_no_permit')}
              </span>
            </span>
            <Icon name="chevleft" size={20} flip />
          </button>
        ) : null}
      </div>
      {women ? (
        <div class="rawdah-dots">
          {[t('ro_title'), t('ro_behind')].map((name, i) => (
            <button key={name} type="button" class="rawdah-dot" aria-label={name} aria-current={face === i ? 'true' : undefined} onClick={() => show(i)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
