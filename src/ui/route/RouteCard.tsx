import type { Poi } from '../../data/types';
import { num } from '../../i18n';
import type { RouteSummary } from '../../presentation/route-view';
import { Button, IconButton } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { useI18n } from '../i18n';
import { PlaceBadge } from '../sheet/PlaceCard';

const DIR_VAR = { south: 'var(--dir-south)', west: 'var(--dir-west)', north: 'var(--dir-north)', east: 'var(--dir-east)' } as const;
const round5 = (m: number) => Math.round(m / 5) * 5;

export interface RouteCardProps {
  p: Poi;
  r: RouteSummary;
  closed?: boolean;
  onClose(): void;
  onEnd(): void;
  /** By car to a lot: the way out of the car park, and back to the way in. */
  onWayOut(): void;
  onWayIn(): void;
}

/**
 * The sheet while a route is followed (SPEC N7, the live app's route mode): a slim summary so most
 * of the map stays visible — where to, metres · minutes · side; by car the legs (drive, entrance or
 * exit, lot and level, walk), the yellow-edge legend on level A and the east-side note; then the way
 * out (or in) and «إنهاء المسار».
 */
export function RouteCard({ p, r, closed = false, onClose, onEnd, onWayOut, onWayIn }: RouteCardProps) {
  const { t, nm, dirName } = useI18n();
  const d = r.drive;
  return (
    <article class="route-card" aria-label={nm(p)}>
      <header class="rc-head" data-sheet-drag>
        <PlaceBadge p={p} closed={closed} size={40} />
        <div class="rc-titles">
          <div class="pc-kicker">{t(d?.exit ? 'r_title_exit' : d ? 'r_title_drive' : 'r_title')}</div>
          <h2 class="pc-title rc-title" tabIndex={-1}>
            {nm(p)}
          </h2>
        </div>
        <IconButton icon="close" label={t('l_close')} onClick={onClose} />
      </header>

      <div class="route-box" role="status">
        <div class="route-stats" data-peek-end>
          <span class="rs">
            <span class="sr-only">{t('r_dist')}: </span>
            <span class="rs-v">{t('meters', { m: num(round5(r.meters)) })}</span>
          </span>
          <span class="rs">
            <span class="sr-only">{t(d ? 'r_time_total' : 'r_time')}: </span>
            <span class="rs-v">{t('r_min', { t: r.minutes })}</span>
          </span>
          <span class="rs rs-side">
            <span class="rs-dot" style={{ '--c': DIR_VAR[p.direction] }} aria-hidden="true" />
            <span class="sr-only">{t('side', { d: '' }).trim()}: </span>
            {dirName(p.direction)}
          </span>
        </div>
        {r.nearestEntrance ? <div class="route-nearest">{t('park_nearest', { n: r.nearestEntrance })}</div> : null}
        {d ? (
          <div class="route-legs">
            {d.meters > 5 ? (
              <span class="leg leg-drive">
                <Icon name="car" size={16} />
                {t('r_drive')} · {t('km', { k: (d.meters / 1000).toFixed(1) })}
              </span>
            ) : null}
            {d.entrance ? <span class="leg leg-ent">{d.entrance === 'qurban' ? t('g_in_qurban') : t(d.entrance === 'omar' ? 'g_in_omar' : 'g_in_sultana')}</span> : null}
            {d.exit ? <span class="leg leg-ent">{d.exit === 'qurban' ? t('g_out_qurban') : t(d.exit === 'omar' ? 'g_out_omar' : 'g_out_sultana')}</span> : null}
            {d.carPark ? <span class="leg leg-ent">{t('g_public_parking')}</span> : null}
            {d.lot ? <span class="leg leg-lot">{d.level ? t('r_lot_level', { n: d.lot, l: d.level }) : t('r_lot', { n: d.lot })}</span> : null}
            {d.walkMeters > 5 ? (
              <span class="leg leg-walk">
                <Icon name="walk" size={16} />
                {t('r_walk')} · {t('meters', { m: num(round5(d.walkMeters)) })}
              </span>
            ) : null}
          </div>
        ) : null}
        {d?.level === 'A' && d.meters > 5 ? (
          <div class="route-legend">
            <span class="route-legend-swatch" aria-hidden="true" />
            {t('g_legend_a')}
          </div>
        ) : null}
        {d?.unsure ? <div class="route-unsure">{t('g_unsure')}</div> : null}
      </div>

      <footer class="rc-foot">
        {d?.lot ? (
          d.exit ? (
            <Button variant="secondary" icon="car" class="rc-wayin" onClick={onWayIn}>
              {t('g_way_in')}
            </Button>
          ) : (
            <Button variant="secondary" icon="car" class="rc-wayout" onClick={onWayOut}>
              {t('g_way_out')}
            </Button>
          )
        ) : null}
        <Button variant="danger" block icon="close" class="rc-end" onClick={onEnd}>
          {t('route_end')}
        </Button>
      </footer>
    </article>
  );
}
