import type { FilterId, ParkingSub, ToiletSub } from '../../domain/filters';
import { FILTERS, PARKING_SUBS, TOILET_SUBS } from '../../domain/filters';
import { Icon, type IconName } from '../kit/Icon';
import { useI18n } from '../i18n';

/**
 * The pills' order on the map (owner, 2026-10-17): historic sites and car parks right after the
 * restrooms. domain/filters.ts (the live app's, ported as is) keeps its own order; only the row
 * shows them in this one.
 */
export const PILL_ORDER: readonly FilterId[] = ['all', 'gates', 'women', 'toilets', 'historic', 'parking', 'hotels', 'food', 'shopping', 'landmarks', 'emergency'];
const PILLS = PILL_ORDER.map((id) => FILTERS.find((f) => f.id === id)!).filter(Boolean);

/** Icon and colour of each filter pill (as in the live app's ui/pills.ts). */
export const FILTER_LOOK: Record<FilterId, [IconName, string]> = {
  all: ['grid', 'var(--green-700)'],
  gates: ['gate', 'var(--dir-south)'],
  women: ['women', 'var(--cat-women)'],
  toilets: ['toilets', 'var(--cat-men)'],
  hotels: ['hotel', 'var(--cat-hotel)'],
  food: ['food', 'var(--cat-food)'],
  shopping: ['bag', 'var(--cat-shop)'],
  landmarks: ['landmark', 'var(--cat-land)'],
  historic: ['historic', 'var(--cat-hist)'],
  parking: ['parking', 'var(--cat-men)'],
  emergency: ['emergency', 'var(--cat-emg)'],
};

/** One filter: icon in its colour, name, and how many places it shows. */
export function CategoryButton({ id, label, count, selected, onPick }: { id: FilterId; label: string; count?: number; selected: boolean; onPick(id: FilterId): void }) {
  const [ic, color] = FILTER_LOOK[id];
  return (
    <button type="button" class="cat-btn" aria-pressed={selected} style={{ '--c': color }} onClick={() => onPick(id)}>
      <span class="cat-ic">
        <Icon name={ic} size={16} />
      </span>
      <span class="cat-label">{label}</span>
      {count !== undefined ? <span class="cat-n">{count}</span> : null}
    </button>
  );
}

/**
 * The scrollable row of filters, the «hide markers» switch at its end, and the sub-filters for
 * restrooms (all / open / closed) and car parks (all / public / subscribers) under it.
 */
export function CategoryRow({
  filter,
  counts,
  onFilter,
  hidden,
  onHidden,
  toiletSub,
  parkingSub,
  onSub,
}: {
  filter: FilterId;
  counts: Partial<Record<FilterId, number>>;
  onFilter(f: FilterId): void;
  hidden: boolean;
  onHidden(h: boolean): void;
  toiletSub: ToiletSub;
  parkingSub: ParkingSub;
  onSub(s: ToiletSub | ParkingSub): void;
}) {
  const { t } = useI18n();
  const subs = filter === 'parking' ? PARKING_SUBS : filter === 'toilets' ? TOILET_SUBS : null;
  const active = filter === 'parking' ? parkingSub : toiletSub;
  return (
    <div class="cat-wrap">
      <nav class="cat-row" aria-label={t('filters')}>
        {PILLS.map(({ id, label }) => (
          <CategoryButton key={id} id={id} label={t(label)} count={counts[id]} selected={id === filter} onPick={onFilter} />
        ))}
        <button
          type="button"
          class="cat-btn cat-eye"
          aria-pressed={hidden}
          aria-label={t(hidden ? 'markers_show' : 'markers_hide')}
          title={t(hidden ? 'markers_show' : 'markers_hide')}
          onClick={() => onHidden(!hidden)}
        >
          <Icon name="eye-off" size={18} />
        </button>
      </nav>
      {subs ? (
        <div class="segmented" role="group" aria-label={t(filter === 'parking' ? 'parking_filter' : 'toilet_filter')}>
          {subs.map(({ id, label }) => (
            <button key={id} type="button" class="seg" aria-pressed={id === active} onClick={() => onSub(id)}>
              {t(label)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
