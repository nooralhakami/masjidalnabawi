import type { Poi } from '../data/types';

/**
 * The few page-wide events between the map wiring (map-main.tsx) and everything over it (App.tsx),
 * by name and payload. They stay DOM events on `document`, so the e2e tests can send and watch them,
 * but a misspelt name or a wrong payload is now a type error instead of a button that does nothing.
 */
export interface AppEvents {
  /** A tap on the map: the place under it, or null for empty map. */
  'map-tap': number | null;
  /** Open the landmark stories at this site (0: the first). */
  'stories-request': number;
  /** Open the Islamic library. */
  'library-request': undefined;
  /** Open a place's card and fly to it (the tests use it to choose a place). */
  'open-place': Poi;
}

export function emit<K extends keyof AppEvents>(name: K, detail: AppEvents[K]): void {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Listen to one of the events; returns the function that stops listening. */
export function listen<K extends keyof AppEvents>(name: K, fn: (detail: AppEvents[K]) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<AppEvents[K]>).detail);
  document.addEventListener(name, handler);
  return () => document.removeEventListener(name, handler);
}
