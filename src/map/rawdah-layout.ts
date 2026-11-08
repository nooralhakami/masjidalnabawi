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
 * - Blue: a funeral now and then, carried to the Mosque's south face by Gate 42 (Bab al-Jana'iz).
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

/** Men greeting the Prophet ﷺ: the way to Gate 1, and out of Gate 41 to the south. */
export const SALAM_IN: XY[] = [
  [-76, 8],
  [-84, -15],
  [-117, -50],
  [-115.2, -78.9],
];
export const SALAM_OUT_AT: XY = [-8.6, -78.9];
export const SALAM_OUT: XY[] = [
  [6, -78],
  [6, -20],
  [6, 18],
];

/** A funeral: in at the south gate 368, round block 203 and on to the south face by Gate 42. */
export const FUNERAL_WAY: XY[] = [
  [4.7, 81],
  [0, 45],
  [0, 12],
  [-6, -16],
  [-57, -55.5],
];

/** The flows run while the view is about the south of the Mosque. */
export const FLOWS_CENTRE: XY = [-20, -50];
export const FLOWS_REACH = 160;
