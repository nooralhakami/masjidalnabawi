import { useEffect, useState } from 'preact/hooks';
import { POIS } from '../../data';
import type { Facilities } from '../../domain/facilities';
import { CAR_ENTRANCES } from '../../data-next/car-entrances';
import { entranceOpen, toggleEntrance } from '../../state/entrances';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

const TOILETS = POIS.filter((p) => p.category === 'toilets').sort((a, b) => a.id - b.id);

/**
 * The facility-status simulator (SPEC F11; the live app's ui/admin.ts), shown only after the password
 * (AdminGate: «ADMIN» in the search box, or ?admin=1)
 * and folded by default: mark a restroom «maintenance» or «lift works». Lift works in a women's
 * restroom close its pair with it. The change stays on this device, in this page.
 */
export function AdminPanel({ fac, onNotApplicable }: { fac: Facilities; onNotApplicable(): void }) {
  const { t, nm } = useI18n();
  const [id, setId] = useState(TOILETS[0]?.id ?? 0);
  const [, setTick] = useState(0);
  useEffect(() => fac.onChange(() => setTick((n) => n + 1)), [fac]);
  const label = (x: number) => {
    const s = fac.status(x);
    return t(s === 'open' ? 'a_open' : s === 'works' ? 'a_works' : 'a_maint');
  };
  return (
    <details class="admin">
      <summary>
        <Icon name="settings" size={18} />
        {t('admin_t')}
      </summary>
      <div class="admin-body">
        <select aria-label={t('admin_pick')} value={String(id)} onChange={(e) => setId(Number(e.currentTarget.value))}>
          {TOILETS.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {nm(p)} — {label(p.id)}
            </option>
          ))}
        </select>
        <div class="admin-row">
          <button type="button" class="btn btn-primary" data-act="toggle" onClick={() => fac.toggleMaintenance(id)}>
            <span class="btn-label">{t('admin_btn')}</span>
          </button>
          <button type="button" class="btn btn-ghost" data-act="works" onClick={() => fac.toggleElevatorWorks(id) || onNotApplicable()}>
            <span class="btn-label">{t('admin_works')}</span>
          </button>
        </div>
        <p>{t('admin_note')}</p>
        {/* The new vehicle entrances (owner, 2026-10-16): closed until opened here. */}
        <h3 class="admin-sub">{t('ent_title')}</h3>
        {CAR_ENTRANCES.map((e) => {
          const open = entranceOpen.value[e.id];
          return (
            <div class="admin-ent" key={e.id}>
              <span>
                {t(e.name)} — <strong class={open ? 'is-open' : 'is-closed'}>{open ? t('a_open') : t('ent_closed')}</strong>
              </span>
              <button type="button" class="btn btn-ghost" data-ent={e.id} aria-pressed={open} onClick={() => toggleEntrance(e.id)}>
                <span class="btn-label">{t('admin_btn')}</span>
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
