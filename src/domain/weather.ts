/** Current weather in Madinah from Open-Meteo (free, no key). Pure parts are tested; fetching is best-effort. */

export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm';

export interface Weather {
  /** °C, rounded. */
  temp: number;
  sky: Sky;
  day: boolean;
  /** When it was fetched (ms). */
  at: number;
}

const MADINAH = { lat: 24.4672, lng: 39.6112 };
export const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${MADINAH.lat}&longitude=${MADINAH.lng}` +
  '&current=temperature_2m,weather_code,is_day&timezone=Asia%2FRiyadh';
/** Reuse a reading for half an hour. */
export const WEATHER_TTL_MS = 30 * 60_000;
const KEY = 'weather.v1';

/** WMO weather code → the few skies we show. */
export function skyOf(code: number): Sky {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 1) return 'cloudy';
  return 'clear';
}

/** Open-Meteo "current" block → Weather, or null if it is not what we expect. */
export function parseWeather(json: unknown, now = Date.now()): Weather | null {
  const c = (json as { current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown } } | null)?.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') return null;
  return { temp: Math.round(c.temperature_2m), sky: skyOf(c.weather_code), day: c.is_day !== 0, at: now };
}

function cached(now: number): Weather | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Weather | null;
    return w && now - w.at < WEATHER_TTL_MS ? w : null;
  } catch {
    return null;
  }
}

/** The current weather (cached for 30 min); null when offline or the service fails. */
export async function currentWeather(now = Date.now()): Promise<Weather | null> {
  const hit = cached(now);
  if (hit) return hit;
  try {
    const res = await fetch(WEATHER_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const w = parseWeather(await res.json(), now);
    if (w) {
      try {
        localStorage.setItem(KEY, JSON.stringify(w));
      } catch {
        /* private mode */
      }
    }
    return w;
  } catch {
    return null;
  }
}
