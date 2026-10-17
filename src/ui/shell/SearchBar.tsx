import type { ComponentChildren, Ref } from 'preact';
import type { JSX } from 'preact';
import { brandStar } from '../../presentation/icons';
import { Icon } from '../kit/Icon';
import { IconButton } from '../kit/Button';
import { tNext } from '../../i18n-next/strings';
import { useI18n } from '../i18n';

/**
 * The top card of the map (the live app's header, kept by the owner's choice, 2026-10-16): on the
 * first row the brand, the guide's name with the city and how many places show, then the theme,
 * home and share buttons, and the language; on the second row the search field across the card,
 * with sun mode (high contrast) beside it. Room under it for the results panel.
 */
export function SearchBar({
  value,
  onInput,
  onClear,
  langShort,
  onLang,
  dark,
  onTheme,
  contrast = false,
  onContrast,
  onShare,
  count,
  expanded = false,
  inputRef,
  inputProps,
  children,
}: {
  value: string;
  onInput(v: string): void;
  onClear(): void;
  /** The language button: its short name, and what it opens. */
  langShort?: string;
  onLang?(): void;
  dark: boolean;
  onTheme(): void;
  /** Sun mode: stronger text and lines for bright sunlight. */
  contrast?: boolean;
  onContrast?(): void;
  onShare?(): void;
  /** How many places the map shows now («303 معلم» under the name). */
  count?: number;
  expanded?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Keyboard, focus and ARIA wiring from the search panel. */
  inputProps?: Omit<JSX.HTMLAttributes<HTMLInputElement>, 'value' | 'onInput'>;
  children?: ComponentChildren;
}) {
  const { t } = useI18n();
  return (
    <div class="search" role="search">
      <div class="top-card">
        <div class="top-row">
          <span class="top-brand" aria-hidden="true" dangerouslySetInnerHTML={{ __html: brandStar(24) }} />
          <div class="top-titles">
            <h1 class="top-title">{t('title')}</h1>
            <div class="top-sub">
              <span class="top-city">
                {t('city')}
                {count !== undefined ? ' · ' : null}
              </span>
              {count !== undefined ? t('cnt', { n: count }) : null}
            </div>
          </div>
          <div class="quick" role="group">
            <button type="button" class="quick-btn theme-btn" aria-label={t(dark ? 'theme_day' : 'theme_night')} title={t(dark ? 'theme_day' : 'theme_night')} aria-pressed={dark} onClick={onTheme}>
              <Icon name={dark ? 'sun' : 'moon'} size={18} />
            </button>
            {/* Back to the landing page (the live app's header button «go_home»). */}
            <a class="quick-btn home-btn" href="./" aria-label={t('go_home')} title={t('go_home')}>
              <Icon name="home" size={18} />
            </a>
            {onShare ? (
              <button type="button" class="quick-btn" aria-label={t('share_app')} title={t('share_app')} onClick={onShare}>
                <Icon name="share" size={18} />
              </button>
            ) : null}
          </div>
          {langShort && onLang ? (
            <button type="button" class="lang-btn" id="lang-btn" aria-haspopup="true" aria-controls="lang-menu" aria-label={t('lang_title')} title={t('lang_title')} onClick={onLang}>
              <Icon name="globe" size={18} />
              <span>{langShort}</span>
              <span class="lang-chev">
                <Icon name="chevdown" size={14} />
              </span>
            </button>
          ) : null}
        </div>
        <div class="search-bar">
          <label class="search-field">
            <Icon name="search" />
            <span class="sr-only">{t('ph')}</span>
            <input
              ref={inputRef}
              type="search"
              autocomplete="off"
              enterkeyhint="search"
              role="combobox"
              aria-expanded={expanded}
              aria-autocomplete="list"
              aria-label={t('ph')}
              placeholder={t('ph')}
              {...inputProps}
              value={value}
              onInput={(e) => onInput(e.currentTarget.value)}
            />
            {value ? <IconButton icon="close" label={t('clear')} class="search-clear" onClick={onClear} /> : null}
          </label>
          {onContrast ? (
            <button type="button" class="icon-btn contrast-btn" aria-label={tNext('contrast_more')} title={tNext('contrast_more')} aria-pressed={contrast} onClick={onContrast}>
              {/* The usual contrast sign: a circle half filled. */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/** The panel under the search bar: a heading, then results, or loading rows, or «no results». */
export function SearchPanel({ state, id, head, children }: { state: 'results' | 'loading' | 'empty' | 'recent'; id?: string; head?: ComponentChildren; children?: ComponentChildren }) {
  const { t } = useI18n();
  return (
    <div class="search-panel" id={id} role="listbox" aria-busy={state === 'loading' ? true : undefined}>
      {state === 'empty' ? (
        <div class="search-empty" role="status">
          <Icon name="search" size={22} />
          <span>{t('nores2')}</span>
        </div>
      ) : (
        <>
          <div class="search-head">{head ?? t('results')}</div>
          {children}
        </>
      )}
    </div>
  );
}
