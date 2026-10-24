export type Direction = 'south' | 'west' | 'north' | 'east';

export type Category = 'gates' | 'toilets' | 'parking' | 'landmarks' | 'wheelchair' | 'emergency' | 'women' | 'hotels' | 'food' | 'shopping';

export type SubCategory =
  | 'gate_outer'
  | 'gate_inner'
  | 'toilet_men'
  | 'toilet_women'
  | 'toilet_mixed'
  | 'toilet_elderly'
  | 'toilet_accessible'
  | 'parking'
  | 'landmark'
  | 'historic'
  | 'health'
  | 'lost_children'
  | 'lost_found'
  | 'police'
  | 'child_care'
  | 'service'
  | 'wheelchair_zone'
  | 'women_service'
  | 'hotel'
  | 'food'
  | 'mall'
  | 'hypermarket'
  | 'market';

export type Status = 'open' | 'maintenance' | 'works';

export type Gender = 'men' | 'women' | 'mixed' | 'all';

/** A point of interest exactly as stored in data/pois.json. */
export interface Poi {
  id: number;
  name_ar: string;
  category: Category;
  subCategory: SubCategory;
  lat: number;
  lng: number;
  direction: Direction;
  description_ar: string;
  status?: Status;
  /** The facility across the walkway that leads to the same restrooms. */
  pairWith?: number;
  /** The number shown between the two markers of a pair on the map (both facilities carry it). */
  pairNo?: number;
  gender?: Gender;
  /** Inner gate inside the women's section. */
  women?: boolean;
  /** Extra search terms (parking: "1A 1B P1 parking"). */
  alias?: string;
  /** An elevator is under construction here. */
  elev?: boolean;
  elevatorAvailable?: boolean;
  /** Closed because works on this paired facility block the shared restrooms. */
  worksBy?: number;
  rawdah?: boolean;
  access?: 'public' | 'subscribers';
  /** Source element in OpenStreetMap (n123, w123, r123), for places taken from it. */
  osm?: string;
  /** Where a place's position comes from when not OSM (e.g. a brand's own branch list). */
  source?: string;
  /** Wikidata item that confirms a historic site (Q123). */
  wikidata?: string;
}

/** One text slide of a must-visit site. `ar` and `en` are required; other languages are added after the texts are approved. */
export type VisitText = { ar: string; en: string } & Partial<Record<LangCode, string>>;

/** A photo of a site: file under public/visits/. `by` and `license` are the owner's record of where it came from (not shown in the app). */
export interface VisitImage {
  src: string;
  alt: Partial<Record<LangCode, string>> & { ar: string; en: string };
  by: string;
  license: string;
  /** CSS object-position when the photo is cropped to the screen (e.g. '20% 50%' keeps the left part). */
  focus?: string;
  /** Page where the photo and its licence can be checked. */
  url?: string;
}

export interface VisitSite {
  /** Place in pois.json. */
  id: number;
  slides: VisitText[];
  /** Pages the facts come from (two at least). */
  sources: { t: string; u: string }[];
  images: VisitImage[];
}

export type LatLng = [number, number];

/** A walkway branching off the main ring: a spur, a cross link, or a path to a women's prayer area. */
export interface Walkway {
  id: string;
  kind: 'spur' | 'link' | 'walk' | 'women';
  path: LatLng[];
}

export interface Routing {
  /** The main walkway loop round the mosque (closed: the last point joins the first). */
  walkway_ring: LatLng[];
  /** Branches that join the ring or each other where their ends meet a walkway. */
  walkways: Walkway[];
  /** Areas no route may cross; each is a 4-corner rectangle. */
  obstacles: {
    mosque_building: LatLng[];
    baqi_outside_haram: LatLng[];
  } & Record<string, LatLng[]>;
  /** Open ground with no set paths (the west plaza): inside it, walk straight. */
  open_areas?: { id: string; polygon: LatLng[] }[];
  /** Women's prayer areas inside the mosque, drawn as a pink overlay. */
  women_prayer_areas: { id: string; polygon: LatLng[] }[];
  rules: {
    short_L_route_max_m: number;
    corner_radius_m: number;
    /** Side of the square building every restroom inside the Haram is treated as (routes pass beside it, never over it). */
    toilet_building_m: number;
    walk_speed_m_per_min: number;
  };
}

export interface Rules {
  rules: {
    WOMEN: number[];
    MIXED: number[];
    ELDERLY: number[];
    ELEV_SOON: number[];
    ELEV_WOMEN: number[];
    WORKS_PAIR: Record<string, number>;
    MAINT_demo: number[];
    initial_works_demo: number[];
    /** By car to these places (id → lot id), park in this lot (owner's choice); otherwise the nearest public lot. */
    drive_lot?: Record<string, number | string>;
    /** Gates reached through another place first (the Rawdah entrance for gates 37 and 38). Gate id → place id. */
    gate_via?: Record<string, number | string>;
    rawdah: {
      gate: number;
      isha_hour_default: number;
      fajr_hour_default: number;
      schedule_ar: string;
    };
  };
  colors: {
    directions: Record<Direction, string>;
    categories: Record<'men' | 'women' | 'acc' | 'gray' | 'hotel' | 'food' | 'land' | 'emg', string>;
  };
  map: {
    center: LatLng;
    default_zoom: number;
    max_zoom: number;
    tiles: { satellite: string; light: string };
  };
}

export type LangCode =
  | 'ar'
  | 'en'
  | 'tr'
  | 'ur'
  | 'id'
  | 'uz'
  | 'bn'
  | 'fr'
  | 'fa'
  | 'ru'
  | 'ms'
  | 'ha'
  | 'ml'
  | 'sw'
  | 'ps'
  | 'so'
  | 'ta'
  | 'hi'
  | 'bs'
  | 'de'
  | 'zh'
  | 'am'
  | 'ku'
  | 'az'
  | 'th'
  | 'es';

export interface LangPack {
  n: string;
  short: string;
  dir: 'rtl' | 'ltr';
  dirs: Record<Direction, string>;
  streets: Record<Direction, string>;
  ui: Record<string, string>;
  /** Named inner gates (non-Arabic only). */
  gi?: Record<string, string>;
  /** Name templates per subCategory, e.g. "Gate {id}". */
  nt?: Record<string, string>;
  /** Description templates per subCategory. */
  dt?: Record<string, string>;
  /** Descriptions keyed by Arabic name. */
  descs?: Record<string, string>;
  /** Translated names keyed by Arabic name. */
  names?: Record<string, string>;
}

/** data/i18n.json: place names and descriptions per language; the interface texts are in src/i18n/locales. */
export type I18n = Record<LangCode, Omit<LangPack, 'ui'>>;

/** Per-POI nudge in metres, applied at load time. */
export type Overrides = Record<string, { north?: number; east?: number }>;
