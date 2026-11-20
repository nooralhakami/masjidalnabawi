import { afterEach, describe, expect, it } from 'vitest';
import type { XY } from '../../src/domain/frames';
import { getGateDoorState, getMosqueDoors, resetMosqueDoors, toggleGateBay } from '../../src/domain/mosque-doors';
import { ENTRY_ZOOM_THRESHOLD, MOSQUE_ROOF_ALT_M, ROOF_CLAMP_ZOOM, guardMosqueCameraEntry, isInsideMosqueWall } from '../../src/domain/mosque-entry';

afterEach(() => resetMosqueDoors());

describe('strict doorway-only camera entry into the Mosque (owner, 2026-11-20)', () => {
  const doors = () => getMosqueDoors();

  it('allows flying/panning freely above roof altitude and blocks zooming straight down through the solid roof', () => {
    const plazaOutside: XY = [-275, -230];
    const roofCenter: XY = [-80, -230];
    expect(isInsideMosqueWall(plazaOutside)).toBe(false);
    expect(isInsideMosqueWall(roofCenter)).toBe(true);
    const flyOver = guardMosqueCameraEntry(
      { inside: false, center: plazaOutside, eyeX: -275, eyeY: 50, eyeZ: -215, zoom: 18.4 },
      { center: roofCenter, eyeX: -80, eyeY: 50, eyeZ: -215, zoom: 18.4 },
      doors(),
    );
    expect(flyOver.allowed).toBe(true);
    expect(flyOver.inside).toBe(false);

    const res = guardMosqueCameraEntry(
      { inside: false, center: roofCenter, eyeX: -80, eyeY: 28, eyeZ: -215, zoom: 18.6 },
      { center: roofCenter, eyeX: -80, eyeY: 9.5, eyeZ: -222, zoom: ENTRY_ZOOM_THRESHOLD + 0.4 },
      doors(),
    );
    expect(res.blocked).toBe(true);
    expect(res.inside).toBe(false);
    expect(res.reason).toBe('roof');
    expect(res.clampedZoom).toBeLessThanOrEqual(ROOF_CLAMP_ZOOM);
  });

  it('blocks crossing through solid exterior stone walls away from doorways', () => {
    // Solid masonry on the West wall midway between Gates 8 and 9
    const prev: XY = [-261.0, -182.0];
    const next: XY = [-254.0, -182.0];
    const res = guardMosqueCameraEntry(
      { inside: false, center: prev, eyeX: -268, eyeY: 3.5, eyeZ: -182, zoom: 20.4 },
      { center: next, eyeX: -260, eyeY: 2.5, eyeZ: -182, zoom: 20.6 },
      doors(),
    );
    expect(res.blocked).toBe(true);
    expect(res.inside).toBe(false);
    expect(res.reason).toBe('solid_wall');
    expect(isInsideMosqueWall(res.clampedCenter!)).toBe(false);
  });

  it('blocks entering through a closed doorway bay', () => {
    const g8 = getGateDoorState(8)!;
    const closedBay = g8.bays.find((b) => !b.open)!;
    expect(closedBay.open).toBe(false);
    const outside: XY = [closedBay.x + g8.outward[0] * 3.0, closedBay.y];
    const inside: XY = [closedBay.x - g8.outward[0] * 2.5, closedBay.y];

    const res = guardMosqueCameraEntry(
      { inside: false, center: outside, eyeX: outside[0] - 4, eyeY: 2.2, eyeZ: outside[1], zoom: 20.6 },
      { center: inside, eyeX: outside[0], eyeY: 2.2, eyeZ: inside[1], zoom: 20.8 },
      doors(),
    );
    expect(res.blocked).toBe(true);
    expect(res.inside).toBe(false);
    expect(res.reason).toBe('closed_door');
    expect(isInsideMosqueWall(res.clampedCenter!)).toBe(false);
  });

  it('allows gliding into the Mosque through an open doorway bay', () => {
    const g8 = getGateDoorState(8)!;
    const openBay = g8.bays.find((b) => b.open)!;
    expect(openBay.open).toBe(true);
    const outside: XY = [openBay.x + g8.outward[0] * 3.0, openBay.y];
    const inside: XY = [openBay.x - g8.outward[0] * 2.5, openBay.y];

    const res = guardMosqueCameraEntry(
      { inside: false, center: outside, eyeX: outside[0] - 4, eyeY: 2.2, eyeZ: outside[1], zoom: 20.6 },
      { center: inside, eyeX: outside[0], eyeY: 2.2, eyeZ: inside[1], zoom: 20.8 },
      doors(),
    );
    expect(res.blocked).toBe(false);
    expect(res.allowed).toBe(true);
    expect(res.inside).toBe(true);
    expect(res.enteredGateId).toBe(8);
    expect(res.enteredBayIndex).toBe(openBay.bayIndex);
  });

  it('blocks a half-swung leaf until it opens past DOOR_PASS_OPEN_MIN, and unlocks entry once open', () => {
    const g8 = getGateDoorState(8)!;
    const bay0 = g8.bays[0];
    expect(bay0.open).toBe(false);
    const outside: XY = [bay0.x + g8.outward[0] * 3.0, bay0.y];
    const inside: XY = [bay0.x - g8.outward[0] * 2.5, bay0.y];

    toggleGateBay(8, 0);
    // Mid-swing below threshold still blocks
    const mid = guardMosqueCameraEntry(
      { inside: false, center: outside, eyeX: outside[0] - 4, eyeY: 2.2, eyeZ: outside[1], zoom: 20.6 },
      { center: inside, eyeX: outside[0], eyeY: 2.2, eyeZ: inside[1], zoom: 20.8 },
      doors(),
      () => 0.15,
    );
    expect(mid.blocked).toBe(true);

    // Fully swung open allows entry
    const full = guardMosqueCameraEntry(
      { inside: false, center: outside, eyeX: outside[0] - 4, eyeY: 2.2, eyeZ: outside[1], zoom: 20.6 },
      { center: inside, eyeX: outside[0], eyeY: 2.2, eyeZ: inside[1], zoom: 20.8 },
      doors(),
      () => 1.0,
    );
    expect(full.allowed).toBe(true);
    expect(full.inside).toBe(true);
  });

  it('allows free exploration once inside and exits cleanly when zooming back above the roof', () => {
    const explore = guardMosqueCameraEntry(
      { inside: true, center: [-180, -200], eyeX: -186, eyeY: 3.0, eyeZ: -200, zoom: 20.5 },
      { center: [-100, -210], eyeX: -106, eyeY: 3.0, eyeZ: -210, zoom: 20.4 },
      doors(),
    );
    expect(explore.allowed).toBe(true);
    expect(explore.inside).toBe(true);

    const exit = guardMosqueCameraEntry(
      { inside: true, center: [-100, -210], eyeX: -110, eyeY: 4.0, eyeZ: -210, zoom: 20.0 },
      { center: [-100, -210], eyeX: -115, eyeY: MOSQUE_ROOF_ALT_M + 10, eyeZ: -210, zoom: 18.2 },
      doors(),
    );
    expect(exit.allowed).toBe(true);
    expect(exit.inside).toBe(false);
  });
});
