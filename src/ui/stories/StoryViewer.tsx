import './stories.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Poi } from '../../data/types';
import { SLIDE_MS, VISIT_LIST, imageFor, isPrayerSlide, nextPos, prevPos, segmentFill, slideLang, slideText, type Pos } from '../../domain/visits';
import { SALAWAT_AR } from '../../i18n';
import { useI18n } from '../i18n';
import { Icon } from '../kit/Icon';

const COUNT_KEY = 'salawat-count';
/** A press held this long pauses the story (a quick tap moves on). */
const HOLD_MS = 220;

/** The visitor's count of prayers on the Prophet ﷺ, kept on this device only. */
export function readSalawat(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

let memoryCount = 0;
export function addSalawat(): number {
  const n = Math.max(readSalawat(), memoryCount) + 1;
  memoryCount = n;
  try {
    localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    // Private window or blocked storage: the count lives until the page closes.
  }
  return n;
}

/** Keep the ﷺ sign (a wide calligraphic ligature) from wrapping alone onto a line. */
function Sal({ text }: { text: string }) {
  const parts = text.split(/\s*ﷺ/);
  return (
    <>
      {parts.map((p, i) =>
        i ? (
          <>
            {'\u00a0'}
            <span class="st-sal">ﷺ</span>
            {p}
          </>
        ) : (
          p
        ),
      )}
    </>
  );
}

export interface StoryViewerProps {
  /** The site to start at (its place in VISIT_LIST). */
  site: number;
  onClose(): void;
  /** Show the site on the map (the stories close). */
  onMap(p: Poi): void;
  /** Plan a route to the site (the stories close). */
  onRoute(p: Poi): void;
}

/**
 * Landmark stories (SPEC F14, N10; the live app's ui/stories.ts), full screen, WhatsApp-status
 * style: one top segment per site, each a few photo/text slides ending with the prayer on the
 * Prophet ﷺ. Tap the sides to move (mirrored by the language's direction), hold to pause, swipe
 * down or Esc to close; each slide moves on by itself after 6 s, never with reduced motion.
 * Photos load only when shown (and the next one ahead), and are never in the app's cache.
 *
 * Only the progress bars change per frame, by one CSS variable each: no re-render per frame.
 */
export function StoryViewer({ site, onClose, onMap, onRoute }: StoryViewerProps) {
  const { t, lang, nm } = useI18n();
  const [pos, setPos] = useState<Pos>({ site: Math.min(Math.max(site, 0), VISIT_LIST.length - 1), slide: 0 });
  const [userPaused, setUserPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [sources, setSources] = useState(false);
  const [count, setCount] = useState(readSalawat);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = useRef<HTMLElement>(null);
  const live = useRef({ elapsed: 0, last: 0, raf: 0, holdTimer: 0, justHeld: false, swipe: null as { x: number; y: number } | null, pos, paused: false });
  const paused = userPaused || held || sources || reduce;
  live.current.pos = pos;
  live.current.paused = paused;

  const v = VISIT_LIST[pos.site];
  const prayer = isPrayerSlide(v, pos.slide);
  const img = imageFor(v, pos.slide);

  const goTo = (p: Pos) => {
    live.current.elapsed = 0;
    setSources(false);
    setPos(p);
  };
  const step = (dir: 1 | -1) => {
    const p = live.current.pos;
    const to = dir === 1 ? nextPos(VISIT_LIST, p) : prevPos(VISIT_LIST, p);
    if (to) goTo(to);
    else if (dir === 1) onClose();
    else live.current.elapsed = 0;
  };

  // The clock: elapsed time on this slide, the bars painted from it, the next slide when it is full.
  useEffect(() => {
    const s = live.current;
    const tick = (now: number) => {
      // Capped so a stall does not skip a slide; hiding the page resets the clock anyway (visibilitychange).
      // 500 ms, not the live app's 100: on a slow phone drawing a few frames a second, 100 made 6 s last 12.
      const dt = s.last ? Math.min(now - s.last, 500) : 0;
      s.last = now;
      if (!s.paused && !document.hidden) {
        s.elapsed += dt;
        if (s.elapsed >= SLIDE_MS) step(1);
      }
      const bars = root.current?.querySelectorAll<HTMLElement>('.st-bar > i') ?? [];
      const progress = reduce ? 0 : s.elapsed / SLIDE_MS;
      bars.forEach((b, i) => b.style.setProperty('--f', String(segmentFill(VISIT_LIST, s.pos, i, progress))));
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    const vis = () => (s.last = 0);
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(s.raf);
      clearTimeout(s.holdTimer);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // Focus starts on «close»; the next slide's photo is fetched ahead so the change is instant.
  useLayoutEffect(() => root.current?.querySelector<HTMLElement>('[data-act="close"]')?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const n = nextPos(VISIT_LIST, pos);
    const next = n && imageFor(VISIT_LIST[n.site], n.slide);
    if (next) new Image().src = next.src;
  }, [pos]);

  const endHold = () => {
    const s = live.current;
    clearTimeout(s.holdTimer);
    s.swipe = null;
    if (held) {
      setHeld(false);
      // The click that follows the release is part of the hold; forget it once it has passed.
      setTimeout(() => (s.justHeld = false), 150);
    }
  };
  const zone = (dir: 1 | -1) => () => {
    // A press held to pause must not also count as a tap.
    if (live.current.justHeld) {
      live.current.justHeld = false;
      return;
    }
    step(dir);
  };
  const pray = () => setCount(addSalawat());

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step((e.key === 'ArrowRight') !== rtl ? 1 : -1);
      return;
    }
    // Keep Tab inside the stories while they are open.
    if (e.key === 'Tab') {
      const items = [...root.current!.querySelectorAll<HTMLElement>('button:not(.st-zone), a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const text = prayer ? '' : slideText(v.slides[pos.slide], lang);
  // Long translations get a smaller size so they stay on the dark band, clear of the header.
  const size = text.length > 300 ? ' is-xl' : text.length > 200 ? ' is-long' : '';
  return (
    <section
      ref={root}
      class={`stories${paused ? ' is-paused' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('st_open')}
      onKeyDown={onKey}
      // A long press on a photo must pause the story, not open the browser's copy/save menu.
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        // Buttons and links (other than the two tap zones) keep their own press behaviour.
        if ((e.target as HTMLElement).closest('button:not(.st-zone), a')) return;
        const s = live.current;
        s.swipe = { x: e.clientX, y: e.clientY };
        clearTimeout(s.holdTimer);
        s.holdTimer = window.setTimeout(() => {
          s.justHeld = true;
          setHeld(true);
        }, HOLD_MS);
      }}
      onPointerUp={(e) => {
        const s = live.current.swipe;
        endHold();
        // A downward swipe closes, like dismissing a status.
        if (s && e.clientY - s.y > 90 && Math.abs(e.clientX - s.x) < 70) {
          live.current.justHeld = true;
          onClose();
        }
      }}
      onPointerCancel={endHold}
    >
      <div class="st-media">
        {img ? (
          <img class="st-img" key={img.src} src={img.src} alt={img.alt[lang] ?? img.alt.en} decoding="async" style={img.focus ? { objectPosition: img.focus } : undefined} />
        ) : (
          <div class="st-art" aria-hidden="true">
            <Icon name="landmark" size={120} />
          </div>
        )}
      </div>
      <div class="st-scrim" aria-hidden="true" />
      <div class="st-bars" aria-hidden="true">
        {VISIT_LIST.map((x) => (
          <span class="st-bar" key={x.poi.id}>
            <i />
          </span>
        ))}
      </div>
      <header class="st-head">
        <span class="st-rank" dir="ltr" aria-hidden="true">
          {pos.site + 1} / {VISIT_LIST.length}
        </span>
        <h2 class="st-name">{nm(v.poi)}</h2>
        {reduce ? null : (
          <button type="button" class="st-icon" data-act="pause" aria-label={t(userPaused ? 'st_play' : 'st_pause')} onClick={() => setUserPaused(!userPaused)}>
            <Icon name={userPaused ? 'play' : 'pause'} size={20} />
          </button>
        )}
        <button type="button" class="st-icon" data-act="close" aria-label={t('l_close')} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <button type="button" class="st-zone st-zone-prev" data-act="prev" aria-label={t('st_prev')} onClick={zone(-1)} />
      <button type="button" class="st-zone st-zone-next" data-act="next" aria-label={t('st_next')} onClick={zone(1)} />
      <footer class="st-foot">
        {prayer ? (
          <div class="st-pray">
            <p class="st-pray-ar" lang="ar" dir="rtl">
              {SALAWAT_AR}
            </p>
            {lang === 'ar' ? null : (
              <p class="st-pray-meaning">
                <Sal text={t('st_pray_meaning')} />
              </p>
            )}
            <button type="button" class="st-pray-btn" data-act="pray" onClick={pray}>
              <Sal text={t('st_pray_btn')} />
            </button>
            <p class="st-pray-count" id="st-count" aria-live="polite">
              {count ? <Sal text={t('st_pray_count', { n: count })} /> : null}
            </p>
          </div>
        ) : (
          <p class={`st-text${size}`} key={`${pos.site}-${pos.slide}`} lang={slideLang(v.slides[pos.slide], lang)} dir="auto">
            {text}
          </p>
        )}
        {sources ? (
          <ul class="st-sources">
            {v.sources.map((s) => (
              <li key={s.u}>
                <a href={s.u} target="_blank" rel="noopener noreferrer">
                  {s.t}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div class="st-actions">
          <button type="button" class="st-btn" data-act="map" onClick={() => (onClose(), onMap(v.poi))}>
            <Icon name="dome" size={18} />
            <span>{t('st_on_map')}</span>
          </button>
          <button type="button" class="st-btn" data-act="route" onClick={() => (onClose(), onRoute(v.poi))}>
            <Icon name="route" size={18} />
            <span>{t('st_route')}</span>
          </button>
          <button type="button" class="st-btn st-btn-quiet" data-act="sources" aria-expanded={sources} onClick={() => setSources(!sources)}>
            <Icon name="link" size={18} />
            <span>{t('st_sources')}</span>
          </button>
        </div>
        {prayer ? null : (
          <div class="st-salawat">
            <span lang="ar" dir="rtl">
              {SALAWAT_AR}
            </span>
            <button type="button" class="st-mini" data-act="pray" aria-label={t('st_pray_btn')} onClick={pray}>
              <span aria-hidden="true">ﷺ</span>
              <b>{count}</b>
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
