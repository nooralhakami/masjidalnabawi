import { describe, expect, it } from 'vitest';
import { POI_BY_ID } from '../../src/data';
import { isEntranceOpen } from '../../src/routing/garage';
import { planExit, planRoute } from '../../src/routing/plan';
import { entranceOpen, toggleEntrance } from '../../src/state/entrances';

const P = (id: number) => POI_BY_ID.get(id)!;
const NORTH: [number, number] = [24.476, 39.611];

// The supervisor's button (AdminPanel → toggleEntrance) closes an entrance for the route planner too,
// not only on the map: no way in and no way out through it (owner, 2026-10-24).
describe('the supervisor closes a car park entrance', () => {
  it('all three planner entrances start open, as in car-entrances.ts', () => {
    for (const id of ['omar', 'sultana', 'qurban'] as const) {
      expect(entranceOpen.value[id], id).toBe(true);
      expect(isEntranceOpen(id), id).toBe(true);
    }
  });

  it('Sultana closed: the car goes in by another entrance and out by another exit', async () => {
    expect((await planRoute(NORTH, P(908), 'drive')).entrance).toBe('sultana');
    expect(planExit(P(908), 'B').map((x) => x.exit)).toContain('sultana');
    toggleEntrance('sultana');
    try {
      expect(isEntranceOpen('sultana')).toBe(false);
      const p = await planRoute(NORTH, P(908), 'drive');
      expect(['omar', 'qurban']).toContain(p.entrance);
      const out = planExit(P(908), 'B').map((x) => x.exit);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain('sultana');
    } finally {
      toggleEntrance('sultana');
    }
    expect(isEntranceOpen('sultana')).toBe(true);
    expect((await planRoute(NORTH, P(908), 'drive')).entrance).toBe('sultana');
  });

  it('Omar ibn al-Khattab street closed: the car goes in by another entrance and out by another exit', async () => {
    expect((await planRoute(NORTH, P(913), 'drive')).entrance).toBe('omar');
    expect(planExit(P(905), 'B').map((x) => x.exit)).toEqual(['omar']);
    toggleEntrance('omar');
    try {
      expect(isEntranceOpen('omar')).toBe(false);
      const p = await planRoute(NORTH, P(913), 'drive');
      expect(['sultana', 'qurban']).toContain(p.entrance);
      const out = planExit(P(905), 'B').map((x) => x.exit);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain('omar');
    } finally {
      toggleEntrance('omar');
    }
    expect(isEntranceOpen('omar')).toBe(true);
  });

  it('Qurban closed from the button as well (it was the only one wired before)', async () => {
    toggleEntrance('qurban');
    try {
      expect((await planRoute(NORTH, P(901), 'drive')).entrance).not.toBe('qurban');
      expect(planExit(P(901), 'B').map((x) => x.exit)).not.toContain('qurban');
    } finally {
      toggleEntrance('qurban');
    }
    expect(isEntranceOpen('qurban')).toBe(true);
  });
});
