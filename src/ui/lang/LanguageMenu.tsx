import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LangCode } from '../../data/types';
import { LANGS, MORE_LANGS, pack } from '../../i18n';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

export interface LanguageMenuProps {
  current: LangCode;
  onPick(l: LangCode): void;
  onClose(): void;
}

/**
 * The language menu (SPEC F8; the live app's lang-menu.ts): Arabic and English first with the other
 * widespread languages, then an arrow that unfolds the less widespread ones. It opens unfolded when
 * the current language is one of those. Each name is written in its own language and direction.
 * It takes the room left below it on screen, so it fits from 320 to 412 px (CLAUDE.md lesson).
 */
export function LanguageMenu({ current, onPick, onClose }: LanguageMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(MORE_LANGS.has(current));
  const menu = useRef<HTMLUListElement>(null);
  const arrow = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    const el = menu.current!;
    el.style.maxHeight = `${Math.max(160, innerHeight - el.getBoundingClientRect().top - 12)}px`;
    (el.querySelector<HTMLElement>('[aria-current="true"]') ?? el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => !(e.target as HTMLElement).closest('#lang-menu, .lang-btn') && onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const item = (c: LangCode, more: boolean) => (
    <li key={c} class={more ? 'lang-more-item' : undefined} hidden={more && !open}>
      <button type="button" data-lang={c} lang={c} dir={pack(c).dir} aria-current={c === current} onClick={() => onPick(c)}>
        <span>{pack(c).n}</span>
        <small>{pack(c).short}</small>
      </button>
    </li>
  );
  return (
    <ul class="lang-menu" id="lang-menu" ref={menu} aria-label={t('lang_title')}>
      {LANGS.filter((c) => !MORE_LANGS.has(c)).map((c) => item(c, false))}
      <li class="lang-more" ref={arrow}>
        <button
          type="button"
          class="lang-more-btn"
          aria-expanded={open}
          aria-label={t('lang_more')}
          title={t('lang_more')}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next)
              requestAnimationFrame(() => {
                // Scroll the menu (not the page) so the unfolded languages fill it, just under the arrow.
                menu.current!.scrollTop = arrow.current!.offsetTop - 6;
                menu.current!.querySelector<HTMLElement>('.lang-more-item button')?.focus({ preventScroll: true });
              });
          }}
        >
          <Icon name="chevdown" size={18} />
        </button>
      </li>
      {LANGS.filter((c) => MORE_LANGS.has(c)).map((c) => item(c, true))}
    </ul>
  );
}
