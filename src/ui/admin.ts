import { POIS } from '../data';
import type { Facilities } from '../domain/facilities';
import { nm, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';
import { toast } from './toast';

const TOILETS = POIS.filter((p) => p.category === 'toilets').sort((a, b) => a.id - b.id);

/** Facility-status simulator, shown only with ?admin=1. Collapsed by default. */
export class AdminPanel {
  readonly root: HTMLDetailsElement;
  private select!: HTMLSelectElement;

  constructor(private fac: Facilities) {
    this.root = document.createElement('details');
    this.root.className = 'admin';
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const id = Number(this.select.value);
      if (b.dataset.act === 'toggle') this.fac.toggleMaintenance(id);
      else if (!this.fac.toggleElevatorWorks(id)) toast(t('admin_na'));
    });
    fac.onChange(() => this.fillOptions());
    this.render();
  }

  private label(id: number): string {
    const s = this.fac.status(id);
    return t(s === 'open' ? 'a_open' : s === 'works' ? 'a_works' : 'a_maint');
  }

  private fillOptions() {
    const v = this.select.value;
    this.select.innerHTML = TOILETS.map((p) => `<option value="${p.id}">${esc(nm(p))} — ${esc(this.label(p.id))}</option>`).join('');
    if (v) this.select.value = v;
  }

  render(): void {
    const open = this.root.open;
    const v = this.select?.value;
    this.root.innerHTML = `<summary>${icon('settings', 18)}${esc(t('admin_t'))}</summary>
      <div class="admin-body">
        <select aria-label="${esc(t('admin_pick'))}"></select>
        <div class="admin-row">
          <button type="button" class="btn" data-act="toggle">${esc(t('admin_btn'))}</button>
          <button type="button" class="btn ghost" data-act="works">${esc(t('admin_works'))}</button>
        </div>
        <p>${esc(t('admin_note'))}</p>
      </div>`;
    this.select = this.root.querySelector('select')!;
    this.fillOptions();
    if (v) this.select.value = v;
    this.root.open = open;
  }
}
