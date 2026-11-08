import type { XY } from './crowd-sim';

/**
 * The ways round the Rawdah and the Prophet's chamber, as the owner drew them over the 3D view
 * (2026-11-08). In the models' metres (x east, z south), read from his picture by matching the
 * gates' markers in it (about 5.24 px a metre, north up; good to a metre or two).
 *
 * - Yellow: the queues for the Rawdah. Three long rails, and between each two of them two shorter
 *   dividers broken in the middle: six lanes, entered from the south, checked at their north end.
 * - Then on to wait before Gate 37, sent in batches into the Rawdah through Gate 39, and out of it
 *   through Gate 2.
 * - Green: men to greet the Prophet ﷺ enter through Gate 1 (Bab al-Salam); red: they leave through
 *   Gate 41 (Bab al-Baqi') and walk south.
 * - Blue: a funeral now and then, out of block 203 to the Mosque's south face by Gate 42 (Bab
 *   al-Jana'iz).
 */

/** The queue rails (polylines). */
export const QUEUE_RAILS: XY[][] = [
  [
    [16.7, -93.2],
    [16.7, 2.9],
  ],
  [
    [29.5, -93.2],
    [29.5, -8.2],
  ],
  [
    [42.2, -93.2],
    [42.2, 2.9],
  ],
  ...[20.2, 24.3, 33.3, 37.7].flatMap((x): XY[][] => [
    [
      [x, -93.2],
      [x, -74.9],
    ],
    [
      [x, -62.7],
      [x, -33.3],
    ],
  ]),
];

/** The six lanes, west to east: [west edge, east edge]. */
export const QUEUE_LANES: readonly (readonly [number, number])[] = [
  [16.7, 20.2],
  [20.2, 24.3],
  [24.3, 29.5],
  [29.5, 33.3],
  [33.3, 37.7],
  [37.7, 42.2],
];
/** Where a lane's head stands (checked there), where it is entered, and the gap between rows. */
export const QUEUE_HEAD_Z = -91.6;
export const QUEUE_ENTRY_Z = -30.5;
export const QUEUE_ROW = 0.85;
/** Where the dividers end to the south: the lanes' mouths. */
export const QUEUE_MOUTH_Z = -33.3;
/** Past the checkers, a few steps north of the rails' ends. */
export const QUEUE_OUT_Z = -96.8;
/** Only those queuing walk inside the lanes. */
export const QUEUE_AREA: XY[] = [
  [16.7, -93.2],
  [42.2, -93.2],
  [42.2, -33.3],
  [16.7, -33.3],
];
/** The lanes' mouth, between the long rails south of the dividers: kept for those joining. */
export const QUEUE_MOUTH: XY[] = [
  [16.7, -33.3],
  [42.2, -33.3],
  [42.2, 2.9],
  [16.7, 2.9],
];
/** Where the checkers stand: at the north end of the rails between the lanes, facing south. */
export const QUEUE_CHECKERS: XY[] = [
  [20.2, -94],
  [24.3, -94],
  [29.5, -94],
  [33.3, -94],
  [37.7, -94],
];

/** Waiting before Gate 37, and the organisers standing by. */
export const HOLD_CENTRE: XY = [55, -103];
export const HOLD_HALF: XY = [8, 3.5];
export const HOLD_ORGANISERS: XY[] = [
  [45.5, -101],
  [64.5, -101],
];
/** Into the Rawdah (Gate 39), and out of it (outside Gate 2) and away west. */
export const RAWDAH_IN: XY = [-10.3, -113.4];
export const RAWDAH_OUT: XY = [-112.5, -99.6];
export const RAWDAH_AWAY: XY = [-140, -95];

/**
 * The green barriers that order the greeting (owner, 2026-11-08: all there in fact, and all green;
 * in his picture orange, grey, and red for the way out).
 * - Orange: the west side of the way in, from the Mosque's wall north of Gate 1 down to block 205.
 * - Grey: the east side of the way in, from the Mosque by Gate 1 south and round to the south;
 *   a "D" beside block 205; a line along the south; a line from it to block 203.
 * - Red: the two sides of the way out of Gate 41, south past block 203.
 */
export const GREETING_BARRIERS: XY[][] = [
  // Orange.
  [
    [-109.6, -87.9],
    [-122.5, -87.9],
    [-122.5, -31.8],
    [-118.6, -25.6],
    [-106.2, -19.0],
    [-106.2, -16.0],
  ],
  // Grey: the east side of the way in.
  [
    [-109.6, -68.4],
    [-110.8, -68.4],
    [-110.5, -35.2],
    [-107.2, -28.5],
    [-100.5, -26.6],
    [-89.1, -23.8],
    [-78.6, -18.0],
    [-70.9, -10.5],
    [-66.2, -1.0],
    [-65.7, 2.9],
    [-66.6, 7.6],
    [-66.2, 22.2],
  ],
  // Grey: the "D" beside block 205.
  [
    [-102.9, -16.2],
    [-102.9, 10.0],
  ],
  [
    [-106.2, 10.0],
    [-81.4, 10.0],
  ],
  [
    [-102.9, -16.2],
    [-92.9, -11.9],
    [-85.2, -5.7],
    [-80.0, 1.9],
    [-80.5, 7.6],
    [-81.4, 10.0],
  ],
  // Grey: along the south, and on to block 203.
  [
    [-119.6, 22.2],
    [0.7, 22.2],
  ],
  [
    [-70.0, -11.4],
    [-16.5, -11.4],
  ],
  // Red: the way out of Gate 41, west side then east side.
  [
    [-11.4, -72.7],
    [-8.4, -72.7],
    [-5.1, -68.9],
    [-2.2, -59.9],
    [-0.8, -46.6],
    [-0.1, -27.6],
    [0.2, 22.3],
  ],
  [
    [-11.4, -87.5],
    [-2.2, -84.6],
    [4.5, -75.1],
    [8.3, -60.8],
    [10.7, -37.1],
    [11.6, 21.9],
  ],
];

/**
 * Where only the men the flows lead walk (inside those barriers): the way in to Gate 1, the way out
 * of Gate 41, and the ground they close in between them, where the funerals go.
 */
export const GREETING_WAYS: XY[][] = [
  [
    [-122.5, -87.9],
    [-109.6, -87.9],
    [-109.6, -68.4],
    [-110.8, -68.4],
    [-110.5, -35.2],
    [-107.2, -28.5],
    [-100.5, -26.6],
    [-89.1, -23.8],
    [-78.6, -18.0],
    [-70.9, -10.5],
    [-66.2, -1.0],
    [-66.2, 22.2],
    [-119.6, 22.2],
    [-119.6, 7.3],
    [-118.7, 7.3],
    [-118.7, -16.2],
    [-106.2, -16.2],
    [-106.2, -19.0],
    [-118.6, -25.6],
    [-122.5, -31.8],
  ],
  [
    [-11.4, -87.5],
    [-2.2, -84.6],
    [4.5, -75.1],
    [8.3, -60.8],
    [10.7, -37.1],
    [11.6, 21.9],
    [0.2, 22.3],
    [-0.1, -27.6],
    [-0.8, -46.6],
    [-2.2, -59.9],
    [-5.1, -68.9],
    [-8.4, -72.7],
    [-11.4, -72.7],
  ],
  [
    [-109.6, -57],
    [-11.4, -57],
    [-11.4, -72.7],
    [-8.4, -72.7],
    [-5.1, -68.9],
    [-2.2, -59.9],
    [-0.8, -46.6],
    [-0.1, -27.6],
    [0.2, 22.3],
    [-66.2, 22.2],
    [-66.6, 7.6],
    [-65.7, 2.9],
    [-66.2, -1.0],
    [-70.9, -10.5],
    [-78.6, -18.0],
    [-89.1, -23.8],
    [-100.5, -26.6],
    [-107.2, -28.5],
    [-110.5, -35.2],
    [-110.8, -57],
  ],
];

/**
 * Men greeting the Prophet ﷺ: in from the west under block 205, north between the "D" and the
 * grey line, then up between the orange and the grey to Gate 1; out of Gate 41 and south between
 * the red lines.
 */
export const SALAM_IN: XY[] = [
  [-124, 15],
  [-73, 15],
  [-75.5, -4],
  [-93, -18],
  [-116.5, -40],
  [-115.2, -78.9],
];
export const SALAM_OUT_AT: XY = [-8.6, -78.9];
export const SALAM_OUT: XY[] = [
  [-3, -77],
  [4.5, -50],
  [5.5, -10],
  [6, 30],
];

/** A funeral: out of the door of block 203 (its north side) to the south face by Gate 42. */
export const FUNERAL_WAY: XY[] = [
  [-6, -16],
  [-57, -55.5],
];

/** The flows run while the view is about the south of the Mosque. */
export const FLOWS_CENTRE: XY = [-20, -50];
export const FLOWS_REACH = 160;
