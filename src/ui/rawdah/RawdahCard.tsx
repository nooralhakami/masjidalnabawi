import { splitDuration, type RawdahState } from '../../domain/rawdah';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';
import { Ring } from '../kit/Ring';

/**
 * The Rawdah, live: a ring with the time left in the current turn, «now: women's/men's time ·
 * switches in …». In the women's turn: Gate 37 needs a Nusuk permit, and a second card leads to
 * the area behind the Rawdah (Gate 21, no permit). Texts are the live app's (ro_* keys, R5).
 */
export function RawdahCard({ state, onOpen, onBehind }: { state: RawdahState; onOpen(): void; onBehind(): void }) {
  const { t } = useI18n();
  const women = state.turn === 'women';
  const color = women ? 'var(--cat-women)' : 'var(--cat-men)';
  const { h, m } = splitDuration(state.minutesLeft);
  const left = h ? t('dur_hm', { h, m }) : t('dur_m', { m });
  return (
    <div class="rawdah-stack">
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
  );
}
