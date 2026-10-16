// Extracts everything the film's phone map draws, from the app itself: the places (POIs), the women's
// prayer areas, the walking route to 227 and the drive to 226 through car park 9, level A (the app's own
// router, the same code the site runs). Writes video/courtyard/geo.json.
// Run from the app checkout: cp <this> tests/unit/zz-geo.test.ts && GEO_OUT=<path>/geo.json npx vitest run tests/unit/zz-geo.test.ts
import { test } from 'vitest';
import fs from 'node:fs';
import { POIS, POI_BY_ID, ROUTING } from '../../src/data';
import { planRoute, planRoutes } from '../../src/routing/plan';
import { garageExit } from '../../src/routing/garage';
import { pathLength } from '../../src/routing/walk';

const KIND: Record<string, string> = {
  toilet_men: 'men', toilet_women: 'women', women_service: 'women', toilet_mixed: 'acc', toilet_elderly: 'acc',
  hotel: 'hotel', food: 'food', landmark: 'land', historic: 'land', lost_found: 'emg', health: 'emg', service: 'emg', lost_children: 'emg', child_care: 'emg',
};
const r7 = (ll: number[]) => [+ll[0].toFixed(7), +ll[1].toFixed(7)];

test('film geo', async () => {
  // walking: from inside the mosque (north-east) to the men's restrooms 227
  const WALK_FROM: [number, number] = [24.469, 39.6125];
  const walk = await planRoute(WALK_FROM, POI_BY_ID.get(227)!, 'walk');
  const walkPath = walk.legs.flatMap((l) => l.path);
  // driving to 226 on level A: the app picks car park 9 through the Sultana entrance
  const [drive] = await planRoutes([24.4745, 39.602], POI_BY_ID.get(226)!, 'drive', { level: 'A' });
  const garage = drive.legs.find((l) => l.kind === 'garage')!;
  const exit = garageExit(drive.lot!, 'sultana', 'A')!;
  const geo = {
    pois: POIS.filter((p) => KIND[p.subCategory]).map((p) => [...r7([p.lat, p.lng]), KIND[p.subCategory]]),
    women: (ROUTING.women_prayer_areas ?? []).map((a) => a.polygon.map(r7)),
    p227: r7([POI_BY_ID.get(227)!.lat, POI_BY_ID.get(227)!.lng]),
    p226: r7([POI_BY_ID.get(226)!.lat, POI_BY_ID.get(226)!.lng]),
    p37: r7([POI_BY_ID.get(37)!.lat, POI_BY_ID.get(37)!.lng]),
    walk: { path: walkPath.map(r7), m: Math.round(pathLength(walkPath)), minutes: walk.minutes },
    drive: { lot: drive.lot!.id, level: drive.level, entrance: drive.entrance, minutes: drive.minutes, walkM: Math.round(drive.walkM),
      parts: garage.parts!.map((p) => ({ on: p.on, path: p.path.map(r7) })), ramp: r7(drive.ramps![0].at), gate: r7(drive.gate!) },
    exit: { parts: exit.parts.map((p) => ({ on: p.on, path: p.path.map(r7) })) },
  };
  fs.writeFileSync(process.env.GEO_OUT!, JSON.stringify(geo));
  console.log('pois', geo.pois.length, 'walk', geo.walk.m, 'm', geo.walk.minutes, 'min', 'drive lot', geo.drive.lot, geo.drive.level, geo.drive.parts.map((p) => p.on).join('>'), 'exit', geo.exit.parts.map((p) => p.on).join('>'));
}, 120000);
