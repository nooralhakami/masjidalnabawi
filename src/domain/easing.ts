/**
 * A heavy thing moved by a motor (the courtyard canopies, the sliding domes): it starts gently,
 * runs, and slows into place. `u` in [0, 1] → [0, 1], with no speed or acceleration at either end.
 */
export function motorEase(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
