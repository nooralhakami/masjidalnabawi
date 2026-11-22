import { describe, expect, it } from 'vitest';
import { crowdOccasionAt, hijriMonthDay, OCCASION_CROWD, parseCrowdOccasionOverride } from '../../src/domain/crowd-occasion';
import { generateWorshipperPlacements, resolvePrayerSession } from '../../src/domain/prayer-session';

/** A Madinah wall-clock time (UTC+3) as an instant. */
const madinah = (iso: string) => new Date(`${iso}+03:00`);

describe('crowd occasions (owner, 2026-11-22): Eid fullest, Ramadan nights a little less, every other day medium', () => {
  it('reads the Umm al-Qura calendar in Madinah', () => {
    expect(hijriMonthDay(madinah('2026-03-20T09:00'))).toEqual([10, 1]);
    expect(hijriMonthDay(madinah('2026-05-27T09:00'))).toEqual([12, 10]);
    expect(hijriMonthDay(madinah('2026-03-01T12:00'))).toEqual([9, 12]);
  });

  it('places the occasion by the Islamic day, which starts at Maghrib', () => {
    // An ordinary day, morning and night: medium.
    expect(crowdOccasionAt(madinah('2026-11-22T10:00'))).toBe('regular');
    expect(crowdOccasionAt(madinah('2026-11-22T22:00'))).toBe('regular');
    // Ramadan: busy from Maghrib to Fajr, ordinary by day.
    expect(crowdOccasionAt(madinah('2026-03-01T22:00'))).toBe('ramadan_night');
    expect(crowdOccasionAt(madinah('2026-03-02T02:30'))).toBe('ramadan_night');
    expect(crowdOccasionAt(madinah('2026-03-01T12:00'))).toBe('regular');
    // The eve of 1 Ramadan (29 Sha'ban after Maghrib) is already a Ramadan night.
    expect(crowdOccasionAt(madinah('2026-02-17T21:00'))).toBe('ramadan_night');
    // Eid al-Fitr and Eid al-Adha mornings, Fajr to Dhuhr; the night of Eid al-Fitr is busy too.
    expect(crowdOccasionAt(madinah('2026-03-20T06:30'))).toBe('eid');
    expect(crowdOccasionAt(madinah('2026-05-27T06:30'))).toBe('eid');
    expect(crowdOccasionAt(madinah('2026-03-20T02:00'))).toBe('ramadan_night');
    expect(crowdOccasionAt(madinah('2026-03-20T16:00'))).toBe('regular');
  });

  it('takes a preview override from the link', () => {
    expect(parseCrowdOccasionOverride('?crowdOccasion=eid')).toBe('eid');
    expect(parseCrowdOccasionOverride('?crowdOccasion=ramadan')).toBe('ramadan_night');
    expect(parseCrowdOccasionOverride('?crowdOccasion=regular')).toBe('regular');
    expect(parseCrowdOccasionOverride('?crowdOccasion=hajj')).toBeNull();
    expect(parseCrowdOccasionOverride('')).toBeNull();
  });

  it('keeps the ordinary day as it was, and orders Eid > Ramadan night > ordinary', () => {
    expect(OCCASION_CROWD.regular).toEqual({ scale: 1, streets: false });
    expect(OCCASION_CROWD.eid.scale).toBeGreaterThan(OCCASION_CROWD.ramadan_night.scale);
    expect(OCCASION_CROWD.ramadan_night.scale).toBeGreaterThan(OCCASION_CROWD.regular.scale);

    const isha = resolvePrayerSession(madinah('2026-11-22T10:00'), undefined, 'isha');
    const plain = generateWorshipperPlacements(isha, { maxTotal: 900 });
    const regular = generateWorshipperPlacements(isha, { maxTotal: 900, occasion: 'regular' });
    expect(regular).toEqual(plain);
    expect(regular.some((w) => w.zoneKind === 'west_street' || w.zoneKind === 'north_street')).toBe(false);

    const ramadan = generateWorshipperPlacements(isha, { maxTotal: Math.round(900 * OCCASION_CROWD.ramadan_night.scale), occasion: 'ramadan_night' });
    const eid = generateWorshipperPlacements(isha, { maxTotal: Math.round(900 * OCCASION_CROWD.eid.scale), occasion: 'eid' });
    expect(ramadan.length).toBeGreaterThan(regular.length);
    expect(eid.length).toBeGreaterThan(ramadan.length);
    expect(ramadan.some((w) => w.zoneKind === 'west_street' || w.zoneKind === 'north_street')).toBe(true);
    expect(eid.some((w) => w.zoneKind === 'west_street' || w.zoneKind === 'north_street')).toBe(true);
  });

  it('sits Eid morning in rows between its prayers, where an ordinary morning is scattered', () => {
    const quiet = resolvePrayerSession(madinah('2026-11-22T10:00'), undefined, 'off_prayer');
    const ordinary = generateWorshipperPlacements(quiet, { maxTotal: 420 });
    expect(ordinary.some((w) => w.activity === 'khutbah_listening')).toBe(false);
    const eid = generateWorshipperPlacements(quiet, { maxTotal: 1800, occasion: 'eid' });
    expect(eid.length).toBeGreaterThan(ordinary.length * 2);
    expect(eid.every((w) => w.activity === 'khutbah_listening' && w.posture === 'juloos')).toBe(true);
    expect(eid.some((w) => w.zoneKind === 'north_street')).toBe(true);
  });
});
