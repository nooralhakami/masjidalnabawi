import { FLOORS } from '../../data-next/floors';
import { floor } from '../../state/store';
import { useI18n } from '../i18n';

/** The building floor's interface label key (the Authority's short codes B1/B2 stay as they are). */
const LABEL: Record<number, string> = { 24: 'floor_roof', 12: 'floor_ground', 11: 'floor_plaza', 94: 'floor_b1', 95: 'floor_b2' };

/**
 * The building-floor switcher (Phase 1, plan §4.2): the five verified floors, top to bottom — the
 * Roof, the Mosque's ground floor, the Plaza, and the car park's B1 and B2. Choosing one shows that
 * floor's verified lift and escalator landings on the map and sets the floor a cross-floor route
 * aims at. Distinct from the car park's A/B driving toggle. Each button is a 44 px touch target.
 */
export function BuildingFloors() {
  const { t } = useI18n();
  const active = floor.value;
  return (
    <div class="building-floors" role="group" aria-label={t('floors_title')}>
      {FLOORS.map((f) => {
        const name = t(LABEL[f.id]);
        return (
          <button
            key={f.id}
            type="button"
            class="bf-btn"
            data-floor={f.id}
            aria-pressed={f.id === active}
            aria-label={name}
            title={name}
            onClick={() => {
              floor.value = f.id;
            }}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
