/*
 * /design — the internal gallery of the design system (dev server only; never in the production
 * build, see vite.config.ts). Every component in each of its states, Arabic (RTL) and English
 * (LTR) side by side, light or dark.
 *
 *   ?theme=light|dark   ?langs=ar,en   ?w=412 (column width)   ?only=<section id>
 *
 * The gallery's own section titles and state captions are developer-facing English; the
 * components themselves only show text from i18n, in the column's language.
 */
import { render, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import '../styles/fonts';
import '../styles/index.css';
import './design.css';
import { POIS, POI_BY_ID } from '../data';
import type { LangCode } from '../data/types';
import { Facilities } from '../domain/facilities';
import { FILTERS, type FilterId, type ParkingSub, type ToiletSub } from '../domain/filters';
import { rawdahState } from '../domain/rawdah';
import { search } from '../domain/search';
import { visiblePois } from '../domain/visible';
import { isLang, pack } from '../i18n';
import { Button, IconButton } from '../ui/kit/Button';
import { Chip } from '../ui/kit/Chip';
import { PlaceCardSkeleton, Skeleton } from '../ui/kit/Skeleton';
import { Toast } from '../ui/kit/Toast';
import { FloorSwitch, TravelToggle, type Level, type Travel } from '../ui/kit/TravelToggle';
import { LangContext, useI18n } from '../ui/i18n';
import { BottomSheet } from '../ui/sheet/BottomSheet';
import { PlaceBadge, PlaceCard } from '../ui/sheet/PlaceCard';
import type { Detent } from '../ui/sheet/physics';
import { StepBanner } from '../ui/sheet/StepBanner';
import { CategoryRow } from '../ui/shell/CategoryRow';
import { SearchBar, SearchPanel } from '../ui/shell/SearchBar';
import { RawdahCard } from '../ui/rawdah/RawdahCard';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
const langs = (q.get('langs') ?? 'ar,en').split(',').filter(isLang) as LangCode[];
const width = Number(q.get('w')) || 412;
const only = q.get('only');
/** ?fit=1: one column filling the window (the audit measures overflow at phone widths). */
const fit = q.get('fit') === '1';
document.documentElement.dataset.theme = theme;

const P = (id: number) => POI_BY_ID.get(id)!;
const noop = () => {};

/** Places in states that show every part of the card (all from data/, nothing invented). */
const FAC = new Facilities();
FAC.toggleMaintenance(212);
FAC.toggleElevatorWorks(215); // women's lift works: closes 216 with it (R1)
const COUNTS = Object.fromEntries(FILTERS.map(({ id }) => [id, visiblePois(id, 'all', '', new Facilities(), undefined, id === 'parking' ? 'all' : undefined).length])) as Record<
  FilterId,
  number
>;
const WOMEN_TURN = rawdahState(new Date('2026-10-16T05:00:00Z'));
const MEN_TURN = rawdahState(new Date('2026-10-16T12:00:00Z'));

function Section({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  if (only && only !== id) return null;
  return (
    <section class="g-section" id={id} data-section={id}>
      <h3 class="g-h" lang="en" dir="ltr">
        {title}
      </h3>
      {children}
    </section>
  );
}

function State({ name, children, wide }: { name: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <figure class={`g-state${wide ? ' is-wide' : ''}`}>
      {children}
      <figcaption lang="en" dir="ltr">
        {name}
      </figcaption>
    </figure>
  );
}

function Swatches() {
  const names = ['bg', 'surface', 'surface-2', 'field', 'line-strong', 'outline', 'ink', 'muted', 'heading', 'accent', 'focus', 'gold-500', 'danger', 'success', 'warn'];
  const cats = [
    'cat-men',
    'cat-women',
    'cat-acc',
    'cat-hotel',
    'cat-food',
    'cat-land',
    'cat-emg',
    'cat-shop',
    'cat-hist',
    'cat-park-sub',
    'cat-gray',
    'route-walk',
    'route-drive',
    'route-level-a',
    'route-level-b',
  ];
  return (
    <>
      <div class="g-swatches">
        {names.map((n) => (
          <span class="g-swatch" key={n}>
            <span style={{ background: `var(--${n})` }} />
            <code>{n}</code>
          </span>
        ))}
      </div>
      <div class="g-swatches">
        {cats.map((n) => (
          <span class="g-swatch" key={n}>
            <span style={{ background: `var(--${n})` }} />
            <code>{n}</code>
          </span>
        ))}
      </div>
    </>
  );
}

function TypeScale() {
  const { t, nm } = useI18n();
  return (
    <div class="g-type">
      <div style={{ fontSize: 'var(--fs-3xl)', fontFamily: 'var(--font-display)', color: 'var(--heading)', fontWeight: 700 }}>{t('title')}</div>
      <div style={{ fontSize: 'var(--fs-xl)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{nm(P(21))}</div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('ro_title')}</div>
      <div>{t('ph')}</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{t('near_street')} · 215 · 1A · 37</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{t('alt_meta', { m: 120, min: 2 })}</div>
    </div>
  );
}

function Buttons() {
  const { t } = useI18n();
  return (
    <div class="g-grid">
      <State name="primary">
        <Button icon="route">{t('route')}</Button>
      </State>
      <State name="primary · pressed">
        <Button icon="route" class="is-pressed">
          {t('route')}
        </Button>
      </State>
      <State name="primary · focus">
        <Button icon="route" class="is-focus">
          {t('route')}
        </Button>
      </State>
      <State name="primary · disabled">
        <Button icon="route" disabled>
          {t('route')}
        </Button>
      </State>
      <State name="primary · loading">
        <Button loading>{t('locating')}</Button>
      </State>
      <State name="primary · error">
        <div class="g-col">
          <Button icon="route">{t('route')}</Button>
          <span class="g-error" role="alert">
            {t('geo_deny')}
          </span>
        </div>
      </State>
      <State name="secondary">
        <Button variant="secondary">{t('go')}</Button>
      </State>
      <State name="ghost">
        <Button variant="ghost" icon="share">
          {t('share_place')}
        </Button>
      </State>
      <State name="danger">
        <Button variant="danger" icon="close">
          {t('route_end')}
        </Button>
      </State>
      <State name="icon · plain / floating / pressed / focus / disabled" wide>
        <div class="g-row">
          <IconButton icon="close" label={t('l_close')} />
          <IconButton icon="locate" label={t('gps')} floating />
          <IconButton icon="moon" label={t('theme_night')} pressed floating />
          <IconButton icon="layers" label={t('layer_map')} floating class="is-focus" />
          <IconButton icon="plus" label={t('zoom_in')} floating disabled />
        </div>
      </State>
    </div>
  );
}

function Chips() {
  const { t, dirName } = useI18n();
  return (
    <div class="chips">
      <Chip dot="var(--dir-west)">{t('side', { d: dirName('west') })}</Chip>
      <Chip tone="ok" icon="check">
        {t('a_open')}
      </Chip>
      <Chip tone="warn" icon="works">
        {t('maint')}
      </Chip>
      <Chip>{t('num_label', { id: 215 })}</Chip>
      <Chip tone="sub" icon="lock">
        {t('park_sub')}
      </Chip>
      <Chip tone="info">{t('park_public')}</Chip>
      <Chip tone="danger">{t('nores2')}</Chip>
    </div>
  );
}

function Categories() {
  const [filter, setFilter] = useState<FilterId>('all');
  const [hidden, setHidden] = useState(false);
  const [ts, setTs] = useState<ToiletSub>('all');
  const [ps, setPs] = useState<ParkingSub>('all');
  const props = (f: FilterId) => ({
    counts: COUNTS,
    hidden,
    onHidden: setHidden,
    toiletSub: ts,
    parkingSub: ps,
    onSub: (s: string) => (f === 'parking' ? setPs(s as ParkingSub) : setTs(s as ToiletSub)),
  });
  return (
    <div class="g-col g-bleed">
      <State name="interactive (counts from data, via visiblePois)" wide>
        <CategoryRow filter={filter} onFilter={setFilter} {...props(filter)} />
      </State>
      <State name="restrooms chosen · sub-filters" wide>
        <CategoryRow filter="toilets" onFilter={noop} {...props('toilets')} toiletSub="open" />
      </State>
      <State name="car parks chosen · markers hidden" wide>
        <CategoryRow filter="parking" onFilter={noop} {...props('parking')} hidden parkingSub="subscribers" />
      </State>
    </div>
  );
}

function Toggles() {
  const [travel, setTravel] = useState<Travel>('walk');
  const [level, setLevel] = useState<Level>('B');
  return (
    <div class="g-grid">
      <State wide name="interactive (←/→ keys)">
        <div class="g-col">
          <TravelToggle value={travel} onChange={setTravel} />
          {travel === 'drive' ? <FloorSwitch value={level} onChange={setLevel} /> : null}
        </div>
      </State>
      <State wide name="drive · level B">
        <div class="g-col">
          <TravelToggle value="drive" onChange={noop} />
          <FloorSwitch value="B" onChange={noop} />
        </div>
      </State>
      <State wide name="drive · level A">
        <div class="g-col">
          <TravelToggle value="drive" onChange={noop} />
          <FloorSwitch value="A" onChange={noop} />
        </div>
      </State>
      <State wide name="disabled">
        <TravelToggle value="walk" onChange={noop} disabled />
      </State>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function Searches() {
  const { lang, nm, t, dirName } = useI18n();
  const short = pack(lang).short;
  const [value, setValue] = useState('');
  const rows = (query: string) =>
    search(POIS, query)
      .slice(0, 3)
      .map((p, i) => (
        <button type="button" role="option" aria-selected={i === 0} class="search-row" key={p.id}>
          <PlaceBadge p={p} size={36} />
          <span class="search-row-text">
            <span class="search-row-name">
              <Highlight text={nm(p)} query={query} />
            </span>
            <span class="search-row-meta">{t('side', { d: dirName(p.direction) })}</span>
          </span>
        </button>
      ));
  return (
    <div class="g-col g-bleed">
      <State name="interactive · empty" wide>
        <SearchBar value={value} onInput={setValue} onClear={() => setValue('')} langShort={short} onLang={noop} dark={theme === 'dark'} onTheme={noop} />
      </State>
      <State name="typed «215» · results, the match highlighted" wide>
        <SearchBar value="215" onInput={noop} onClear={noop} langShort={short} onLang={noop} dark={theme === 'dark'} onTheme={noop} expanded>
          <SearchPanel state="results">{rows('215')}</SearchPanel>
        </SearchBar>
      </State>
      <State name="loading" wide>
        <SearchBar value="Al Baik" onInput={noop} onClear={noop} langShort={short} onLang={noop} dark={theme === 'dark'} onTheme={noop} expanded>
          <SearchPanel state="loading">
            {[0, 1].map((k) => (
              <div class="search-row" key={k}>
                <Skeleton width={36} height={36} round />
                <span class="search-row-text" style={{ flex: 1, gap: '6px' }}>
                  <Skeleton width="60%" />
                  <Skeleton width="30%" height={10} />
                </span>
              </div>
            ))}
          </SearchPanel>
        </SearchBar>
      </State>
      <State name="no results (error state)" wide>
        <SearchBar value="zzzzqq" onInput={noop} onClear={noop} langShort={short} onLang={noop} dark={theme === 'dark'} onTheme={noop} expanded>
          <SearchPanel state="empty" />
        </SearchBar>
      </State>
    </div>
  );
}

function SheetDemo() {
  const { t, nm } = useI18n();
  const [detent, setDetent] = useState<Detent>('half');
  const [travel, setTravel] = useState<Travel>('walk');
  const [level, setLevel] = useState<Level>('B');
  return (
    <div class="g-col">
      <div class="g-row" lang="en" dir="ltr">
        {(['closed', 'peek', 'half', 'full'] as Detent[]).map((d) => (
          <button type="button" class={`g-chipbtn${d === detent ? ' is-on' : ''}`} key={d} onClick={() => setDetent(d)}>
            {d}
          </button>
        ))}
      </div>
      <div class="g-phone" style={{ height: '640px' }}>
        <div class="g-map" aria-hidden="true" />
        <BottomSheet detent={detent} onDetent={setDetent} label={nm(P(215))} extra={travel === 'drive' ? 120 : 64}>
          <PlaceCard
            p={P(215)}
            fac={FAC}
            travel={travel}
            level={level}
            onTravel={setTravel}
            onLevel={setLevel}
            onRoute={noop}
            onShare={noop}
            onClose={() => setDetent('closed')}
            onGo={noop}
          />
        </BottomSheet>
      </div>
      <p class="g-note" lang="en" dir="ltr">
        Drag the handle or the card header. A flick moves one detent; a slow drag stops at the nearest. ↑/↓ on the handle, Esc closes. ({t('sheet_label')})
      </p>
    </div>
  );
}

function Cards() {
  const [travel, setTravel] = useState<Travel>('drive');
  const [level, setLevel] = useState<Level>('A');
  const card = (id: number, extra: Partial<Parameters<typeof PlaceCard>[0]> = {}) => (
    <div class="g-card">
      <PlaceCard
        p={P(id)}
        fac={FAC}
        travel="walk"
        level="B"
        onTravel={noop}
        onLevel={noop}
        onRoute={noop}
        onShare={noop}
        onClose={noop}
        onGo={noop}
        now={new Date('2026-10-16T05:00:00Z')}
        {...extra}
      />
    </div>
  );
  return (
    <div class="g-grid g-cards">
      <State name="women's restroom 215 · lift works (closes 216 with it)">{card(215)}</State>
      <State name="restroom 212 · closed for maintenance → nearest open alternative">{card(212)}</State>
      <State name="named gate 21 · the story of its name">{card(21)}</State>
      <State name="car park 2 · subscribers only · by car, level A">{card(902, { travel, level, onTravel: setTravel, onLevel: setLevel })}</State>
      <State name="Gate 37 · the Rawdah schedule · route button busy">{card(37, { routing: true })}</State>
      <State name="loading">
        <div class="g-card">
          <PlaceCardSkeleton label="…" />
        </div>
      </State>
    </div>
  );
}

function Rawdah() {
  return (
    <div class="g-grid">
      <State wide name="women's turn (05:00 UTC): Nusuk permit + behind the Rawdah, Gate 21">
        <RawdahCard state={WOMEN_TURN} onOpen={noop} onBehind={noop} />
      </State>
      <State wide name="men's turn (12:00 UTC): no permit line, no second card">
        <RawdahCard state={MEN_TURN} onOpen={noop} onBehind={noop} />
      </State>
    </div>
  );
}

function Steps() {
  return (
    <div class="g-grid">
      <State name="in the car park: the step now, then the next">
        <StepBanner step={{ now: { kind: 'e', meters: 375 }, next: { kind: 'up', meters: null }, lot: 9 }} level="B" />
      </State>
      <State name="on the yellow ramp up to level A">
        <StepBanner step={{ now: { kind: 'up', meters: 40 }, next: { kind: 'lot_in', meters: null }, lot: 9 }} level="A" />
      </State>
      <State name="just before the car park: «then: …» with the metres">
        <StepBanner step={{ now: null, next: { kind: 'e', meters: 80 }, lot: 9 }} />
      </State>
    </div>
  );
}

function Toasts() {
  const { t } = useI18n();
  return (
    <div class="g-col">
      <Toast>{t('locating')}</Toast>
      <Toast tone="ok" icon="check">
        {t('place_link_copied')}
      </Toast>
      <Toast tone="error" icon="info">
        {t('geo_deny')}
      </Toast>
    </div>
  );
}

function Column({ lang }: { lang: LangCode }) {
  return (
    <LangContext.Provider value={lang}>
      <div class="g-column" lang={lang} dir={pack(lang).dir} style={{ width: fit ? '100%' : `${width}px` }}>
        <div class="g-colhead" lang="en" dir="ltr">
          {pack(lang).n} · {pack(lang).dir.toUpperCase()} · {theme}
        </div>
        <Section id="colours" title="Colours (tokens)">
          <Swatches />
        </Section>
        <Section id="type" title="Type scale">
          <TypeScale />
        </Section>
        <Section id="buttons" title="Buttons">
          <Buttons />
        </Section>
        <Section id="chips" title="Chips">
          <Chips />
        </Section>
        <Section id="categories" title="Category row · sub-filters">
          <Categories />
        </Section>
        <Section id="toggles" title="Walk / drive toggle · level switch">
          <Toggles />
        </Section>
        <Section id="search" title="Search bar">
          <Searches />
        </Section>
        <Section id="sheet" title="Bottom sheet (3 detents + closed)">
          <SheetDemo />
        </Section>
        <Section id="cards" title="Place card">
          <Cards />
        </Section>
        <Section id="rawdah" title="Rawdah card">
          <Rawdah />
        </Section>
        <Section id="steps" title="Step banner (car park)">
          <Steps />
        </Section>
        <Section id="toasts" title="Toast">
          <Toasts />
        </Section>
        <Section id="skeletons" title="Skeletons">
          <div class="g-card">
            <PlaceCardSkeleton label="…" />
          </div>
        </Section>
      </div>
    </LangContext.Provider>
  );
}

function Gallery() {
  return (
    <main class={`g-main${fit ? ' is-fit' : ''}`}>
      {langs.map((l) => (
        <Column key={l} lang={l} />
      ))}
    </main>
  );
}

render(<Gallery />, document.getElementById('app')!);
