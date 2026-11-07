import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';

/** Al-Madinah, Saudi Arabia (UTC+3 all year, no DST). */
const MADINAH = new Coordinates(24.4672, 39.6111);
export const MADINAH_UTC_OFFSET_MIN = 180;
const DAY = 86_400_000;

export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYERS: readonly PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Madinah calendar date (y, m0, d) for an instant. */
export function madinahDate(now: Date): [number, number, number] {
  const shifted = new Date(now.getTime() + MADINAH_UTC_OFFSET_MIN * 60_000);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()];
}

/** The five prayers in Madinah on a Madinah date, Umm al-Qura method (the calendar the Rawdah rota follows). */
export function prayersOn(y: number, m: number, d: number): Record<PrayerName, Date> {
  // adhan reads the calendar day from the Date's local fields.
  const pt = new PrayerTimes(MADINAH, new Date(y, m, d, 12), CalculationMethod.UmmAlQura());
  return { fajr: pt.fajr, dhuhr: pt.dhuhr, asr: pt.asr, maghrib: pt.maghrib, isha: pt.isha };
}

export interface NextPrayer {
  name: PrayerName;
  at: Date;
  /** Whole minutes until it (rounded up; 0 at the adhan itself). */
  minutesLeft: number;
  /** Today's five (Madinah date), for the list. */
  today: Record<PrayerName, Date>;
}

/** The next adhan in Madinah from `now`: today's next one, or tomorrow's Fajr after Isha. */
export function nextPrayer(now: Date = new Date()): NextPrayer {
  const [y, m, d] = madinahDate(now);
  const today = prayersOn(y, m, d);
  const t = now.getTime();
  let name = PRAYERS.find((p) => today[p].getTime() > t);
  let at: Date;
  if (name) at = today[name];
  else {
    const [y2, m2, d2] = madinahDate(new Date(t + DAY));
    name = 'fajr';
    at = prayersOn(y2, m2, d2).fajr;
  }
  return { name, at, minutesLeft: Math.max(0, Math.ceil((at.getTime() - t) / 60_000)), today };
}
