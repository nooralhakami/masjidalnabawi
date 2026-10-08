import { rawdahState, splitDuration } from '../domain/rawdah';
import { t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';

/** "2 س 5 د" / "45 د" */
export function durationText(minutes: number): string {
  const { h, m } = splitDuration(minutes);
  return h ? t('dur_hm', { h, m }) : t('dur_m', { m });
}

/** Live "now: women/men · switches in …" pill + schedule line. */
export function rawdahNowHtml(now = new Date()): string {
  const s = rawdahState(now);
  const who = t(s.turn === 'women' ? 'ro_women' : 'ro_men');
  return `<span class="turn ${s.turn}"><span class="dot"></span>${esc(t('ro_now', { who }))}</span><span>${esc(t('ro_switch', { t: durationText(s.minutesLeft) }))}</span>`;
}

/**
 * Floating card for Gate 37 shown when no sheet is open; refreshes every 30 s.
 * In the women's turn it also says that Gate 37 needs a Nusuk permit, and offers a second card for
 * the area behind the Rawdah (entered from Gate 21, no permit) that selects that entrance on the map.
 */
export class RawdahCard {
  readonly root: HTMLDivElement;
  private card: HTMLButtonElement;
  private behind: HTMLButtonElement;

  constructor(onOpen: () => void, onBehind: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'rawdah-stack';
    this.card = document.createElement('button');
    this.card.type = 'button';
    this.card.className = 'rawdah-card';
    this.card.addEventListener('click', onOpen);
    this.behind = document.createElement('button');
    this.behind.type = 'button';
    this.behind.className = 'rawdah-behind';
    this.behind.addEventListener('click', onBehind);
    this.root.append(this.card, this.behind);
    this.render();
    window.setInterval(() => this.render(), 30_000);
  }

  render(): void {
    const s = rawdahState();
    const women = s.turn === 'women';
    const c = women ? 'var(--cat-women)' : 'var(--cat-men)';
    const permit = women ? `<span class="rawdah-permit">${icon('lock', 13)}${esc(t('ro_permit'))}</span>` : '';
    this.card.innerHTML = `<span class="tile">${icon('dome', 24)}</span>
      <span style="flex:1;min-width:0"><span class="rawdah-title">${esc(t('ro_title'))} · ${esc(t('gate_n', { id: 37 }))}</span>
      <span class="rawdah-meta">${rawdahNowHtml()}</span>${permit}</span>
      <span class="flip" style="color:var(--muted)">${icon('chevleft', 20)}</span>
      <span class="rawdah-progress" style="--c:${c}" aria-hidden="true"><span style="width:${Math.round(s.progress * 100)}%"></span></span>`;
    this.behind.hidden = !women;
    this.behind.innerHTML = `<span class="tile">${icon('women', 20)}</span>
      <span style="flex:1;min-width:0"><span class="rawdah-title">${esc(t('ro_behind'))}</span>
      <span class="rawdah-free">${icon('check', 13)}${esc(t('ro_no_permit'))}</span></span>
      <span class="flip" style="color:var(--muted)">${icon('chevleft', 20)}</span>`;
  }
}
