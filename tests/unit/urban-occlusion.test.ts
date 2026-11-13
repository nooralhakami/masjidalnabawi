import { describe, expect, it } from 'vitest';
import { blocksView, occludedIds, type UrbanBuilding } from '../../src/map/urban-occlusion';

// The camera south of the Haram, high up, looking at the Mosque's roofline to the north.
const eye: [number, number, number] = [0, 100, 200];
const target: [number, number, number] = [0, 20, 0];
// A tower straddling the sight line halfway (z 90…110), ten metres each way east.
const tower = (
  height: number,
  ring: [number, number][] = [
    [-10, 90],
    [10, 90],
    [10, 110],
    [-10, 110],
  ],
): UrbanBuilding => ({ id: 'T1', height, ring });

describe('urban occlusion fade geometry (owner, 2026-11-10)', () => {
  it('fades a tower tall enough to stand in the sight line', () => {
    expect(blocksView(tower(60), eye, target)).toBe(true);
  });

  it('leaves a tower the sight line passes above', () => {
    expect(blocksView(tower(50), eye, target)).toBe(false);
  });

  it('leaves a tower beyond the target and one off to the side', () => {
    const beyond = tower(60, [
      [-10, -110],
      [10, -110],
      [10, -90],
      [-10, -90],
    ]);
    const side = tower(60, [
      [100, 90],
      [120, 90],
      [120, 110],
      [100, 110],
    ]);
    expect(blocksView(beyond, eye, target)).toBe(false);
    expect(blocksView(side, eye, target)).toBe(false);
  });

  it('leaves a flat building (no height) out of the fade', () => {
    expect(blocksView(tower(0), eye, target)).toBe(false);
  });

  it('collects only the blocking buildings, and none when the coast is clear', () => {
    const blocker = tower(60);
    const clear = {
      id: 'T2',
      height: 60,
      ring: [
        [100, 90],
        [120, 90],
        [120, 110],
        [100, 110],
      ] as [number, number][],
    };
    expect([...occludedIds([blocker, clear], eye, [target])]).toEqual(['T1']);
    expect(occludedIds([clear], eye, [target]).size).toBe(0);
    expect(occludedIds([], eye, [target]).size).toBe(0);
  });

  it('fades a tower that blocks any one of several targets', () => {
    const sideTarget: [number, number, number] = [110, 20, 100];
    const side = tower(60, [
      [100, 90],
      [120, 90],
      [120, 110],
      [100, 110],
    ]);
    expect(blocksView(side, eye, target)).toBe(false);
    expect([...occludedIds([side], eye, [target, sideTarget])]).toEqual(['T1']);
  });
});
