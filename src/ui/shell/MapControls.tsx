import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import { useI18n } from '../i18n';

export interface MapControlsProps {
  onZoom(step: 1 | -1): void;
  /** Turn the map clockwise (+) or anticlockwise (−) by 15°, as the live app's buttons. */
  onTurn(deg: 15 | -15): void;
  onNorth(): void;
  /** Subscribe to where true north points on screen (deg clockwise); returns an unsubscribe. */
  watchNorth(fn: (deg: number) => void): () => void;
}

/**
 * The map's own buttons, in one column on the inline-end side: zoom, turn and the compass (its
 * needle follows true north on screen, the Kaaba mark at its other end points to the qibla, as in
 * the live app). The needle is turned by writing one transform, never a render.
 */
export function MapControls({ onZoom, onTurn, onNorth, watchNorth }: MapControlsProps) {
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
      <div class="mc-group mc-zoom">
        <IconButton icon="plus" label={t('zoom_in')} onClick={() => onZoom(1)} />
        <IconButton icon="minus" label={t('zoom_out')} onClick={() => onZoom(-1)} />
      </div>
      <div class="mc-group">
        <IconButton icon="rotate-right" class="mc-turn" label={t('rot_right')} onClick={() => onTurn(15)} />
        <span ref={compass} class="mc-compass">
          <IconButton icon="rotate-reset" label={t('rot_reset')} onClick={onNorth} />
        </span>
        <IconButton icon="rotate-left" class="mc-turn" label={t('rot_left')} onClick={() => onTurn(-15)} />
      </div>
    </div>
  );
}

/** The map's three views, in the order the layers button steps through them (owner, 2026-11-06). */
export type MapView = '3d' | 'satellite' | 'light';
export const NEXT_VIEW: Record<MapView, MapView> = { '3d': 'satellite', satellite: 'light', light: '3d' };
/** The button names the view it leads to. */
const VIEW_LABEL: Record<MapView, string> = { '3d': 'view_3d', satellite: 'view_2d', light: 'layer_map' };

/**
 * The left column, as the live app's: the landmark stories, the library, the layers button and «my
 * location», with the weather chip above them. The layers button steps through the 3D view (the
 * first), the plain satellite map and the light map (owner, 2026-11-06).
 */
export function MapTools({
  view,
  onView,
  onLocate,
  onStories,
  onLibrary,
  weather,
}: {
  view: MapView;
  onView(): void;
  onLocate?(): void;
  onStories?(): void;
  onLibrary?(): void;
  weather?: ComponentChildren;
}) {
  const { t } = useI18n();
  return (
    <div class="map-controls">
      {weather}
      {onStories ? <IconButton icon="landmark" floating class="mc-stories" label={t('st_open')} onClick={onStories} /> : null}
      {onLibrary ? <IconButton icon="book" floating class="mc-library" label={t('lib_title')} onClick={onLibrary} /> : null}
      <IconButton icon="layers" floating class="mc-layers" data-view={view} label={t(VIEW_LABEL[NEXT_VIEW[view]])} onClick={onView} />
      {/* Location is asked for only on this tap (or «route from my location»), never before. */}
      {onLocate ? <IconButton icon="locate" floating class="mc-locate" label={t('gps')} onClick={onLocate} /> : null}
    </div>
  );
}
