import type { Feature, FeatureCollection, Polygon } from 'geojson';

/**
 * 3D Saqifat Bani Sa'idah Garden (سقيفة بني ساعدة) and the surrounding West-zone OSM buildings.
 *
 * Geometry provenance:
 * - Four heritage structures (ways 775419642..775419645) and 45 surrounding West-zone buildings
 *   are extracted directly from docs/routes/osm/buildings-2026-10-08.json (excluding plaza
 *   restroom blocks 209..222, which already have bespoke GLB 3D models).
 * - Enclosure walls, garden lawns, stone pathways, and 28 trees model the walled historical
 *   garden at POI 515 (24.4703318, 39.6068586) between OSM pedestrian bounds.
 */

export interface Saqifah2DProps {
  id: string;
  kind: 'garden-base' | 'lawn' | 'path' | 'wall' | 'heritage' | 'tree-crown';
  color: string;
  opacity: number;
}

export interface Saqifah3DProps {
  id: string;
  kind: 'wall' | 'lawn' | 'hedge' | 'path' | 'heritage' | 'tree-trunk' | 'tree-crown' | 'hotel' | 'civic' | 'building';
  name?: string;
  color: string;
  base: number;
  height: number;
  opacity: number;
}

interface OsmBuildingRecord {
  readonly id: string;
  readonly kind: 'heritage' | 'hotel' | 'civic' | 'building';
  readonly name?: string;
  readonly height: number;
  readonly ring: readonly (readonly [number, number])[];
}

const M_PER_LAT = 110_574;
const M_PER_LNG = 111_320 * Math.cos((24.47 * Math.PI) / 180);

function toPoly(ring: readonly (readonly [number, number])[]): [number, number][][] {
  return [ring.map(([lng, lat]) => [lng, lat])];
}

function rectRing(w: number, s: number, e: number, n: number): [number, number][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

function circleRing(lng: number, lat: number, radiusM: number, sides = 8): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    ring.push([+(lng + (radiusM * Math.cos(a)) / M_PER_LNG).toFixed(6), +(lat + (radiusM * Math.sin(a)) / M_PER_LAT).toFixed(6)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

function wallSegmentRing([x0, y0]: readonly [number, number], [x1, y1]: readonly [number, number], halfThickM: number): [number, number][] {
  const dx = (x1 - x0) * M_PER_LNG;
  const dy = (y1 - y0) * M_PER_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (halfThickM / M_PER_LNG);
  const ny = (dx / len) * (halfThickM / M_PER_LAT);
  return [
    [+(x0 + nx).toFixed(6), +(y0 + ny).toFixed(6)],
    [+(x1 + nx).toFixed(6), +(y1 + ny).toFixed(6)],
    [+(x1 - nx).toFixed(6), +(y1 - ny).toFixed(6)],
    [+(x0 - nx).toFixed(6), +(y0 - ny).toFixed(6)],
    [+(x0 + nx).toFixed(6), +(y0 + ny).toFixed(6)],
  ];
}

/** 4 OSM buildings inside/immediately adjacent to Saqifat Bani Sa'idah (ways 775419642..775419645). */
const HERITAGE_OSM_BUILDINGS: readonly OsmBuildingRecord[] = [
  {
    id: '775419642',
    kind: 'heritage',
    height: 6.8,
    ring: [
      [39.606563, 24.470064],
      [39.606815, 24.470066],
      [39.606816, 24.46998],
      [39.606564, 24.469978],
      [39.606563, 24.470064],
    ],
  },
  {
    id: '775419643',
    kind: 'heritage',
    height: 6.8,
    ring: [
      [39.606822, 24.470062],
      [39.607052, 24.470061],
      [39.607051, 24.469977],
      [39.606821, 24.469978],
      [39.606822, 24.470062],
    ],
  },
  {
    id: '775419644',
    kind: 'heritage',
    height: 5.2,
    ring: [
      [39.606902, 24.469827],
      [39.606992, 24.469824],
      [39.606993, 24.469742],
      [39.606902, 24.469743],
      [39.606902, 24.469827],
    ],
  },
  {
    id: '775419645',
    kind: 'heritage',
    height: 5.2,
    ring: [
      [39.606241, 24.46972],
      [39.606333, 24.469736],
      [39.606358, 24.469629],
      [39.606265, 24.46961],
      [39.606241, 24.46972],
    ],
  },
];

/** 45 surrounding West-zone OSM buildings (lng 39.6038..39.6092, lat 24.4665..24.4728), excluding restrooms 209..222. */
const SURROUNDING_OSM_BUILDINGS: readonly OsmBuildingRecord[] = [
  {
    id: '65541120',
    kind: 'hotel',
    name: 'فندق ميسان الحارثية',
    height: 42,
    ring: [
      [39.608799, 24.472011],
      [39.608797, 24.472338],
      [39.608844, 24.47242],
      [39.608901, 24.472448],
      [39.608959, 24.472464],
      [39.609018, 24.472449],
      [39.609074, 24.472421],
      [39.609122, 24.47234],
      [39.609123, 24.472012],
      [39.609073, 24.471941],
      [39.609022, 24.471916],
      [39.608959, 24.471898],
      [39.608899, 24.471912],
      [39.608844, 24.47194],
      [39.608799, 24.472011],
    ],
  },
  {
    id: '65542886',
    kind: 'hotel',
    name: 'فندق وينر إن الخير',
    height: 36,
    ring: [
      [39.606774, 24.471706],
      [39.606767, 24.471449],
      [39.6071, 24.471443],
      [39.607097, 24.471668],
      [39.607053, 24.471706],
      [39.606774, 24.471706],
    ],
  },
  {
    id: '261731120',
    kind: 'hotel',
    name: 'فندق اعمار ايليت',
    height: 30,
    ring: [
      [39.606675, 24.471392],
      [39.606345, 24.471402],
      [39.606399, 24.471188],
      [39.606479, 24.471148],
      [39.606674, 24.471156],
      [39.606675, 24.471392],
    ],
  },
  {
    id: '301812038',
    kind: 'hotel',
    name: 'فندق إيلاف طيبة',
    height: 36,
    ring: [
      [39.60676, 24.471137],
      [39.606766, 24.471404],
      [39.607118, 24.471398],
      [39.607116, 24.471183],
      [39.607056, 24.471134],
      [39.60676, 24.471137],
    ],
  },
  {
    id: '301812039',
    kind: 'hotel',
    name: 'فندق ابراج طابة',
    height: 30,
    ring: [
      [39.606347, 24.471719],
      [39.606301, 24.47167],
      [39.60635, 24.471446],
      [39.606675, 24.471451],
      [39.606675, 24.471714],
      [39.606347, 24.471719],
    ],
  },
  {
    id: '301813399',
    kind: 'hotel',
    name: 'فندق مآدن طيبة',
    height: 36,
    ring: [
      [39.608311, 24.472432],
      [39.608311, 24.472168],
      [39.608633, 24.472171],
      [39.608636, 24.47241],
      [39.608601, 24.472435],
      [39.608311, 24.472432],
    ],
  },
  {
    id: '369085864',
    kind: 'hotel',
    name: 'فندق مياس',
    height: 30,
    ring: [
      [39.605533, 24.467644],
      [39.605955, 24.467636],
      [39.605961, 24.467913],
      [39.60554, 24.467921],
      [39.605533, 24.467644],
    ],
  },
  {
    id: '369085866',
    kind: 'civic',
    name: 'وزارة المالية',
    height: 16,
    ring: [
      [39.606023, 24.467929],
      [39.60603, 24.467641],
      [39.606486, 24.467652],
      [39.606527, 24.467669],
      [39.606534, 24.467711],
      [39.606498, 24.467877],
      [39.606438, 24.467929],
      [39.606023, 24.467929],
    ],
  },
  {
    id: '369085868',
    kind: 'civic',
    name: 'وكالة الرئاسة العامة لشؤون المسجد النبوي',
    height: 12.6,
    ring: [
      [39.607412, 24.467141],
      [39.607408, 24.466591],
      [39.60773, 24.466589],
      [39.607735, 24.467138],
      [39.607412, 24.467141],
    ],
  },
  {
    id: '369085870',
    kind: 'civic',
    name: 'متحف السلام',
    height: 16,
    ring: [
      [39.607418, 24.468171],
      [39.607424, 24.467635],
      [39.60776, 24.467639],
      [39.607754, 24.468174],
      [39.607418, 24.468171],
    ],
  },
  {
    id: '369464185',
    kind: 'building',
    height: 22,
    ring: [
      [39.603943, 24.467952],
      [39.603942, 24.467666],
      [39.604121, 24.467666],
      [39.604122, 24.467952],
      [39.603943, 24.467952],
    ],
  },
  {
    id: '369464186',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.604178, 24.467984],
      [39.604181, 24.467663],
      [39.604611, 24.467664],
      [39.604666, 24.467712],
      [39.604669, 24.46793],
      [39.604606, 24.467983],
      [39.604178, 24.467984],
    ],
  },
  {
    id: '369464188',
    kind: 'hotel',
    name: 'فندق امجاد الغراء',
    height: 36,
    ring: [
      [39.603744, 24.468478],
      [39.603742, 24.468072],
      [39.603961, 24.468068],
      [39.604007, 24.468114],
      [39.604018, 24.46841],
      [39.603963, 24.468468],
      [39.603744, 24.468478],
    ],
  },
  {
    id: '388392249',
    kind: 'hotel',
    name: 'فندق جراند الصافي',
    height: 30,
    ring: [
      [39.60443, 24.466329],
      [39.604655, 24.466331],
      [39.604654, 24.466649],
      [39.604594, 24.466684],
      [39.604431, 24.466684],
      [39.60443, 24.466329],
    ],
  },
  {
    id: '388392250',
    kind: 'hotel',
    name: 'فندق ديوان المدينه',
    height: 30,
    ring: [
      [39.604375, 24.466493],
      [39.604152, 24.466492],
      [39.604151, 24.466638],
      [39.604191, 24.466682],
      [39.604374, 24.466682],
      [39.604375, 24.466493],
    ],
  },
  {
    id: '444235531',
    kind: 'civic',
    name: 'مسجد علي بن أبي طالب',
    height: 16,
    ring: [
      [39.606212, 24.467042],
      [39.606209, 24.466941],
      [39.606513, 24.466937],
      [39.606516, 24.467043],
      [39.606212, 24.467042],
    ],
  },
  {
    id: '625628203',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.603942, 24.467155],
      [39.603944, 24.466872],
      [39.604353, 24.466866],
      [39.604361, 24.467145],
      [39.603942, 24.467155],
    ],
  },
  {
    id: '625628205',
    kind: 'hotel',
    name: 'فندق البسفور',
    height: 30,
    ring: [
      [39.604426, 24.467137],
      [39.604646, 24.467139],
      [39.60465, 24.466919],
      [39.604602, 24.466867],
      [39.604428, 24.466871],
      [39.604426, 24.467137],
    ],
  },
  {
    id: '625628207',
    kind: 'building',
    name: 'مستشفي السلام الوقفي',
    height: 22,
    ring: [
      [39.604988, 24.467883],
      [39.60499, 24.46764],
      [39.605253, 24.467643],
      [39.605254, 24.467739],
      [39.605178, 24.467742],
      [39.605178, 24.467824],
      [39.605254, 24.46782],
      [39.605255, 24.467926],
      [39.605036, 24.46793],
      [39.604988, 24.467883],
    ],
  },
  {
    id: '625628209',
    kind: 'hotel',
    name: 'فندق كيان الماسي',
    height: 30,
    ring: [
      [39.604965, 24.467117],
      [39.604961, 24.466914],
      [39.605001, 24.466872],
      [39.605196, 24.466872],
      [39.605196, 24.467119],
      [39.604965, 24.467117],
    ],
  },
  {
    id: '625628211',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.605307, 24.46713],
      [39.605774, 24.46713],
      [39.605783, 24.466879],
      [39.605309, 24.466877],
      [39.605307, 24.46713],
    ],
  },
  {
    id: '625628213',
    kind: 'hotel',
    name: 'فندق منازل الصادق',
    height: 30,
    ring: [
      [39.605785, 24.467127],
      [39.605986, 24.467132],
      [39.605991, 24.467068],
      [39.605953, 24.467002],
      [39.605881, 24.466953],
      [39.60579, 24.46695],
      [39.605785, 24.467127],
    ],
  },
  {
    id: '625636527',
    kind: 'hotel',
    name: 'فندق ديار الايمان',
    height: 36,
    ring: [
      [39.606176, 24.471916],
      [39.606103, 24.472211],
      [39.606388, 24.472222],
      [39.606406, 24.471934],
      [39.606295, 24.471902],
      [39.606176, 24.471916],
    ],
  },
  {
    id: '625636528',
    kind: 'hotel',
    name: 'فندق تريبل ون',
    height: 30,
    ring: [
      [39.606097, 24.472235],
      [39.606052, 24.472462],
      [39.606194, 24.472499],
      [39.606346, 24.472481],
      [39.60637, 24.472255],
      [39.606247, 24.472233],
      [39.606097, 24.472235],
    ],
  },
  {
    id: '625636529',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.606572, 24.472539],
      [39.606572, 24.472245],
      [39.607147, 24.472237],
      [39.607147, 24.472341],
      [39.607135, 24.472402],
      [39.607104, 24.472451],
      [39.607062, 24.472496],
      [39.606954, 24.472541],
      [39.606572, 24.472539],
    ],
  },
  {
    id: '625636758',
    kind: 'hotel',
    name: 'ديار عجوة، مجموعة تابيستري من هيلتون',
    height: 36,
    ring: [
      [39.608311, 24.472168],
      [39.608633, 24.472171],
      [39.60864, 24.471958],
      [39.608609, 24.471922],
      [39.60856, 24.471883],
      [39.608485, 24.471856],
      [39.608327, 24.471858],
      [39.608311, 24.472168],
    ],
  },
  {
    id: '625637641',
    kind: 'building',
    height: 22,
    ring: [
      [39.603669, 24.470923],
      [39.603662, 24.470647],
      [39.603958, 24.470632],
      [39.604007, 24.470665],
      [39.604017, 24.470875],
      [39.603981, 24.470917],
      [39.603669, 24.470923],
    ],
  },
  {
    id: '625637643',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.60374, 24.47006],
      [39.604007, 24.470054],
      [39.603998, 24.469681],
      [39.603734, 24.469687],
      [39.60374, 24.47006],
    ],
  },
  {
    id: '625637644',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.603734, 24.469147],
      [39.604007, 24.469144],
      [39.603998, 24.468729],
      [39.603932, 24.468697],
      [39.603788, 24.468695],
      [39.603727, 24.468729],
      [39.603734, 24.469147],
    ],
  },
  {
    id: '625637646',
    kind: 'hotel',
    name: 'فندق روضة العقيق',
    height: 36,
    ring: [
      [39.604194, 24.468084],
      [39.604139, 24.468124],
      [39.604139, 24.468275],
      [39.604633, 24.468285],
      [39.604638, 24.468132],
      [39.604583, 24.468084],
      [39.604194, 24.468084],
    ],
  },
  {
    id: '625747546',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.60413, 24.470562],
      [39.604145, 24.470886],
      [39.604183, 24.470906],
      [39.604351, 24.470906],
      [39.604392, 24.470879],
      [39.604388, 24.470555],
      [39.60413, 24.470562],
    ],
  },
  {
    id: '625747547',
    kind: 'hotel',
    name: 'فندق وقف الصافي',
    height: 30,
    ring: [
      [39.604129, 24.470125],
      [39.604134, 24.470457],
      [39.604637, 24.470451],
      [39.604632, 24.470119],
      [39.604129, 24.470125],
    ],
  },
  {
    id: '625747548',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.604142, 24.469674],
      [39.604138, 24.470024],
      [39.604374, 24.470021],
      [39.604377, 24.46967],
      [39.604142, 24.469674],
    ],
  },
  {
    id: '625747549',
    kind: 'hotel',
    name: 'فندق منازل الزهراء',
    height: 30,
    ring: [
      [39.60413, 24.469245],
      [39.604127, 24.469582],
      [39.604355, 24.469585],
      [39.60437, 24.469245],
      [39.60413, 24.469245],
    ],
  },
  {
    id: '625747550',
    kind: 'hotel',
    name: 'فندق ارائك طيبة',
    height: 30,
    ring: [
      [39.604435, 24.470025],
      [39.604636, 24.470028],
      [39.604647, 24.469671],
      [39.604438, 24.469669],
      [39.604435, 24.470025],
    ],
  },
  {
    id: '625747551',
    kind: 'hotel',
    name: 'فندق كرم طيبة الماسي',
    height: 30,
    ring: [
      [39.604455, 24.469581],
      [39.604638, 24.469586],
      [39.604644, 24.469392],
      [39.604461, 24.469387],
      [39.604455, 24.469581],
    ],
  },
  {
    id: '625747552',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.604134, 24.468706],
      [39.60414, 24.468328],
      [39.604406, 24.468334],
      [39.604398, 24.468712],
      [39.604134, 24.468706],
    ],
  },
  {
    id: '625747553',
    kind: 'hotel',
    name: 'فندق سويس إنترناشونال طابه السلام',
    height: 30,
    ring: [
      [39.604151, 24.468957],
      [39.604145, 24.468761],
      [39.604404, 24.468763],
      [39.604396, 24.468954],
      [39.604151, 24.468957],
    ],
  },
  {
    id: '625747554',
    kind: 'hotel',
    name: 'فندق الدار روافد توليب إن',
    height: 30,
    ring: [
      [39.604423, 24.468954],
      [39.60465, 24.468951],
      [39.604653, 24.46876],
      [39.604429, 24.46876],
      [39.604423, 24.468954],
    ],
  },
  {
    id: '625747555',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.604453, 24.470901],
      [39.604448, 24.470554],
      [39.604662, 24.470549],
      [39.604657, 24.470864],
      [39.604617, 24.470903],
      [39.604453, 24.470901],
    ],
  },
  {
    id: '630032836',
    kind: 'hotel',
    name: 'فندق حياة الذهبي',
    height: 36,
    ring: [
      [39.604151, 24.469149],
      [39.604146, 24.468977],
      [39.604648, 24.468971],
      [39.604648, 24.469147],
      [39.604151, 24.469149],
    ],
  },
  {
    id: '670700709',
    kind: 'building',
    name: 'Luggage Lockers',
    height: 4.8,
    ring: [
      [39.608948, 24.470928],
      [39.608949, 24.470959],
      [39.609061, 24.47096],
      [39.60906, 24.470928],
      [39.608948, 24.470928],
    ],
  },
  {
    id: '884849172',
    kind: 'building',
    height: 4.8,
    ring: [
      [39.606775, 24.46901],
      [39.60682, 24.469021],
      [39.606852, 24.468868],
      [39.606808, 24.46886],
      [39.606775, 24.46901],
    ],
  },
  {
    id: '1357108807',
    kind: 'hotel',
    name: 'فندق ديار التقوى',
    height: 30,
    ring: [
      [39.604431, 24.468705],
      [39.604438, 24.468494],
      [39.604669, 24.468496],
      [39.604665, 24.468707],
      [39.604431, 24.468705],
    ],
  },
  {
    id: '1365532985',
    kind: 'hotel',
    height: 30,
    ring: [
      [39.605255, 24.467926],
      [39.605253, 24.467643],
      [39.605468, 24.467641],
      [39.60547, 24.467924],
      [39.605255, 24.467926],
    ],
  },
];

/** Perimeter enclosure walls around Saqifat Bani Sa'idah (open southern gateway). */
const GARDEN_WALLS: readonly { id: string; a: readonly [number, number]; b: readonly [number, number] }[] = [
  { id: 'saqifah-wall-west', a: [39.60646, 24.46992], b: [39.60641, 24.47066] },
  { id: 'saqifah-wall-north', a: [39.60641, 24.47066], b: [39.60718, 24.47064] },
  { id: 'saqifah-wall-east', a: [39.60718, 24.47064], b: [39.60718, 24.4699] },
  { id: 'saqifah-wall-south-west', a: [39.60646, 24.46992], b: [39.60675, 24.46991] },
  { id: 'saqifah-wall-south-east', a: [39.60691, 24.46991], b: [39.60718, 24.4699] },
];

const GARDEN_BASE_RING: readonly (readonly [number, number])[] = [
  [39.60646, 24.46992],
  [39.60718, 24.4699],
  [39.60718, 24.47064],
  [39.60641, 24.47066],
  [39.60646, 24.46992],
];

const GARDEN_LAWNS: readonly { id: string; ring: [number, number][] }[] = [
  { id: 'saqifah-lawn-nw', ring: rectRing(39.60646, 24.4704, 39.60675, 24.47061) },
  { id: 'saqifah-lawn-ne', ring: rectRing(39.60691, 24.4704, 39.60714, 24.47061) },
  { id: 'saqifah-lawn-sw', ring: rectRing(39.60649, 24.47009, 39.60675, 24.47028) },
  { id: 'saqifah-lawn-se', ring: rectRing(39.60691, 24.47009, 39.60714, 24.47028) },
];

const GARDEN_PATHS: readonly { id: string; ring: [number, number][] }[] = [
  { id: 'saqifah-path-ns', ring: rectRing(39.60678, 24.46991, 39.60688, 24.47062) },
  { id: 'saqifah-path-ew', ring: rectRing(39.60648, 24.4703, 39.60715, 24.47038) },
  { id: 'saqifah-path-plaza', ring: circleRing(39.60683, 24.47034, 9.5, 10) },
];

/** 28 palm & shade trees distributed cleanly across the four planted beds and entrance forecourt. */
const GARDEN_TREES: readonly { id: string; lng: number; lat: number }[] = [
  // NW bed (7)
  { id: 'saqifah-tree-01', lng: 39.60651, lat: 24.47056 },
  { id: 'saqifah-tree-02', lng: 39.6066, lat: 24.47056 },
  { id: 'saqifah-tree-03', lng: 39.60669, lat: 24.47056 },
  { id: 'saqifah-tree-04', lng: 39.60652, lat: 24.47049 },
  { id: 'saqifah-tree-05', lng: 39.60663, lat: 24.47049 },
  { id: 'saqifah-tree-06', lng: 39.60651, lat: 24.47043 },
  { id: 'saqifah-tree-07', lng: 39.6067, lat: 24.47044 },
  // NE bed (7)
  { id: 'saqifah-tree-08', lng: 39.60695, lat: 24.47056 },
  { id: 'saqifah-tree-09', lng: 39.60703, lat: 24.47056 },
  { id: 'saqifah-tree-10', lng: 39.6071, lat: 24.47056 },
  { id: 'saqifah-tree-11', lng: 39.60696, lat: 24.47049 },
  { id: 'saqifah-tree-12', lng: 39.60708, lat: 24.47049 },
  { id: 'saqifah-tree-13', lng: 39.60695, lat: 24.47043 },
  { id: 'saqifah-tree-14', lng: 39.6071, lat: 24.47043 },
  // SW bed (7)
  { id: 'saqifah-tree-15', lng: 39.60653, lat: 24.47024 },
  { id: 'saqifah-tree-16', lng: 39.60663, lat: 24.47024 },
  { id: 'saqifah-tree-17', lng: 39.60671, lat: 24.47024 },
  { id: 'saqifah-tree-18', lng: 39.60653, lat: 24.47017 },
  { id: 'saqifah-tree-19', lng: 39.60665, lat: 24.47017 },
  { id: 'saqifah-tree-20', lng: 39.60654, lat: 24.47012 },
  { id: 'saqifah-tree-21', lng: 39.60671, lat: 24.47012 },
  // SE bed (7)
  { id: 'saqifah-tree-22', lng: 39.60695, lat: 24.47024 },
  { id: 'saqifah-tree-23', lng: 39.60704, lat: 24.47024 },
  { id: 'saqifah-tree-24', lng: 39.60711, lat: 24.47024 },
  { id: 'saqifah-tree-25', lng: 39.60696, lat: 24.47017 },
  { id: 'saqifah-tree-26', lng: 39.60709, lat: 24.47017 },
  { id: 'saqifah-tree-27', lng: 39.60695, lat: 24.47012 },
  { id: 'saqifah-tree-28', lng: 39.6071, lat: 24.47012 },
];

const BUILDING_COLORS: Record<OsmBuildingRecord['kind'], string> = {
  heritage: '#cbb593',
  hotel: '#cbd1d8',
  civic: '#d4cbb9',
  building: '#c8ccd2',
};

export function saqifahGround2D(): FeatureCollection<Polygon, Saqifah2DProps> {
  const features: Feature<Polygon, Saqifah2DProps>[] = [];
  const push = (id: string, kind: Saqifah2DProps['kind'], color: string, opacity: number, ring: readonly (readonly [number, number])[]) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: toPoly(ring) },
      properties: { id, kind, color, opacity },
    });
  };

  push('saqifah-garden-base', 'garden-base', '#ece3d2', 0.88, GARDEN_BASE_RING);
  for (const lawn of GARDEN_LAWNS) push(lawn.id, 'lawn', '#4c8647', 0.85, lawn.ring);
  for (const p of GARDEN_PATHS) push(p.id, 'path', '#e4d8c4', 0.92, p.ring);
  for (const w of GARDEN_WALLS) push(w.id, 'wall', '#ccbda4', 0.95, wallSegmentRing(w.a, w.b, 0.75));
  for (const h of HERITAGE_OSM_BUILDINGS) push(h.id, 'heritage', '#c9b28f', 0.95, h.ring);
  for (const t of GARDEN_TREES) push(`${t.id}-canopy`, 'tree-crown', '#2d6832', 0.82, circleRing(t.lng, t.lat, 2.2, 8));

  return { type: 'FeatureCollection', features };
}

export function saqifahAndSurroundings3D(): FeatureCollection<Polygon, Saqifah3DProps> {
  const features: Feature<Polygon, Saqifah3DProps>[] = [];
  const push = (
    id: string,
    kind: Saqifah3DProps['kind'],
    color: string,
    base: number,
    height: number,
    opacity: number,
    ring: readonly (readonly [number, number])[],
    name?: string,
  ) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: toPoly(ring) },
      properties: { id, kind, ...(name ? { name } : {}), color, base, height, opacity },
    });
  };

  for (const lawn of GARDEN_LAWNS) push(lawn.id, 'lawn', '#3b7339', 0, 0.26, 0.96, lawn.ring);
  for (const p of GARDEN_PATHS) push(p.id, 'path', '#e3d7c3', 0, 0.28, 0.98, p.ring);
  for (const w of GARDEN_WALLS) push(w.id, 'wall', '#d8cab4', 0, 3.2, 0.98, wallSegmentRing(w.a, w.b, 0.75));
  for (const h of HERITAGE_OSM_BUILDINGS) push(h.id, 'heritage', BUILDING_COLORS.heritage, 0, h.height, 0.98, h.ring);

  for (const t of GARDEN_TREES) {
    push(`${t.id}-trunk`, 'tree-trunk', '#6b4c35', 0, 2.6, 1, circleRing(t.lng, t.lat, 0.45, 6));
    push(`${t.id}-crown`, 'tree-crown', '#2f6a34', 2.3, 6.2, 0.95, circleRing(t.lng, t.lat, 2.3, 8));
  }

  for (const b of SURROUNDING_OSM_BUILDINGS) {
    push(b.id, b.kind, BUILDING_COLORS[b.kind], 0, b.height, 0.94, b.ring, b.name);
  }

  return { type: 'FeatureCollection', features };
}
