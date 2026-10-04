export type Direction = 'south' | 'west' | 'north' | 'east';

export type Category =
  | 'gates'
  | 'toilets'
  | 'parking'
  | 'landmarks'
  | 'wheelchair'
  | 'emergency'
  | 'women'
  | 'hotels'
  | 'food';

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
  | 'wheelchair_zone'
  | 'women_service'
  | 'hotel'
  | 'food';

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
}

export type LatLng = [number, number];

export interface Routing {
  walkway_ring: LatLng[];
  obstacles: {
    mosque_building: LatLng[];
    baqi_outside_haram: LatLng[];
  };
  rules: {
    short_L_route_max_m: number;
    corner_radius_m: number;
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

export type LangCode = 'ar' | 'en' | 'tr' | 'ur' | 'id' | 'uz';

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

export type I18n = Record<LangCode, LangPack>;

/** Per-POI nudge in metres, applied at load time. */
export type Overrides = Record<string, { north?: number; east?: number }>;
