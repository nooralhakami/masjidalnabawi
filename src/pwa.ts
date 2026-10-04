import { registerSW } from 'virtual:pwa-register';

/** Register the service worker (production builds only); updates apply on the next load. */
export function initPwa(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
