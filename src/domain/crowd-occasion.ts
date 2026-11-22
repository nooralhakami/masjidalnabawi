import { madinahDate, prayersOn } from './prayer';

/**
 * How full the Mosque and its streets are, by occasion (owner, 2026-11-22): the Eid prayer is the
 * fullest (the photographs of streets packed with rows are from it), Ramadan nights a little less,
 * and every other day medium. The ordinary day is the default and stays as it was.
 */
export type CrowdOccasion = 'regular' | 'ramadan_night' | 'eid';

export interface OccasionCrowd {
  /** Multiplies how many worshippers are laid out and drawn (1 = the ordinary day). */
  scale: number;
  /** The rows spill onto the streets round the courtyards at the congregational prayer. */
  streets: boolean;
}

export const OCCASION_CROWD: Readonly<Record<CrowdOccasion, OccasionCrowd>> = {
  regular: { scale: 1, streets: false },
  ramadan_night: { scale: 1.7, streets: true },
  eid: { scale: 2, streets: true },
};

const DAY_MS = 86_400_000;

/** The Umm al-Qura (Saudi official) Hijri month and day of an instant in Madinah, or null if the runtime has no Islamic calendar. */
export function hijriMonthDay(at: Date): [number, number] | null {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'Asia/Riyadh', month: 'numeric', day: 'numeric' }).formatToParts(at);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    return Number.isInteger(month) && Number.isInteger(day) ? [month, day] : null;
  } catch {
    return null;
  }
}

/**
 * The occasion at an instant. The Islamic day starts at Maghrib, so a night belongs to the next date:
 * a Ramadan night runs from Maghrib to Fajr (with the night of Eid al-Fitr), and Eid morning (1 Shawwal,
 * 10 Dhu al-Hijjah) from Fajr to Dhuhr, when the takbeer, the Eid prayer and its sermon fill the Haram.
 */
export function crowdOccasionAt(now: Date): CrowdOccasion {
  const [y, m, d] = madinahDate(now);
  const today = prayersOn(y, m, d);
  const t = now.getTime();
  const afterMaghrib = t >= today.maghrib.getTime();
  const beforeFajr = t < today.fajr.getTime();
  const md = hijriMonthDay(afterMaghrib ? new Date(t + DAY_MS) : now);
  if (!md) return 'regular';
  const [month, day] = md;
  const eidDay = (month === 10 && day === 1) || (month === 12 && day === 10);
  if (eidDay && !beforeFajr && !afterMaghrib && t < today.dhuhr.getTime()) return 'eid';
  if ((month === 9 || (month === 10 && day === 1)) && (afterMaghrib || beforeFajr)) return 'ramadan_night';
  return 'regular';
}

/** A fixed occasion for previews (`?crowdOccasion=eid|ramadan|regular`), or null to follow the calendar. */
export function parseCrowdOccasionOverride(search: string): CrowdOccasion | null {
  const raw = new URLSearchParams(search).get('crowdOccasion');
  if (raw === 'eid' || raw === 'regular') return raw;
  if (raw === 'ramadan' || raw === 'ramadan_night') return 'ramadan_night';
  return null;
}
