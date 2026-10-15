import mosqueJson from '../../data/library/mosque.json';
import { shownMosquePlaces, type MosqueData, type ShownPlace } from './library';

/** The library's mosque places (data/library/mosque.json), loaded only when the section opens. */
export const MOSQUE_DATA = mosqueJson as unknown as MosqueData;
/** What the visitor may see: shownMosquePlaces() rules. */
export const MOSQUE_PLACES: ShownPlace[] = shownMosquePlaces(MOSQUE_DATA);
