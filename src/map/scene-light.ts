import type { SkySpecification } from 'maplibre-gl';
import type { SunPosition } from '../domain/daylight';

/**
 * How the 3D view is lit for a given sun position: noon light, the golden hour, the blue hour and
 * the lit night of the Mosque (its golden minarets, its floodlit walls, its plazas under the lamps).
 * Everything eases between a few key moments by the sun's elevation, so the scene never jumps.
 */
export interface SceneLight {
  /** 0 by day, 1 at night: how strongly the Mosque's own lights show. */
  night: number;
  /** Toward the sun, in the glTF frame of the models (X east, Y up, Z south). */
  sunDir: [number, number, number];
  /** Sunlight colour already scaled by its strength. */
  sun: [number, number, number];
  /** Light from the sky on every face. */
  ambient: [number, number, number];
  sky: SkySpecification;
  /** The haze far away (0–1 per channel), for what MapLibre's fog does not reach: the custom layers. */
  fog: [number, number, number];
  /** The ground under the imagery, seen where no tile has loaded yet and toward the horizon. */
  ground: string;
  /** Paint of the (greyed) imagery under the models. */
  raster: { brightnessMin: number; brightnessMax: number; contrast: number; saturation: number };
}

type Rgb = [number, number, number];

interface Key {
  elevation: number;
  night: number;
  sun: Rgb;
  ambient: Rgb;
  sky: Rgb;
  horizon: Rgb;
  fog: Rgb;
  brightnessMin: number;
  brightnessMax: number;
}

const hex = (h: string): Rgb => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];

/**
 * The key moments, by sun elevation in degrees. The full-day key keeps the look navQ gives the
 * models (a bright, near-white ambient) and the pale imagery of the 3D mode.
 */
const KEYS: readonly Key[] = [
  // Night: a deep navy sky, the city's glow low on the horizon, the ground dark.
  {
    elevation: -12,
    night: 1,
    sun: [0, 0, 0],
    ambient: [0.2, 0.23, 0.32],
    sky: hex('#050a18'),
    horizon: hex('#2b2c45'),
    fog: hex('#141a2e'),
    brightnessMin: 0,
    brightnessMax: 0.3,
  },
  // Blue hour: the lights are on, the sky still holds some blue.
  {
    elevation: -5,
    night: 0.9,
    sun: [0, 0, 0],
    ambient: [0.34, 0.36, 0.5],
    sky: hex('#1d3266'),
    horizon: hex('#8a6a86'),
    fog: hex('#3d4466'),
    brightnessMin: 0.04,
    brightnessMax: 0.45,
  },
  // Golden hour: a low orange sun, a burning horizon.
  {
    elevation: 2,
    night: 0.35,
    sun: [0.75, 0.45, 0.24],
    ambient: [0.58, 0.52, 0.56],
    sky: hex('#4a6ea8'),
    horizon: hex('#f2965a'),
    fog: hex('#caa08c'),
    brightnessMin: 0.35,
    brightnessMax: 0.85,
  },
  // Morning or late afternoon: warm, a little hazy.
  {
    elevation: 12,
    night: 0,
    sun: [0.42, 0.36, 0.3],
    ambient: [0.84, 0.83, 0.84],
    sky: hex('#79acdc'),
    horizon: hex('#f0dcc2'),
    fog: hex('#e6e0d6'),
    brightnessMin: 0.7,
    brightnessMax: 1,
  },
  // Full day.
  {
    elevation: 30,
    night: 0,
    sun: [0.4, 0.39, 0.37],
    ambient: [0.9, 0.9, 0.9],
    sky: hex('#76b2e6'),
    horizon: hex('#dde9f2'),
    fog: hex('#e8eef2'),
    brightnessMin: 0.76,
    brightnessMax: 1,
  },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** The light of the 3D scene for this sun position. */
export function sceneLight({ elevation, azimuth }: SunPosition): SceneLight {
  let i = 0;
  while (i < KEYS.length - 2 && elevation > KEYS[i + 1].elevation) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (elevation - a.elevation) / (b.elevation - a.elevation)));
  const ease = t * t * (3 - 2 * t);

  // Below the horizon there is no sunlight to point: the direction then only shapes the sky's light.
  const el = Math.max(elevation, 4) * (Math.PI / 180);
  const az = azimuth * (Math.PI / 180);
  const sunDir: [number, number, number] = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];

  return {
    night: lerp(a.night, b.night, ease),
    sunDir,
    sun: mix(a.sun, b.sun, ease),
    ambient: mix(a.ambient, b.ambient, ease),
    sky: {
      'sky-color': css(mix(a.sky, b.sky, ease)),
      'horizon-color': css(mix(a.horizon, b.horizon, ease)),
      'fog-color': css(mix(a.fog, b.fog, ease)),
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.75,
      'atmosphere-blend': 0,
    },
    fog: mix(a.fog, b.fog, ease).map((c) => c / 255) as Rgb,
    ground: css(mix(a.fog, b.fog, ease).map((c) => c * 0.8) as Rgb),
    raster: {
      brightnessMin: lerp(a.brightnessMin, b.brightnessMin, ease),
      brightnessMax: lerp(a.brightnessMax, b.brightnessMax, ease),
      contrast: -0.55,
      saturation: -1,
    },
  };
}

/** A fixed moment for previews and tests (`?scene=night`), or null to follow the sun. */
export function sceneOverride(search: string): SunPosition | null {
  const scene = new URLSearchParams(search).get('scene');
  if (scene === 'night') return { elevation: -18, azimuth: 270 };
  if (scene === 'dusk') return { elevation: -2, azimuth: 285 };
  if (scene === 'sunset') return { elevation: 3, azimuth: 285 };
  if (scene === 'day') return { elevation: 60, azimuth: 160 };
  return null;
}

/** What each glTF material does once the lights come on (matched by its name in navQ's files). */
export interface MaterialGlow {
  /** Emitted colour at full night (0–1 per channel, may exceed 1 for a hot lamp). */
  color: Rgb;
  /** 1: the glow takes the surface's own colour (lit stone); 0: it is the lamp's colour alone. */
  tint: number;
  /** 1: brighter near the ground, like walls under floodlights; -1: brighter near the top (minarets). */
  rise: number;
}

const WARM: Rgb = [1, 0.86, 0.66];
/** Cream stone under floodlights, as the night photographs show the walls: near white, a touch warm. */
const CREAM: Rgb = [1, 0.93, 0.82];
const GOLD: Rgb = [1, 0.74, 0.4];
const COOL: Rgb = [0.82, 0.92, 1];

/** The glow of a material of `file` (the file's base name), or null if it stays dark at night. */
export function materialGlow(file: string, material: string | undefined): MaterialGlow | null {
  const name = (material ?? '').toLowerCase();
  const canopies = file.includes('canopies');
  if (name.startsWith('glass')) {
    // The lanterns on the canopy columns, cold white; the Mosque's windows, warm from inside.
    return canopies ? { color: [1.5, 1.65, 1.8], tint: 0, rise: 0 } : { color: [0.95, 0.68, 0.36], tint: 0, rise: 0 };
  }
  if (name.startsWith('min')) return { color: [1.1, 0.9, 0.62], tint: 0.6, rise: -1 };
  if (name.includes('gold') || name.includes('goold')) return { color: scale(GOLD, 1.2), tint: 1, rise: 0 };
  if (name.includes('greendome')) return { color: [0.7, 1.05, 0.78], tint: 1, rise: 0 };
  if (name.includes('dome')) return { color: scale(COOL, 0.75), tint: 1, rise: 0 };
  if (canopies) return { color: scale(COOL, name === 'umb' ? 0.85 : 0.7), tint: 1, rise: 0 };
  if (['roof', 'tile', 'deep', 'dark', 'tent', 'silver', 'steel'].includes(name)) return { color: scale(WARM, 0.35), tint: 1, rise: 0 };
  // Walls, arches, gates, cornices and the service blocks: cream stone under floodlights.
  // Mostly the light's own cream: navQ's wall materials lean pink, the stone at night reads near white.
  return { color: scale(CREAM, 0.95), tint: 0.2, rise: 1 };
}

function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}
