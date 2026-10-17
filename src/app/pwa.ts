import { registerSW } from 'virtual:pwa-register';

/**
 * Register the service worker (production builds only; the live app's src/pwa.ts). The app shell is
 * precached, so the interface stays available even on a weak connection; an update reaches the
 * visitor on their next visit. Map tiles and story photos are never cached (vite.config.ts).
 */
export function initPwa(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
