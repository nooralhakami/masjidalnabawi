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

/** Floating card for Gate 37 shown when no sheet is open; refreshes every 30 s. */
export class RawdahCard {
  readonly root: HTMLButtonElement;

  constructor(onOpen: () => void) {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.className = 'rawdah-card';
    this.root.addEventListener('click', onOpen);
    this.render();
    window.setInterval(() => this.render(), 30_000);
  }

  render(): void {
    this.root.innerHTML = `<span class="tile">${icon('dome', 24)}</span>
      <span style="flex:1;min-width:0"><span class="rawdah-title">${esc(t('ro_title'))} · ${esc(t('gate_n', { id: 37 }))}</span>
      <span class="rawdah-meta">${rawdahNowHtml()}</span></span>
      <span class="flip" style="color:var(--muted)">${icon('chevleft', 20)}</span>`;
  }
}
