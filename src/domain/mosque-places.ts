import companionsIndex from '../../data/library/companions.json';
import mosqueJson from '../../data/library/mosque.json';
import { shownCompanions, shownMosquePlaces, type CompanionData, type MosqueData, type ShownCompanion, type ShownPlace } from './library';

/** The library's data (data/library/*.json), loaded only when the section opens. */
export const MOSQUE_DATA = mosqueJson as unknown as MosqueData;
/**
 * One file per companion (data/library/companions/<id>.json, 2026-10-24), listed in the order of
 * companions.json's `order`: adding or fixing a card touches only its own small file.
 */
const CARDS = import.meta.glob('../../data/library/companions/*.json', { eager: true, import: 'default' });
const { order, ...index } = companionsIndex as { order: string[] } & Record<string, unknown>;
export const COMPANION_DATA = { ...index, companions: order.map((id) => CARDS[`../../data/library/companions/${id}.json`]) } as unknown as CompanionData;
/** What the visitor may see (rules in domain/library.ts). */
export const MOSQUE_PLACES: ShownPlace[] = shownMosquePlaces(MOSQUE_DATA);
export const COMPANIONS: ShownCompanion[] = shownCompanions(COMPANION_DATA);
