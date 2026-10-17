import { useLayoutEffect, useRef } from 'preact/hooks';
import { num } from '../../i18n';

const MS = 450;

/**
 * A number that glides to its new value (the navigation bar's metres and minutes, DESIGN §5): its
 * text is written straight to the element for 450 ms, never a re-render per frame. With reduced
 * motion it changes at once. Digits stay Latin (num).
 */
export function Count({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const from = shown.current;
    if (from === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown.current = value;
      node.textContent = num(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / MS);
      const e = 1 - (1 - k) ** 3;
      shown.current = Math.round(from + (value - from) * e);
      node.textContent = num(shown.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      shown.current = value;
    };
  }, [value]);
  return <span ref={el}>{num(shown.current)}</span>;
}
