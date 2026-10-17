import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import { DETENTS, SPRINGS, detentHeights, releaseDetent, settled, springStep, stepDetent, type Detent, type Heights } from './physics';

export interface BottomSheetProps {
  detent: Detent;
  onDetent(d: Detent): void;
  /** The detents this sheet offers (a route sheet, for instance, cannot be dragged closed). */
  allowed?: readonly Detent[];
  /** Extra height for the half detent (the walking/car and level rows, as in the live app). */
  extra?: number;
  label: string;
  /**
   * The half detent fits the content instead (a route summary: exactly the card and its end button,
   * never more than 45% of the screen, as the live app), so most of the map stays visible.
   */
  fit?: boolean;
  /** The visible height the sheet is settling to (for what sits above it: notices, the navigation bar). */
  onHeight?(px: number): void;
  children: ComponentChildren;
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* optional */
  }
};

/**
 * The bottom sheet (SPEC N4): closed / peek / half / full. It follows the finger on its handle and
 * header, and on release settles with a spring that starts at the finger's speed (physics.ts).
 * Only `transform` moves, written straight to the element: no re-render per frame. Its content
 * scrolls only at full height, so a drag is never mistaken for a scroll.
 */
export function BottomSheet({ detent, onDetent, allowed = DETENTS, extra = 0, label, fit = false, onHeight, children }: BottomSheetProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [heights, setHeights] = useState<Heights>(() => detentHeights(812, { extra }));
  const live = useRef({ h: 0, v: 0, raf: 0, dragging: false, placed: false });

  // The host's height decides the detents (the screen, or a phone frame in the gallery).
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const h = detentHeights(el.clientHeight, { extra });
      const content = fit ? sheet.current?.querySelector<HTMLElement>('.sheet-body > *') : null;
      if (content) {
        const body = content.parentElement!;
        const handle = sheet.current!.querySelector<HTMLElement>('.sheet-handle');
        const need = (handle?.offsetHeight ?? 0) + content.offsetHeight + (parseFloat(getComputedStyle(body).paddingBottom) || 0);
        h.half = Math.min(h.full, Math.ceil(need), Math.round(el.clientHeight * 0.45));
      }
      setHeights((old) => (old.half === h.half && old.full === h.full && old.peek === h.peek ? old : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const content = fit ? sheet.current?.querySelector('.sheet-body > *') : null;
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, [extra, fit, children]);

  useEffect(() => onHeight?.(heights[detent]), [detent, heights]);

  const place = (h: number) => {
    live.current.h = h;
    const el = sheet.current;
    if (el) el.style.transform = `translate3d(0, ${Math.round(heights.full - h)}px, 0)`;
  };

  const animateTo = (target: number) => {
    const s = live.current;
    cancelAnimationFrame(s.raf);
    if (reduceMotion()) {
      s.v = 0;
      place(target);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const [x, v] = springStep(s.h, s.v, target, SPRINGS.sheet, dt);
      s.v = v;
      if (settled(x, v, target)) {
        s.v = 0;
        place(target);
        return;
      }
      place(x);
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };

  // First paint: straight to the detent, no entrance animation.
  useLayoutEffect(() => {
    if (live.current.placed) return;
    live.current.placed = true;
    place(heights[detent]);
  });

  // A new detent from outside (or new heights): spring there from wherever the sheet is.
  useEffect(() => {
    if (!live.current.dragging) animateTo(heights[detent]);
  }, [detent, heights]);
  useEffect(() => () => cancelAnimationFrame(live.current.raf), []);

  // Dragging by the handle or by anything marked data-sheet-drag (the card's header).
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    let startY = 0;
    let startH = 0;
    let samples: { y: number; t: number }[] = [];
    let moved = false;
    let pointer = -1;
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-sheet-drag]') || (e.target as HTMLElement).closest('[data-no-drag]')) return;
      if ((e.target as HTMLElement).closest('button, a, input') && !(e.target as HTMLElement).closest('.sheet-handle')) return;
      pointer = e.pointerId;
      startY = e.clientY;
      startH = live.current.h;
      samples = [{ y: e.clientY, t: e.timeStamp }];
      moved = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 6) return;
      if (!moved) {
        moved = true;
        live.current.dragging = true;
        cancelAnimationFrame(live.current.raf);
        el.setPointerCapture?.(e.pointerId);
      }
      samples.push({ y: e.clientY, t: e.timeStamp });
      if (samples.length > 6) samples.shift();
      let h = startH - dy;
      // Past the top it resists (a third of the finger's travel).
      if (h > heights.full) h = heights.full + (h - heights.full) / 3;
      place(Math.max(0, h));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      if (!moved) return;
      live.current.dragging = false;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = Math.max(1, b.t - a.t) / 1000;
      // Growing is positive: the finger moving up.
      const v = (a.y - b.y) / dt;
      live.current.v = v;
      const next = releaseDetent(detent, live.current.h, v, heights, allowed);
      if (next !== detent) {
        haptic();
        onDetent(next);
      } else animateTo(heights[next]);
      // The click that ends a drag must not press what is under the finger.
      const swallow = (ev: Event) => ev.stopPropagation();
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [detent, heights, allowed]);

  const lowest = DETENTS.find((d) => allowed.includes(d)) ?? 'peek';
  return (
    <div class="sheet-host" ref={host}>
      <section
        ref={sheet}
        class={`sheet is-${detent}`}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        aria-hidden={detent === 'closed' ? 'true' : undefined}
        // transform is not here on purpose: Preact would rewrite it on each render and fight the spring.
        // --half: where the visible part ends when half open (the card's footer sits there, as in the live app).
        style={{ height: `${heights.full}px`, '--half': `${heights.half}px` }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && detent !== lowest) {
            e.stopPropagation();
            onDetent(allowed.includes('closed') ? 'closed' : lowest);
          }
        }}
      >
        <button
          type="button"
          class="sheet-handle"
          data-sheet-drag
          aria-label={t('sheet_label')}
          aria-expanded={detent === 'full'}
          onClick={() => onDetent(detent === 'full' ? 'half' : 'full')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onDetent(stepDetent(detent, e.key === 'ArrowUp' ? 1 : -1, allowed.filter((d) => d !== 'closed')));
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  );
}
