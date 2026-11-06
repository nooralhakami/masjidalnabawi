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

/**
 * Floodlight colours, close to white as the night photographs show them: the camera sees the stone's
 * own colour under a slightly warm light, never orange (owner, 2026-11-04). The shader tone-maps the
 * result, so a strong light rolls off to white instead of burning to yellow.
 */
const FLOOD: Rgb = [1, 0.95, 0.87];
const INSIDE: Rgb = [1, 0.86, 0.66];
const LANTERN: Rgb = [1, 0.99, 0.95];

/** The glow of a material of `file` (the file's base name), or null if it stays dark at night. */
export function materialGlow(file: string, material: string | undefined): MaterialGlow | null {
  const name = (material ?? '').toLowerCase();
  const canopies = file.includes('canopies');
  // The restroom blocks' lattice windows, the lit stairs and escalator halls of the entrance, the
  // closed lattice at the back and the sign, lit from inside: the light shows through the lattice's
  // holes and the bronze stays dark (scripts/restroom-model.mjs).
  if (file.includes('restroom')) {
    if (['window', 'stairs', 'escalator', 'gate', 'sign'].includes(name)) return { color: scale(INSIDE, 1.5), tint: 1, rise: 0 };
    // Its white marble is lit less than the Mosque's cream walls, or it burns out and loses its joints.
    if (name !== 'steel' && name !== 'dark') return { color: scale(FLOOD, 0.42), tint: 1, rise: 1 };
  }
  if (name.startsWith('glass')) {
    // The lanterns on the canopy columns, near white; the Mosque's windows, warm from inside.
    return canopies ? { color: scale(LANTERN, 2.2), tint: 0, rise: 0 } : { color: scale(INSIDE, 0.9), tint: 0, rise: 0 };
  }
  // Canopies: lit only from their lanterns, softly; the fabric keeps its own colour.
  if (canopies) return { color: scale(FLOOD, name === 'umb' || name === 'steel.001' ? 0.55 : 0.35), tint: 1, rise: 0 };
  // Minarets: floodlit cream, brightest toward the top.
  if (name.startsWith('min')) return { color: scale(FLOOD, 1.1), tint: 1, rise: -1 };
  // Gold finials and bands only reflect the light round them.
  if (name.includes('gold') || name.includes('goold')) return { color: scale(FLOOD, 0.8), tint: 1, rise: 0 };
  if (name.includes('dome')) return { color: scale(FLOOD, 0.9), tint: 1, rise: 0 };
  // The portals' back walls, painted with a door, a window and a lantern (portalKind): lit like stone.
  if (name === 'deep' && !canopies) return { color: scale(FLOOD, 0.65), tint: 1, rise: 0 };
  if (['roof', 'tile', 'deep', 'dark', 'tent', 'silver', 'steel'].includes(name)) return { color: scale(FLOOD, 0.3), tint: 1, rise: 0 };
  // The gates and doors are photographs of the real ones: lit softly so their wood and gold show,
  // never burnt to white (owner, 2026-11-04). Their lattices glow from behind (gateLattice).
  if (/^(gate|door|ogdoor|arc$|g1$)/.test(name)) return { color: scale(FLOOD, 0.7), tint: 1, rise: 0 };
  if (/^w[12]$/.test(name)) return { color: scale(FLOOD, 0.6), tint: 1, rise: 0 };
  // Walls, cornices and the service blocks: stone under floodlights from the ground.
  return { color: scale(FLOOD, 0.85), tint: 1, rise: 1 };
}

/**
 * Colours that replace a material's own in navQ's canopies file. Its folded fabric is a pale blue
 * and the lantern housing a green-grey, which read as cyan and green on screen; the photographs show
 * beige fabric and bronze housings (owner, 2026-11-04, overriding the file for these two only).
 */
export function materialColor(file: string, material: string | undefined): [number, number, number, number] | null {
  if (!file.includes('canopies')) return null;
  if (material === 'steel.001') return [0.78, 0.74, 0.66, 1];
  if (material === 'GREENDOME2') return [0.4, 0.34, 0.25, 1];
  return null;
}

function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * The green-lit crown of the minarets at night (the owner's photographs): the short cylinder just
 * under the finial, above the upper balcony. In navQ's minaret mesh (`Circle…`, material `MINTEX`) it
 * spans 68–72 m of the mesh's own height, whatever each minaret's scale and base; measured from the
 * mesh's profile (balcony 62.5–65.5 m, crown 68–72 m, cone from 72 m). Null for anything else.
 */
export function minaretCrown(file: string, mesh: string | undefined, material: string | undefined): [number, number] | null {
  if (!file.includes('haram-3d') || !(mesh ?? '').startsWith('Circle') || material !== 'MINTEX') return null;
  return [68, 72];
}

/**
 * What the shader paints on a portal's back wall (navQ's `DEEP`, a flat dark plane in 16 arched
 * portals): 1, a closed gate as the owner's photographs show it (wood with a gold lattice and
 * medallion, a lit transom, and in the tall portals a calligraphy panel and an arched window with a
 * hanging lantern); 2, Bab al-Salam open, the lit hall and its great chandelier inside (its portal is
 * the mesh `Plane.057`, at gate 1, under the gold muqarnas and green band). 0 for anything else.
 */
export function portalKind(file: string, mesh: string | undefined, material: string | undefined): 0 | 1 | 2 {
  if (!file.includes('haram-3d') || material !== 'DEEP') return 0;
  return mesh === 'Plane.057' ? 2 : 1;
}

/** The gates whose photograph has a lattice lunette above the door, lit from behind at night. */
export function gateLattice(file: string, material: string | undefined): boolean {
  return file.includes('haram-3d') && (material === 'Gate1' || material === 'GateR');
}
