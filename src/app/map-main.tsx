/*
 * map.html — the map with everything over it: search, categories, the place card (phase 4).
 * Routes and navigation come in phase 5, the Rawdah card, stories, library and languages in phase 6.
 */
import { computed, effect } from '@preact/signals';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import '../styles/fonts';
import '../styles/main.css';
import { POI_BY_ID } from '../data';
import { Facilities } from '../domain/facilities';
import { isHidden } from '../domain/filters';
import { visiblePois } from '../domain/visible';
import { VISIT_LIST } from '../domain/visits';
import { currentWeather, WEATHER_TTL_MS } from '../domain/weather';
import { getLang, nm, t } from '../i18n';
import { applyLang, initialLang, onLangChange } from '../i18n/dom';
import { loadLang } from '../i18n/load';
import { CAR_ENTRANCES } from '../data-next/car-entrances';
import { entranceOpen } from '../state/entrances';
import { MapEngine, type BaseLayer } from '../map/engine';
import { filter, headingUp, markersHidden, nav, notify, route, parkingSub, query, rawdahH, searching, selected, sheetH, toiletSub, weather } from '../state/store';
import { LangContext } from '../ui/i18n';
import { MapControls, MapTools } from '../ui/shell/MapControls';
import { WeatherChip } from '../ui/shell/WeatherChip';
import { MapError } from '../ui/shell/MapError';
import { applyContrast, applyTheme, savedContrast, savedTheme } from '../ui/theme';
import { App } from './App';
import { emit } from './events';
import { initPwa } from './pwa';
import { Trip } from './trip';

applyTheme(savedTheme(), false);
applyContrast(savedContrast(), false);
// The visitor's language: its texts arrive (their own file) before anything is drawn, in main().
const firstLang = initialLang();
document.documentElement.lang = firstLang;

const root = document.getElementById('app')!;
root.innerHTML =
  '<div class="map-page"><div id="map" class="map-root" role="application"></div><div class="map-overlay" id="overlay"></div><div class="map-overlay-left" id="overlay-left"></div><div id="ui"></div></div>';

const fac = new Facilities();

async function main() {
  await loadLang(firstLang);
  applyLang(firstLang);
  document.title = t('title');
  let engine: MapEngine;
  try {
    engine = await MapEngine.create({
      container: document.getElementById('map')!,
      nameOf: (p) => nm(p),
      status: (id) => fac.status(id),
      onPick: (id) => emit('map-tap', id),
      routeText: { minutes: (m) => t('r_min', { t: m }), level: (l) => t('lvl_name', { l }), entrance: (p) => nm(p) },
      meLabel: () => t('you'),
      // The new vehicle entrances (owner, 2026-10-16): a tap says the name, the state and how to leave.
      entranceText: (id, open) => {
        const e = CAR_ENTRANCES.find((x) => x.id === id);
        return e ? { name: t(e.name), state: open ? t('a_open') : t('ent_closed') } : null;
      },
      onEntrance: (id) => {
        const e = CAR_ENTRANCES.find((x) => x.id === id);
        if (!e) return;
        const open = entranceOpen.value[e.id];
        notify(`${t(e.name)} · ${open ? t('a_open') : t('ent_closed')}${e.note ? ` — ${t(e.note)}` : ''}`, 'info', 7000);
      },
    });
  } catch {
    // No map on this device (no WebGL, or refused): say so instead of a blank page.
    render(
      <LangContext.Provider value={getLang()}>
        <MapError onRetry={() => location.reload()} />
      </LangContext.Provider>,
      document.getElementById('ui')!,
    );
    return;
  }

  const trip = new Trip(engine, {
    // With a route, the top bar steps aside (trip mode): only the safe area is left above.
    top: () => (route.value ? 16 : (document.querySelector('.app-top')?.getBoundingClientRect().bottom ?? 0)),
    sheet: () => sheetH.value,
    bar: () => document.querySelector('.nav-bar, .garage-ask')?.getBoundingClientRect().top ?? innerHeight - sheetH.value,
  });

  // The map follows the state: the places of the filter and search, and the card that is open.
  effect(() => {
    const ids = visiblePois(filter.value, toiletSub.value, query.value, fac, undefined, parkingSub.value).map((p) => p.id);
    engine.setView({ ids, filter: filter.value, withFeatured: !searching.value, hidden: markersHidden.value });
  });
  effect(() => engine.select(selected.value));
  // The map's buttons sit above what is at the bottom: while navigating, the sheet and the bar
  // (the live app's body.is-navigating rule); with no card open, the Rawdah cards. Written on the two
  // button columns, never as a class on <body>.
  const navigating = computed(() => nav.value !== null);
  const open = computed(() => selected.value !== null);
  effect(() => {
    const on = navigating.value;
    const h = sheetH.value;
    const r = open.value ? 0 : rawdahH.value;
    requestAnimationFrame(() => {
      const bar = document.querySelector<HTMLElement>('.nav-bar')?.offsetHeight ?? 64;
      // Room under the buttons for the scale bar (as the default 64px leaves).
      const bottom = on ? `${h + bar + 46}px` : r ? `${r + 50}px` : '';
      for (const id of ['overlay', 'overlay-left']) document.getElementById(id)!.style.bottom = bottom;
      // The scale bar too (above the imagery credit, which stays at the very bottom, always visible).
      const scale = document.querySelector<HTMLElement>('.maplibregl-ctrl-scale');
      if (scale) scale.style.marginBottom = on ? `${h + bar}px` : r ? `${r + 4}px` : '';
    });
  });
  // Trip mode (owner, 2026-10-17): with a route on the map, the top bar, the pills and the map's
  // own buttons step aside, the compass staying (kit.css «trip mode»). Set once when a route starts
  // or ends, never during a gesture, and on the page wrapper, not <body>.
  effect(() => void document.querySelector('.map-page')!.toggleAttribute('data-trip', route.value !== null));
  fac.onChange(() => engine.refreshStatus());
  effect(() => engine.setEntrances(entranceOpen.value));
  addEventListener('resize', () => engine.refit());

  const watchNorth = (fn: (deg: number) => void) => {
    const on = () => fn(engine.north);
    engine.map.on('rotate', on);
    on();
    return () => engine.map.off('rotate', on);
  };

  // The weather in Madinah, every 30 minutes (none offline: the chip stays hidden).
  const loadWeather = async () => {
    weather.value = (await currentWeather()) ?? weather.value;
  };
  void loadWeather();
  setInterval(() => void loadWeather(), WEATHER_TTL_MS);

  function Tools() {
    const [base, setBase] = useState<BaseLayer>(engine.baseLayer);
    return (
      <MapTools
        weather={<WeatherChip w={weather.value} />}
        onStories={() => emit('stories-request', 0)}
        onLibrary={() => emit('library-request', undefined)}
        onLocate={() => void trip.locate()}
        base={base}
        onBase={() => {
          const next = base === 'satellite' ? 'light' : 'satellite';
          engine.setBase(next);
          setBase(next);
        }}
      />
    );
  }

  // A shared link (map.html?poi=215) opens that place directly (shared links, printed signs). The
  // card opens it once mounted: an event sent before then would be lost.
  const linked = Number(new URLSearchParams(location.search).get('poi'));
  const shared = Number.isInteger(linked) ? POI_BY_ID.get(linked) : undefined;
  let initial = shared && !isHidden(shared) ? shared : undefined;
  // A shared story (?visit=543) or library entry (?lib=umar); ?admin=1 shows the status simulator.
  const params = new URLSearchParams(location.search);
  const visitAt = VISIT_LIST.findIndex((v) => v.poi.id === Number(params.get('visit')));
  let initialVisit = visitAt >= 0 ? visitAt : undefined;
  let initialLib = params.get('lib') ?? undefined;
  const admin = params.get('admin') === '1';

  const draw = () => {
    const lang = getLang();
    render(
      <LangContext.Provider value={lang}>
        <MapControls
          onZoom={(s) => engine.zoomBy(s)}
          onTurn={(d) => engine.turn(d)}
          onNorth={() => {
            // North up: heading-up (if on) stops too, or the next step would turn the map again.
            if (headingUp.value) trip.setHeadingUp(false);
            engine.resetNorth();
          }}
          watchNorth={watchNorth}
        />
      </LangContext.Provider>,
      document.getElementById('overlay')!,
    );
    render(
      <LangContext.Provider value={lang}>
        <Tools />
      </LangContext.Provider>,
      document.getElementById('overlay-left')!,
    );
    render(
      <App key={lang} engine={engine} fac={fac} initial={initial} initialVisit={initialVisit} initialLib={initialLib} admin={admin} trip={trip} />,
      document.getElementById('ui')!,
    );
    initial = initialVisit = initialLib = undefined;
  };
  draw();

  onLangChange(() => {
    document.title = t('title');
    engine.restyle();
    draw();
  });

  // For the browser tests and the performance script only (automated browsers), never for visitors.
  if (navigator.webdriver) Object.assign(window, { __engine: engine, __fac: fac, __trip: trip });
}

void main();
initPwa();
