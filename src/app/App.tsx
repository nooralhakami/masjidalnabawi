import { useComputed, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { POI_BY_ID, RULES } from '../data';
import type { Poi } from '../data/types';
import type { Facilities } from '../domain/facilities';
import { FILTERS, type FilterId, type ParkingSub, type ToiletSub } from '../domain/filters';
import { isTapName } from '../domain/route-hint';
import { visiblePois } from '../domain/visible';
import { getLang, nm, pack, t } from '../i18n';
import { applyLang } from '../i18n/dom';
import { loadLang } from '../i18n/load';
import type { MapEngine } from '../map/engine';
import { isClosed } from '../domain/facilities';
import {
  accessibleRoute,
  filter,
  garageQ,
  headingUp,
  level,
  markersHidden,
  nav,
  notify,
  parkingSub,
  query,
  rawdahH,
  route,
  selected,
  sheet,
  sheetH,
  toast,
  toiletSub,
  travel,
  typed,
  whereQ,
  hintsSeen,
  markHintsSeen,
  searching,
} from '../state/store';
import { HINT_DELAY_MS, showHints, type HintId } from '../presentation/hints';
import { FirstHints, type HintTarget } from '../ui/hints/FirstHints';
import type { NearKind, NearWho } from '../domain/near';
import { NearRow } from '../ui/near/NearRow';
import { tapHaptic } from '../ui/haptic';
import { WhereAsk, WhoAsk } from '../ui/near/NearAsk';
import type { AdminPanel as AdminPanelT } from '../ui/admin/AdminPanel';
import { AdminGate } from '../ui/admin/AdminGate';
import { adminUnlocked } from '../state/admin';
import { LanguageMenu } from '../ui/lang/LanguageMenu';
import type { Library as LibraryT } from '../ui/library/Library';
import { RawdahHost } from '../ui/rawdah/RawdahHost';
import type { StoryViewer as StoryViewerT } from '../ui/stories/StoryViewer';
import { GarageAsk } from '../ui/route/GarageAsk';
import { NavBar } from '../ui/route/NavBar';
import { RouteCard } from '../ui/route/RouteCard';
import type { Trip } from './trip';
import { LangContext } from '../ui/i18n';
import { Toast } from '../ui/kit/Toast';
import { SearchArea } from '../ui/search/SearchArea';
import { BottomSheet } from '../ui/sheet/BottomSheet';
import { PlaceCard } from '../ui/sheet/PlaceCard';
import { detentHeights } from '../ui/sheet/physics';
import { CategoryRow } from '../ui/shell/CategoryRow';
import { applyContrast, applyTheme, currentTheme } from '../ui/theme';
import { listen } from './events';

/** Extra height of the half-open card for its walking/car row, and the level row by car (as the live app). */
const extraFor = (tr: 'walk' | 'drive') => (tr === 'drive' ? 120 : 64);

export interface AppProps {
  engine: MapEngine;
  fac: Facilities;
  /** A place to open as soon as the card is ready (a shared ?poi= link). */
  initial?: Poi;
  /** Routes and live navigation (phase 5). */
  trip: Trip;
  /** A shared story (?visit=) or library entry (?lib=) to open at once; ?admin=1 asks for the supervisor password. */
  initialVisit?: number;
  initialLib?: string;
  admin?: boolean;
}

/** The women's entrance to the area behind the Rawdah, facing Gate 21 (the live app's map/main.ts). */
const BEHIND_RAWDAH_ID = 604;

/**
 * A part loaded only when first needed (stories, library, admin: their own chunks, so the map's
 * first load does not carry them). Returns the component once loaded.
 */
function useLazy<T>(load: () => Promise<T>): [T | null, () => Promise<T>] {
  const [mod, setMod] = useState<T | null>(null);
  const get = async () => {
    const m = await load();
    setMod(() => m);
    return m;
  };
  return [mod, get];
}

/** Everything over the map on map.html (phase 4): search, categories, the place card, notices. */
export function App({ engine, fac, initial, trip, initialVisit, initialLib, admin }: AppProps) {
  const lang = getLang();
  const dark = useSignal(currentTheme() === 'dark');
  const contrast = useSignal(document.documentElement.dataset.contrast === 'more');
  const top = useRef<HTMLDivElement>(null);
  // When the visitor moves the map by hand (and when it rests): the Rawdah card is compact meanwhile.
  const watchMove = useCallback(
    (fn: (moving: boolean) => void) => {
      const start = (e: { originalEvent?: unknown }) => {
        if (e.originalEvent) fn(true);
      };
      const end = () => fn(false);
      engine.map.on('movestart', start);
      engine.map.on('moveend', end);
      return () => {
        engine.map.off('movestart', start);
        engine.map.off('moveend', end);
      };
    },
    [engine],
  );

  // How many places each pill shows (the live app's counts), and what the chosen pill shows now.
  const counts = useComputed(() => {
    const c = Object.fromEntries(FILTERS.map(({ id }) => [id, visiblePois(id, 'all', '', fac, undefined, id === 'parking' ? 'all' : undefined).length])) as Record<
      FilterId,
      number
    >;
    c[filter.value] = visiblePois(filter.value, toiletSub.value, '', fac, undefined, parkingSub.value).length;
    return c;
  });

  const rank = (q: string) => visiblePois(filter.value, toiletSub.value, q, fac, undefined, parkingSub.value);

  /** Open a place's card: the map flies to it when it was chosen from a list or a link (the live app's select()). */
  const [routing, setRouting] = useState(false);
  /** «Men's or women's?», asked on every «nearest restroom» (owner, 2026-11-08; null: dismissed). */
  const [whoQ, setWhoQ] = useState<((w: NearWho | null) => void) | null>(null);
  // The navigation bar's height, so the notices sit above it.
  const navHost = useRef<HTMLDivElement>(null);
  const [navH, setNavH] = useState(0);
  useEffect(() => {
    const el = navHost.current;
    if (!el) return setNavH(0);
    const ro = new ResizeObserver(() => setNavH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!(nav.value || garageQ.value || whereQ.value || whoQ)]);
  const [langOpen, setLangOpen] = useState(false);
  // The stories (at a site) and the library (at an entry, or the list) open full screen.
  const [stories, setStories] = useState<number | null>(null);
  const [library, setLibrary] = useState<string | null | undefined>(undefined);
  const opener = useRef<Element | null>(null);
  const [Stories, loadStories] = useLazy<typeof StoryViewerT>(() => import('../ui/stories/StoryViewer').then((m) => m.StoryViewer));
  const [Lib, loadLib] = useLazy<typeof LibraryT>(() => import('../ui/library/Library').then((m) => m.Library));
  const [Admin, loadAdmin] = useLazy<typeof AdminPanelT>(() => import('../ui/admin/AdminPanel').then((m) => m.AdminPanel));
  // ?admin=1 or «ADMIN» in the search box: the password first (owner, 2026-10-16).
  const [gate, setGate] = useState(!!admin && !adminUnlocked.value);
  const toAdmin = () => (adminUnlocked.value ? void loadAdmin() : setGate(true));
  const openStories = async (site: number) => {
    opener.current = document.activeElement;
    await loadStories();
    setStories(site);
  };
  const openLibrary = async (id?: string) => {
    opener.current = document.activeElement;
    await loadLib();
    setLibrary(id ?? null);
  };
  /** Back to the button that opened the stories or the library. */
  const refocus = () => requestAnimationFrame(() => (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true }));
  // A facility opened or closed (works, maintenance): the card shows it at once (the live app's fac.onChange).
  const [, setFacTick] = useState(0);
  useEffect(() => fac.onChange(() => setFacTick((n) => n + 1)), [fac]);

  /** Where the card grows from (UI plan phase 4): the tapped marker's place across the sheet, in px; null: its middle. */
  const [growX, setGrowX] = useState<number | null>(null);
  const select = (p: Poi, fly: boolean) => {
    // A new destination ends the current walk entirely (GPS watch, wake lock, the bar).
    if (selected.value !== p.id) trip.end();
    // Tapped on the map: the card grows out of the marker. From a list or a link: from the middle.
    if (!fly) {
      const q = engine.map.project([p.lng, p.lat]);
      const box = engine.map.getContainer().getBoundingClientRect();
      const sheetBox = document.querySelector('.sheet')?.getBoundingClientRect();
      setGrowX(Math.round(box.left + q.x - (sheetBox?.left ?? 0)));
    } else setGrowX(null);
    const wasClosed = sheet.value === 'closed';
    selected.value = p.id;
    if (sheet.value !== 'full') sheet.value = 'half';
    const topH = top.current?.getBoundingClientRect().bottom ?? 0;
    const sheetH = detentHeights(innerHeight, { extra: extraFor(travel.value) })[sheet.value === 'full' ? 'half' : sheet.value];
    engine.focus(p.id, { legacyZoom: fly ? Math.max(Math.round(engine.legacyZoom), 19) : undefined, fly, top: topH + 8, bottom: sheetH });
    if (wasClosed) requestAnimationFrame(() => (document.querySelector('.pc-title') as HTMLElement | null)?.focus({ preventScroll: true }));
  };

  /** Close the card. Closing it ends the search too (owner, 2026-10-14): every place comes back. */
  const deselect = () => {
    trip.end();
    selected.value = null;
    sheet.value = 'closed';
    if (typed.value.trim()) {
      typed.value = '';
      query.value = '';
    }
  };

  /** «Route from my location»: the button shows it is busy while the location is asked and the way planned. */
  // A route drawn: the card steps down to a slim strip (name and close), so the map and the route
  // show; dragging it up brings the details (owner, 2026-10-17).
  const hasRoute = !!route.value;
  useEffect(() => {
    if (hasRoute) sheet.value = 'peek';
  }, [hasRoute]);

  const askWho = () => new Promise<NearWho | null>((answer) => setWhoQ(() => answer));
  /** «Near you now»: the nearest open restroom or gate, two ways drawn (UI plan phase 2). */
  const runNear = async (kind: NearKind) => {
    tapHaptic();
    // Asked every time, never remembered (owner, 2026-11-08): one phone is often shared by a family.
    // A gate is the same for everyone, so «nearest gate» asks nothing.
    let who: NearWho | null = 'men';
    if (kind === 'toilet') {
      who = await askWho();
      setWhoQ(null);
      if (!who) return;
    }
    await trip.near(
      kind,
      who,
      (id) => fac.isOpen(id),
      (p) => select(p, false),
    );
  };

  const runRoute = async (p: Poi) => {
    tapHaptic();
    setRouting(true);
    try {
      await trip.draw(p);
    } finally {
      setRouting(false);
    }
  };

  useEffect(() => {
    const onPick = (id: number | null) => {
      const p = id !== null ? POI_BY_ID.get(id) : undefined;
      // On a route, a tap on a gate or a restroom block says its name for two seconds and does not open its card (owner, 2026-10-25).
      if (p && trip.active && isTapName(p)) trip.nameTapped(p.id);
      else if (p) {
        tapHaptic();
        select(p, false);
      }
      // While a route is followed, a stray tap on the map must not end it (use «إنهاء المسار»).
      else if (selected.value !== null && !trip.active) deselect();
    };
    const stop = [
      listen('map-tap', onPick),
      listen('open-place', (p) => select(p, true)),
      listen('stories-request', (at) => void openStories(at ?? 0)),
      listen('library-request', () => void openLibrary()),
      listen('share-app-request', () => void share(new URL('./', location.href).href, t('title'), t('app_link_copied'))),
    ];
    if (initial) select(initial, true);
    if (initialVisit !== undefined) void openStories(initialVisit);
    if (initialLib !== undefined) void openLibrary(initialLib);
    if (adminUnlocked.value) void loadAdmin();
    return () => stop.forEach((f) => f());
  }, []);

  // First-visit hints (UI plan phase 5): a plain first visit only, once the map has drawn. Seen as
  // soon as the first shows, so they never come back, even if the visitor leaves half way.
  const [hints, setHints] = useState(false);
  useEffect(() => {
    if (!showHints({ seen: hintsSeen.value, deepLink: !!initial || initialVisit !== undefined || initialLib !== undefined || !!admin })) return;
    let timer = 0;
    const go = () => (timer = window.setTimeout(() => (markHintsSeen(), setHints(true)), HINT_DELAY_MS));
    // The first time the map rests with everything drawn (its 'load' may be long past by now).
    engine.map.once('idle', go);
    engine.map.triggerRepaint();
    return () => {
      clearTimeout(timer);
      engine.map.off('idle', go);
    };
  }, []);
  const rectOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const hintTarget = (h: HintId): HintTarget | null => {
    if (h !== 'marker') {
      const r = rectOf(h === 'search' ? '.search-field' : '.cat-row');
      return r && r.width ? { x: r.left + r.width / 2, y: r.bottom, side: 'below' } : null;
    }
    // A real marker in the free part of the map, between the categories and the row at the bottom.
    const q = engine.markerOnScreen(rectOf('.cat-wrap')?.bottom ?? 0, rectOf('.rawdah-host')?.top ?? innerHeight);
    return q ? { x: q.x, y: q.y, side: 'above', gap: 16 } : null;
  };

  const share = async (url: string, title: string, copied: string) => {
    try {
      if (navigator.share) await navigator.share({ title, text: title === t('title') ? title : `${title} — ${t('title')}`, url });
      else {
        await navigator.clipboard.writeText(url);
        notify(copied, 'ok');
      }
    } catch {
      // The visitor closed the share sheet, or the clipboard is blocked.
    }
  };

  const place = selected.value !== null ? POI_BY_ID.get(selected.value) : undefined;
  // Anything else on screen ends the hints: they are about the bare map.
  const hintsOn =
    hints &&
    !place &&
    !route.value &&
    !nav.value &&
    !garageQ.value &&
    !whereQ.value &&
    !whoQ &&
    !langOpen &&
    stories === null &&
    library === undefined &&
    !gate &&
    !searching.value;
  useEffect(() => {
    if (hints && !hintsOn) setHints(false);
  }, [hints, hintsOn]);
  const pickFilter = (f: FilterId) => {
    filter.value = f;
    if (f !== 'toilets') toiletSub.value = 'all';
    if (f !== 'parking') parkingSub.value = 'all';
    markersHidden.value = false;
    requestAnimationFrame(() => document.querySelector('.cat-btn[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }));
  };

  return (
    <LangContext.Provider value={lang}>
      <div class="app-top" ref={top}>
        <SearchArea
          rank={rank}
          status={(id) => fac.status(id)}
          onPick={(p) => select(p, true)}
          dark={dark.value}
          onTheme={() => {
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            dark.value = next === 'dark';
            engine.restyle();
          }}
          contrast={contrast.value}
          onContrast={() => {
            applyContrast(!contrast.value);
            contrast.value = !contrast.value;
            engine.restyle();
          }}
          langShort={pack(lang).short}
          onLang={() => setLangOpen(!langOpen)}
          onAdmin={toAdmin}
          count={counts.value[filter.value]}
        />
        {langOpen ? (
          <LanguageMenu
            current={lang}
            onClose={() => setLangOpen(false)}
            onPick={(l) => {
              setLangOpen(false);
              // The whole page follows (map-main redraws the UI and the map's labels).
              // Its texts first (their own file), then the whole page follows.
              if (l !== lang) void loadLang(l).then(() => applyLang(l));
            }}
          />
        ) : null}
        <CategoryRow
          filter={filter.value}
          counts={counts.value}
          onFilter={pickFilter}
          hidden={markersHidden.value}
          onHidden={(h) => (markersHidden.value = h)}
          toiletSub={toiletSub.value}
          parkingSub={parkingSub.value}
          onSub={(s) => {
            if (filter.value === 'parking') parkingSub.value = s as ParkingSub;
            else toiletSub.value = s as ToiletSub;
            markersHidden.value = false;
          }}
        />
      </div>
      <BottomSheet
        detent={place ? sheet.value : 'closed'}
        onDetent={(d) => (d === 'closed' ? deselect() : (sheet.value = d))}
        label={place ? nm(place) : t('sheet_label')}
        extra={extraFor(travel.value)}
        fit={!!route.value}
        onHeight={(h) => (sheetH.value = h)}
      >
        {place ? (
          // The card grows out of the place it is about (UI plan phase 4); a new place grows anew.
          <div class="card-in" key={place.id} style={{ '--from-x': growX === null ? '50%' : `${growX}px` }}>
            {place && route.value ? (
              <RouteCard
                p={place}
                r={route.value}
                closed={isClosed(fac.status(place.id))}
                onClose={deselect}
                onEnd={() => trip.end()}
                onWayOut={() => void trip.wayOut()}
                onWayIn={() => void runRoute(place)}
              />
            ) : place ? (
              <PlaceCard
                p={place}
                fac={fac}
                travel={travel.value}
                level={level.value}
                accessible={accessibleRoute.value}
                onTravel={(v) => (travel.value = v)}
                onLevel={(v) => (level.value = v)}
                onAccessible={(v) => (accessibleRoute.value = v)}
                onRoute={() => void runRoute(place)}
                routing={routing}
                onShare={() => {
                  const url = new URL('./map.html', location.href);
                  url.search = '';
                  url.searchParams.set('poi', String(place.id));
                  void share(url.href, nm(place), t('place_link_copied'));
                }}
                onClose={deselect}
                onGo={(p) => select(p, true)}
              />
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
      {nav.value || garageQ.value || whereQ.value || whoQ ? (
        // The car park question is a modal over the card, from the bottom of the screen (it is too
        // tall to sit above a half-open card on a short phone); the navigation bar sits above the sheet.
        <div
          ref={navHost}
          class={`nav-host${garageQ.value || whereQ.value || whoQ ? ' is-modal' : ''}`}
          style={{ '--sheet-h': `${place && !garageQ.value && !whereQ.value && !whoQ ? sheetH.value : 0}px` }}
        >
          {whoQ ? (
            <WhoAsk onAnswer={whoQ} />
          ) : whereQ.value ? (
            <WhereAsk rough={whereQ.value.rough} onAnswer={whereQ.value.answer} />
          ) : garageQ.value ? (
            <GarageAsk key={garageQ.value.lots.map((l) => l.id).join()} lots={garageQ.value.lots} spot={garageQ.value.spot} onAnswer={garageQ.value.answer} />
          ) : nav.value ? (
            <NavBar
              s={nav.value}
              level={route.value?.drive?.level}
              onFollow={() => trip.tracker.toggleFollow()}
              headingUp={headingUp.value}
              onHeadingUp={() => trip.setHeadingUp(!headingUp.value)}
              onEnd={() => trip.end()}
              onKeep={() => trip.tracker.keepGoing()}
            />
          ) : null}
        </div>
      ) : null}
      {!place ? (
        <RawdahHost
          onHeight={(h) => (rawdahH.value = h)}
          watchMove={watchMove}
          onOpen={() => {
            const gate = POI_BY_ID.get(RULES.rules.rawdah.gate);
            if (gate) select(gate, true);
          }}
          onBehind={() => {
            const entrance = POI_BY_ID.get(BEHIND_RAWDAH_ID);
            if (entrance) select(entrance, true);
          }}
        >
          <NearRow onNear={runNear} />
        </RawdahHost>
      ) : null}
      {Admin && adminUnlocked.value ? <Admin fac={fac} onNotApplicable={() => notify(t('admin_na'))} /> : null}
      {gate ? (
        <AdminGate
          onUnlock={() => {
            adminUnlocked.value = true;
            setGate(false);
            void loadAdmin();
          }}
          onClose={() => setGate(false)}
        />
      ) : null}
      {Stories && stories !== null ? (
        <Stories
          site={stories}
          onClose={() => {
            setStories(null);
            refocus();
          }}
          onMap={(p) => select(p, true)}
          onRoute={(p) => {
            select(p, true);
            void runRoute(p);
          }}
        />
      ) : null}
      {Lib && library !== undefined ? (
        <Lib
          start={library ?? undefined}
          onClose={() => {
            setLibrary(undefined);
            refocus();
          }}
        />
      ) : null}
      {hintsOn ? <FirstHints target={hintTarget} onDone={() => setHints(false)} /> : null}
      {/* Notices rise above the navigation bar too, never on it. */}
      <div class="toast-host" style={{ '--sheet-h': `${(place ? sheetH.value : 0) + (nav.value || garageQ.value || whereQ.value || whoQ ? navH + 12 : 0)}px` }}>
        {toast.value ? (
          <Toast key={toast.value.id} tone={toast.value.tone} icon={toast.value.tone === 'ok' ? 'check' : 'info'}>
            {toast.value.text}
          </Toast>
        ) : null}
      </div>
    </LangContext.Provider>
  );
}
