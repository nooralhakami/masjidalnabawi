import type { Weather } from '../../domain/weather';
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../kit/Icon';

const ICON: Record<Weather['sky'], IconName> = { clear: 'sun', cloudy: 'cloud', fog: 'cloud', rain: 'rain', storm: 'rain' };

/**
 * «☀ 33°» over the map's left buttons (SPEC F9; the live app's weather chip): the temperature in
 * Madinah now, named in the visitor's language. Nothing shows until a reading arrives, nor offline.
 */
export function WeatherChip({ w }: { w: Weather | null }) {
  const { t } = useI18n();
  if (!w) return null;
  const label = t('weather_now', { t: w.temp, d: t(`sky_${w.sky}`) });
  return (
    <div class="weather-chip" role="img" aria-label={label} title={label} data-sky={w.sky}>
      <Icon name={w.sky === 'clear' && !w.day ? 'moon' : ICON[w.sky]} size={18} />
      <span>{w.temp}°</span>
    </div>
  );
}
