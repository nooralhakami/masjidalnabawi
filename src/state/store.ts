import type { Spot } from '../routing/spot';
import { computed, effect, signal } from '@preact/signals';
import type { Poi } from '../data/types';
import type { NavigationSnapshot } from '../navigation/tracker';
import type { RouteSummary } from '../presentation/route-view';
import type { GarageStart } from '../routing/plan';
import type { FilterId, ParkingSub, ToiletSub } from '../domain/filters';
import type { Weather } from '../domain/weather';
import { load, save } from './persist';

/**
 * The state the UI and the map share (ARCHITECTURE §2): ui/ writes it, the app wiring passes it to
 * the map. Remembered choices use the live app's keys: travel, level, theme.
 */
export type Travel = 'walk' | 'drive';
export type Level = 'A' | 'B';
export type Detent = 'closed' | 'peek' | 'half' | 'full';

export const filter = signal<FilterId>('all');
export const toiletSub = signal<ToiletSub>('all');
export const parkingSub = signal<ParkingSub>('all');
export const markersHidden = signal(false);

/**
 * The weather in Madinah now (map-main fetches it every 30 minutes; null until a reading arrives, and
 * offline). A signal, so the chip shows a reading that arrives before or after it mounts.
 */
export const weather = signal<Weather | null>(null);

/** What is typed in the search box, and what the map and the results follow (after a short pause). */
export const typed = signal('');
export const query = signal('');
export const searching = computed(() => query.value.trim() !== '');

export const selected = signal<number | null>(null);
export const sheet = signal<Detent>('closed');

export const travel = signal<Travel>(load('travel') === 'drive' ? 'drive' : 'walk');
export const level = signal<Level>(load('level') === 'A' ? 'A' : 'B');
effect(() => save('travel', travel.value));
effect(() => save('level', level.value));

/** A short notice above the sheet. */
export const toast = signal<{ text: string; tone: 'info' | 'ok' | 'error'; id: number } | null>(null);
let toastTimer = 0;
let toastId = 0;
export function notify(text: string, tone: 'info' | 'ok' | 'error' = 'info', ms = tone === 'error' ? 6000 : 3000): void {
  toast.value = { text, tone, id: ++toastId };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), ms);
}

/** Recent searches, on this device only (SPEC N12): the last six, newest first. */
const RECENT_KEY = 'recent-searches';
const MAX_RECENT = 6;
function readRecent(): string[] {
  try {
    const v = JSON.parse(load(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
export const recent = signal<string[]>(readRecent());
export function remember(q: string): void {
  const t = q.trim();
  if (!t) return;
  recent.value = [t, ...recent.value.filter((r) => r !== t)].slice(0, MAX_RECENT);
  save(RECENT_KEY, JSON.stringify(recent.value));
}
export function forgetRecent(): void {
  recent.value = [];
  save(RECENT_KEY, null);
}

/** The route being followed (phase 5): its summary for the card, or null. */
export const route = signal<RouteSummary | null>(null);
/** Live navigation, as the tracker last published it. */
export const nav = signal<NavigationSnapshot | null>(null);
/** How tall the sheet is settling to, so the notices and the navigation bar sit just above it. */
export const sheetH = signal(0);

/**
 * Heading-up while navigating (owner, 2026-10-17): the map turns so the way ahead points up, and
 * follows the visitor. Optional, off by default, remembered on this device.
 */
export const headingUp = signal(load('heading-up') === '1');
export function setHeadingUp(on: boolean): void {
  headingUp.value = on;
  save('heading-up', on ? '1' : null);
}

/** «Where is your car?» (in or by the car park): the question on screen, answered through `answer`. */
export interface GarageQuestion {
  lots: Poi[];
  /** Where the visitor stands above the car park: the words of «I am not in the car park». */
  spot: Spot;
  answer(start: GarageStart | null): void;
}
export const garageQ = signal<GarageQuestion | null>(null);

/** Height of the Rawdah cards at the bottom (0 when hidden), so the map's buttons sit above them. */
export const rawdahH = signal(0);
