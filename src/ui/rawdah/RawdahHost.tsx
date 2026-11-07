import { useEffect, useRef, useState } from 'preact/hooks';
import { rawdahState } from '../../domain/rawdah';
import { RawdahCard } from './RawdahCard';

/**
 * The Rawdah card at the bottom of the map while no place is open (SPEC N9, F7), refreshed every
 * 30 s as the live app's. It reports its height so the map's buttons sit above it.
 */
export function RawdahHost({
  onOpen,
  onBehind,
  onHeight,
  watchMove,
}: {
  onOpen(): void;
  onBehind(): void;
  onHeight(px: number): void;
  /** Tell when the map starts and stops moving (returns an unsubscribe): the card is compact meanwhile. */
  watchMove?(fn: (moving: boolean) => void): () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!watchMove) return;
    // Back to full a moment after the map rests, so it does not flicker between two gestures.
    let rest = 0;
    const off = watchMove((on) => {
      clearTimeout(rest);
      if (on) setMoving(true);
      else rest = window.setTimeout(() => setMoving(false), 900);
    });
    return () => {
      clearTimeout(rest);
      off();
    };
  }, [watchMove]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, []);
  return (
    <div class="rawdah-host" ref={box}>
      <RawdahCard state={rawdahState(now)} onOpen={onOpen} onBehind={onBehind} compact={moving} />
    </div>
  );
}
