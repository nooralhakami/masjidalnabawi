import L from 'leaflet';

type NavigationState = 'locating' | 'updated' | 'low-accuracy' | 'signal-lost' | 'off-route' | 'error' | 'stopped';
export interface NavigationSnapshot { position: L.LatLng | null; accuracy: number; remainingMeters: number; remainingMinutes: number; state: NavigationState; heading: number | null; follow: boolean; }

const DEFAULT_SPEED = 1.35;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export class NavigationTracker {
  private watchId: number | null = null;
  private last: GeolocationPosition | null = null;
  private lastAccepted: L.LatLng | null = null;
  private speed = DEFAULT_SPEED;
  private segment = 0;
  private offRouteReads = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private userMarker?: L.Marker;
  private accuracyCircle?: L.Circle;
  private panel?: HTMLElement;
  private state: NavigationSnapshot = { position: null, accuracy: 0, remainingMeters: 0, remainingMinutes: 0, state: 'stopped', heading: null, follow: false };
  private listeners = new Set<(s: NavigationSnapshot) => void>();

  constructor(private map: L.Map, private getPath: () => L.LatLng[], private onReroute?: () => void) {
    map.on('dragstart', () => { if (this.state.follow) { this.state.follow = false; this.publish(); } });
    map.on('rotate', () => this.rotateMarker());
  }
  onChange(fn: (s: NavigationSnapshot) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get snapshot() { return this.state; }
  async start() {
    this.stop();
    if (!window.isSecureContext || !navigator.geolocation) return this.fail('error');
    this.state.follow = true; this.state.state = 'locating'; this.publish();
    try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
    this.watchId = navigator.geolocation.watchPosition((p) => this.onPosition(p), (e) => this.onError(e), { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }
  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null; this.last = null; this.lastAccepted = null; this.state.follow = false; this.state.state = 'stopped';
    this.userMarker?.remove(); this.accuracyCircle?.remove(); this.panel?.remove(); this.userMarker = undefined; this.accuracyCircle = undefined;
    void this.wakeLock?.release(); this.wakeLock = null; this.publish();
  }
  private fail(state: NavigationState) { this.state.state = state; this.publish(); }
  private onError(error: GeolocationPositionError) { this.fail(error.code === error.PERMISSION_DENIED ? 'error' : 'locating'); }
  private onPosition(pos: GeolocationPosition) {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude); const accuracy = pos.coords.accuracy;
    this.ensureLayers(ll, accuracy);
    if (accuracy > 50) { this.state.accuracy = accuracy; this.state.state = 'low-accuracy'; this.accuracyCircle?.setLatLng(ll).setRadius(accuracy); this.publish(); return; }
    if (this.last && this.lastAccepted) {
      const dt = Math.max(0.2, (pos.timestamp - this.last.timestamp) / 1000); const distance = this.lastAccepted.distanceTo(ll);
      if (distance / dt > 7 && ++this.offRouteReads < 3) return;
      this.offRouteReads = 0;
      const observed = distance / dt; if (observed > 0.2) this.speed = this.speed * 0.75 + clamp(observed, 0.8, 2) * 0.25;
    }
    this.last = pos; this.lastAccepted = ll; this.updateRoute(ll, accuracy, pos.coords.heading);
    if (this.state.follow) this.map.panTo(ll, { animate: true, duration: 0.25 });
  }
  private updateRoute(ll: L.LatLng, accuracy: number, gpsHeading: number | null) {
    const path = this.getPath(); if (path.length < 2) return;
    let best = Infinity, bestPoint = ll, bestIndex = this.segment;
    for (let i = this.segment; i < Math.min(path.length - 1, this.segment + 6); i++) {
      const a = path[i], b = path[i + 1]; const p = this.project(ll, a, b); const d = ll.distanceTo(p);
      if (d < best) { best = d; bestPoint = p; bestIndex = i; }
    }
    if (best > Math.max(25, accuracy * 1.5)) { this.offRouteReads++; } else this.offRouteReads = 0;
    if (this.offRouteReads >= 3) { this.state.state = 'off-route'; this.onReroute?.(); }
    this.segment = Math.max(this.segment, bestIndex);
    let remaining = bestPoint.distanceTo(path[this.segment + 1]);
    for (let i = this.segment + 1; i < path.length - 1; i++) remaining += path[i].distanceTo(path[i + 1]);
    const segmentBearing = this.bearing(path[this.segment], path[Math.min(this.segment + 1, path.length - 1)]);
    const heading = gpsHeading != null && this.speed > 0.5 ? gpsHeading : segmentBearing;
    this.state = { position: bestPoint, accuracy, remainingMeters: remaining, remainingMinutes: Math.max(1, Math.ceil(remaining / (this.speed * 60))), state: this.offRouteReads >= 3 ? 'off-route' : 'updated', heading, follow: this.state.follow };
    this.ensureLayers(bestPoint, accuracy); this.userMarker?.setLatLng(bestPoint); this.accuracyCircle?.setLatLng(bestPoint).setRadius(accuracy); this.rotateMarker(); this.publish();
  }
  private ensureLayers(ll: L.LatLng, accuracy: number) {
    if (!this.userMarker) { this.userMarker = L.marker(ll, { icon: L.divIcon({ className: 'navigation-marker', html: '<span></span><i></i>', iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, zIndexOffset: 1000 }).addTo(this.map); this.accuracyCircle = L.circle(ll, { className: 'navigation-accuracy', radius: accuracy, interactive: false }).addTo(this.map); }
  }
  private rotateMarker() { const el = this.userMarker?.getElement(); if (el && this.state.heading != null) el.style.setProperty('--heading', `${this.state.heading - (this.map.getBearing?.() ?? 0)}deg`); }
  private publish() { this.renderPanel(); this.listeners.forEach((fn) => fn(this.state)); }
  private renderPanel() { if (!this.panel && this.state.state !== 'stopped') { this.panel = document.createElement('div'); this.panel.className = 'navigation-status'; document.body.append(this.panel); } if (!this.panel) return; const s = this.state; const label = s.state === 'off-route' ? 'أنت خارج المسار' : s.state === 'low-accuracy' ? 'دقة منخفضة' : s.state === 'locating' ? 'جارٍ تحديد الموقع' : s.state === 'signal-lost' ? 'فقدان إشارة GPS' : 'الموقع محدث'; this.panel.innerHTML = `<strong>${label}</strong><span>${s.remainingMeters ? `${Math.round(s.remainingMeters)} م · ${s.remainingMinutes} دقيقة` : ''}</span><button type="button">${s.follow ? 'إيقاف المتابعة' : 'العودة إلى موقعي'}</button>`; this.panel.querySelector('button')?.addEventListener('click', () => { this.state.follow = !this.state.follow; if (this.state.follow && this.state.position) this.map.panTo(this.state.position, { animate: true }); this.publish(); }); }
  private project(p: L.LatLng, a: L.LatLng, b: L.LatLng) { const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat; const t = clamp(((p.lng - ax) * (bx - ax) + (p.lat - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1), 0, 1); return L.latLng(ay + (by - ay) * t, ax + (bx - ax) * t); }
  private bearing(a: L.LatLng, b: L.LatLng) { return (Math.atan2(Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180), Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180)) * 180 / Math.PI + 360) % 360; }
}
