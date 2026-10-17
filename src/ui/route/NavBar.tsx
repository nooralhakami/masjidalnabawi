import { STATE_LABEL, navKnown, type NavView } from '../../presentation/route-view';
import { Button } from '../kit/Button';
import { Count } from '../kit/Count';
import { Icon } from '../kit/Icon';
import { useI18n } from '../i18n';
import { StepBanner } from '../sheet/StepBanner';

export interface NavBarProps {
  s: NavView;
  /** The car park level of the route, for the step banner's edge. */
  level?: 'A' | 'B';
  onFollow(): void;
  onEnd(): void;
  onKeep(): void;
}

/**
 * Live navigation, just above the sheet (SPEC N7, F6; the live app's .navigation-status): minutes
 * and metres left, how the tracking is going, «تتبّعني», the car park step, and the progress. On
 * arrival: «وصلت إلى وجهتك» with «إنهاء التتبع» and «متابعة».
 */
export function NavBar({ s, level, onFollow, onEnd, onKeep }: NavBarProps) {
  const { t } = useI18n();
  if (s.state === 'arrived')
    return (
      <div class="nav-bar is-arrived" data-state="arrived" role="status" aria-live="polite">
        <span class="nav-arrived">
          <span class="nav-arrived-ic" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          {t('nav_arrived')}
        </span>
        <div class="nav-arrived-actions">
          <Button class="nav-end" onClick={onEnd}>
            {t('nav_arrived_end')}
          </Button>
          <Button variant="secondary" class="nav-keep" onClick={onKeep}>
            {t('nav_arrived_keep')}
          </Button>
        </div>
      </div>
    );
  const known = navKnown(s);
  const label = s.state === 'low-accuracy' ? `${t('nav_low')} · ${t('nav_acc', { m: Math.round(s.accuracy) })}` : t(STATE_LABEL[s.state]);
  const warn = s.state === 'off-route' || s.state === 'signal-lost' || s.state === 'error' || s.state === 'away' || s.state === 'low-accuracy';
  return (
    <div class="nav-bar" data-state={s.state} role="status" aria-live="polite">
      <div class="nav-row">
        {known ? (
          <span class="nav-counts">
            <span class="nav-big">
              <Count value={s.remainingMinutes} />
              <small> {t('dur_m', { m: '' }).trim()}</small>
            </span>
            <span class="nav-big nav-m">
              <Count value={Math.round(s.remainingMeters / 5) * 5} />
              <small> {t('meters', { m: '' }).trim()}</small>
            </span>
          </span>
        ) : null}
        <strong class={`nav-label${warn ? ' is-warn' : ''}`}>{label}</strong>
        <button type="button" class="nav-follow" aria-pressed={s.follow} aria-label={t(s.follow ? 'nav_unfollow' : 'nav_follow')} title={t(s.follow ? 'nav_unfollow' : 'nav_follow')} onClick={onFollow}>
          <Icon name="locate" size={18} />
          <span>{t(s.follow ? 'nav_unfollow' : 'nav_follow')}</span>
        </button>
      </div>
      {s.step ? <StepBanner step={s.step} level={level} /> : null}
      {known ? (
        <span class="nav-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.progress}>
          <span style={{ inlineSize: `${s.progress}%` }} />
        </span>
      ) : null}
    </div>
  );
}
