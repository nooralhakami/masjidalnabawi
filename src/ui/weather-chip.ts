import L from 'leaflet';
import { currentWeather, type Weather } from '../domain/weather';
import { t } from '../i18n';
import { icon, type IconName } from './icons';

const ICON: Record<Weather['sky'], IconName> = { clear: 'sun', cloudy: 'cloud', fog: 'cloud', rain: 'rain', storm: 'rain' };

/**
 * A small "☀ 33°" chip above the map's bottom-left buttons. Hidden until a reading arrives,
 * and stays hidden offline; refreshes every 30 minutes and follows the language.
 */
export function addWeatherChip(map: L.Map): void {
  const ctl = new L.Control({ position: 'bottomleft' });
  let el!: HTMLElement;
  let last: Weather | null = null;
  const paint = () => {
    if (!last) {
      el.hidden = true;
      return;
    }
    const sky = last.sky === 'clear' && !last.day ? 'moon' : ICON[last.sky];
    const label = t('weather_now', { t: last.temp, d: t(`sky_${last.sky}`) });
    el.hidden = false;
    el.innerHTML = `${icon(sky, 18)}<span>${last.temp}°</span>`;
    el.setAttribute('aria-label', label);
    el.title = label;
    el.dataset.sky = last.sky;
  };
  const load = async () => {
    last = (await currentWeather()) ?? last;
    paint();
  };
  ctl.onAdd = () => {
    el = L.DomUtil.create('div', 'weather-chip');
    el.setAttribute('role', 'img');
    el.hidden = true;
    return el;
  };
  ctl.addTo(map);
  document.addEventListener('langchange', paint);
  void load();
  window.setInterval(() => void load(), 30 * 60_000);
}
