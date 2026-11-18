import { toModelMetres } from './frames';
import type { XY } from './frames';

/**
 * The ways round the Rawdah and the Prophet's chamber, as the owner drew them over the 3D view
 * (2026-11-08). In the models' metres (x east, z south), read from his picture by matching the
 * gates' markers in it (about 5.24 px a metre, north up; good to a metre or two).
 *
 * - Yellow: the queues for the Rawdah. Three long rails, and between each two of them two shorter
 *   dividers broken in the middle: six lanes, entered from the south, checked at their north end.
 * - Then (owner, 2026-11-18) in through Gate 38 only, to wait in the closed hall inside it (the bay
 *   «مصلى الرجال A17» and its walkways, `RAWDAH_HALL`); every ten minutes or so a group goes on
 *   through Gate 39 into the Rawdah, and out of it through Gate 2. Never toward Gate 37: barriers
 *   close the hall from the rest of the Mosque, and the ground outside between the queue's head,
 *   Gate 38 and the greeting's way out (`RAWDAH_HALL_BARRIERS`, `RAWDAH_APPROACH_BARRIERS`).
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

/**
 * In through Gate 38 (owner, 2026-11-18: «visitors go in by Gate 38, wait inside, and go on to the
 * Rawdah through Gate 39»): the step before the gate where those let through the queue go in, and
 * the organisers standing by it. (Gate 38's marker; navQ draws the gate 15 m further west, at
 * x −7.8, by the old Mosque's corner: both are inside the closed ground.)
 */
export const GATE_38_STEP: XY = [7.7, -107.2];
export const GATE_38_ORGANISERS: XY[] = [
  [2.4, -106.4],
  [13.0, -106.4],
];
/** Out of the Rawdah (outside Gate 2) and away west. */
export const RAWDAH_OUT: XY = [-112.5, -99.6];
export const RAWDAH_AWAY: XY = [-140, -95];

/**
 * The closed hall where those for the Rawdah wait (owner, 2026-11-18, his yellow box over navQ's
 * plan): the bay «مصلى الرجال A17» (navQ 178: x −4.6…52.2, z −161.8…−119.2), its west walkway (to
 * the carpet A12 at x −10) and the south half of its north one (z −167.5), east to x 55.5 so that
 * Gate 37 (navQ x 59.3, on the east walkway) stays outside; and the way from it west to Gate 39
 * (navQ x −23.5, z −112.7) along the south of the carpet A7. Its only ways in: Gate 38 from the
 * queue, and out: Gate 39 to the Rawdah.
 */
export const RAWDAH_HALL: XY[] = [
  [55.5, -110.6],
  [55.5, -167.5],
  [-10.0, -167.5],
  [-10.0, -136.0],
  [-18.7, -136.0],
  [-19.2, -132.5],
  [-19.2, -120.9],
  [-27.0, -120.9],
  [-27.0, -110.6],
];
/** The barriers round it, inside the Mosque: east (Gate 37 left outside), north, and west to Gate 39. */
export const RAWDAH_HALL_BARRIERS: XY[][] = [
  [
    [55.5, -110.8],
    [55.5, -167.5],
    [-10.0, -167.5],
    [-10.0, -136.0],
    [-18.7, -136.0],
    [-19.2, -132.5],
    [-19.2, -120.9],
    [-27.0, -120.9],
    [-27.0, -110.8],
  ],
];
/**
 * Outside, between the queue's head and the Mosque (owner, 2026-11-18): from the queue's east rail to
 * the Mosque's wall, so none let through goes east toward Gate 37; and the ground between the
 * greeting's way out (its east barrier) and the queue's west rail closed at both ends, so none comes
 * up between them to Gate 38 without queuing. The ground they close, with the queue's head, Gate 38
 * and the old Mosque's wall, is `RAWDAH_APPROACH`.
 */
export const RAWDAH_APPROACH_BARRIERS: XY[][] = [
  [
    [42.2, -93.2],
    [42.2, -110.2],
  ],
  [
    [16.7, -93.2],
    [4.5, -75.1],
  ],
  [
    [11.3, 2.9],
    [16.7, 2.9],
  ],
];
/** Where only those let through the queue walk, outside: from the queue's head to Gate 38. */
export const RAWDAH_APPROACH: XY[] = [
  [-11.4, -110.2],
  [42.2, -110.2],
  [42.2, -93.2],
  [16.7, -93.2],
  [4.5, -75.1],
  [-2.2, -84.6],
  [-11.4, -87.5],
];
/** The strip closed between the greeting's way out and the queue's west rail. */
export const RAWDAH_STRIP: XY[] = [
  [4.5, -75.1],
  [16.7, -93.2],
  [16.7, 2.9],
  [11.3, 2.9],
  [10.7, -37.1],
  [8.3, -60.8],
];

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

/**
 * الممر المغلق للنساء من باب الملك فهد رقم 21 حتى المنطقة خلف الروضة الشريفة:
 * أثناء أوقات دخول النساء من باب 21 تُغلق الجهتان الشرقية والغربية بالكامل بحيث لا يدخل إلا النساء فقط.
 */
export const WOMEN_RAWDAH_CORRIDOR_BOUNDS = {
  westLng: 39.611065,
  eastLng: 39.611245,
  centerLng: 39.6111543,
  northLat: 24.4698467,
  southLat: 24.46798,
} as const;

export const WOMEN_RAWDAH_CORRIDOR_BARRIERS: XY[][] = [
  [
    toModelMetres([WOMEN_RAWDAH_CORRIDOR_BOUNDS.westLng, WOMEN_RAWDAH_CORRIDOR_BOUNDS.northLat]),
    toModelMetres([WOMEN_RAWDAH_CORRIDOR_BOUNDS.westLng, WOMEN_RAWDAH_CORRIDOR_BOUNDS.southLat]),
  ],
  [
    toModelMetres([WOMEN_RAWDAH_CORRIDOR_BOUNDS.eastLng, WOMEN_RAWDAH_CORRIDOR_BOUNDS.northLat]),
    toModelMetres([WOMEN_RAWDAH_CORRIDOR_BOUNDS.eastLng, WOMEN_RAWDAH_CORRIDOR_BOUNDS.southLat]),
  ],
];
