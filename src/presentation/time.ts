import { latinDigits } from '../i18n';

/** A Madinah wall-clock time in the visitor's language, Latin digits (DESIGN §2). */
export function clock(at: Date, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' };
  let s: string;
  try {
    s = new Intl.DateTimeFormat(`${lang}-u-nu-latn`, opts).format(at);
  } catch {
    s = new Intl.DateTimeFormat('en', opts).format(at);
  }
  return latinDigits(s);
}

/** Minutes left as «1 h 22 min» / «22 min», with the language's own words (dur_hm, dur_m). */
export function minutesText(minutes: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? t('dur_hm', { h, m }) : t('dur_m', { m });
}
