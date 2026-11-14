import { WOMEN_AREAS } from '../data-next/women-areas';
import { fromModelMetres, toModelMetres } from './frames';
import { QIBLA_BEARING_DEG } from './geo';
import {
  INTERIOR_MAIN_BOUNDS,
  INTERIOR_SOUTH_BOUNDS,
  RAWDAH_INTERIOR_BOUNDS,
  interiorColumnCentres,
  isPointOnInteriorWalkway,
} from './interior-layout';
import { MADINAH_UTC_OFFSET_MIN, PRAYERS, madinahDate, prayersOn, type PrayerName } from './prayer';
import { currentRugLayout, rugLayout } from './rug-layout';

/** Delay between Adhan and Iqamah in minutes at Al-Masjid an-Nabawi. */
export const IQAMAH_DELAY_MINUTES: Readonly<Record<PrayerName, number>> = {
  fajr: 20,
  dhuhr: 15,
  asr: 15,
  maghrib: 10,
  isha: 15,
};

/** Rak'ah count per Fard congregation (plus Friday Jumu'ah). */
export const PRAYER_RAKAHS: Readonly<Record<PrayerName | 'jummah', number>> = {
  fajr: 2,
  dhuhr: 4,
  asr: 4,
  maghrib: 3,
  isha: 4,
  jummah: 2,
};

export type PrayerPhase = 'off_prayer' | 'iqamah_wait' | 'fard_prayer' | 'friday_khutbah' | 'friday_prayer';
export type PrayerPosture = 'standing' | 'ruku' | 'sujud' | 'juloos';
export type WorshipperActivity =
  | 'congregational_prayer'
  | 'khutbah_listening'
  | 'individual_prayer'
  | 'quran_reading'
  | 'friends_circle'
  | 'family_group';

export type PrayerDemoOverride =
  | PrayerName
  | 'jummah_khutbah'
  | 'jummah_prayer'
  | 'off_prayer';

export interface PrayerSessionState {
  phase: PrayerPhase;
  prayer: PrayerName | null;
  rakahCount: number;
  currentRakah: number;
  posture: PrayerPosture;
  isFriday: boolean;
  streetOverflow: boolean;
  densityMultiplier: number;
}

export interface WorshipperPlacement {
  /** glTF model East coordinate (metres). */
  x: number;
  /** glTF model South coordinate (metres). */
  z: number;
  /** Facing angle in CrowdLayer radians (0 = east, PI/2 = south). */
  heading: number;
  posture: PrayerPosture;
  activity: WorshipperActivity;
  isWoman: boolean;
  isChild: boolean;
  scale: number;
  hasRehal: boolean;
  zoneKind: 'interior' | 'rawdah' | 'courtyard' | 'western_annex' | 'west_street' | 'north_street';
}

export interface GenerateOptions {
  columns?: readonly (readonly [number, number])[];
  maxTotal?: number;
}

const VALID_DEMOS = new Set<PrayerDemoOverride>([
  'fajr',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
  'jummah_khutbah',
  'jummah_prayer',
  'off_prayer',
]);

/** Facing angle toward Makkah (`176.24°`) in CrowdLayer radians (where PI/2 = 180° south). */
export const QIBLA_HEADING_RAD = ((QIBLA_BEARING_DEG - 90) * Math.PI) / 180;

export function parsePrayerDemoOverride(search: string): PrayerDemoOverride | null {
  const value = new URLSearchParams(search).get('prayerDemo');
  if (!value || !VALID_DEMOS.has(value as PrayerDemoOverride)) return null;
  return value as PrayerDemoOverride;
}

function postureAtProgress(rakahCount: number, elapsedPrayerMin: number): { currentRakah: number; posture: PrayerPosture } {
  const minPerRakah = 2.5;
  const clamped = Math.max(0, Math.min(rakahCount * minPerRakah - 0.001, elapsedPrayerMin));
  const zeroBased = Math.floor(clamped / minPerRakah);
  const currentRakah = Math.min(rakahCount, zeroBased + 1);
  const f = (clamped - zeroBased * minPerRakah) / minPerRakah;
  if (f < 0.44) return { currentRakah, posture: 'standing' };
  if (f < 0.56) return { currentRakah, posture: 'ruku' };
  if (f < 0.65) return { currentRakah, posture: 'standing' };
  if (f < 0.77) return { currentRakah, posture: 'sujud' };
  if (f < 0.85) return { currentRakah, posture: 'juloos' };
  if (f < 0.96) return { currentRakah, posture: 'sujud' };
  return { currentRakah, posture: currentRakah === 2 || currentRakah === rakahCount ? 'juloos' : 'standing' };
}

export function resolvePrayerSession(
  now: Date = new Date(),
  adhanTimes?: Partial<Record<PrayerName, number | Date>>,
  demoOverride?: PrayerDemoOverride | null,
): PrayerSessionState {
  if (demoOverride) {
    if (demoOverride === 'off_prayer') {
      return {
        phase: 'off_prayer',
        prayer: null,
        rakahCount: 0,
        currentRakah: 0,
        posture: 'juloos',
        isFriday: false,
        streetOverflow: false,
        densityMultiplier: 0.3,
      };
    }
    if (demoOverride === 'jummah_khutbah') {
      return {
        phase: 'friday_khutbah',
        prayer: 'dhuhr',
        rakahCount: PRAYER_RAKAHS.jummah,
        currentRakah: 0,
        posture: 'juloos',
        isFriday: true,
        streetOverflow: true,
        densityMultiplier: 1.85,
      };
    }
    if (demoOverride === 'jummah_prayer') {
      const cycle = ((now.getTime() / 1000) % 24) / 24;
      const { currentRakah, posture } = postureAtProgress(PRAYER_RAKAHS.jummah, cycle * (PRAYER_RAKAHS.jummah * 2.5));
      return {
        phase: 'friday_prayer',
        prayer: 'dhuhr',
        rakahCount: PRAYER_RAKAHS.jummah,
        currentRakah,
        posture,
        isFriday: true,
        streetOverflow: true,
        densityMultiplier: 2.0,
      };
    }
    const rakahCount = PRAYER_RAKAHS[demoOverride];
    const cycle = ((now.getTime() / 1000) % (rakahCount * 12)) / (rakahCount * 12);
    const { currentRakah, posture } = postureAtProgress(rakahCount, cycle * (rakahCount * 2.5));
    return {
      phase: 'fard_prayer',
      prayer: demoOverride,
      rakahCount,
      currentRakah,
      posture,
      isFriday: false,
      streetOverflow: false,
      densityMultiplier: 1.0,
    };
  }

  const shifted = new Date(now.getTime() + MADINAH_UTC_OFFSET_MIN * 60_000);
  const isFriday = shifted.getUTCDay() === 5;
  const [y, m, d] = madinahDate(now);
  const defaults = prayersOn(y, m, d);
  const nowMs = now.getTime();

  for (const prayer of PRAYERS) {
    const rawAdhan = adhanTimes?.[prayer] ?? defaults[prayer];
    const adhanMs = rawAdhan instanceof Date ? rawAdhan.getTime() : rawAdhan;
    const elapsedMin = (nowMs - adhanMs) / 60_000;
    if (elapsedMin < 0) continue;

    if (isFriday && prayer === 'dhuhr') {
      if (elapsedMin < 20) {
        return {
          phase: 'friday_khutbah',
          prayer: 'dhuhr',
          rakahCount: PRAYER_RAKAHS.jummah,
          currentRakah: 0,
          posture: 'juloos',
          isFriday: true,
          streetOverflow: true,
          densityMultiplier: 1.85,
        };
      }
      if (elapsedMin < 32) {
        const { currentRakah, posture } = postureAtProgress(PRAYER_RAKAHS.jummah, ((elapsedMin - 20) / 12) * (PRAYER_RAKAHS.jummah * 2.5));
        return {
          phase: 'friday_prayer',
          prayer: 'dhuhr',
          rakahCount: PRAYER_RAKAHS.jummah,
          currentRakah,
          posture,
          isFriday: true,
          streetOverflow: true,
          densityMultiplier: 2.0,
        };
      }
      continue;
    }

    const delay = IQAMAH_DELAY_MINUTES[prayer];
    const rakahCount = PRAYER_RAKAHS[prayer];
    const prayerDurationMin = rakahCount * 2.5;
    if (elapsedMin < delay) {
      return {
        phase: 'iqamah_wait',
        prayer,
        rakahCount,
        currentRakah: 0,
        posture: 'juloos',
        isFriday,
        streetOverflow: false,
        densityMultiplier: 0.72,
      };
    }
    if (elapsedMin < delay + prayerDurationMin) {
      const { currentRakah, posture } = postureAtProgress(rakahCount, elapsedMin - delay);
      return {
        phase: 'fard_prayer',
        prayer,
        rakahCount,
        currentRakah,
        posture,
        isFriday,
        streetOverflow: false,
        densityMultiplier: 1.0,
      };
    }
  }

  return {
    phase: 'off_prayer',
    prayer: null,
    rakahCount: 0,
    currentRakah: 0,
    posture: 'juloos',
    isFriday,
    streetOverflow: false,
    densityMultiplier: 0.3,
  };
}

let cachedWomenModelRings: (readonly [number, number])[][][] | null = null;
function womenModelRings(): (readonly [number, number])[][][] {
  if (cachedWomenModelRings) return cachedWomenModelRings;
  cachedWomenModelRings = WOMEN_AREAS.map((area) => [area.zone.map(([lat, lng]) => toModelMetres([lng, lat]))]);
  return cachedWomenModelRings;
}

function pointInRing(x: number, z: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function isWomenCourtyardPoint(x: number, z: number): boolean {
  for (const [ring] of womenModelRings()) {
    if (pointInRing(x, z, ring)) return true;
  }
  return false;
}

function hash01(seed: number): number {
  let x = (seed ^ 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Generates deterministic worshipper placements across the Mosque interior, courtyard carpets,
 * Western Annex areas, and Friday street overflow zones (`West` + `North` surrounding streets).
 */
export function generateWorshipperPlacements(
  session: PrayerSessionState,
  opts: GenerateOptions = {},
): WorshipperPlacement[] {
  const layout = opts.columns ? rugLayout(opts.columns) : currentRugLayout();
  const cols = interiorColumnCentres();
  const out: WorshipperPlacement[] = [];
  const cap = opts.maxTotal ?? (session.streetOverflow ? 2200 : session.phase === 'fard_prayer' ? 1600 : 700);
  const congregational = session.phase === 'fard_prayer' || session.phase === 'friday_khutbah' || session.phase === 'friday_prayer';

  const nearInteriorColumn = (x: number, z: number) => cols.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 1.5);

  if (congregational) {
    const activity: WorshipperActivity = session.phase === 'friday_khutbah' ? 'khutbah_listening' : 'congregational_prayer';

    // 1. Interior Mosque halls (strictly men inside main halls & Rawdah; avoid walkways & columns)
    const interiorStepX = 3.2;
    const interiorStepZ = 3.4;
    for (let z = INTERIOR_MAIN_BOUNDS.zMin + 6; z <= INTERIOR_MAIN_BOUNDS.zMax - 6 && out.length < cap * 0.45; z += interiorStepZ) {
      for (let x = INTERIOR_MAIN_BOUNDS.xMin + 6; x <= INTERIOR_MAIN_BOUNDS.xMax - 6; x += interiorStepX) {
        if (isPointOnInteriorWalkway(x, z, 0.8) || nearInteriorColumn(x, z)) continue;
        out.push({
          x,
          z,
          heading: QIBLA_HEADING_RAD,
          posture: session.posture,
          activity,
          isWoman: false,
          isChild: false,
          scale: 1,
          hasRehal: false,
          zoneKind: 'interior',
        });
      }
    }
    for (let z = INTERIOR_SOUTH_BOUNDS.zMin + 4; z <= INTERIOR_SOUTH_BOUNDS.zMax - 4 && out.length < cap * 0.5; z += 3.0) {
      for (let x = INTERIOR_SOUTH_BOUNDS.xMin + 4; x <= INTERIOR_SOUTH_BOUNDS.xMax - 4; x += 3.0) {
        if (nearInteriorColumn(x, z)) continue;
        const inRawdah =
          x >= RAWDAH_INTERIOR_BOUNDS.xMin &&
          x <= RAWDAH_INTERIOR_BOUNDS.xMax &&
          z >= RAWDAH_INTERIOR_BOUNDS.zMin &&
          z <= RAWDAH_INTERIOR_BOUNDS.zMax;
        out.push({
          x,
          z,
          heading: QIBLA_HEADING_RAD,
          posture: session.posture,
          activity,
          isWoman: false,
          isChild: false,
          scale: 1,
          hasRehal: false,
          zoneKind: inRawdah ? 'rawdah' : 'interior',
        });
      }
    }

    // 2. Courtyard & Western Annex rugs (men/women segregated strictly by WOMEN_AREAS)
    const rugStep = session.isFriday ? 1 : 2;
    for (let i = 0; i < layout.rugs.length && out.length < (session.streetOverflow ? cap * 0.82 : cap); i += rugStep) {
      const rug = layout.rugs[i];
      const women = isWomenCourtyardPoint(rug.x, rug.z);
      const offsets = session.isFriday ? [-1.6, 0, 1.6] : [-1.2, 1.2];
      for (const ox of offsets) {
        if (out.length >= (session.streetOverflow ? cap * 0.82 : cap)) break;
        out.push({
          x: rug.x + ox,
          z: rug.z,
          heading: QIBLA_HEADING_RAD,
          posture: session.posture,
          activity,
          isWoman: women,
          isChild: false,
          scale: 1,
          hasRehal: false,
          zoneKind: rug.courtyard ? 'courtyard' : 'western_annex',
        });
      }
    }

    // 3. Friday street overflow onto surrounding West and North streets
    if (session.streetOverflow) {
      // West road (immediately west of Courtyard Sector 4 / Abu Bakr road)
      for (let z = -158; z <= 70 && out.length < cap * 0.91; z += 4.2) {
        for (let x = -444; x <= -406; x += 3.8) {
          if (out.length >= cap * 0.91) break;
          out.push({
            x,
            z,
            heading: QIBLA_HEADING_RAD,
            posture: session.posture,
            activity,
            isWoman: false,
            isChild: false,
            scale: 1,
            hasRehal: false,
            zoneKind: 'west_street',
          });
        }
      }
      // North road (immediately north of Courtyard Sector 1)
      for (let z = -506; z <= -476 && out.length < cap; z += 4.0) {
        for (let x = -380; x <= 240; x += 5.5) {
          if (out.length >= cap) break;
          out.push({
            x,
            z,
            heading: QIBLA_HEADING_RAD,
            posture: session.posture,
            activity,
            isWoman: false,
            isChild: false,
            scale: 1,
            hasRehal: false,
            zoneKind: 'north_street',
          });
        }
      }
    }

    return out;
  }

  // Off-prayer / Iqamah-wait scene: lighter scattered worshippers inside Mosque, courtyards, and Annex.
  let seed = 101;
  // Interior Mosque: individual 2-rak'ah pray-ers, seated Quran readers near pillars, and friend circles.
  for (let z = INTERIOR_MAIN_BOUNDS.zMin + 10; z <= INTERIOR_MAIN_BOUNDS.zMax - 10 && out.length < cap * 0.35; z += 14) {
    for (let x = INTERIOR_MAIN_BOUNDS.xMin + 12; x <= INTERIOR_MAIN_BOUNDS.xMax - 12; x += 14) {
      if (isPointOnInteriorWalkway(x, z, 1.2) || nearInteriorColumn(x, z)) continue;
      const r = hash01(seed++);
      if (r > (session.phase === 'iqamah_wait' ? 0.72 : 0.42)) continue;
      const roll = hash01(seed++ * 7);
      if (roll < 0.32) {
        const indPosture = postureAtProgress(2, hash01(seed++) * 5).posture;
        out.push({
          x,
          z,
          heading: QIBLA_HEADING_RAD,
          posture: indPosture,
          activity: 'individual_prayer',
          isWoman: false,
          isChild: false,
          scale: 1,
          hasRehal: false,
          zoneKind: 'interior',
        });
      } else if (roll < 0.74) {
        out.push({
          x,
          z,
          heading: QIBLA_HEADING_RAD + (hash01(seed++) - 0.5) * 0.5,
          posture: 'juloos',
          activity: 'quran_reading',
          isWoman: false,
          isChild: false,
          scale: 1,
          hasRehal: true,
          zoneKind: 'interior',
        });
      } else {
        for (let k = 0; k < 3 && out.length < cap * 0.35; k++) {
          const ang = (k * Math.PI * 2) / 3;
          out.push({
            x: x + Math.cos(ang) * 0.85,
            z: z + Math.sin(ang) * 0.85,
            heading: ang + Math.PI,
            posture: 'juloos',
            activity: 'friends_circle',
            isWoman: false,
            isChild: false,
            scale: 1,
            hasRehal: false,
            zoneKind: 'interior',
          });
        }
      }
    }
  }

  // Courtyard and Western Annex prayer carpets: families are rare in fenced courtyards (~3%)
  // and noticeably more common in Western Annex (#23, #26, #31, #34, #36, ~18%).
  for (let i = 0; i < layout.rugs.length && out.length < cap; i += 4) {
    const rug = layout.rugs[i];
    const r = hash01(seed++);
    if (r > (session.phase === 'iqamah_wait' ? 0.55 : 0.32)) continue;
    const women = isWomenCourtyardPoint(rug.x, rug.z);
    const zoneKind = rug.courtyard ? 'courtyard' : 'western_annex';
    const familyChance = rug.courtyard ? 0.03 : 0.18;
    const roll = hash01(seed++ * 13);

    if (roll < familyChance) {
      out.push({
        x: rug.x - 0.55,
        z: rug.z,
        heading: QIBLA_HEADING_RAD,
        posture: 'juloos',
        activity: 'family_group',
        isWoman: women,
        isChild: false,
        scale: 1,
        hasRehal: false,
        zoneKind,
      });
      if (out.length < cap) {
        out.push({
          x: rug.x + 0.35,
          z: rug.z + 0.1,
          heading: QIBLA_HEADING_RAD + 0.25,
          posture: 'juloos',
          activity: 'family_group',
          isWoman: women,
          isChild: true,
          scale: 0.62,
          hasRehal: false,
          zoneKind,
        });
      }
    } else if (roll < familyChance + 0.28) {
      const indPosture = postureAtProgress(2, hash01(seed++) * 5).posture;
      out.push({
        x: rug.x,
        z: rug.z,
        heading: QIBLA_HEADING_RAD,
        posture: indPosture,
        activity: 'individual_prayer',
        isWoman: women,
        isChild: false,
        scale: 1,
        hasRehal: false,
        zoneKind,
      });
    } else if (roll < familyChance + 0.66) {
      out.push({
        x: rug.x,
        z: rug.z,
        heading: QIBLA_HEADING_RAD + (hash01(seed++) - 0.5) * 0.4,
        posture: 'juloos',
        activity: 'quran_reading',
        isWoman: women,
        isChild: false,
        scale: 1,
        hasRehal: true,
        zoneKind,
      });
    } else {
      for (let k = 0; k < 3 && out.length < cap; k++) {
        const ang = (k * Math.PI * 2) / 3;
        out.push({
          x: rug.x + Math.cos(ang) * 0.7,
          z: rug.z + Math.sin(ang) * 0.4,
          heading: ang + Math.PI,
          posture: 'juloos',
          activity: 'friends_circle',
          isWoman: women,
          isChild: false,
          scale: 1,
          hasRehal: false,
          zoneKind,
        });
      }
    }
  }

  return out;
}

/** Sample coordinates inside the Western and Northern Friday street overflow bounds (in `[lng, lat]`). */
export function fridayOverflowStreetBounds(): {
  westStreet: { minX: number; maxX: number; minZ: number; maxZ: number; sampleLngLat: [number, number] };
  northStreet: { minX: number; maxX: number; minZ: number; maxZ: number; sampleLngLat: [number, number] };
} {
  return {
    westStreet: {
      minX: -448,
      maxX: -402,
      minZ: -162,
      maxZ: 75,
      sampleLngLat: fromModelMetres([-425, -45]),
    },
    northStreet: {
      minX: -392,
      maxX: 252,
      minZ: -510,
      maxZ: -474,
      sampleLngLat: fromModelMetres([-70, -492]),
    },
  };
}
