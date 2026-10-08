import { FILTERS, PARKING_SUBS, TOILET_SUBS, type FilterId, type ParkingSub, type ToiletSub } from '../domain/filters';
import { t } from '../i18n';
import { esc } from './dom';
import { icon, type IconName } from './icons';

const LOOK: Record<FilterId, [IconName, string]> = {
  all: ['grid', 'var(--green-700)'],
  gates: ['gate', 'var(--dir-south)'],
  women: ['women', 'var(--cat-women)'],
  toilets: ['toilets', 'var(--cat-men)'],
  hotels: ['hotel', 'var(--cat-hotel)'],
  food: ['food', 'var(--cat-food)'],
  shopping: ['bag', 'var(--cat-shop)'],
  landmarks: ['landmark', 'var(--cat-land)'],
  historic: ['historic', 'var(--cat-hist)'],
  wheelchair: ['cart', 'var(--cat-acc)'],
  parking: ['parking', 'var(--cat-men)'],
  emergency: ['emergency', 'var(--cat-emg)'],
};

/** Horizontally scrollable filter pills, plus the restroom status sub-pills. */
export class Pills {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private sub: HTMLElement;
  private hidden = false;
  private parkingSub: ParkingSub = 'all';

  constructor(
    private filter: FilterId,
    private toiletSub: ToiletSub,
    private onChange: (f: FilterId, s: ToiletSub, hidden: boolean, parkingSub: ParkingSub) => void,
    /** How many places each pill shows (displayed as a small count). */
    private counts: () => Partial<Record<FilterId, number>> = () => ({}),
  ) {
    this.root = document.createElement('div');
    this.root.innerHTML = '<nav class="pills" id="pills"></nav><div class="subpills" id="subpills" role="group" hidden></div>';
    this.bar = this.root.querySelector('#pills')!;
    this.sub = this.root.querySelector('#subpills')!;
    this.bar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const visibility = target.closest<HTMLElement>('[data-visibility]');
      if (visibility) {
        this.hidden = !this.hidden;
        this.render();
        this.onChange(this.filter, this.toiletSub, this.hidden, this.parkingSub);
        return;
      }
      const b = target.closest<HTMLElement>('[data-f]');
      if (!b) return;
      this.filter = b.dataset.f as FilterId;
      if (this.filter !== 'toilets') this.toiletSub = 'all';
      if (this.filter !== 'parking') this.parkingSub = 'all';
      this.hidden = false;
      this.render();
      b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      this.onChange(this.filter, this.toiletSub, this.hidden, this.parkingSub);
    });
    this.sub.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!b) return;
      if (this.filter === 'parking') this.parkingSub = b.dataset.s as ParkingSub;
      else this.toiletSub = b.dataset.s as ToiletSub;
      this.hidden = false;
      this.render();
      this.onChange(this.filter, this.toiletSub, this.hidden, this.parkingSub);
    });
    this.render();
  }

  render(): void {
    this.bar.setAttribute('aria-label', t('filters'));
    const filters = FILTERS.map(({ id, label }) => {
      const [ic, c] = LOOK[id];
      const n = this.counts()[id];
      return `<button type="button" class="pill" data-f="${id}" aria-pressed="${id === this.filter}" style="--c:${c}"><span class="pill-ic">${icon(ic, 15)}</span>${esc(t(label))}${n !== undefined ? `<span class="pill-n">${n}</span>` : ''}</button>`;
    }).join('');
    const visibility = `<button type="button" class="pill visibility-pill" data-visibility aria-pressed="${this.hidden}" aria-label="${esc(t(this.hidden ? 'markers_show' : 'markers_hide'))}" title="${esc(t(this.hidden ? 'markers_show' : 'markers_hide'))}">${icon('eye-off', 16)}</button>`;
    this.bar.innerHTML = filters + visibility;
    this.sub.hidden = this.filter !== 'toilets' && this.filter !== 'parking';
    this.sub.setAttribute('aria-label', t(this.filter === 'parking' ? 'parking_filter' : 'toilet_filter'));
    const subs = this.filter === 'parking' ? PARKING_SUBS : TOILET_SUBS;
    const active = this.filter === 'parking' ? this.parkingSub : this.toiletSub;
    this.sub.innerHTML = subs.map(
      ({ id, label }) => `<button type="button" class="subpill" data-s="${id}" aria-pressed="${id === active}">${esc(t(label))}</button>`,
    ).join('');
  }
}
