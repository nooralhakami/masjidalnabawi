/**
 * A light tap felt in the hand (UI plan phase 4, owner 2026-11-07: «yes» on Android). Phones without
 * the Vibration API (iPhone) simply feel nothing. Used on the main actions only: a place opened from
 * the map, «near you now», and starting a route — not on every button.
 */
export function tapHaptic(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* optional */
  }
}
