import { describe, expect, it } from 'vitest';
import { prayerTimes, rawdahState, splitDuration } from '../../src/domain/rawdah';

/** Madinah wall-clock time (UTC+3) → instant. */
const mad = (iso: string) => new Date(`${iso}+03:00`);
const madHour = (d: Date) => (d.getUTCHours() + 3) % 24 + d.getUTCMinutes() / 60;

describe('rawdah schedule (Gate 37)', () => {
  const day = '2026-10-04';
  const { fajr, isha } = prayerTimes(2026, 9, 4);

  it('computes plausible Fajr and Isha for Madinah (Umm al-Qura)', () => {
    expect(madHour(fajr)).toBeGreaterThan(4);
    expect(madHour(fajr)).toBeLessThan(5.5);
    expect(madHour(isha)).toBeGreaterThan(19);
    expect(madHour(isha)).toBeLessThan(21);
  });

  it('men from midnight until Fajr', () => {
    const s = rawdahState(mad(`${day}T01:30:00`));
    expect(s.turn).toBe('men');
    expect(s.until.getTime()).toBe(fajr.getTime());
  });

  it('women from Fajr until 10:00', () => {
    const s = rawdahState(new Date(fajr.getTime() + 60_000));
    expect(s.turn).toBe('women');
    expect(s.until.getTime()).toBe(mad(`${day}T10:00:00`).getTime());
  });

  it('men from 10:00 until Isha', () => {
    const s = rawdahState(mad(`${day}T10:00:00`));
    expect(s.turn).toBe('men');
    expect(s.until.getTime()).toBe(isha.getTime());
  });

  it('women from Isha until midnight', () => {
    const s = rawdahState(new Date(isha.getTime() + 60_000));
    expect(s.turn).toBe('women');
    expect(s.until.getTime()).toBe(mad('2026-10-05T00:00:00').getTime());
  });

  it('minutes left counts down to the switch', () => {
    const s = rawdahState(mad(`${day}T09:15:00`));
    expect(s.turn).toBe('women');
    expect(s.minutesLeft).toBe(45);
    expect(splitDuration(125)).toEqual({ h: 2, m: 5 });
  });
});
