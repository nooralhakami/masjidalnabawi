import L from 'leaflet';
import type { LatLng } from '../data/types';
import { haversine } from '../domain/geo';
import { num, t } from '../i18n';
import { toast } from '../ui/toast';

const MOSQUE: LatLng = [24.4672, 39.6111];
const MAX_KM = 3;
/** A fix older than this is refreshed before drawing a route. */
const FRESH_MS = 60_000;

/**
 * Visitor location. Asked for only when the visitor taps "My location" or "Draw route".
 * Farther than 3 km from the mosque: the map stays put and a gentle note explains why.
 */
export class Locator {
  private marker: L.Marker | null = null;
  private circle: L.Circle | null = null;
  private last: LatLng | null = null;
  private at = 0;

  constructor(private map: L.Map) {}

  /** Last fix if it's recent, else null. */
  get position(): LatLng | null {
    return this.last && Date.now() - this.at < FRESH_MS ? this.last : null;
  }

  private forget() {
    this.last = null;
    this.marker?.remove();
    this.circle?.remove();
    this.marker = this.circle = null;
  }

  locate(): Promise<LatLng | null> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        toast(t('geo_unsup'));
        return resolve(null);
      }
      toast(t('locating'), 2500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const ll: LatLng = [pos.coords.latitude, pos.coords.longitude];
          const km = haversine(ll, MOSQUE) / 1000;
          if (km > MAX_KM) {
            this.forget();
            toast(t('geo_far', { k: km < 10 ? km.toFixed(1) : num(km) }), 6000);
            return resolve(null);
          }
          this.show(ll, pos.coords.accuracy);
          resolve(ll);
        },
        () => {
          this.forget();
          toast(t('geo_deny'), 6000);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
      );
    });
  }

  private show(ll: LatLng, accuracy: number) {
    this.last = ll;
    this.at = Date.now();
    this.marker?.remove();
    this.circle?.remove();
    this.circle = L.circle(ll, {
      radius: Math.min(accuracy || 0, 150),
      className: 'me-accuracy',
      interactive: false,
      weight: 1,
    }).addTo(this.map);
    this.marker = L.marker(ll, {
      icon: L.divIcon({ className: 'me', html: '<span class="me-pulse"></span><span class="me-dot"></span>', iconSize: [22, 22] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 2000,
      title: t('you'),
    }).addTo(this.map);
  }
}
