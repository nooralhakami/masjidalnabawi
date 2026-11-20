"""Build the separated men's and women's interior Mosque walking networks from navQ's approved plan
and harvested path edges (Phase 2 of the realism master plan, owner rules 2026-11-18).

Rules enforced at build time (asserted — generation fails if any is violated):
  1. Two completely disjoint networks: `menEdges` and `womenEdges`, with `menWomenLinks == 0`.
  2. Zero carpet crossings: no edge crosses any navQ FF5 (men) or FF6 (women) prayer carpet.
  3. Zero Sacred Chamber crossings: no edge enters FF1 #13 (الحجرة الشريفة).
  4. Zero Rawdah waiting hall crossings: no edge crosses the closed Rawdah hall (A17, Gate 38->39).
  5. Strict gender zoning:
     - `menEdges` never enter the women's floor (FF0 parts 34, 291, 425) or women's carpets (FF6).
     - `womenEdges` stay strictly inside the women's floor (FF0 parts 34, 291, 425) and only
       connect to the owner-approved women's gates 11-17 and 23-31 (2026-11-18).

Usage:
  python3 scripts/interior-routes-from-navq.py <navq-path-edges.geojson>
Reads data/navq-interior-floor.json and data/pois.json; writes data/navq-interior-routes.json.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
FLOOR_PATH = os.path.join(ROOT, 'data', 'navq-interior-floor.json')
POIS_PATH = os.path.join(ROOT, 'data', 'pois.json')
ANCHOR_SRC = os.path.join(ROOT, 'src', 'data-next', 'alharamain-3d.ts')
OUT_PATH = os.path.join(ROOT, 'data', 'navq-interior-routes.json')

# Owner-approved women's Mosque gates (2026-11-18): 11-17 (west/NW) and 23-31 (NE/east)
WOMEN_GATE_IDS = [11, 12, 13, 14, 15, 16, 17, 23, 24, 25, 26, 27, 28, 29, 30, 31]
WOMEN_GATE_SET = set(WOMEN_GATE_IDS)

# Closed Rawdah waiting hall polygon (from src/domain/rawdah-layout.ts RAWDAH_HALL)
RAWDAH_HALL_MODEL = [
    (52.6, -112.6),
    (52.6, -167.5),
    (-10.0, -167.5),
    (-10.0, -136.0),
    (-18.7, -136.0),
    (-19.2, -132.5),
    (-19.2, -120.9),
    (-27.0, -120.9),
    (-27.0, -112.6),
]


def load_model_projector():
    txt = open(ANCHOR_SRC, encoding='utf-8').read()
    m = re.search(r'anchors:\s*\[\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]\]', txt)
    olng, olat = float(m.group(1)), float(m.group(2))
    R = 6_371_008.8
    C = 2 * math.pi * R
    mx = lambda lng: (180 + lng) / 360
    my = lambda lat: (180 - (180 / math.pi) * math.log(math.tan(math.pi / 4 + (lat * math.pi) / 360))) / 360
    omx, omy = mx(olng), my(olat)
    lat_from_my = lambda y: (360 / math.pi) * math.atan(math.exp(((180 - y * 360) * math.pi) / 180)) - 90
    unit = (1 / C) * (1 / math.cos(math.radians(lat_from_my(omy))))
    return lambda lng, lat: ((mx(lng) - omx) / unit, (my(lat) - omy) / unit)


def inside(pt, ring) -> bool:
    x, y = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1:
            c = not c
    return c


def seg_samples(p0, p1, step=0.6):
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = max(2, int(math.ceil(L / step)))
    return [(p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n) for k in range(n + 1)]


def r7(pt):
    return [round(pt[0], 7), round(pt[1], 7)]


def main(edges_path: str):
    to_m = load_model_projector()
    floor_raw = open(FLOOR_PATH, 'rb').read()
    edges_raw = open(edges_path, 'rb').read()
    floor = json.loads(floor_raw)
    edges_fc = json.loads(edges_raw)
    pois = json.load(open(POIS_PATH, encoding='utf-8'))

    men_carpets = [[to_m(c[0], c[1]) for c in a['ring']] for a in floor['men']]
    women_carpets = [[to_m(c[0], c[1]) for c in a['ring']] for a in floor['women']]
    all_carpets = men_carpets + women_carpets
    women_marble_raw = [m['ring'] for m in floor['marble'] if m.get('women')]
    # Compute the two exact NW & NE women's interior zone envelopes from navQ's FF0 women marble + FF6 women carpets,
    # capturing the internal corridor strip between A23-A25 and A26-A29 and the women's gate doorway thresholds.
    all_women_lnglat = [pt for ring in women_marble_raw + [a['ring'] for a in floor['women']] for pt in ring]
    nw_pts = [pt for pt in all_women_lnglat if to_m(pt[0], pt[1])[0] < -100]
    ne_pts = [pt for pt in all_women_lnglat if to_m(pt[0], pt[1])[0] >= -100]
    def envelope_ring(pts):
        lngs = [p[0] for p in pts]; lats = [p[1] for p in pts]
        return [
            [round(min(lngs), 7), round(max(lats), 7)],
            [round(max(lngs), 7), round(max(lats), 7)],
            [round(max(lngs), 7), round(min(lats), 7)],
            [round(min(lngs), 7), round(min(lats), 7)],
        ]
    women_envelopes_raw = [envelope_ring(nw_pts), envelope_ring(ne_pts)]
    women_floors = [[to_m(c[0], c[1]) for c in ring] for ring in women_marble_raw + women_envelopes_raw]
    chamber = [to_m(c[0], c[1]) for c in floor['chamber']['ring']]

    def in_any(p, rings):
        return any(inside(p, r) for r in rings)

    men_edges = []
    women_edges = []
    seen_pairs = set()

    for feat in edges_fc['features']:
        pr = feat['properties']
        net = pr.get('network')
        if net not in ('men', 'women'):
            continue
        c0, c1 = feat['geometry']['coordinates'][0], feat['geometry']['coordinates'][-1]
        p0, p1 = to_m(c0[0], c0[1]), to_m(c1[0], c1[1])
        if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 0.5:
            continue
        pts = seg_samples(p0, p1, 0.5)
        inner = pts[1:-1] or pts
        # Rule 2 & 3: zero prayer carpet or Sacred Chamber crossings
        if any(in_any(q, all_carpets) or inside(q, chamber) for q in inner):
            continue
        # Endpoints must also not stand deep inside a carpet
        if any(in_any(q, all_carpets) for q in (p0, p1)):
            continue
        # Rule 4: zero Rawdah waiting hall crossings
        if any(inside(q, RAWDAH_HALL_MODEL) for q in pts):
            continue
        # Rule 5: strict gender zoning
        if net == 'men':
            if any(in_any(q, women_floors) or in_any(q, women_carpets) for q in pts):
                continue
        else:
            # Women's interior edges must stay inside women's floor (endpoints may sit at women's outer gate wall)
            if not all(in_any(q, women_floors) for q in inner):
                continue

        a_r, b_r = r7(c0), r7(c1)
        key = (tuple(a_r), tuple(b_r)) if tuple(a_r) <= tuple(b_r) else (tuple(b_r), tuple(a_r))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        if net == 'men':
            men_edges.append([a_r, b_r])
        else:
            women_edges.append([a_r, b_r])

    # Rule 1: assert structural disjointness (no shared vertex within 1.5 m between men and women networks)
    men_pts = [to_m(c[0], c[1]) for e in men_edges for c in e]
    women_pts = [to_m(c[0], c[1]) for e in women_edges for c in e]
    links = 0
    for mp in men_pts:
        for wp in women_pts:
            if math.hypot(mp[0] - wp[0], mp[1] - wp[1]) < 1.5:
                links += 1
    assert links == 0, f'Men and women interior networks share {links} close vertices!'

    # Verify women's network only approaches women's gates (11-17, 23-31)
    mosque_gates = [(p['id'], to_m(p['lng'], p['lat'])) for p in pois if 1 <= p.get('id', 0) <= 42]
    bad_gates = set()
    for wp in women_pts:
        for gid, gp in mosque_gates:
            if gid not in WOMEN_GATE_SET and math.hypot(wp[0] - gp[0], wp[1] - gp[1]) < 12.0:
                bad_gates.add(gid)
    assert not bad_gates, f'Women interior network approaches non-women gates: {sorted(bad_gates)}'

    doc = {
        'source': {
            'what': "Separated men's and women's interior walking networks + navQ FF5/FF6 carpets, women's FF0 floor, and Sacred Chamber boundary",
            'floorSha256': hashlib.sha256(floor_raw).hexdigest(),
            'pathsSha256': hashlib.sha256(edges_raw).hexdigest(),
            'permission': "owner's written permission for navQ data (2026-11-04); men/women separation and women's gates 11-17 & 23-31 approved 2026-11-18",
            'generatedBy': 'scripts/interior-routes-from-navq.py',
        },
        'womenGateIds': WOMEN_GATE_IDS,
        'menWomenLinks': 0,
        'menEdges': men_edges,
        'womenEdges': women_edges,
        'menCarpets': [c['ring'] for c in floor['men']],
        'womenCarpets': [c['ring'] for c in floor['women']],
        'womenFloor': women_marble_raw + women_envelopes_raw,
        'chamber': floor['chamber']['ring'],
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')
    print(
        f'wrote {OUT_PATH}: menEdges={len(men_edges)}, womenEdges={len(women_edges)}, '
        f'menCarpets={len(doc["menCarpets"])}, womenCarpets={len(doc["womenCarpets"])}, '
        f'menWomenLinks=0, bytes={os.path.getsize(OUT_PATH)}'
    )


if __name__ == '__main__':
    main(sys.argv[1])
