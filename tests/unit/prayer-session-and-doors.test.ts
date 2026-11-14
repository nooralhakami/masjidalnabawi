import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALHARAMAIN_MODELS } from '../../src/data-next/alharamain-3d';
import { POIS } from '../../src/data';
import {
  ALWAYS_CLOSED_GATES,
  NEVER_CLOSED_GATES,
  type MosqueDoorState,
  getGateDoorState,
  getMosqueDoors,
  mosqueDoorBaysGeoJSON,
  openDoorwayBayCentres,
  resetMosqueDoors,
  subscribeMosqueDoors,
  toggleGateDoor,
  toggleNearestMosqueDoor,
} from '../../src/domain/mosque-doors';
import {
  IQAMAH_DELAY_MINUTES,
  PRAYER_RAKAHS,
  QIBLA_HEADING_RAD,
  fridayOverflowStreetBounds,
  generateWorshipperPlacements,
  resolvePrayerSession,
  type PrayerPosture,
} from '../../src/domain/prayer-session';
import { nodePositions, parseGlbBuffer } from '../../src/map/glb-layer';

const canopies = readFileSync(join(__dirname, '../../public/models/haram-canopies.glb'));
const { gltf } = parseGlbBuffer(canopies.buffer.slice(canopies.byteOffset, canopies.byteOffset + canopies.byteLength) as ArrayBuffer);
const columnsLL = nodePositions(ALHARAMAIN_MODELS.find((m) => m.url.includes('canopies'))!, gltf);

/** 2026-11-10 is a Tuesday in Madinah; 2026-11-13 is a Friday. */
const TUESDAY = new Date('2026-11-10T02:00:00Z');
const FRIDAY = new Date('2026-11-13T06:00:00Z');
const minute = (base: Date, min: number) => new Date(base.getTime() + min * 60_000);

afterEach(() => resetMosqueDoors());

describe('the Mosque’s gates: multi-bay doors (owner, 2026-11-13)', () => {
  const bays = (g: MosqueDoorState) => g.bays.filter((b) => b.open).length;

  it('all 42 inner gates are doors, each with the bays its class gives it', () => {
    const gateIds = POIS.filter((p) => p.subCategory === 'gate_inner')
      .map((p) => p.id)
      .sort((a, b) => a - b);
    expect(gateIds).toHaveLength(42);
    const doors = getMosqueDoors();
    expect(doors.map((g) => g.id)).toEqual(gateIds);
    for (const g of doors) {
      expect(g.totalBays, `gate ${g.id}`).toBe([1, 3, 5].includes(g.totalBays) ? g.totalBays : -1);
      expect(g.bays).toHaveLength(g.totalBays);
      expect(g.canToggle).toBe(!g.alwaysClosed && !g.neverClosed);
      expect(bays(g)).toBe(g.openBays);
      // An open gate opens contiguous middle bays, never a side one alone.
      const open = g.bays.filter((b) => b.open).map((b) => b.bayIndex);
      if (open.length) expect(open).toEqual(open.map((_, i) => Math.min(...open) + i));
    }
  });

  it('Bab al-Salam and Bab Abi Bakr stay open; the five sealed gates never open', () => {
    for (const id of ONLY(NEVER_CLOSED_GATES)) {
      const g = getGateDoorState(id)!;
      expect(g.open, `gate ${id}`).toBe(true);
      expect(g.bays.every((b) => b.open)).toBe(true);
      const r = toggleGateDoor(id);
      expect(r).toMatchObject({ ok: false, open: true, reason: 'never_closed' });
      expect(getGateDoorState(id)!.open).toBe(true);
    }
    for (const id of ONLY(ALWAYS_CLOSED_GATES)) {
      const g = getGateDoorState(id)!;
      expect(g.open, `gate ${id}`).toBe(false);
      expect(g.openBays).toBe(0);
      expect(g.canToggle).toBe(false);
      expect(toggleGateDoor(id)).toMatchObject({ ok: false, open: false, reason: 'always_closed' });
    }
    expect(ONLY(ALWAYS_CLOSED_GATES)).toEqual([18, 23, 26, 31, 32]);
  });

  it('a numbered gate opens two of its three bays; closing it leaves the leaves shut, opening again brings them back', () => {
    const g = getGateDoorState(6)!;
    expect(g.totalBays).toBe(3);
    expect(g.openBays).toBe(2);
    const closed = toggleGateDoor(6);
    expect(closed).toMatchObject({ ok: true, open: false });
    expect(closed.gate!.openBays).toBe(0);
    expect(closed.gate!.bays.every((b) => !b.open)).toBe(true);
    const open = toggleGateDoor(6);
    expect(open).toMatchObject({ ok: true, open: true });
    expect(open.gate!.bays.map((b) => b.open)).toEqual([true, true, false]);
  });

  it('the bays stand 3.2 m apart along the wall, the middle one on the gate', () => {
    for (const g of getMosqueDoors().filter((d) => d.totalBays > 1)) {
      const dx = g.tangent[0] * 3.2;
      const dy = g.tangent[1] * 3.2;
      for (let i = 1; i < g.bays.length; i++) {
        expect(g.bays[i].x - g.bays[i - 1].x, `gate ${g.id} bay ${i}`).toBeCloseTo(dx, 6);
        expect(g.bays[i].y - g.bays[i - 1].y, `gate ${g.id} bay ${i}`).toBeCloseTo(dy, 6);
      }
      const middle = g.bays[(g.totalBays - 1) / 2];
      expect(middle.x).toBeCloseTo(g.x, 6);
      expect(middle.y).toBeCloseTo(g.y, 6);
    }
  });

  it('a tap at a bay toggles its gate; a tap in the street toggles nothing', () => {
    const g = getGateDoorState(37)!;
    const bay = g.bays[Math.floor(g.totalBays / 2)];
    expect(toggleNearestMosqueDoor(bay.x, bay.y)).toMatchObject({ ok: true, open: false });
    expect(getGateDoorState(37)!.open).toBe(false);
    expect(toggleNearestMosqueDoor(g.x + 120, g.y + 120, 14)).toMatchObject({ ok: false, reason: 'not_found' });
    // A gate that cannot be toggled says why, and stays as it was.
    expect(toggleNearestMosqueDoor(getGateDoorState(1)!.x, getGateDoorState(1)!.y)).toMatchObject({ ok: false, reason: 'never_closed' });
  });

  it('the 3D doorway bays are one polygon each: a brass threshold when open, teak leaves when shut', () => {
    const doors = getMosqueDoors();
    const fc = mosqueDoorBaysGeoJSON();
    expect(fc.features).toHaveLength(doors.reduce((n, g) => n + g.totalBays, 0));
    for (const f of fc.features) {
      const p = f.properties as Record<string, unknown>;
      expect(f.geometry.coordinates[0]).toHaveLength(5);
      expect(f.geometry.coordinates[0][0]).toEqual(f.geometry.coordinates[0][4]);
      if (p.open) {
        expect(p.height).toBe(0.45);
        expect(p.color).toBe('#d4af37');
        expect(p.opacity).toBe(0.92);
      } else {
        expect(p.height).toBe(5.4);
        expect(p.color).toBe(p.alwaysClosed ? '#3d2414' : '#5c381c');
        expect(p.opacity).toBe(0.96);
      }
    }
    // The sealed gates' leaves are read as shut even after a tap.
    toggleGateDoor(18);
    const sealed = mosqueDoorBaysGeoJSON().features.filter((f) => (f.properties as Record<string, unknown>).gateId === 18);
    expect(sealed.every((f) => (f.properties as Record<string, unknown>).open === false)).toBe(true);
  });

  it('opening and closing publishes the bays a visitor can walk through', () => {
    const before = openDoorwayBayCentres();
    const open37 = getGateDoorState(37)!;
    expect(before.filter((b) => b.gateId === 37)).toHaveLength(open37.totalBays === 5 ? 3 : 2);
    toggleGateDoor(37);
    expect(openDoorwayBayCentres().filter((b) => b.gateId === 37)).toEqual([]);
    toggleGateDoor(37);
    const again = openDoorwayBayCentres().filter((b) => b.gateId === 37);
    expect(again).toHaveLength(3);
    for (const bay of again) {
      const gate = getGateDoorState(37)!;
      expect(bay.x).toBeCloseTo(gate.bays[bay.bayIndex].x, 6);
      expect(bay.outward).toEqual(gate.outward);
    }
  });

  it('a change reaches the map once, and unsubscribing stops it', () => {
    let seen = 0;
    const off = subscribeMosqueDoors(() => seen++);
    toggleGateDoor(6);
    toggleGateDoor(6);
    off();
    toggleGateDoor(6);
    // The gate is left as it started, for the tests after this one.
    toggleGateDoor(6);
    expect(seen).toBe(2);
  });
});

describe('the prayer session: iqamah, rak‘ahs and the Friday khutbah', () => {
  /** Adhan times chosen so only the prayer under test can be in progress. */
  const adhans = {
    fajr: minute(TUESDAY, -600),
    dhuhr: minute(TUESDAY, -300),
    asr: TUESDAY,
    maghrib: minute(TUESDAY, 120),
    isha: minute(TUESDAY, 200),
  };

  it('the years-long practice: 15 minutes between the Asr adhan and the iqamah', () => {
    expect(IQAMAH_DELAY_MINUTES).toEqual({ fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15 });
    const waiting = resolvePrayerSession(minute(TUESDAY, 14.9), adhans);
    expect(waiting).toMatchObject({ phase: 'iqamah_wait', prayer: 'asr', posture: 'juloos', currentRakah: 0, streetOverflow: false });
    expect(resolvePrayerSession(TUESDAY, adhans).phase).toBe('iqamah_wait');
    expect(resolvePrayerSession(minute(TUESDAY, 15), adhans)).toMatchObject({ phase: 'fard_prayer', prayer: 'asr', currentRakah: 1 });
    // Four raka‘ahs of 2.5 minutes; after them the session is over (Maghrib is still ahead).
    expect(resolvePrayerSession(minute(TUESDAY, 15 + 4 * 2.5), adhans).phase).toBe('off_prayer');
  });

  it('the fard has its rak‘ah count, and every posture of the prayer is drawn', () => {
    expect(PRAYER_RAKAHS).toEqual({ fajr: 2, dhuhr: 4, asr: 4, maghrib: 3, isha: 4, jummah: 2 });
    const seen = new Set<PrayerPosture>();
    for (let i = 0; i < 100; i++) {
      // 15 min after the adhan, then every six seconds to just before the end of the fourth rak‘ah.
      const at = new Date(TUESDAY.getTime() + (15 * 60 + i * 6) * 1000);
      const s = resolvePrayerSession(at, adhans);
      expect(s.phase, `second ${i * 6}`).toBe('fard_prayer');
      expect(s.rakahCount).toBe(4);
      expect(s.currentRakah).toBeGreaterThanOrEqual(1);
      expect(s.currentRakah).toBeLessThanOrEqual(4);
      seen.add(s.posture);
    }
    expect([...seen].sort()).toEqual(['juloos', 'ruku', 'standing', 'sujud']);
  });

  it('on Friday the khutbah holds the rows seated, then the two-rak‘ah prayer follows', () => {
    const fridayAdhans = {
      fajr: minute(FRIDAY, -600),
      dhuhr: FRIDAY,
      asr: minute(FRIDAY, 200),
      maghrib: minute(FRIDAY, 400),
      isha: minute(FRIDAY, 500),
    };
    const khutbah = resolvePrayerSession(minute(FRIDAY, 10), fridayAdhans);
    expect(khutbah).toMatchObject({ phase: 'friday_khutbah', prayer: 'dhuhr', rakahCount: 2, posture: 'juloos', isFriday: true, streetOverflow: true });
    expect(khutbah.densityMultiplier).toBeGreaterThan(1);
    const prayer = resolvePrayerSession(minute(FRIDAY, 25), fridayAdhans);
    expect(prayer).toMatchObject({ phase: 'friday_prayer', rakahCount: 2, isFriday: true, streetOverflow: true });
    expect(prayer.densityMultiplier).toBeGreaterThan(khutbah.densityMultiplier);
    expect(resolvePrayerSession(minute(FRIDAY, 40), fridayAdhans)).toMatchObject({ phase: 'off_prayer', isFriday: true, streetOverflow: false });
  });

  it('the preview links name a scene and its count, and nothing else does', () => {
    const fajr = resolvePrayerSession(TUESDAY, undefined, 'fajr');
    expect(fajr).toMatchObject({ phase: 'fard_prayer', prayer: 'fajr', rakahCount: 2, streetOverflow: false });
    expect(resolvePrayerSession(TUESDAY, undefined, 'isha')).toMatchObject({ rakahCount: 4, phase: 'fard_prayer' });
    expect(resolvePrayerSession(TUESDAY, undefined, 'jummah_khutbah')).toMatchObject({ phase: 'friday_khutbah', isFriday: true, streetOverflow: true });
    expect(resolvePrayerSession(TUESDAY, undefined, 'jummah_prayer')).toMatchObject({ phase: 'friday_prayer', rakahCount: 2 });
    expect(resolvePrayerSession(TUESDAY, undefined, 'off_prayer')).toMatchObject({ phase: 'off_prayer', prayer: null, densityMultiplier: 0.3 });
  });
});

describe('the rows: courtyards, the Friday overflow, and the families (owner, 2026-11-13)', () => {
  it('a weekday congregation keeps to the Mosque; only Friday spills into the streets', () => {
    const weekday = generateWorshipperPlacements(resolvePrayerSession(TUESDAY, undefined, 'asr'), { columns: columnsLL, maxTotal: 1200 });
    const zones = new Set(weekday.map((p) => p.zoneKind));
    expect(zones.has('interior')).toBe(true);
    expect(zones.has('courtyard')).toBe(true);
    expect(zones.has('west_street')).toBe(false);
    expect(zones.has('north_street')).toBe(false);
    for (const p of weekday) expect(p.heading).toBeCloseTo(QIBLA_HEADING_RAD, 6);

    const friday = generateWorshipperPlacements(resolvePrayerSession(TUESDAY, undefined, 'jummah_prayer'), { columns: columnsLL, maxTotal: 1200 });
    const fridayZones = new Set(friday.map((p) => p.zoneKind));
    expect(fridayZones.has('west_street')).toBe(true);
    expect(fridayZones.has('north_street')).toBe(true);
    // Every street row stays on the streets the owner drew, not in the courtyards.
    const { westStreet, northStreet } = fridayOverflowStreetBounds();
    for (const p of friday.filter((w) => w.zoneKind === 'west_street')) {
      expect(p.x).toBeGreaterThanOrEqual(westStreet.minX);
      expect(p.x).toBeLessThanOrEqual(westStreet.maxX);
      expect(p.z).toBeGreaterThanOrEqual(westStreet.minZ);
      expect(p.z).toBeLessThanOrEqual(westStreet.maxZ);
    }
    for (const p of friday.filter((w) => w.zoneKind === 'north_street')) {
      expect(p.x).toBeGreaterThanOrEqual(northStreet.minX);
      expect(p.x).toBeLessThanOrEqual(northStreet.maxX);
      expect(p.z).toBeGreaterThanOrEqual(northStreet.minZ);
      expect(p.z).toBeLessThanOrEqual(northStreet.maxZ);
    }
    // Rows, not a crowd: the same Qibla heading and the session's posture all through.
    for (const p of friday) {
      expect(p.heading).toBeCloseTo(QIBLA_HEADING_RAD, 6);
      expect(p.posture).toBe(resolvePrayerSession(TUESDAY, undefined, 'jummah_prayer').posture);
    }
    expect(weekday.length).toBeLessThanOrEqual(1200);
    expect(friday.length).toBeLessThanOrEqual(1200);
  });

  it('between the prayers the families are rarer in the fenced courtyards than in the Annex', () => {
    const places = generateWorshipperPlacements(resolvePrayerSession(TUESDAY, undefined, 'off_prayer'), { columns: columnsLL, maxTotal: 4000 });
    const share = (zone: 'courtyard' | 'western_annex') => {
      const inZone = places.filter((p) => p.zoneKind === zone);
      const family = inZone.filter((p) => p.activity === 'family_group');
      return { inZone: inZone.length, family: family.length, share: family.length / Math.max(1, inZone.length) };
    };
    const courtyard = share('courtyard');
    const annex = share('western_annex');
    expect(courtyard.family).toBeGreaterThan(0);
    expect(annex.family).toBeGreaterThan(0);
    expect(annex.share).toBeGreaterThan(courtyard.share);
    // A family is a grown figure and a child at 0.62 of it.
    for (const child of places.filter((p) => p.isChild)) {
      expect(child.activity).toBe('family_group');
      expect(child.scale).toBe(0.62);
      expect(places.some((p) => p.activity === 'family_group' && !p.isChild && Math.hypot(p.x - child.x, p.z - child.z) < 1.5)).toBe(true);
    }
    // The readers sit with a rehal; no one else does.
    for (const p of places.filter((p) => p.hasRehal)) expect(p.activity).toBe('quran_reading');
  });
});

describe('the interior view is the visitor’s choice, never the app’s (owner, 2026-11-13)', () => {
  const ROOT = join(__dirname, '../..');
  const text = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  it('a fix inside the Mosque raises the optional banner, it does not cut the roof away', () => {
    const trip = text('src/app/trip.ts');
    expect(trip).not.toMatch(/interiorView\s*\.\s*value\s*=/);
    expect(trip).toContain('never auto-enable interiorView');
  });

  it('the hall opens only from ?interior=1 or the visitor’s own tap', () => {
    expect(text('src/state/store.ts')).toMatch(/interiorView = signal<boolean>\(false\)/);
    expect(text('src/app/map-main.tsx')).toMatch(/params\.get\('interior'\) === '1'\) interiorView\.value = true/);
  });
});

/** A set's ids in the order the tests read them. */
function ONLY(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b);
}
