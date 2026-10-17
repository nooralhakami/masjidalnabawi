import { useEffect, useRef, useState } from 'preact/hooks';
import type { Poi } from '../../data/types';
import type { Status } from '../../data/types';
import { isClosed } from '../../domain/facilities';
import { groupResults, highlight, MAX_RESULTS, shownOrder } from '../../presentation/search-view';
import { isAdminWord } from '../../state/admin';
import { forgetRecent, query, recent, remember, typed } from '../../state/store';
import { tNext } from '../../i18n-next/strings';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';
import { PlaceBadge } from '../sheet/PlaceCard';
import { SearchBar, SearchPanel } from '../shell/SearchBar';

/** The live app waits this long after the last key before searching (ui/header.ts). */
export const SEARCH_DELAY_MS = 200;

export interface SearchAreaProps {
  /** Every place matching a query, best first (the live app's visiblePois with the query). */
  rank(q: string): Poi[];
  status(id: number): Status | undefined;
  onPick(p: Poi): void;
  dark: boolean;
  onTheme(): void;
  contrast?: boolean;
  onContrast?(): void;
  onShare?(): void;
  /** How many places the map shows now (under the guide's name). */
  count?: number;
  /** The language button (its short name) and what it opens. */
  langShort?: string;
  onLang?(): void;
  /** «ADMIN» typed exactly: the one row offered opens the supervisor's password (owner, 2026-10-16). */
  onAdmin?(): void;
}

/**
 * Search (SPEC F2, N12): results as you type (after 200 ms, as the live app), grouped by kind, the
 * typed part highlighted; ↑ ↓ to move, Enter picks (the first by default), Esc clears, then leaves.
 * Back in a box with words already in it, the results show again without typing (owner,
 * 2026-10-14). With an empty box, the recent searches (this device only).
 */
export function SearchArea({ rank, status, onPick, dark, onTheme, contrast, onContrast, onShare, count, langShort, onLang, onAdmin }: SearchAreaProps) {
  const { t, nm, dirName } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const value = typed.value;
  const q = query.value;
  const ranked = q.trim() ? rank(q) : [];
  const groups = groupResults(ranked);
  const rows = shownOrder(groups);
  const showRecent = open && !value.trim() && recent.value.length > 0;
  const adminAsked = open && !!onAdmin && isAdminWord(value);
  const showResults = !adminAsked && open && !!q.trim() && value.trim() !== '';
  const expanded = showRecent || showResults || adminAsked;

  useEffect(() => setActive(0), [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (v: string) => {
    typed.value = v;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => (query.value = v), SEARCH_DELAY_MS);
    setOpen(true);
  };
  const flush = () => {
    clearTimeout(timer.current);
    query.value = typed.value;
  };
  const clear = () => {
    clearTimeout(timer.current);
    typed.value = '';
    query.value = '';
  };
  const pick = (p: Poi) => {
    remember(typed.value);
    setOpen(false);
    input.current?.blur();
    onPick(p);
  };
  const reopen = () => {
    if (typed.value.trim() && query.value !== typed.value) flush();
    setOpen(true);
  };

  const toAdmin = () => {
    clear();
    setOpen(false);
    input.current?.blur();
    onAdmin?.();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && onAdmin && isAdminWord(typed.value)) {
      e.preventDefault();
      toAdmin();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      const n = rows.length;
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter acts on what was typed, without waiting for the pause.
      flush();
      const now = shownOrder(groupResults(typed.value.trim() ? rank(typed.value) : []));
      const p = now[Math.min(active, now.length - 1)] ?? now[0];
      if (p) pick(p);
    } else if (e.key === 'Escape') {
      if (typed.value) clear();
      else {
        setOpen(false);
        input.current?.blur();
      }
    }
  };

  const activeRow = showResults ? rows[active] : undefined;
  return (
    <SearchBar
      value={value}
      onInput={set}
      onClear={() => {
        clear();
        input.current?.focus();
      }}
      dark={dark}
      onTheme={onTheme}
      contrast={contrast}
      onContrast={onContrast}
      onShare={onShare}
      count={count}
      langShort={langShort}
      onLang={onLang}
      expanded={expanded}
      inputRef={input}
      inputProps={{
        'aria-controls': 'search-results',
        'aria-activedescendant': adminAsked ? 'res-admin' : activeRow ? `res-${activeRow.id}` : undefined,
        onKeyDown,
        onFocus: reopen,
        onClick: reopen,
        // Leaving the box closes the panel — after a pick has had its click.
        onBlur: () => window.setTimeout(() => document.activeElement !== input.current && setOpen(false), 150),
      }}
    >
      {showRecent ? (
        <SearchPanel
          state="recent"
          id="search-results"
          head={
            <span class="search-head-row">
              <span>{t('recent_title')}</span>
              <button type="button" class="search-head-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => forgetRecent()}>
                {t('recent_clear')}
              </button>
            </span>
          }
        >
          {recent.value.map((r) => (
            <button type="button" role="option" aria-selected={false} class="search-row" key={r} onMouseDown={(e) => e.preventDefault()} onClick={() => (set(r), flush())}>
              <span class="search-row-ic">
                <Icon name="clock" size={18} />
              </span>
              <span class="search-row-text">
                <span class="search-row-name">{r}</span>
              </span>
            </button>
          ))}
        </SearchPanel>
      ) : null}
      {adminAsked ? (
        <SearchPanel state="results" id="search-results" head={t('admin_t')}>
          <button type="button" role="option" id="res-admin" aria-selected={true} class="search-row search-admin" onMouseDown={(e) => e.preventDefault()} onClick={toAdmin}>
            <span class="search-row-ic">
              <Icon name="settings" size={18} />
            </span>
            <span class="search-row-text">
              <span class="search-row-name">{tNext('admin_enter')}</span>
            </span>
          </button>
        </SearchPanel>
      ) : null}
      {showResults ? (
        rows.length ? (
          <SearchPanel
            state="results"
            id="search-results"
            head={
              <span class="search-head-row">
                <span>{t('results')}</span>
                <span class="search-count">{ranked.length > MAX_RESULTS ? t('res_more', { n: MAX_RESULTS, total: ranked.length }) : ranked.length}</span>
              </span>
            }
          >
            {groups.map((g) => (
              <div class="search-group" role="group" aria-label={t(g.label)} key={g.label}>
                <div class="search-group-k">{t(g.label)}</div>
                {g.items.map((p) => {
                  const name = nm(p);
                  const h = highlight(name, value);
                  const i = rows.indexOf(p);
                  return (
                    <button
                      type="button"
                      role="option"
                      id={`res-${p.id}`}
                      aria-selected={i === active}
                      class="search-row"
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()}
                      // Only a pointer that moves picks a row: a panel opening under a resting pointer must not change what Enter opens.
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => pick(p)}
                    >
                      <PlaceBadge p={p} closed={isClosed(status(p.id))} size={36} />
                      <span class="search-row-text">
                        <span class="search-row-name">{h ? [h[0], <mark key="m">{h[1]}</mark>, h[2]] : name}</span>
                        <span class="search-row-meta">{t('side', { d: dirName(p.direction) })}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </SearchPanel>
        ) : (
          <SearchPanel state="empty" id="search-results" />
        )
      ) : null}
    </SearchBar>
  );
}
