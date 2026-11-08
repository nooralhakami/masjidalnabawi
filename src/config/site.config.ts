import type { LangCode } from '../data/types';

/**
 * Edit these values to brand and deploy the guide.
 * QR_URL: leave empty to encode the full URL of map.html on whatever host serves the site.
 * QR_IMAGE: path to a ready-made QR image (relative to the site root); when set it replaces the generated code.
 */
export const SITE = {
  // The QR code is generated from this address so the displayed, copied and downloaded codes stay in sync.
  // It opens the site's home page, as the printed codes do (owner, 2026-11-08: «الباركود يفتح الصفحة
  // الرئيسية وليس الخريطة»); the big «open the map» button is at the top there.
  QR_URL: 'https://masjidalnabawi.vercel.app/',
  QR_IMAGE: '',
  // The organisation's name under the title in the landing footer; empty hides the line (owner, 2026-10-16).
  ORG_NAME: '',
  DEFAULT_LANG: 'ar' as LangCode,
  SITE_URL: 'https://masjidalnabawi.vercel.app/',
  /**
   * Light base map. rules.json's CARTO URL now needs an API key, so OpenStreetMap's standard tiles are used.
   * For heavy traffic, follow https://operations.osmfoundation.org/policies/tiles/ or switch to a keyed provider.
   * Set to '' to use the URL from rules.json.
   */
  LIGHT_TILES: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  LIGHT_ATTRIBUTION: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
} as const;
