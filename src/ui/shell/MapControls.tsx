import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { view3d } from '../../state/store';
import { useI18n } from '../i18n';

export interface MapControlsProps {
  onZoom(step: 1 | -1): void;
  /** Turn the map clockwise (+) or anticlockwise (−) by 15°, as the live app's buttons. */
  onTurn(deg: 15 | -15): void;
  onNorth(): void;
  /** Tilt the 3D view by `deg` (shown in 3D only). */
  onTilt?(deg: 10 | -10): void;
  /** Subscribe to where true north points on screen (deg clockwise); returns an unsubscribe. */
  watchNorth(fn: (deg: number) => void): () => void;
}

/** Close an open popover on Escape or a tap elsewhere, focus going back to its button. */
function usePopover(open: boolean, close: () => void, box: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      box.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    };
    const tap = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    addEventListener('keydown', key);
    addEventListener('pointerdown', tap, true);
    return () => {
      removeEventListener('keydown', key);
      removeEventListener('pointerdown', tap, true);
    };
  }, [open]);
}

/**
 * The map's own buttons, in one column on the inline-end side (owner, 2026-11-07: fewer buttons, more
 * map): zoom, the compass (its needle follows true north on screen, the Kaaba mark at its other end
 * points to the qibla; a tap turns north up), and one button that opens turning (and in 3D tilting)
 * beside it. The needle is turned by writing one transform, never a render.
 */
export function MapControls({ onZoom, onTurn, onNorth, onTilt, watchNorth }: MapControlsProps) {
  const { t } = useI18n();
  const compass = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false), box);
  useEffect(
    () =>
      watchNorth((deg) => {
        const el = compass.current;
        if (!el) return;
        el.style.setProperty('--north', `${deg}deg`);
        el.classList.toggle('is-rotated', Math.abs(((deg % 360) + 360) % 360) > 0.5 && Math.abs(((deg % 360) + 360) %360) < 359.5);
      }),
    [watchNorth],
  );
  const tilt = !!onTilt && view3d.value;
  const label = t(tilt ? 'map_turn_tilt' : 'map_turn');
  return (
    <div class="map-controls">
      <div class="mc-group mc-zoom">
        <IconButton icon="plus" label={t('zoom_in')} onClick={() => onZoom(1)} />
        <IconButton icon="minus" label={t('zoom_out')} onClick={() => onZoom(-1)} />
      </div>
      <div class="mc-group mc-view" ref={box}>
        <span ref={compass} class="mc-compass">
          <IconButton icon="rotate-reset" label={t('rot_reset')} onClick={onNorth} />
        </span>
        <button
          type="button"
          class="icon-btn mc-turn mc-adjust"
          aria-label={label}
          title={tilt ? `${label} — ${t('gestures_desktop')}` : label}
          aria-expanded={open}
          aria-controls="mc-adjust-panel"
          onClick={() => setOpen(!open)}
        >
          <Icon name={tilt ? 'cube' : 'rotate-right'} />
        </button>
        {open ? (
          // Beside the button, toward the map: turning, and in 3D tilting too.
          <div id="mc-adjust-panel" class="mc-pop mc-adjust-pop" role="group" aria-label={label}>
            <IconButton icon="rotate-left" class="mc-turn" label={t('rot_left')} onClick={() => onTurn(-15)} />
            <IconButton icon="rotate-right" class="mc-turn" label={t('rot_right')} onClick={() => onTurn(15)} />
            {tilt ? (
              <>
                <IconButton icon="tilt-up" class="mc-tilt" label={t('tilt_up')} onClick={() => onTilt?.(10)} />
                <IconButton icon="tilt-down" class="mc-tilt" label={t('tilt_down')} onClick={() => onTilt?.(-10)} />
              </>
            ) : null}
          </div>
        ) : null}
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
 * The left column (owner, 2026-11-07: fewer buttons, more map): the weather chip, one «more» button
 * that opens the landmark stories, the library and the map's view (3D, satellite, light) as named
 * rows, and «my location». The view row steps through the 3D view (the first), the plain satellite
 * map and the light map (owner, 2026-11-06).
 */
export function MapTools({
  view,
  onView,
  onLocate,
  onStories,
  onLibrary,
  onShare,
  weather,
}: {
  view: MapView;
  onView(): void;
  onLocate?(): void;
  onStories?(): void;
  onLibrary?(): void;
  /** Share the guide's link (moved here from the top card, owner 2026-11-07: a one-line title). */
  onShare?(): void;
  weather?: ComponentChildren;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false), box);
  const pick = (fn: () => void, stay = false) => () => {
    if (!stay) setOpen(false);
    fn();
  };
  return (
    <div class="map-controls">
      {weather}
      <div class="mc-menu" ref={box}>
        <IconButton
          icon="grid"
          floating
          class="mc-more"
          label={t('map_more')}
          aria-expanded={open}
          aria-controls="mc-more-panel"
          onClick={() => setOpen(!open)}
        />
        {open ? (
          <div id="mc-more-panel" class="mc-pop mc-more-pop" role="group" aria-label={t('map_more')}>
            {onStories ? (
              <button type="button" class="mc-row mc-stories" onClick={pick(onStories)}>
                <Icon name="landmark" />
                <span>{t('st_open')}</span>
              </button>
            ) : null}
            {onLibrary ? (
              <button type="button" class="mc-row mc-library" onClick={pick(onLibrary)}>
                <Icon name="book" />
                <span>{t('lib_title')}</span>
              </button>
            ) : null}
            {/* The view row stays open: the visitor sees the map change and may step on. */}
            <button type="button" class="mc-row mc-layers" data-view={view} onClick={pick(onView, true)}>
              <Icon name="layers" />
              <span>{t(VIEW_LABEL[NEXT_VIEW[view]])}</span>
            </button>
            {onShare ? (
              <button type="button" class="mc-row mc-share" onClick={pick(onShare)}>
                <Icon name="share" />
                <span>{t('share_app')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Location is asked for only on this tap (or «route from my location»), never before. */}
      {onLocate ? <IconButton icon="locate" floating class="mc-locate" label={t('gps')} onClick={onLocate} /> : null}
    </div>
  );
}
