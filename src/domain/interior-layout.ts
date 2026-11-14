import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { WOMEN_RAWDAH_CORRIDOR_BOUNDS } from './rawdah-layout';

/**
 * Interior Mosque prayer halls, internal open courtyards, the closed women's corridor
 * from Gate 21 to Behind the Rawdah, and interior connecting walkways between main gates
 * (2026-11-14).
 *
 * All interior corridors obey the two rules specified by the owner:
 * 1. Exterior walkways retain default route priority (`الأولوية للمسارات الخارجية`).
 * 2. Women's routes must NEVER enter men's interior Mosque halls (`men_interior`);
 *    the sole permitted interior path for women is the enclosed Gate 21 → Behind Rawdah
 *    corridor (`women_rawdah_corridor`), bounded East and West during women's visiting hours.
 */

export interface InteriorAreaProps {
  id: string;
  kind: 'men_hall' | 'women_rawdah_corridor' | 'inner_courtyard';
  name_ar: string;
  color: string;
  opacity: number;
}

export interface InteriorCorridorProps {
  id: string;
  kind: 'men_interior' | 'women_rawdah_corridor';
  name_ar: string;
}

function rectRing(w: number, s: number, e: number, n: number): [number, number][] {
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
    [w, n],
  ];
}

export function interiorPrayerAreas(): FeatureCollection<Polygon, InteriorAreaProps> {
  const b = WOMEN_RAWDAH_CORRIDOR_BOUNDS;
  const features: Feature<Polygon, InteriorAreaProps>[] = [
    {
      type: 'Feature',
      properties: {
        id: 'hall-west-extension',
        kind: 'men_hall',
        name_ar: 'المصلى الداخلي — التوسعة الغربية (للرجال)',
        color: '#8899a6',
        opacity: 0.24,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.60922, 24.46788, 39.61018, 24.46976)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'hall-north-west-bay',
        kind: 'men_hall',
        name_ar: 'المصلى الداخلي — التوسعة الشمالية الغربية (للرجال)',
        color: '#8899a6',
        opacity: 0.24,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.61025, 24.46862, b.westLng - 0.00003, 24.46976)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'hall-north-east-bay',
        kind: 'men_hall',
        name_ar: 'المصلى الداخلي — التوسعة الشمالية الشرقية (للرجال)',
        color: '#8899a6',
        opacity: 0.24,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(b.eastLng + 0.00003, 24.46862, 39.61224, 24.46976)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'hall-east-extension',
        kind: 'men_hall',
        name_ar: 'المصلى الداخلي — التوسعة الشرقية (للرجال)',
        color: '#8899a6',
        opacity: 0.24,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.61231, 24.46788, 39.61306, 24.46976)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'hall-old-mosque-south',
        kind: 'men_hall',
        name_ar: 'الحرم القديم ومنطقة الصلوات (للرجال)',
        color: '#8899a6',
        opacity: 0.22,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.61062, 24.46755, 39.61224, 24.46796)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'courtyard-inner-center',
        kind: 'inner_courtyard',
        name_ar: 'الحصوة والفناء الداخلي المظلل',
        color: '#dcd4c6',
        opacity: 0.28,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.61084, 24.46812, 39.61146, 24.4686)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'women-rawdah-corridor-area',
        kind: 'women_rawdah_corridor',
        name_ar: 'ممر النساء المغلق (باب 21 ← خلف الروضة الشريفة)',
        color: '#c97b9e',
        opacity: 0.34,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(b.westLng, b.southLat, b.eastLng, b.northLat)] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'women-behind-rawdah-zone',
        kind: 'women_rawdah_corridor',
        name_ar: 'مصلى النساء خلف الروضة الشريفة',
        color: '#c97b9e',
        opacity: 0.36,
      },
      geometry: { type: 'Polygon', coordinates: [rectRing(39.61082, 24.46784, 39.61148, 24.4681)] },
    },
  ];
  return { type: 'FeatureCollection', features };
}

export function interiorCorridors(): FeatureCollection<LineString, InteriorCorridorProps> {
  const b = WOMEN_RAWDAH_CORRIDOR_BOUNDS;
  const corridors: { id: string; kind: InteriorCorridorProps['kind']; name_ar: string; coordinates: [number, number][] }[] = [
    {
      id: 'men-ns-gate15-gate6',
      kind: 'men_interior',
      name_ar: 'ممر داخلي (باب 15 ← باب 6)',
      coordinates: [
        [39.6094962, 24.4698467],
        [39.609485, 24.4687485],
        [39.609474, 24.4678322],
      ],
    },
    {
      id: 'men-ns-gate17-gate5',
      kind: 'men_interior',
      name_ar: 'ممر داخلي (باب عمر 17 ← باب قباء 5)',
      coordinates: [
        [39.6100144, 24.4699208],
        [39.6100144, 24.4687485],
        [39.6100144, 24.4677649],
      ],
    },
    {
      id: 'men-ns-gate25-gate37',
      kind: 'men_interior',
      name_ar: 'ممر داخلي (باب عثمان 25 ← باب مكة 37)',
      coordinates: [
        [39.6122942, 24.4699208],
        [39.6122942, 24.4687553],
        [39.6122202, 24.4679266],
      ],
    },
    {
      id: 'men-ew-west-gate10',
      kind: 'men_interior',
      name_ar: 'ممر عرضي داخلي (باب 10 غربًا)',
      coordinates: [
        [39.6091483, 24.4687485],
        [39.6100144, 24.4687485],
        [b.westLng - 0.000045, 24.4687485],
      ],
    },
    {
      id: 'men-ew-east-gate32',
      kind: 'men_interior',
      name_ar: 'ممر عرضي داخلي (باب أبي ذر 32 شرقًا)',
      coordinates: [
        [b.eastLng + 0.000045, 24.4687553],
        [39.6122942, 24.4687553],
        [39.613138, 24.4687553],
      ],
    },
    {
      id: 'men-ew-south-west',
      kind: 'men_interior',
      name_ar: 'ممر عرضي جنوبي غربي (باب الملك سعود 8)',
      coordinates: [
        [39.6091483, 24.4682702],
        [39.6100144, 24.4682702],
        [b.westLng - 0.000045, 24.4682702],
      ],
    },
    {
      id: 'men-ew-south-east',
      kind: 'men_interior',
      name_ar: 'ممر عرضي جنوبي شرقي (باب الملك عبد العزيز 34)',
      coordinates: [
        [b.eastLng + 0.000045, 24.4682904],
        [39.6122942, 24.4682904],
        [39.613138, 24.4682904],
      ],
    },
    {
      id: 'women-rawdah-gate21-corridor',
      kind: 'women_rawdah_corridor',
      name_ar: 'ممر النساء المغلق (باب الملك فهد 21 ← خلف الروضة)',
      coordinates: [
        [b.centerLng, 24.470155],
        [b.centerLng, b.northLat],
        [b.centerLng, 24.4689],
        [b.centerLng, b.southLat],
      ],
    },
  ];
  return {
    type: 'FeatureCollection',
    features: corridors.map((c) => ({
      type: 'Feature',
      properties: { id: c.id, kind: c.kind, name_ar: c.name_ar },
      geometry: { type: 'LineString', coordinates: c.coordinates },
    })),
  };
}
