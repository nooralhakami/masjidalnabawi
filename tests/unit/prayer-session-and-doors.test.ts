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
  isGateOpen,
  nearestMosqueDoor,
  openDoorwayBayCentres,
  resetMosqueDoors,
  subscribeMosqueDoors,
  toggleGateBay,
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
      expect([1, 2, 3, 5], `gate ${g.id}`).toContain(g.totalBays);
      expect(g.bays).toHaveLength(g.totalBays);
      expect(g.canToggle).toBe(!g.alwaysClosed && (!g.neverClosed || g.totalBays > 1));
      expect(bays(g)).toBe(g.openBays);
      // An open gate opens contiguous middle bays, never a side one alone.
      const open = g.bays.filter((b) => b.open).map((b) => b.bayIndex);
      if (open.length) expect(open).toEqual(open.map((_, i) => Math.min(...open) + i));
    }
  });

  it('Bab al-Salam and Bab Abi Bakr stay open; the five sealed gates never open', () => {
    const g1 = getGateDoorState(1)!;
    expect(g1.totalBays).toBe(1);
    expect(g1.openBays).toBe(1);
    expect(g1.open).toBe(true);
    expect(toggleGateDoor(1)).toMatchObject({ ok: false, open: true, reason: 'never_closed' });

    const g2 = getGateDoorState(2)!;
    expect(g2.totalBays).toBe(3);
    expect(g2.openBays).toBe(2);
    expect(g2.open).toBe(true);
    expect(toggleGateDoor(2)).toMatchObject({ ok: false, open: true, reason: 'never_closed' });

    // Gate 2 (3 bays) allows toggling individual bays while keeping at least 1 bay open.
    expect(toggleGateBay(2, 2)).toMatchObject({ ok: true, open: true });
    expect(getGateDoorState(2)!.openBays).toBe(3);
    expect(toggleGateBay(2, 1)).toMatchObject({ ok: true, open: false });
    expect(toggleGateBay(2, 2)).toMatchObject({ ok: true, open: false });
    expect(getGateDoorState(2)!.openBays).toBe(1);
    expect(toggleGateBay(2, 0)).toMatchObject({ ok: false, open: true, reason: 'never_closed' });

    for (const id of ONLY(ALWAYS_CLOSED_GATES)) {
      const g = getGateDoorState(id)!;
      expect(g.open, `gate ${id}`).toBe(false);
      expect(g.openBays).toBe(0);
      expect(g.canToggle).toBe(false);
      expect(toggleGateDoor(id)).toMatchObject({ ok: false, open: false, reason: 'always_closed' });
    }
    expect(ONLY(NEVER_CLOSED_GATES)).toEqual([1, 2]);
    expect(ONLY(ALWAYS_CLOSED_GATES)).toEqual([18, 23, 26, 31, 32]);
  });

  it('multi-bay gates open with realistic partial-open defaults and support both gate and single-bay toggling', () => {
    const g8 = getGateDoorState(8)!;
    expect(g8.totalBays).toBe(5);
    expect(g8.openBays).toBe(2);
    expect(g8.bays.map((b) => b.open)).toEqual([false, true, true, false, false]);
    const closed8 = toggleGateDoor(8);
    expect(closed8).toMatchObject({ ok: true, open: false });
    expect(closed8.gate!.openBays).toBe(0);
    expect(closed8.gate!.bays.every((b) => !b.open)).toBe(true);
    const open8 = toggleGateDoor(8);
    expect(open8).toMatchObject({ ok: true, open: true });
    expect(open8.gate!.openBays).toBe(2);
    expect(open8.gate!.bays.map((b) => b.open)).toEqual([false, true, true, false, false]);
    const singleBay8 = toggleGateBay(8, 0);
    expect(singleBay8).toMatchObject({ ok: true, open: true });
    expect(singleBay8.gate!.openBays).toBe(3);
    expect(singleBay8.gate!.bays.map((b) => b.open)).toEqual([true, true, true, false, false]);

    expect(getGateDoorState(4)).toMatchObject({ totalBays: 2, openBays: 1 });
    expect(getGateDoorState(37)).toMatchObject({ totalBays: 3, openBays: 2 });
    expect(getGateDoorState(6)).toMatchObject({ totalBays: 1, openBays: 1 });
    expect(getGateDoorState(32)).toMatchObject({ totalBays: 2, openBays: 0 });
  });

  it('the bays stand ordered along the wall tangent with real haram-3d.glb spacing (>= 2.5 m) around the gate center', () => {
    for (const g of getMosqueDoors().filter((d) => d.totalBays > 1)) {
      for (let i = 1; i < g.bays.length; i++) {
        const dx = g.bays[i].x - g.bays[i - 1].x;
        const dy = g.bays[i].y - g.bays[i - 1].y;
        const along = dx * g.tangent[0] + dy * g.tangent[1];
        const step = Math.hypot(dx, dy);
        expect(along, `gate ${g.id} bay ${i} ordered along tangent`).toBeGreaterThan(2.4);
        expect(step, `gate ${g.id} bay ${i} step`).toBeGreaterThanOrEqual(2.5);
        expect(step, `gate ${g.id} bay ${i} step`).toBeLessThanOrEqual(7.0);
      }
      const meanX = g.bays.reduce((s, b) => s + b.x, 0) / g.bays.length;
      const meanY = g.bays.reduce((s, b) => s + b.y, 0) / g.bays.length;
      expect(meanX, `gate ${g.id} meanX`).toBeCloseTo(g.x, 1);
      expect(meanY, `gate ${g.id} meanY`).toBeCloseTo(g.y, 1);
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

  it('the nearest doorway picks its gate, and the gate open state is what the portal paints', () => {
    const g = getGateDoorState(8)!;
    const bay = g.bays[Math.floor(g.totalBays / 2)];
    expect(nearestMosqueDoor(bay.x, bay.y)?.id).toBe(8);
    expect(nearestMosqueDoor(g.x + 500, g.y + 500)).toBeNull();
    // The real wall portal paints the open hall while its gate is open, the carved leaves when shut.
    expect(isGateOpen(8)).toBe(true);
    toggleGateDoor(8);
    expect(isGateOpen(8)).toBe(false);
    toggleGateDoor(8);
    expect(isGateOpen(8)).toBe(true);
    // Bab al-Salam's portal is always the open hall; a sealed gate's portal is always shut.
    expect(isGateOpen(1)).toBe(true);
    expect(isGateOpen(26)).toBe(false);
  });

  it('opening and closing publishes the bays a visitor can walk through', () => {
    const before = openDoorwayBayCentres();
    expect(before.filter((b) => b.gateId === 37)).toHaveLength(2);
    toggleGateDoor(37);
    expect(openDoorwayBayCentres().filter((b) => b.gateId === 37)).toEqual([]);
    toggleGateDoor(37);
    const again = openDoorwayBayCentres().filter((b) => b.gateId === 37);
    expect(again).toHaveLength(2);
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
