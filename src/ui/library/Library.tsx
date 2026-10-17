import './library.css';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { sourceLines, type LibFact, type ShownCompanion, type ShownPlace } from '../../domain/library';
import { COMPANION_DATA, COMPANIONS, MOSQUE_DATA, MOSQUE_PLACES } from '../../domain/mosque-places';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

type Sources = Record<string, { t: string; u?: string }>;
type Entry = { kind: 'place'; item: ShownPlace } | { kind: 'companion'; item: ShownCompanion };

/** Groups of companions, in the order of the plan's list (the live app's ui/library.ts). */
const GROUPS = ['ten', 'mothers', 'family', 'early', 'ansar', 'scholars', 'leaders'] as const;
type Show = 'all' | 'places' | (typeof GROUPS)[number];

/** Keep the ﷺ sign from wrapping alone onto a line. */
const sal = (s: string): string => s.replace(/\s*ﷺ/g, ' ﷺ');

function find(id: string): Entry | null {
  const p = MOSQUE_PLACES.find((x) => x.id === id);
  if (p) return { kind: 'place', item: p };
  const c = COMPANIONS.find((x) => x.id === id);
  return c ? { kind: 'companion', item: c } : null;
}

export interface LibraryProps {
  /** Open straight on one place or companion (`?lib=ID`). */
  start?: string;
  onClose(): void;
}

/**
 * The library (SPEC N11; the live app's ui/library.ts): the landmarks of the Prophet's Mosque and
 * the companions, as cards in a grid that can be narrowed to one group, then one entry at a time.
 * The texts are Arabic (no guessed translations; a line says so in other languages); the labels
 * follow the visitor's language. While an entry is not approved by a named reviewer, the notice
 * stays at the top. Each paragraph lists its sources under it; a fact still waiting for a second
 * source is never shown (domain/library.ts, ported). Loaded only when opened (its own chunk).
 */
export function Library({ start, onClose }: LibraryProps) {
  const { t, lang } = useI18n();
  const [current, setCurrent] = useState<Entry | null>(() => (start ? find(start) : null));
  const [show, setShow] = useState<Show>('all');
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    root.current?.querySelector('.lib-body')?.scrollTo({ top: 0 });
    root.current?.querySelector<HTMLElement>(current ? '[data-act="back"]' : '[data-act="close"]')?.focus({ preventScroll: true });
  }, [current]);

  const unreviewed = current ? !current.item.reviewed : [...MOSQUE_PLACES, ...COMPANIONS].some((x) => !x.reviewed);

  const fact = (f: LibFact, sources: Sources, k: number) => (
    <div class="lib-fact" key={k}>
      {f.title ? (
        <h4 lang="ar" dir="rtl">
          {sal(f.title)}
        </h4>
      ) : null}
      <p lang="ar" dir="rtl">
        {sal(f.ar)}
      </p>
      <details class="lib-src">
        <summary>{t('lib_sources')}</summary>
        <ul lang="ar" dir="rtl">
          {sourceLines(f, sources).map((s, i) => (
            <li key={i}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.text}
                </a>
              ) : (
                s.text
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );

  const item = (id: string, name: string, kind: 'place' | 'companion') => (
    <li key={id}>
      <button type="button" class="lib-item" data-act="open" data-id={id} onClick={() => setCurrent(find(id))}>
        <span class="lib-item-ic" aria-hidden="true">
          <Icon name={kind === 'place' ? 'dome' : 'book'} size={20} />
        </span>
        <span class="lib-item-name" lang="ar" dir="rtl">
          {sal(name)}
        </span>
        <Icon name="chevleft" size={18} flip />
      </button>
    </li>
  );

  const list = () => {
    const groups = GROUPS.filter((g) => COMPANIONS.some((c) => c.group === g));
    const other = COMPANIONS.filter((c) => !(GROUPS as readonly string[]).includes(c.group));
    const chip = (id: Show, label: string) => (
      <button type="button" key={id} class="lib-chip" aria-pressed={show === id} onClick={() => setShow(id)}>
        {label}
      </button>
    );
    return (
      <>
        <nav class="lib-chips" aria-label={t('lib_title')}>
          {chip('all', t('p_all'))}
          {MOSQUE_PLACES.length ? chip('places', t('lib_open')) : null}
          {groups.map((g) => chip(g, t(`lib_grp_${g}`)))}
        </nav>
        {MOSQUE_PLACES.length && (show === 'all' || show === 'places') ? (
          <>
            <h3>{t('lib_open')}</h3>
            <ul class="lib-list">{MOSQUE_PLACES.map((p) => item(p.id, p.name, 'place'))}</ul>
          </>
        ) : null}
        {COMPANIONS.length && show !== 'places' ? (
          <>
            {show === 'all' ? <h3 class="lib-part">{t('lib_tab_companions')}</h3> : null}
            {groups
              .filter((g) => show === 'all' || show === g)
              .map((g) => (
                <section key={g}>
                  <h4 class="lib-group">{t(`lib_grp_${g}`)}</h4>
                  <ul class="lib-list">{COMPANIONS.filter((c) => c.group === g).map((c) => item(c.id, c.name, 'companion'))}</ul>
                </section>
              ))}
            {show === 'all' && other.length ? <ul class="lib-list">{other.map((c) => item(c.id, c.name, 'companion'))}</ul> : null}
          </>
        ) : null}
      </>
    );
  };

  const detail = (e: Entry) =>
    e.kind === 'place' ? (
      <>
        {e.item.where ? (
          <>
            <h3>{t('lib_where')}</h3>
            {fact(e.item.where, MOSQUE_DATA.sources, 0)}
          </>
        ) : null}
        {e.item.story.length ? (
          <>
            <h3>{t('lib_story')}</h3>
            {e.item.story.map((f, i) => fact(f, MOSQUE_DATA.sources, i + 1))}
          </>
        ) : null}
      </>
    ) : (
      e.item.fields.map((x) => (
        <section key={x.field}>
          <h3>{t(`lib_f_${x.field}`)}</h3>
          {x.facts.map((f, i) => fact(f, COMPANION_DATA.sources, i))}
        </section>
      ))
    );

  return (
    <section
      ref={root}
      class="library"
      role="dialog"
      aria-modal="true"
      aria-label={t('lib_title')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (current) setCurrent(null);
        else onClose();
      }}
    >
      <header class="lib-head">
        {current ? (
          <button type="button" class="lib-icon" data-act="back" aria-label={t('lib_back')} onClick={() => setCurrent(null)}>
            {/* Back points to the start of the line: mirrored right to left (the live app's .lib-back). */}
            <span class="lib-back">
              <Icon name="arrowleft" size={20} />
            </span>
          </button>
        ) : null}
        <h2 {...(current ? { lang: 'ar', dir: 'rtl' } : {})}>{current ? sal(current.item.name) : t('lib_title')}</h2>
        <button type="button" class="lib-icon" data-act="close" aria-label={t('l_close')} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <div class="lib-body">
        {unreviewed ? (
          <p class="lib-notice" role="note">
            <Icon name="info" size={18} />
            <span>{t('lib_unreviewed')}</span>
          </p>
        ) : null}
        {lang === 'ar' ? null : <p class="lib-lang">{t('lib_ar_only')}</p>}
        {current ? detail(current) : list()}
      </div>
    </section>
  );
}
