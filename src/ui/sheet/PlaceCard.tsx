import type { Poi } from '../../data/types';
import { elevatorBadge, isClosed, pairOf, type Facilities } from '../../domain/facilities';
import { nearestOuterGate } from '../../domain/nearby';
import { lotLevels } from '../../domain/parking';
import { rawdahState } from '../../domain/rawdah';
import { num } from '../../i18n';
import { lookOf } from '../../presentation/markers';
import { kindLabel } from '../../presentation/search-view';
import { Button, IconButton } from '../kit/Button';
import { Chip } from '../kit/Chip';
import { Icon } from '../kit/Icon';
import { FloorSwitch, TravelToggle, type Level, type Travel } from '../kit/TravelToggle';
import { useI18n } from '../i18n';

const WALK_M_PER_MIN = 80;

/** The colour of a place's category; closed places are grey (and carry a dark glyph, DESIGN §1-e). */
export function placeColor(p: Poi, closed: boolean): string {
  if (closed) return 'var(--cat-gray)';
  const c = lookOf(p).color;
  return c === 'mixed' ? 'var(--cat-women)' : c;
}

/** The round icon of a place, in its category colour. */
export function PlaceBadge({ p, closed = false, size = 48 }: { p: Poi; closed?: boolean; size?: number }) {
  return (
    <span class={`pc-badge${closed ? ' is-closed' : ''}`} style={{ '--c': placeColor(p, closed), width: `${size}px`, height: `${size}px` }}>
      <Icon name={lookOf(p).icon} size={Math.round(size * 0.52)} />
    </span>
  );
}

export interface PlaceCardProps {
  p: Poi;
  fac: Facilities;
  travel: Travel;
  level: Level;
  onTravel(t: Travel): void;
  onLevel(l: Level): void;
  onRoute(): void;
  onShare(): void;
  onClose(): void;
  onGo(p: Poi): void;
  /** The route button is busy (asking for the location, planning). */
  routing?: boolean;
  now?: Date;
}

/**
 * A place's card in the sheet (SPEC N5), with the live app's content and rules (ui/sheet.ts):
 * category, name, description or the story of a gate's name; side, status, number, access and lift
 * chips; why it is closed and the nearest open alternative; the Rawdah schedule; nearest gate and
 * street; then walking/driving, the car park level, «route from my location» and share.
 */
export function PlaceCard({ p, fac, travel, level, onTravel, onLevel, onRoute, onShare, onClose, onGo, routing, now }: PlaceCardProps) {
  const { t, nm, ds, dirName, streetName } = useI18n();
  // A lot on one level only (12 and 13, on B): the switch shows it and cannot change.
  const one = p.category === 'parking' ? lotLevels(p) : [];
  const oneLevel = one.length === 1 ? one[0] : null;
  const status = fac.status(p.id);
  const closed = isClosed(status);
  const named = p.subCategory === 'gate_inner' && p.name_ar !== `باب رقم ${p.id}`;
  const eb = elevatorBadge(p);
  const pair = p.category === 'toilets' ? pairOf(p) : undefined;
  const alt = closed ? fac.nearestOpen(p) : null;
  const gate = nearestOuterGate(p);
  const by = status === 'works' ? fac.worksBy(p.id) : undefined;
  return (
    <article class="place-card" aria-label={nm(p)} style={{ '--c': placeColor(p, closed) }}>
      <header class="pc-head" data-sheet-drag>
        <PlaceBadge p={p} closed={closed} />
        <div class="pc-titles">
          <div class="pc-kicker">{t(kindLabel(p))}</div>
          <h2 class="pc-title" tabIndex={-1}>
            {nm(p)}
          </h2>
        </div>
        <IconButton icon="close" label={t('l_close')} onClick={onClose} />
      </header>

      {named ? (
        <div class="pc-about">
          <div class="pc-about-k">{t('gate_about')}</div>
          <p>{ds(p)}</p>
        </div>
      ) : (
        <p class="pc-desc">{ds(p)}</p>
      )}

      <div class="chips">
        <Chip dot={`var(--dir-${p.direction})`}>{t('side', { d: dirName(p.direction) })}</Chip>
        {status === 'open' ? (
          <Chip tone="ok" icon="check">
            {t('a_open')}
          </Chip>
        ) : null}
        {status === 'maintenance' ? (
          <Chip tone="warn" icon="works">
            {t('maint')}
          </Chip>
        ) : null}
        {status === 'works' ? (
          <Chip tone="warn" icon="works">
            {t('a_works')}
          </Chip>
        ) : null}
        <Chip>{t('num_label', { id: p.id })}</Chip>
        {p.category === 'parking' ? (
          p.access === 'subscribers' ? (
            <Chip tone="sub" icon="lock">
              {t('park_sub')}
            </Chip>
          ) : (
            <Chip tone="info">{t('park_public')}</Chip>
          )
        ) : null}
        {eb && !closed ? (
          <Chip tone="info" icon="works">
            {t('elev')}
          </Chip>
        ) : null}
      </div>

      {/* Closed: the nearest open one first, in view without dragging the sheet (owner, 2026-10-16). */}
      {alt ? (
        <div class="pc-alt">
          <PlaceBadge p={alt.poi} size={40} />
          <span class="pc-alt-text">
            <span class="pc-alt-k">{t('alt_title')}</span>
            <span class="pc-alt-n">{nm(alt.poi)}</span>
            <span class="pc-alt-m">{t('alt_meta', { m: num(alt.meters), min: Math.max(1, Math.round(alt.meters / WALK_M_PER_MIN)) })}</span>
          </span>
          <Button variant="secondary" onClick={() => onGo(alt.poi)}>
            {t('go')}
          </Button>
        </div>
      ) : null}

      {status === 'works' || status === 'maintenance' ? (
        <div class="pc-notice" role="note">
          <div>
            <Icon name="works" />
            <span>{status === 'maintenance' ? t('maint') : by ? t('works_p', { id: by }) : t('works')}</span>
          </div>
          {status === 'works' && !by && eb === 'elev_w' ? (
            <div>
              <Icon name="clock" />
              <span>{t('elev_w')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {pair && by !== pair.id ? (
        <div class="pc-note">
          <Icon name="link" size={18} />
          <span>{t('pair', { id: pair.id })}</span>
        </div>
      ) : null}

      {p.rawdah ? <RawdahSchedule now={now} /> : null}

      <dl class="pc-facts">
        <div class="pc-fact">
          <dt>
            <Icon name="gate" size={16} />
            {t('near_gate')}
          </dt>
          <dd>{gate ? `${t('gate_n', { id: gate.poi.id })} · ${t('meters', { m: num(gate.meters) })}` : '—'}</dd>
        </div>
        <div class="pc-fact">
          <dt>
            <Icon name="road" size={16} />
            {t('near_street')}
          </dt>
          <dd>{streetName(p.direction)}</dd>
        </div>
      </dl>

      <footer class="pc-foot">
        <TravelToggle value={travel} onChange={onTravel} />
        {travel === 'drive' ? <FloorSwitch value={oneLevel ?? level} onChange={onLevel} disabled={!!oneLevel} /> : null}
        <div class="pc-actions">
          <Button block icon={travel === 'drive' ? 'car' : 'route'} loading={routing} onClick={onRoute}>
            {t('route')}
          </Button>
          <IconButton icon="share" label={t('share_place')} class="pc-share" onClick={onShare} />
        </div>
      </footer>
    </article>
  );
}

/** The Rawdah's live turn and its daily schedule (R5), as in the live app's card. */
function RawdahSchedule({ now }: { now?: Date }) {
  const { t } = useI18n();
  const s = rawdahState(now);
  return (
    <div class="pc-rawdah">
      <span class={`turn turn-${s.turn}`}>{t('ro_now', { who: t(s.turn === 'women' ? 'ro_women' : 'ro_men') })}</span>
      <ul>
        {t('ro_s')
          .split(/\s*·\s*/)
          .map((line) => (
            <li key={line}>{line}</li>
          ))}
      </ul>
    </div>
  );
}
