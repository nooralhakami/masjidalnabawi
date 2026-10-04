import { FILTERS, TOILET_SUBS, type FilterId, type ToiletSub } from '../domain/filters';
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
  landmarks: ['landmark', 'var(--cat-land)'],
  wheelchair: ['cart', 'var(--cat-acc)'],
  parking: ['parking', 'var(--cat-men)'],
  emergency: ['emergency', 'var(--cat-emg)'],
};

/** Horizontally scrollable filter pills, plus the restroom status sub-pills. */
export class Pills {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private sub: HTMLElement;

  constructor(
    private filter: FilterId,
    private toiletSub: ToiletSub,
    private onChange: (f: FilterId, s: ToiletSub) => void,
  ) {
    this.root = document.createElement('div');
    this.root.innerHTML = '<nav class="pills" id="pills"></nav><div class="subpills" id="subpills" role="group" hidden></div>';
    this.bar = this.root.querySelector('#pills')!;
    this.sub = this.root.querySelector('#subpills')!;
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]');
      if (!b) return;
      this.filter = b.dataset.f as FilterId;
      if (this.filter !== 'toilets') this.toiletSub = 'all';
      this.render();
      b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      this.onChange(this.filter, this.toiletSub);
    });
    this.sub.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!b) return;
      this.toiletSub = b.dataset.s as ToiletSub;
      this.render();
      this.onChange(this.filter, this.toiletSub);
    });
    this.render();
  }

  render(): void {
    this.bar.setAttribute('aria-label', t('filters'));
    this.bar.innerHTML = FILTERS.map(({ id, label }) => {
      const [ic, c] = LOOK[id];
      return `<button type="button" class="pill" data-f="${id}" aria-pressed="${id === this.filter}" style="--c:${c}">${icon(ic, 17)}${esc(t(label))}</button>`;
    }).join('');
    this.sub.hidden = this.filter !== 'toilets';
    this.sub.setAttribute('aria-label', t('toilet_filter'));
    this.sub.innerHTML = TOILET_SUBS.map(
      ({ id, label }) => `<button type="button" class="subpill" data-s="${id}" aria-pressed="${id === this.toiletSub}">${esc(t(label))}</button>`,
    ).join('');
  }
}
