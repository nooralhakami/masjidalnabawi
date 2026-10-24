import type { StepView } from '../../presentation/route-view';
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../kit/Icon';

const ICON: Record<NonNullable<StepView['now']>['kind'], IconName> = {
  n: 'arrowleft',
  e: 'arrowleft',
  s: 'arrowleft',
  w: 'arrowleft',
  up: 'arrowleft',
  down: 'arrowleft',
  lot_in: 'parking',
  lot_out: 'parking',
};
/** The arrow turns to the compass point (screen up = north); ramps point the way of travel. */
const TURN: Record<string, number> = { n: 90, e: 180, s: 270, w: 0, up: 90, down: 270 };

/**
 * Inside the car park: the step now with the metres left in it, and «then: …» under it (the live
 * app's wording, keys g_step_* and g_then). The edge takes the level's colour on the ramps.
 */
export function StepBanner({ step, level }: { step: StepView; level?: 'A' | 'B' }) {
  const { t } = useI18n();
  const text = (kind: string) => (kind === 'lot_in' || kind === 'lot_out' ? t(`g_step_${kind}`, { n: step.lot ?? '' }) : t(`g_step_${kind}`));
  const now = step.now;
  const tone = now?.kind === 'up' ? 'level-a' : now?.kind === 'down' ? 'level-b' : level === 'A' ? 'level-a' : 'level-b';
  return (
    <div class={`step-banner tone-${tone}`} role="status" aria-live="polite">
      {now ? (
        <span class="step-ic" style={{ transform: TURN[now.kind] !== undefined ? `rotate(${TURN[now.kind]}deg)` : undefined }}>
          <Icon name={ICON[now.kind]} size={22} />
        </span>
      ) : null}
      <span class="step-text">
        {now ? (
          <b>
            {text(now.kind)} · {t('meters', { m: now.meters })}
          </b>
        ) : null}
        {step.next ? (
          <small>
            {t('g_then')}: {text(step.next.kind)}
            {step.next.meters !== null ? ` · ${t('meters', { m: step.next.meters })}` : ''}
          </small>
        ) : null}
      </span>
    </div>
  );
}
