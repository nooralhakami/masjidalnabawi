import type { LangCode } from '../data/types';
import { LANGS, MORE_LANGS, pack, t } from '../i18n';
import { esc } from './dom';
import { icon } from './icons';

const item = (c: LangCode, current: LangCode, more: boolean, open: boolean): string =>
  `<li${more ? ` class="lang-more-item"${open ? '' : ' hidden'}` : ''}><button type="button" data-lang="${c}" lang="${c}" dir="${pack(c).dir}" aria-current="${c === current}">${esc(pack(c).n)}<small>${pack(c).short}</small></button></li>`;

/**
 * Items of the language menu (map header and landing page): the main languages, then an arrow
 * that unfolds the less widespread ones. Opens unfolded when the current language is one of them.
 */
export function langMenuItems(current: LangCode): string {
  const open = MORE_LANGS.has(current);
  const main = LANGS.filter((c) => !MORE_LANGS.has(c)).map((c) => item(c, current, false, open));
  const more = LANGS.filter((c) => MORE_LANGS.has(c)).map((c) => item(c, current, true, open));
  const label = esc(t('lang_more'));
  const arrow = `<li class="lang-more"><button type="button" class="lang-more-btn" aria-expanded="${open}" aria-label="${label}" title="${label}">${icon('chevdown', 18)}</button></li>`;
  return [...main, arrow, ...more].join('');
}

/** Unfold/fold the less widespread languages when the arrow is tapped (delegated, bind once per menu element). */
export function bindLangMore(menu: HTMLElement): void {
  menu.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.lang-more-btn');
    if (!btn) return;
    e.stopPropagation();
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    const items = menu.querySelectorAll<HTMLElement>('.lang-more-item');
    items.forEach((li) => (li.hidden = !open));
    if (open) {
      // Scroll the menu (not the page) so the unfolded languages fill it, just under the arrow.
      const li = btn.closest('li')!;
      menu.scrollTop = li.offsetTop - 6;
      items[0]?.querySelector('button')?.focus({ preventScroll: true });
    }
  });
}
