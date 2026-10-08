/**
 * Snapshot of the walking network: the walkways (ring + branches), what joins where, and the route
 * from each plaza side to every facility. Run from the project root: npx vite-node scripts/routes-report.ts
 * Writes docs/routes/baseline.json and docs/routes/network.svg (render network.png from it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { POIS, ROUTING } from '../src/data';
import type { LatLng } from '../src/data/types';
import { network, pathLength, toM, walkMinutes, walkPath, type XY } from '../src/routing/walk';

const N = network();
const len = (pts: XY[]) => pts.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

// Four starting points, one on each plaza side.
const STARTS: Record<string, LatLng> = {
  south: [24.4659, 39.6111],
  west: [24.4686, 39.608],
  north: [24.471, 39.6111],
  east: [24.4688, 39.614],
};
const routes = Object.entries(STARTS).flatMap(([from, a]) =>
  POIS.filter((p) => p.id >= 201 && p.id <= 236).map((p) => {
    const path = walkPath(a, [p.lat, p.lng]);
    const m = pathLength(path);
    // Which branches the route uses: any path point within 3 m of a branch.
    const used = ROUTING.walkways
      .filter((w) => {
        const pts = w.path.map(toM);
        return path.some((ll) => {
          const q = toM(ll);
          return pts.slice(1).some((b, i) => {
            const a2 = pts[i];
            const dx = b[0] - a2[0];
            const dy = b[1] - a2[1];
            const u = Math.max(0, Math.min(1, ((q[0] - a2[0]) * dx + (q[1] - a2[1]) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(q[0] - a2[0] - dx * u, q[1] - a2[1] - dy * u) < 3;
          });
        });
      })
      .map((w) => w.id);
    return { from, to: p.id, meters: Math.round(m), minutes: walkMinutes(m), walkways: used };
  }),
);

mkdirSync('docs/routes', { recursive: true });
writeFileSync(
  'docs/routes/baseline.json',
  JSON.stringify(
    {
      ringM: Math.round(N.P),
      walkways: ROUTING.walkways.map((w) => ({ id: w.id, kind: w.kind, lengthM: Math.round(len(w.path.map(toM))) })),
      graph: { nodes: N.nodes.length, edges: N.edges.length },
      routes,
    },
    null,
    1,
  ) + '\n',
);
console.log(`ring ${Math.round(N.P)} m · ${ROUTING.walkways.length} branches · graph ${N.nodes.length} nodes / ${N.edges.length} edges`);
for (const [from] of Object.entries(STARTS)) {
  const r = routes.filter((x) => x.from === from).sort((a, b) => a.meters - b.meters);
  const avg = Math.round(r.reduce((m, x) => m + x.meters, 0) / r.length);
  console.log(`${from}: nearest ${r[0].to} ${r[0].meters} m · farthest ${r[r.length - 1].to} ${r[r.length - 1].meters} m · average ${avg} m`);
}

// ---------- diagram: docs/routes/network.svg (north up, metres) ----------
const facilities = POIS.filter((p) => (p.id >= 201 && p.id <= 236) || p.category === 'parking').map((p) => ({ p, m: toM([p.lat, p.lng]) }));
const pts = [...N.ring, ...facilities.map((a) => a.m)];
const pad = 40;
const x0 = Math.min(...pts.map((q) => q[0])) - pad;
const x1 = Math.max(...pts.map((q) => q[0])) + pad;
const y0 = Math.min(...pts.map((q) => q[1])) - pad;
const y1 = Math.max(...pts.map((q) => q[1])) + pad;
const S = 1.6; // px per metre
const X = (x: number) => ((x - x0) * S).toFixed(1);
const Y = (y: number) => ((y1 - y) * S).toFixed(1);
const line = (p: XY[]) => p.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ');
const rect = (r: { x0: number; x1: number; y0: number; y1: number }, fill: string, label: string) =>
  `<rect x="${X(r.x0)}" y="${Y(r.y1)}" width="${((r.x1 - r.x0) * S).toFixed(1)}" height="${((r.y1 - r.y0) * S).toFixed(1)}" fill="${fill}" opacity=".18"/>` +
  (label ? `<text x="${X((r.x0 + r.x1) / 2)}" y="${Y((r.y0 + r.y1) / 2)}" class="o">${label}</text>` : '');
const KIND: Record<string, string> = { spur: '#1e2a26', link: '#d33a2c', walk: '#21a6c4', women: '#ec4f9a' };
const COLORS: Record<string, string> = { toilet_men: '#1f64a8', toilet_women: '#83409b', toilet_mixed: '#0e8478', toilet_elderly: '#c9a15b' };
const W = ((x1 - x0) * S).toFixed(0);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${((y1 - y0) * S).toFixed(0)}" font-family="sans-serif" direction="rtl">
<style>text{font-size:11px;text-anchor:middle;dominant-baseline:middle}.o{font-size:16px;font-weight:700;fill:#555}</style>
<rect width="100%" height="100%" fill="#f4f1ea"/>
${N.obstacles.map((r, i) => rect(r, i === 0 ? '#0e4d3a' : '#6a4e39', i === 0 ? 'المسجد (ممنوع العبور)' : i === 1 ? 'البقيع' : '')).join('')}
${ROUTING.women_prayer_areas.map((a) => `<polygon points="${line(a.polygon.map(toM))}" fill="#ec4f9a" fill-opacity=".25" stroke="#ec4f9a" stroke-dasharray="6 4"/>`).join('')}
<polyline points="${line([...N.ring, N.ring[0]])}" fill="none" stroke="#e0a800" stroke-width="5"/>
${ROUTING.walkways.map((w) => `<polyline points="${line(w.path.map(toM))}" fill="none" stroke="${KIND[w.kind]}" stroke-width="4" stroke-linecap="round"/>`).join('\n')}
${N.nodes.map((n) => `<circle cx="${X(n[0])}" cy="${Y(n[1])}" r="2.5" fill="#fff" stroke="#000" stroke-width=".8"/>`).join('')}
${facilities
  .map(({ p, m }) => {
    const park = p.category === 'parking';
    const c = park ? (p.access === 'subscribers' ? '#9f1239' : '#1f64a8') : (COLORS[p.subCategory] ?? '#333');
    return park
      ? `<rect x="${(+X(m[0]) - 11).toFixed(1)}" y="${(+Y(m[1]) - 8).toFixed(1)}" width="22" height="16" rx="4" fill="${c}" opacity=".85"/><text x="${X(m[0])}" y="${Y(m[1])}" fill="#fff">P${p.id - 900}</text>`
      : `<circle cx="${X(m[0])}" cy="${Y(m[1])}" r="11" fill="${c}" opacity=".85"/><text x="${X(m[0])}" y="${Y(m[1])}" fill="#fff">${p.id}</text>`;
  })
  .join('\n')}
<text x="${+W - 20}" y="20" style="text-anchor:start;font-size:13px;font-weight:700">↑ شمال · أصفر = الحلقة الرئيسية · أسود = فرع إلى جدار المسجد · أحمر = وصلة عرضية · أزرق = ممشى · وردي = مصليات النساء وممراتها</text>
</svg>
`;
writeFileSync('docs/routes/network.svg', svg);
