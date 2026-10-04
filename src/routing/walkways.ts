import type { LatLng } from '../data/types';

export type WalkwayKind = 'centerline' | 'connector' | 'exception';
export interface WalkwayEdge { id: string; kind: WalkwayKind; points: LatLng[]; }

export const WALKWAY_EDGES: WalkwayEdge[] = [
  { id: 'north-center', kind: 'centerline', points: [[24.47035,39.60935],[24.47035,39.6101],[24.47035,39.6110],[24.47035,39.6121],[24.47035,39.61285]] },
  { id: 'west-center', kind: 'centerline', points: [[24.47035,39.60935],[24.46945,39.60935],[24.46855,39.60935],[24.46755,39.60935],[24.46675,39.60935]] },
  { id: 'south-center', kind: 'centerline', points: [[24.46675,39.60935],[24.46675,39.6102],[24.46675,39.6111],[24.46675,39.6121],[24.46675,39.61285]] },
  { id: 'east-center', kind: 'centerline', points: [[24.46675,39.61285],[24.4676,39.61285],[24.46855,39.61285],[24.46945,39.61285],[24.47035,39.61285]] },
  { id: 'gate-358-361-inside', kind: 'exception', points: [[24.4680,39.61328],[24.46845,39.61328],[24.4689,39.61328]] },
  { id: 'north-east-connector', kind: 'connector', points: [[24.47035,39.61285],[24.4689,39.61328]] },
  { id: 'south-east-connector', kind: 'connector', points: [[24.46675,39.61285],[24.4680,39.61328]] },
];

export const walkwayNodes = (): LatLng[] => WALKWAY_EDGES.flatMap((edge) => [edge.points[0], edge.points.at(-1)!]);
