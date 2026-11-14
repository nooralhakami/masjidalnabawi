import type { Feature, FeatureCollection, Polygon } from 'geojson';

/**
 * What the Al-Haramain map (navQ) draws around the 3D Mosque, read from its live Mapbox style and
 * its `GetPoIPolygons` response (`docs/DECISIONS.md`, 2026-11-04):
 * - the coloured plaza sectors (`madina-zones`), the western annex (`prayer-nabawi`, FF 12) and its
 *   men's and women's prayer areas (`madina_prayers`, FF 5 and FF 6), with their official colours;
 * - where each courtyard service block stands (`threeDModel` of the campus POIs).
 */
export interface AlharamainPlazaProps {
  id: number;
  kind: 'sector' | 'annex' | 'men' | 'women';
  color: string;
  opacity: number;
}

type RawArea = readonly [id: number, kind: AlharamainPlazaProps['kind'], color: string, opacity: number, ring: string];

const MEN = '#d6dfe6';
const WOMEN = '#e6dbd6';
const MEN_OPACITY = 0.47;
const WOMEN_OPACITY = 0.69;

const RAW_AREAS: readonly RawArea[] = [
  [
    1,
    'sector',
    '#edcfd7',
    0.62,
    '39.607832,24.471042#39.610814,24.471032#39.610814,24.470793#39.611458,24.470793#39.611458,24.471027#39.614317,24.471018#39.613722,24.470402#39.613025,24.469851#39.607826,24.46988',
  ],
  [
    2,
    'sector',
    '#efd9c2',
    0.62,
    '39.609581,24.469895#39.609548,24.46989#39.609548,24.469865#39.609237,24.46987#39.609237,24.469826#39.609248,24.469826#39.609248,24.469802#39.609194,24.469802#39.609189,24.467976#39.609227,24.467976#39.609227,24.467868#39.608958,24.467522#39.608642,24.46718#39.607821,24.467195#39.607832,24.46988',
  ],
  [3, 'sector', '#b3c1a9', 0.62, '39.609232,24.467868#39.613014,24.467849#39.613008,24.467776#39.612944,24.466057#39.60781,24.466076#39.608642,24.46718#39.608958,24.467522'],
  [4, 'sector', '#dcd1e1', 0.62, '39.607821,24.467195#39.608642,24.46718#39.60781,24.466076'],
  [
    5,
    'sector',
    '#d9e8f1',
    0.62,
    '39.614317,24.471013#39.614307,24.46822#39.61376,24.467873#39.613599,24.467444#39.613529,24.466028#39.612944,24.466052#39.613014,24.467849#39.613019,24.469851#39.613722,24.470402',
  ],
  [12, 'annex', '#f1dac5', 0.62, '39.604755,24.470859#39.607837,24.470854#39.607824,24.46834#39.604771,24.46831'],
  // الساحة الغربية الخارجية: الاقتصار على الـ5 مصليات الظاهرة في صورة المرجع المعتمدة (2026-11-14)
  [23, 'men', MEN, MEN_OPACITY, '39.60564,24.470832#39.605635,24.47018#39.605139,24.470178#39.605134,24.47083'],
  [26, 'men', MEN, MEN_OPACITY, '39.605734,24.470708#39.606365,24.470705#39.606359,24.470173#39.60574,24.470173'],
  [31, 'women', WOMEN, WOMEN_OPACITY, '39.607652,24.469458#39.607647,24.468838#39.60722,24.468835#39.607218,24.469458'],
  [34, 'women', WOMEN, WOMEN_OPACITY, '39.60516,24.46946#39.605619,24.469458#39.605611,24.468818#39.605163,24.468821'],
  [36, 'women', WOMEN, WOMEN_OPACITY, '39.60574,24.469465#39.607059,24.469455#39.607062,24.468813#39.605732,24.468823'],
];

function parseRing(ring: string): [number, number][] {
  const pts = ring.split('#').map((p) => {
    const [lng, lat] = p.split(',').map(Number);
    return [lng, lat] as [number, number];
  });
  pts.push(pts[0]);
  return pts;
}

let cachedPlaza: FeatureCollection<Polygon, AlharamainPlazaProps> | null = null;

/** The plaza sectors, the western annex and its prayer areas, in drawing order. */
export function alharamainPlaza(): FeatureCollection<Polygon, AlharamainPlazaProps> {
  if (cachedPlaza) return cachedPlaza;
  const features: Feature<Polygon, AlharamainPlazaProps>[] = RAW_AREAS.map(([id, kind, color, opacity, ring]) => ({
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [parseRing(ring)] },
    properties: { id, kind, color, opacity },
  }));
  return (cachedPlaza = { type: 'FeatureCollection', features });
}

/** One 3D file of navQ and every `[lng, lat]` it stands at. */
export interface AlharamainModel {
  url: string;
  anchors: readonly (readonly [number, number])[];
  /** Turned clockwise about its anchor, in degrees (`threeDRotation`). */
  rotation: number;
  /** Nodes standing inside `within` (`[[west, south], [east, north]]`) moved by whole metres. */
  shifts?: readonly { within: readonly [readonly [number, number], readonly [number, number]]; north: number; east: number }[];
}

/**
 * Venue 4 and the campus POIs carrying a `threeDModel`: 42 placements of 6 files (41 from navQ, one added), and the outer fence (one file, one placement). The
 * restroom blocks stand where navQ puts its plain service boxes, drawn instead with a model made
 * from the owner's photographs (`scripts/restroom-model.mjs`, 2026-11-06). Its entrance is one end
 * only, so each block uses the file turned the way it opens (owner, 2026-11-06): towards the Mosque
 * for the inner rows, towards the outer gates for the outer rows; on the east side 233-236 open to
 * the north and 231-232 to the south.
 */
export const ALHARAMAIN_MODELS: readonly AlharamainModel[] = [
  { url: './models/haram-3d.glb', anchors: [[39.611752, 24.466806]], rotation: 0 },
  {
    url: './models/haram-canopies.glb',
    anchors: [[39.611732, 24.4668]],
    rotation: 1,
    // The 44 canopies of the west courtyard by restrooms 213-218 (5 columns by 9 rows) stand 7 m
    // south of navQ's places, clear of the restroom blocks (owner, 2026-11-06).
    shifts: [
      {
        within: [
          [39.607952, 24.467956],
          [39.609166, 24.470004],
        ],
        north: -7,
        east: 0,
      },
    ],
  },
  // The outer fence of the courtyards and its gates, along the Authority's line (owner, 2026-11-08):
  // made from the owner's photographs by scripts/fence-model.mjs, in true metres from the Mosque's
  // anchor, so it is placed there unturned.
  { url: './models/haram-fence.glb', anchors: [[39.611752, 24.466806]], rotation: 0 },
  {
    url: './models/haram-restroom-a-east.glb',
    rotation: 1,
    anchors: [
      [39.608676, 24.46684], // restroom 211
      [39.608676, 24.467703], // restroom 213
      [39.608676, 24.46865], // restroom 215
      [39.608676, 24.469548], // restroom 217
    ],
  },
  {
    url: './models/haram-restroom-a-west.glb',
    rotation: 1,
    anchors: [
      [39.608028, 24.46684], // restroom 212
      [39.608028, 24.467703], // restroom 214
      [39.608028, 24.46865], // restroom 216
      [39.608028, 24.469548], // restroom 218
      [39.608048, 24.469958], // restroom 219
    ],
  },
  {
    url: './models/haram-restroom-b-north.glb',
    rotation: 1,
    anchors: [
      [39.612641, 24.466101], // restroom 201
      [39.611669, 24.46608], // restroom 203
      [39.610659, 24.4661], // restroom 205
      [39.609682, 24.46611], // restroom 207
      [39.608676, 24.46611], // restroom 209
      [39.608028, 24.470105], // restroom 220
      [39.608676, 24.470105], // restroom 222
      [39.609726, 24.470105], // restroom 224
      [39.610748, 24.470105], // restroom 226
      [39.611593, 24.470105], // restroom 228
      [39.612668, 24.470105], // restroom 230
      [39.613613, 24.468454], // restroom 233
      [39.614195, 24.468454], // restroom 234
      [39.613613, 24.467806], // restroom 235
      [39.614195, 24.467806], // restroom 236
      [39.604948, 24.467751], // restroom 251; west extension, opens north (owner, 2026-11-06 / 2026-11-14)
      [39.604948, 24.468399], // restroom 252; west extension, opens north (owner, 2026-11-06 / 2026-11-14)
      [39.604948, 24.469768], // restroom 254; west extension, opens north (owner, 2026-11-06 / 2026-11-14)
      [39.604948, 24.469096], // restroom 253; west extension, opens north (owner, 2026-11-06 / 2026-11-14)
    ],
  },
  {
    url: './models/haram-restroom-b-south.glb',
    rotation: 1,
    anchors: [
      [39.612644, 24.465472], // restroom 202
      [39.611666, 24.4655], // restroom 204
      [39.610661, 24.465472], // restroom 206
      [39.609682, 24.465472], // restroom 208
      [39.608676, 24.465472], // restroom 210
      [39.608676, 24.469562], // restroom 221
      [39.609726, 24.469562], // restroom 223
      [39.610748, 24.469562], // restroom 225
      [39.611593, 24.469562], // restroom 227
      // Under restroom 229, opposite 230: navQ left this block out; added at the owner's request (2026-11-06).
      [39.612668, 24.469562], // restroom 229
      [39.613632, 24.469562], // restroom 231
      [39.614195, 24.469562], // restroom 232
    ],
  },
];
