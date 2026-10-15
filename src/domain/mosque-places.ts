import companionsJson from '../../data/library/companions.json';
import mosqueJson from '../../data/library/mosque.json';
import { shownCompanions, shownMosquePlaces, type CompanionData, type MosqueData, type ShownCompanion, type ShownPlace } from './library';

/** The library's data (data/library/*.json), loaded only when the section opens. */
export const MOSQUE_DATA = mosqueJson as unknown as MosqueData;
export const COMPANION_DATA = companionsJson as unknown as CompanionData;
/** What the visitor may see (rules in domain/library.ts). */
export const MOSQUE_PLACES: ShownPlace[] = shownMosquePlaces(MOSQUE_DATA);
export const COMPANIONS: ShownCompanion[] = shownCompanions(COMPANION_DATA);
