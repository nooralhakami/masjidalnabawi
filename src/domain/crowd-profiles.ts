/**
 * Pure domain profiles, seasonal/configurable nationality mix weights, and adaptive performance
 * tiers for the Stage 5 stylized low-poly crowd (no DOM or WebGL imports).
 *
 * Notice on mix weights: `SEASON_MIXES` provides neutral configurable defaults (no statistical
 * claim about official pilgrim demographics) and may be overridden per installation or via URL.
 */

export const CROWD_ARCHETYPES = ['gulf_man', 'south_asian_man', 'se_asian_man', 'ihram_man', 'kaftan_man', 'abaya_woman', 'bright_hijab_woman'] as const;

export type CrowdArchetype = (typeof CROWD_ARCHETYPES)[number];
export const ARCHETYPE_COUNT = CROWD_ARCHETYPES.length;

export type SeasonPreset = 'regular' | 'ramadan' | 'hajj' | 'umrah';
export type CrowdQualityTier = 'full' | 'lite' | 'static';

export interface NationalityMix {
  men: {
    gulf_man: number;
    south_asian_man: number;
    se_asian_man: number;
    ihram_man: number;
    kaftan_man: number;
  };
  women: {
    abaya_woman: number;
    bright_hijab_woman: number;
  };
  /** Share of free courtyard walkers modelled as women when sex is not pre-assigned. */
  womenShare: number;
}

/**
 * Configurable baseline weights per season. Callers may supply `mix` overrides at runtime.
 */
export const SEASON_MIXES: Record<SeasonPreset, NationalityMix> = {
  regular: {
    men: { gulf_man: 0.34, south_asian_man: 0.22, se_asian_man: 0.16, ihram_man: 0.1, kaftan_man: 0.18 },
    women: { abaya_woman: 0.72, bright_hijab_woman: 0.28 },
    womenShare: 0.46,
  },
  umrah: {
    men: { gulf_man: 0.22, south_asian_man: 0.23, se_asian_man: 0.21, ihram_man: 0.2, kaftan_man: 0.14 },
    women: { abaya_woman: 0.66, bright_hijab_woman: 0.34 },
    womenShare: 0.46,
  },
  ramadan: {
    men: { gulf_man: 0.28, south_asian_man: 0.24, se_asian_man: 0.2, ihram_man: 0.14, kaftan_man: 0.14 },
    women: { abaya_woman: 0.68, bright_hijab_woman: 0.32 },
    womenShare: 0.46,
  },
  hajj: {
    men: { gulf_man: 0.14, south_asian_man: 0.25, se_asian_man: 0.21, ihram_man: 0.24, kaftan_man: 0.16 },
    women: { abaya_woman: 0.62, bright_hijab_woman: 0.38 },
    womenShare: 0.46,
  },
};

export function parseCrowdSeasonOverride(search: string): SeasonPreset {
  const raw = new URLSearchParams(search).get('crowdSeason');
  if (raw === 'ramadan' || raw === 'hajj' || raw === 'umrah' || raw === 'regular') return raw;
  return 'regular';
}

export function parseCrowdQualityOverride(search: string): CrowdQualityTier | null {
  const raw = new URLSearchParams(search).get('crowdQuality');
  if (raw === 'full' || raw === 'lite' || raw === 'static') return raw;
  return null;
}

export function resolveInitialCrowdTier(reducedMotion: boolean, override: CrowdQualityTier | null): CrowdQualityTier {
  if (override === 'static' || reducedMotion) return 'static';
  if (override === 'lite') return 'lite';
  return 'full';
}

export interface TierCaps {
  walkers: number;
  worshippers: number;
  allowLod0: boolean;
  animate: boolean;
}

export function capsForTier(tier: CrowdQualityTier): TierCaps {
  if (tier === 'static') return { walkers: 260, worshippers: 600, allowLod0: false, animate: false };
  if (tier === 'lite') return { walkers: 260, worshippers: 600, allowLod0: false, animate: true };
  return { walkers: 500, worshippers: 1200, allowLod0: true, animate: true };
}

/**
 * Steps down from `'full'` to `'lite'` when 20 consecutive frames take longer than 66.7 ms
 * (`< 15 fps`), matching `docs/PERF.md` fallback policy on mid-range mobile devices.
 */
export class CrowdPerfGuard {
  private slowStreak = 0;

  constructor(private tier: CrowdQualityTier) {}

  get current(): CrowdQualityTier {
    return this.tier;
  }

  recordFrame(frameMs: number): CrowdQualityTier {
    if (this.tier !== 'full') return this.tier;
    if (frameMs > 66.7) {
      this.slowStreak++;
      if (this.slowStreak >= 20) this.tier = 'lite';
    } else {
      this.slowStreak = 0;
    }
    return this.tier;
  }
}

export interface CrowdProfileOptions {
  women?: ArrayLike<number>;
  scale?: ArrayLike<number>;
  season?: SeasonPreset;
  mix?: {
    men?: Partial<NationalityMix['men']>;
    women?: Partial<NationalityMix['women']>;
    womenShare?: number;
  };
}

export interface CrowdProfileBatch {
  /** Per-instance `[robeR, robeG, robeB, heightM, headR, headG, headB, woman + skin * 0.49]`. */
  data: Float32Array;
  /** `1` for women, `0` for men (strictly matches `opts.women` when supplied). */
  women: Uint8Array;
  /** Archetype index `0..6` into `CROWD_ARCHETYPES`. */
  archetype: Uint8Array;
  /** Per-instance `[archetype, variant, speedScale, phaseOffset]`. */
  meta: Float32Array;
}

type RGB = readonly [number, number, number];

const SKIN_BANDS: readonly [number, number][] = [
  [0.18, 0.42], // gulf_man
  [0.36, 0.72], // south_asian_man
  [0.32, 0.56], // se_asian_man
  [0.2, 0.78], // ihram_man (global pilgrims)
  [0.24, 0.96], // kaftan_man (African / Levantine / Turkish range)
  [0.18, 0.55], // abaya_woman
  [0.24, 0.85], // bright_hijab_woman
];

const GULF_THOBES: readonly RGB[] = [
  [0.98, 0.98, 0.97],
  [0.97, 0.96, 0.93],
  [0.95, 0.93, 0.88],
  [0.91, 0.91, 0.92],
];

const GULF_HEADS: readonly RGB[] = [
  [1.0, 0.99, 0.96], // iconic crimson-and-cream Saudi Shemagh
  [1.0, 0.98, 0.95], // crimson-and-cream Shemagh variant
  [0.96, 0.96, 0.995], // pure white woven cotton Ghutra (`b >= 0.99` switch)
];

const SOUTH_ASIAN_ROBES: readonly RGB[] = [
  [0.86, 0.93, 0.98],
  [0.94, 0.92, 0.88],
  [0.84, 0.88, 0.85],
  [0.9, 0.88, 0.94],
];

const SE_ASIAN_ROBES: readonly RGB[] = [
  [1.0, 1.0, 1.0], // indigo batik pattern from atlas
  [0.92, 0.98, 0.95], // emerald batik tint
  [1.0, 0.94, 0.88], // warm soga brown tint
];

const KAFTAN_ROBES: readonly RGB[] = [
  [0.94, 0.92, 0.87],
  [0.82, 0.88, 0.95],
  [0.85, 0.92, 0.86],
  [0.95, 0.89, 0.82],
];

const ABAYA_ROBES: readonly RGB[] = [
  [0.96, 0.96, 0.98],
  [0.88, 0.9, 0.98],
  [0.94, 0.89, 0.88],
];

const ABAYA_HIJABS: readonly RGB[] = [
  [0.14, 0.15, 0.18],
  [0.18, 0.16, 0.19],
  [0.15, 0.18, 0.22],
];

const BRIGHT_WOMAN_ROBES: readonly RGB[] = [
  [0.92, 0.9, 0.85], // cream/beige abaya
  [0.72, 0.8, 0.75], // sage green
  [0.76, 0.64, 0.68], // muted dusty plum
  [0.68, 0.72, 0.8], // slate blue
];

const BRIGHT_WOMAN_HIJABS: readonly RGB[] = [
  [0.95, 0.94, 0.91],
  [0.34, 0.3, 0.28],
  [0.24, 0.29, 0.36],
  [0.45, 0.28, 0.3],
];

function pickWeightedIndex(u: number, weights: readonly number[]): number {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (sum <= 0) return 0;
  let acc = 0;
  const target = u * sum;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]);
    if (target <= acc) return i;
  }
  return weights.length - 1;
}

/**
 * Generates per-instance visual traits (`data`, `women`, `archetype`, `meta`) deterministically
 * from `seed`, preserving strict men/women segregation when `opts.women` is provided.
 */
export function assignCrowdProfiles(n: number, seed: number, opts: CrowdProfileOptions = {}): CrowdProfileBatch {
  const baseMix = SEASON_MIXES[opts.season ?? 'regular'];
  const menMix = { ...baseMix.men, ...opts.mix?.men };
  const womenMix = { ...baseMix.women, ...opts.mix?.women };
  const womenShare = opts.mix?.womenShare ?? baseMix.womenShare;

  const menWeights = [menMix.gulf_man, menMix.south_asian_man, menMix.se_asian_man, menMix.ihram_man, menMix.kaftan_man];
  const womenWeights = [womenMix.abaya_woman, womenMix.bright_hijab_woman];

  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

  const data = new Float32Array(n * 8);
  const women = new Uint8Array(n);
  const archetype = new Uint8Array(n);
  const meta = new Float32Array(n * 4);

  for (let a = 0; a < n; a++) {
    const isWoman = opts.women ? (opts.women[a] ? 1 : 0) : rnd() < womenShare ? 1 : 0;
    const arch = isWoman ? 5 + pickWeightedIndex(rnd(), womenWeights) : pickWeightedIndex(rnd(), menWeights);

    let robe: RGB;
    let head: RGB;
    let height: number;

    switch (arch) {
      case 0: // gulf_man
        robe = pick(GULF_THOBES);
        head = pick(GULF_HEADS);
        height = 1.69 + rnd() * 0.14;
        break;
      case 1: // south_asian_man
        robe = pick(SOUTH_ASIAN_ROBES);
        head = [0.95, 0.93, 0.89];
        height = 1.64 + rnd() * 0.14;
        break;
      case 2: // se_asian_man
        robe = pick(SE_ASIAN_ROBES);
        head = [0.1, 0.1, 0.11];
        height = 1.61 + rnd() * 0.12;
        break;
      case 3: // ihram_man
        robe = [0.98, 0.97, 0.95];
        head = [0.98, 0.97, 0.95];
        height = 1.64 + rnd() * 0.15;
        break;
      case 4: // kaftan_man
        robe = pick(KAFTAN_ROBES);
        head = [0.94, 0.91, 0.84];
        height = 1.67 + rnd() * 0.16;
        break;
      case 5: // abaya_woman
        robe = pick(ABAYA_ROBES);
        head = pick(ABAYA_HIJABS);
        height = 1.54 + rnd() * 0.13;
        break;
      default: // bright_hijab_woman
        robe = pick(BRIGHT_WOMAN_ROBES);
        head = pick(BRIGHT_WOMAN_HIJABS);
        height = 1.53 + rnd() * 0.13;
        break;
    }

    const [skinMin, skinMax] = SKIN_BANDS[arch];
    const skin = skinMin + rnd() * (skinMax - skinMin);
    const scale = opts.scale?.[a] ?? 1;

    women[a] = isWoman;
    archetype[a] = arch;
    data.set([robe[0], robe[1], robe[2], height * scale, head[0], head[1], head[2], isWoman + skin * 0.49], a * 8);
    meta.set([arch, Math.floor(rnd() * 4), 0.9 + rnd() * 0.2, rnd() * Math.PI * 2], a * 4);
  }

  return { data, women, archetype, meta };
}
