import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';

/** Al-Madinah, Saudi Arabia (UTC+3 all year, no DST). */
const MADINAH = new Coordinates(24.4672, 39.6111);
const UTC_OFFSET_MIN = 180;
const HOUR = 3_600_000;

export type RawdahTurn = 'women' | 'men';

export interface RawdahState {
  turn: RawdahTurn;
  /** When the current turn ends. */
  until: Date;
  /** Minutes left in the current turn (rounded up). */
  minutesLeft: number;
  isha: Date;
  fajr: Date;
}

/** Madinah calendar date (y, m0, d) for an instant. */
function madinahDate(now: Date): [number, number, number] {
  const shifted = new Date(now.getTime() + UTC_OFFSET_MIN * 60_000);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()];
}

/** Instant of a Madinah wall-clock hour on a Madinah date. */
function madinahTime(y: number, m: number, d: number, hour: number): Date {
  return new Date(Date.UTC(y, m, d, hour) - UTC_OFFSET_MIN * 60_000);
}

/** Fajr and Isha in Madinah for a Madinah date, Umm al-Qura method. */
export function prayerTimes(y: number, m: number, d: number): { fajr: Date; isha: Date } {
  // adhan reads the calendar day from the Date's local fields.
  const pt = new PrayerTimes(MADINAH, new Date(y, m, d, 12), CalculationMethod.UmmAlQura());
  return { fajr: pt.fajr, isha: pt.isha };
}

/**
 * Fixed rota at Gate 37:
 * women after Isha → midnight · men midnight → Fajr · women Fajr → 10:00 · men 10:00 → Isha.
 */
export function rawdahState(now: Date = new Date()): RawdahState {
  const [y, m, d] = madinahDate(now);
  const { fajr, isha } = prayerTimes(y, m, d);
  const midnightStart = madinahTime(y, m, d, 0);
  const ten = madinahTime(y, m, d, 10);
  const nextMidnight = new Date(midnightStart.getTime() + 24 * HOUR);

  let turn: RawdahTurn;
  let until: Date;
  const t = now.getTime();
  if (t < fajr.getTime()) {
    turn = 'men';
    until = fajr;
  } else if (t < ten.getTime()) {
    turn = 'women';
    until = ten;
  } else if (t < isha.getTime()) {
    turn = 'men';
    until = isha;
  } else {
    turn = 'women';
    until = nextMidnight;
  }
  return { turn, until, minutesLeft: Math.max(0, Math.ceil((until.getTime() - t) / 60_000)), isha, fajr };
}

/** Split minutes into hours and minutes for display. */
export function splitDuration(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}
