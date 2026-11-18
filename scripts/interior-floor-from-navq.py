"""The Mosque's interior floor from navQ's ground-floor plan (owner, 2026-11-18).

The owner: "the prayer areas with carpets, and the walkways with the tiles inside the Haram, as the
plan extracted from the Authority's site shows". navQ's floor 12 ("GF") GeoJSON styles each shape by
a code `FF`; what each code is was read from the data itself (Phase 1 report, 2026-11-18):
  FF0  the walking floor (marble)            FF5  men's prayer areas (carpet)
  FF6  women's prayer areas (carpet)          FF888 #754  the First Hasawa (open court, canopies)
The named prayer areas (navQ `GetPoIPolygons` for floor 12) name the carpets that contain them.

Usage (the inputs are the owner-authorised navQ capture, kept outside Git):
  python3 scripts/interior-floor-from-navq.py <floor-12-GF.geojson> <GetPoIPolygons-floor-12.json>
Writes data/navq-interior-floor.json (lng/lat, 7 decimals). Holes are dropped: the marble lies under
the whole floor and the carpets are laid over it.
"""

import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'navq-interior-floor.json')
HASAWA_FEATURE = 754  # FF888: the First Hasawa (navQ landmark 1011 "الحصوة الاولى" lies in it)
MIN_AREA_M2 = 4.0
K = 111320.0


def ring_xy(ring):
    c = math.cos(math.radians(24.468))
    return [(p[0] * K * c, p[1] * K) for p in ring]


def area(ring):
    r = ring_xy(ring)
    return abs(sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))) / 2


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i - 1][0], ring[i - 1][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1:
            c = not c
    return c


def tidy(ring):
    out = [[round(p[0], 7), round(p[1], 7)] for p in ring]
    if out and out[0] == out[-1]:
        out = out[:-1]
    return out


def main(gf_path, pois_path):
    raw = open(gf_path, 'rb').read()
    gf = json.loads(raw)['features']
    pois = json.load(open(pois_path))
    pois = pois if isinstance(pois, list) else next(v for v in pois.values() if isinstance(v, list))
    named = []
    for p in pois:
        if p.get('categoryId') not in (3, 41, 43):
            continue
        ar = next((n['value'] for n in p['name'] if n['code'] == 'ar'), '')
        c = p['zoneCenterPoint']['LongLat']
        named.append((p['id'], ar, (c['Longitude'], c['Latitude'])))

    out = {'marble': [], 'men': [], 'women': [], 'courtyard': []}
    for i, f in enumerate(gf):
        g = f.get('geometry')
        if not g:
            continue
        ff = f['properties'].get('FF')
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for p in polys:
            ring = p[0]
            if area(ring) < MIN_AREA_M2:
                continue
            if ff == 0:
                out['marble'].append({'navq': i, 'ring': tidy(ring)})
            elif ff in (5, 6):
                names = [n for (_, n, ll) in named if inside(ll, ring)]
                ids = [pid for (pid, _, ll) in named if inside(ll, ring)]
                rec = {'navq': i, 'ring': tidy(ring), 'names': names, 'poi': ids}
                out['men' if ff == 5 else 'women'].append(rec)
            elif ff == 888 and i == HASAWA_FEATURE:
                out['courtyard'].append({'navq': i, 'name': 'الحصوة الأولى', 'ring': tidy(ring)})

    doc = {
        'source': {
            'what': "navQ floor 12 (GF) GeoJSON of the Prophet's Mosque, codes FF0/FF5/FF6/FF888",
            'url': 'https://maps.alharamain.gov.sa/content/GF_DONE_402742298.txt',
            'lastModified': '2026-09-01',
            'sha256': hashlib.sha256(raw).hexdigest(),
            'permission': "owner's written permission for navQ data (2026-11-04); carpets and walkways per this plan approved 2026-11-18",
            'generatedBy': 'scripts/interior-floor-from-navq.py',
        },
        **out,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')
    print({k: len(v) for k, v in out.items()}, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
