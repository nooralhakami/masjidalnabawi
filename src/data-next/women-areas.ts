/**
 * The women's areas of the courtyards at the Mosque's north-west and north-east corners (owner,
 * 2026-11-07): only women go in, and only through the gaps between the barriers. Drawn by the owner
 * as yellow lines on two screenshots of the 3D view and read off them by the restroom markers in
 * each (twelve and seven, to within 0.3 m). Points are `[lat, lng]`.
 */
export interface WomenArea {
  id: string;
  zone: readonly (readonly [number, number])[];
  barriers: readonly (readonly (readonly [number, number])[])[];
}

export const WOMEN_AREAS: readonly WomenArea[] = [
  {
    id: 'north-west',
    // The ground only women may enter, bounded by the barriers and the Mosque's wall.
    zone: [
      [24.4704073, 39.6087296],
      [24.4704078, 39.6100907],
      [24.469888, 39.6100905],
      // To the Mosque's west wall itself, so no strip is left along it (owner, 2026-11-07).
      [24.4698879, 39.6091633],
      [24.4689626, 39.6091633],
      // The south side on the face of restroom block 215 (the owner's red line, 2026-11-07).
      [24.4689626, 39.6085576],
      [24.4699192, 39.6085576],
      [24.4699193, 39.6087295],
    ],
    // The barriers: one run each, the gaps between them are the entrances.
    barriers: [
      [
        [24.4704073, 39.6087134],
        [24.4704075, 39.609301],
      ],
      [
        [24.4704076, 39.6094706],
        [24.4704078, 39.6100954],
      ],
      [
        [24.4704078, 39.6100907],
        [24.4699662, 39.6100906],
      ],
      [
        [24.4702172, 39.6087296],
        [24.4699932, 39.6087295],
      ],
      [
        [24.4698579, 39.6085576],
        [24.4695262, 39.6085575],
      ],
      [
        [24.4694417, 39.6085574],
        [24.4690888, 39.6085573],
      ],
      // On the face of block 215 from its corner to the Mosque's wall: no slot along the block, and
      // none along the wall (owner's red line, 2026-11-07).
      [
        [24.4689626, 39.6087721],
        [24.4689626, 39.6091534],
      ],
    ],
  },
  {
    id: 'north-east',
    // The ground only women may enter, bounded by the barriers and the Mosque's wall.
    zone: [
      [24.4703941, 39.6116508],
      [24.4703941, 39.6138509],
      [24.4688248, 39.613848],
      [24.4688248, 39.6131649],
      [24.4698814, 39.6131669],
      [24.4698814, 39.6116498],
    ],
    // The barriers: one run each, the gaps between them are the entrances.
    barriers: [
      [
        [24.4703941, 39.6116336],
        [24.4703941, 39.6122823],
      ],
      [
        [24.4703941, 39.6124849],
        [24.4703941, 39.6138509],
      ],
      [
        [24.4703879, 39.6138509],
        [24.4698161, 39.6138499],
      ],
      [
        [24.4696172, 39.6138495],
        [24.4688248, 39.613848],
      ],
      [
        [24.4688248, 39.6131649],
        [24.4688248, 39.6138514],
      ],
      [
        [24.4702201, 39.6116505],
        [24.4698845, 39.6116498],
      ],
    ],
  },
];
