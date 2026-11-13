/**
 * The five verified floors of the Haram, read from the Authority's navQ `GetVenueFloors` response
 * (captured under the owner's permission, D8 pending deposit; docs/DECISIONS.md). Pure data: the
 * routing consumer asserts its provenance (src/data/provenance.ts, 'floors').
 *
 * Two venues share the ground level (0): the campus Plaza (floor 11, venue 3) and the Mosque
 * building's ground floor GF (floor 12, venue 4). Above is the Roof ROF (floor 24, venue 4, level 1);
 * below are the car park's two levels B1 (floor 94, venue 20, level -1) and B2 (floor 95, level -2).
 * `alignment` places each floor's map image (Phase 2 display); `mapUrl`/`geoJsonUrl` reference the
 * Authority's captured assets (no bytes are shipped here).
 */

export interface FloorAlignment {
  /** [longitude, latitude] of the floor map's centre. */
  center: number[];
  scaleX: number;
  scaleY: number;
  rotation: number;
  xyToLong: number[];
  xyToLat: number[];
  longlatToX: number[];
  longlatToY: number[];
}

export interface Floor {
  id: number;
  venueId: number;
  /** Storey relative to the ground: 1 roof, 0 ground, -1 B1, -2 B2. */
  level: number;
  /** The Authority's short label (GF, ROF, B1, B2); null for the campus Plaza. */
  label: string | null;
  /** Floor name by language code, as captured (default, ar, ms, ur, fr, id, tr). */
  names: Record<string, string>;
  iconLabel: Record<string, string | null>;
  mapWidth: number;
  mapHeight: number;
  scaleFactor: number;
  alignment: FloorAlignment;
  mapUrl: string;
  geoJsonUrl: string | null;
  isDefault: boolean;
  isParking: boolean;
  isUnderground: boolean;
  isUncover: boolean;
}

const RAW_FLOORS: readonly Floor[] = [
  {
    id: 24,
    venueId: 4,
    level: 1,
    label: 'ROF',
    names: {
      default: 'Roof',
      ar: 'السطح',
      ms: 'Bumbung',
      ur: 'چھت',
      fr: 'Toit',
      id: 'Atap',
      tr: 'Çatı',
    },
    iconLabel: {
      default: 'ROF',
      ar: 'السطح',
    },
    mapWidth: 8929,
    mapHeight: 6521,
    scaleFactor: 0.049694215521695485,
    alignment: {
      center: [39.611105232799495, 24.468616422034348],
      scaleX: 4.677307519853004e-7,
      scaleY: 4.285252371813519e-7,
      rotation: 6.250232704994763,
      xyToLong: [39.613183719488994, -4.676935952158216e-7, 2.774830725370385e-9],
      xyToLat: [24.467212384218065, 1.6063615529478578e-9, 4.2855752532512813e-7],
      longlatToX: [84358404.65722807, -2138104.4598026886, 13843.837829357219],
      longlatToY: [-57408209.86083904, 8014.250894536004, 2333356.9419998755],
    },
    mapUrl: 'https://maps.alharamain.gov.sa/content/floor_1326759257.png',
    geoJsonUrl: 'https://maps.alharamain.gov.sa/content/FF_DONE_307128908.txt',
    isDefault: false,
    isParking: false,
    isUnderground: false,
    isUncover: false,
  },
  {
    id: 12,
    venueId: 4,
    level: 0,
    label: 'GF',
    names: {
      default: 'GF',
      ar: 'الطابق الأرضي',
      ms: 'Aras Bawah',
      ur: 'گراؤنڈ فلور',
      fr: 'Rez-de-chaussée',
      id: 'Lantai Dasar',
      tr: 'Zemin Kat',
    },
    iconLabel: {
      default: 'GF',
      ar: 'الأرضي',
    },
    mapWidth: 9013,
    mapHeight: 6691,
    scaleFactor: 0.049694215521695485,
    alignment: {
      center: [39.61114964283052, 24.468633890170434],
      scaleX: 4.606590260214819e-7,
      scaleY: 4.29628202653661e-7,
      rotation: 6.266661932839812,
      xyToLong: [39.613218066597874, -4.606222486690888e-7, 2.091666067157443e-9],
      xyToLat: [24.467165062880877, 7.032421127435107e-9, 4.29587759440678e-7],
      longlatToX: [85693174.03209163, -2170147.257657018, 11171.825467529934],
      longlatToY: [-58346723.924454935, 35346.11518318946, 2327468.274415002],
    },
    mapUrl: 'https://maps.alharamain.gov.sa/content/floor_1680302096.png',
    geoJsonUrl: 'https://maps.alharamain.gov.sa/content/GF_DONE_402742298.txt',
    isDefault: false,
    isParking: false,
    isUnderground: false,
    isUncover: false,
  },
  {
    id: 11,
    venueId: 3,
    level: 0,
    label: null,
    names: {
      default: "The Prophet's Mosque",
      ar: 'المسجد النبوي',
      ms: 'Masjid Nabawi',
      ur: 'مسجد نبوی',
      fr: 'Mosquée Prophétique',
      id: 'Masjid Nabawi',
      tr: 'Mescid-i Nebevî',
    },
    iconLabel: {
      default: null,
    },
    mapWidth: 1280,
    mapHeight: 592,
    scaleFactor: 4.348250561657792,
    alignment: {
      center: [39.61098224502783, 24.46875267227921],
      scaleX: 2.145767211910732e-5,
      scaleY: 1.953049982194843e-5,
      rotation: 0.0,
      xyToLong: [39.58351629374607, 4.2915344238217404e-5, 0.0],
      xyToLat: [24.480318345619974, 2.7764248899862815e-18, -3.906099964389086e-5],
      longlatToX: [-922362.7818066222, 23301.688888922043, 7.153327677749665e-9],
      longlatToY: [626720.2214177265, 1.103638440609483e-9, -25600.98331114649],
    },
    mapUrl: 'https://maps.alharamain.gov.sa/content/638885385.png',
    geoJsonUrl: null,
    isDefault: true,
    isParking: false,
    isUnderground: false,
    isUncover: false,
  },
  {
    id: 94,
    venueId: 20,
    level: -1,
    label: 'B1',
    names: {
      default: 'upper',
      ar: 'المواقف العلوية',
      ms: 'Parkir Atas',
      ur: 'بالائی پارکنگ',
      fr: 'Parking supérieur',
      id: 'Parkir Atas',
      tr: 'Üst Otopark',
    },
    iconLabel: {
      default: 'B1',
      ar: 'المواقف العلوية',
    },
    mapWidth: 6562,
    mapHeight: 5377,
    scaleFactor: 0.049694215521695485,
    alignment: {
      center: [39.61101740222819, 24.46860811575339],
      scaleX: 1.2070914284238166e-6,
      scaleY: 1.1077143330224013e-6,
      rotation: 6.242838631439558,
      xyToLong: [39.60708502469346, 1.2068797030243602e-6, -9.962770310590374e-9],
      xyToLat: [24.471573541146586, 3.4732295090578344e-9, -1.1076392366433378e-6],
      longlatToX: [-32632860.357932456, 828480.1271306754, -7389.055654464171],
      longlatToY: [21992136.948004786, 2560.4078975167295, -902824.945166534],
    },
    mapUrl: 'https://maps.alharamain.gov.sa/content/floor_982324595.png',
    geoJsonUrl: 'https://maps.alharamain.gov.sa/content/upper_combined 1_1137301340.txt',
    isDefault: false,
    isParking: false,
    isUnderground: true,
    isUncover: false,
  },
  {
    id: 95,
    venueId: 20,
    level: -2,
    label: 'B2',
    names: {
      default: 'lower',
      ar: 'المواقف السفلية',
      ms: 'Parkir Bawah',
      ur: 'زیرِ زمین پارکنگ',
      fr: 'Parking inférieur',
      id: 'Parkir Bawah',
      tr: 'Otopark Alt Kat',
    },
    iconLabel: {
      default: 'B2',
      ar: 'مواقف سفلية',
    },
    mapWidth: 7915,
    mapHeight: 6269,
    scaleFactor: 0.049694215521695485,
    alignment: {
      center: [39.611313482777874, 24.468567699320108],
      scaleX: 1.0468791323226003e-6,
      scaleY: 9.587058947053123e-7,
      rotation: 6.246303222376957,
      xyToLong: [39.60719098938601, 1.0466395051137725e-6, -6.1958998197307044e-9],
      xyToLat: [24.47159273273443, -5.37959340069683e-9, -9.586648078026922e-7],
      longlatToX: [-37689915.97888405, 955406.0991524251, -6171.884758361738],
      longlatToY: [25738159.775744934, -5363.720803528142, -1043075.459340806],
    },
    mapUrl: 'https://maps.alharamain.gov.sa/content/floor_558716256.png',
    geoJsonUrl: 'https://maps.alharamain.gov.sa/content/lower_combined 1_1782256734.txt',
    isDefault: false,
    isParking: false,
    isUnderground: true,
    isUncover: false,
  },
];

/** The five floors, top to bottom (ROF, GF, Plaza, B1, B2). */
export const FLOORS: readonly Floor[] = RAW_FLOORS;

export const FLOOR_BY_ID: ReadonlyMap<number, Floor> = new Map(FLOORS.map((f) => [f.id, f]));

/** Floor ids in display order. */
export const FLOOR_IDS: readonly number[] = FLOORS.map((f) => f.id);

/** The floors of one venue (the Mosque building 4: GF and ROF; the car park 20: B1 and B2). */
export const floorsOfVenue = (venueId: number): readonly Floor[] => FLOORS.filter((f) => f.venueId === venueId);

/** The ground-level floors (level 0): the campus Plaza and the Mosque GF. */
export const GROUND_FLOORS: readonly Floor[] = FLOORS.filter((f) => f.level === 0);
