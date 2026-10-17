import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import { useI18n } from '../i18n';

export interface MapControlsProps {
  onZoom(step: 1 | -1): void;
  /** Turn the map clockwise (+) or anticlockwise (−) by 15°, as the live app's buttons. */
  onTurn(deg: 15 | -15): void;
  onNorth(): void;
  base: 'satellite' | 'light';
  onBase(): void;
  /** Subscribe to where true north points on screen (deg clockwise); returns an unsubscribe. */
  watchNorth(fn: (deg: number) => void): () => void;
}

/**
 * The map's own buttons, in one column on the inline-end side: zoom, turn and the compass (its
 * needle follows true north on screen, the Kaaba mark at its other end points to the qibla, as in
 * the live app), then the base map. The needle is turned by writing one transform, never a render.
 */
export function MapControls({ onZoom, onTurn, onNorth, watchNorth }: Omit<MapControlsProps, 'base' | 'onBase'>) {
  const { t } = useI18n();
  const compass = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      watchNorth((deg) => {
        const el = compass.current;
        if (!el) return;
        el.style.setProperty('--north', `${deg}deg`);
        el.classList.toggle('is-rotated', Math.abs(((deg % 360) + 360) % 360) > 0.5 && Math.abs(((deg % 360) + 360) % 360) < 359.5);
      }),
    [watchNorth],
  );
  return (
    <div class="map-controls">
      <div class="mc-group">
        <IconButton icon="plus" label={t('zoom_in')} onClick={() => onZoom(1)} />
        <IconButton icon="minus" label={t('zoom_out')} onClick={() => onZoom(-1)} />
      </div>
      <div class="mc-group">
        <IconButton icon="rotate-right" label={t('rot_right')} onClick={() => onTurn(15)} />
        <span ref={compass} class="mc-compass">
          <IconButton icon="rotate-reset" label={t('rot_reset')} onClick={onNorth} />
        </span>
        <IconButton icon="rotate-left" label={t('rot_left')} onClick={() => onTurn(-15)} />
      </div>
    </div>
  );
}

/**
 * The left column, as the live app's: the landmark stories, the library, the base map and «my
 * location», with the weather chip above them.
 */
export function MapTools({
  base,
  onBase,
  onLocate,
  onStories,
  onLibrary,
  weather,
}: Pick<MapControlsProps, 'base' | 'onBase'> & { onLocate?(): void; onStories?(): void; onLibrary?(): void; weather?: ComponentChildren }) {
  const { t } = useI18n();
  return (
    <div class="map-controls">
      {weather}
      {onStories ? <IconButton icon="landmark" floating class="mc-stories" label={t('st_open')} onClick={onStories} /> : null}
      {onLibrary ? <IconButton icon="book" floating class="mc-library" label={t('lib_title')} onClick={onLibrary} /> : null}
      <IconButton icon="layers" floating class="mc-layers" label={t(base === 'satellite' ? 'layer_map' : 'layer_sat')} pressed={base === 'light'} onClick={onBase} />
      {/* Location is asked for only on this tap (or «route from my location»), never before. */}
      {onLocate ? <IconButton icon="locate" floating class="mc-locate" label={t('gps')} onClick={onLocate} /> : null}
    </div>
  );
}
