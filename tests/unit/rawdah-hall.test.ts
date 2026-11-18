import { describe, expect, it } from 'vitest';
import { modelToWalkMetres, type XY } from '../../src/domain/frames';
import { GATE_38_ORGANISERS, GATE_38_STEP, QUEUE_LANES, QUEUE_OUT_Z, RAWDAH_APPROACH, RAWDAH_HALL, RAWDAH_STRIP } from '../../src/domain/rawdah-layout';
import { inside } from '../../src/domain/rug-layout';
import { safetyWorld, segmentHitsBarrier } from '../../src/domain/route-safety';

/** navQ's gates (GetPoIPolygons, in the models' metres): where the owner drew his arrows. */
const NAVQ_GATE_37: XY = [59.3, -115.8];
const NAVQ_GATE_38: XY = [-7.8, -115.6];
const NAVQ_GATE_39: XY = [-23.5, -112.7];
/** The bay «مصلى الرجال A17» (navQ 178), the hall's carpet. */
const A17_CENTRE: XY = [(-4.6 + 52.2) / 2, (-161.8 + -119.2) / 2];

const w = safetyWorld();
const blocked = (a: XY, b: XY) => segmentHitsBarrier(modelToWalkMetres(a), modelToWalkMetres(b), w);

describe('the closed hall where those for the Rawdah wait (owner, 2026-11-18)', () => {
  it('holds the bay A17 and Gate 38 and leads to Gate 39; Gate 37 stays outside it', () => {
    expect(inside(A17_CENTRE, RAWDAH_HALL)).toBe(true);
    // Gate 38 in the Mosque's face (z −121.4 in the 3D model; navQ draws it at x −7.8, the marker at 7.7).
    for (const x of [NAVQ_GATE_38[0], 7.7]) expect(inside([x, -123], RAWDAH_HALL)).toBe(true);
    expect(inside(NAVQ_GATE_39, RAWDAH_HALL)).toBe(true);
    expect(inside(NAVQ_GATE_37, RAWDAH_HALL)).toBe(false);
  });

  it('cannot be walked into from the rest of the Mosque: north, east (Gate 37) or west', () => {
    expect(blocked([20, -185], A17_CENTRE)).toBe(true);
    expect(blocked([62, -140], A17_CENTRE)).toBe(true);
    expect(blocked(NAVQ_GATE_37, A17_CENTRE)).toBe(true);
    expect(blocked([-60, -150], A17_CENTRE)).toBe(true);
    expect(blocked([-60, -116], NAVQ_GATE_39)).toBe(true);
    // Inside it, from Gate 38 across the hall to the way to Gate 39, nothing stands in the way.
    expect(blocked([7.7, -123], [-15, -116])).toBe(false);
    expect(blocked([7.7, -123], A17_CENTRE)).toBe(false);
  });
});

describe('outside, from the queue’s head to Gate 38 (owner, 2026-11-18)', () => {
  it('leads every lane’s head to the step before Gate 38, where the organisers stand', () => {
    expect(inside(GATE_38_STEP, RAWDAH_APPROACH)).toBe(true);
    for (const p of GATE_38_ORGANISERS) expect(inside(p, RAWDAH_APPROACH)).toBe(true);
    for (const [west, east] of QUEUE_LANES) {
      const head: XY = [(west + east) / 2, QUEUE_OUT_Z];
      expect(inside(head, RAWDAH_APPROACH)).toBe(true);
      expect(blocked(head, GATE_38_STEP)).toBe(false);
    }
  });

  it('sends no one let through toward Gate 37, and lets no one reach Gate 38 without queuing', () => {
    const outsideGate37: XY = [60, -102];
    expect(blocked([30, -100], outsideGate37)).toBe(true);
    // Along the Mosque's face, too: the barrier reaches the wall.
    expect(blocked([30, -119], [60, -119])).toBe(true);
    expect(blocked(outsideGate37, GATE_38_STEP)).toBe(true);
    // Up the strip between the greeting's way out and the queue's west rail: closed at both ends.
    expect(blocked([14, 12], [14, -40])).toBe(true);
    expect(blocked([14, -40], GATE_38_STEP)).toBe(true);
    expect(inside([14, -40], RAWDAH_STRIP)).toBe(true);
  });
});
