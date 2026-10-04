import type { LangCode } from '../data/types';

/**
 * Edit these values to brand and deploy the guide.
 * QR_URL: leave empty to encode the full URL of map.html on whatever host serves the site.
 * QR_IMAGE: path to a ready-made QR image (relative to the site root); when set it replaces the generated code.
 */
export const SITE = {
  QR_URL: '',
  QR_IMAGE: '',
  ORG_NAME: '[ORG_NAME]',
  DEFAULT_LANG: 'ar' as LangCode,
  SITE_URL: '',
  /**
   * Light base map. rules.json's CARTO URL now needs an API key, so OpenStreetMap's standard tiles are used.
   * For heavy traffic, follow https://operations.osmfoundation.org/policies/tiles/ or switch to a keyed provider.
   * Set to '' to use the URL from rules.json.
   */
  LIGHT_TILES: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  LIGHT_ATTRIBUTION: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
} as const;
