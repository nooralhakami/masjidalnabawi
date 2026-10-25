"""Turn the owner's route drawing (pixel vertices in docs/routes/drawing-*.json) into data/routing.json.

Fits an affine pixel→metre transform on facility control points, reports the residuals, then writes
lat/lng (6 decimals) with the same local projection as src/routing/walk.ts. Run:
    python3 scripts/routes-from-drawing.py docs/routes/drawing-2026-10-08.json
"""
import json, math, sys
import numpy as np

LAT0, LNG0 = 24.4673, 39.6111
KY = 111_320
KX = KY * math.cos(math.radians(LAT0))

d = json.load(open(sys.argv[1]))
P = np.array([[*c['px'], 1] for c in d['control_points']], float)
M = np.array([c['m'] for c in d['control_points']], float)
A, *_ = np.linalg.lstsq(P, M, rcond=None)
res = np.hypot(*(P @ A - M).T)
print(f'residuals: max {res.max():.1f} m, mean {res.mean():.1f} m')

def ll(px):
    x, y = np.array([*px, 1]) @ A
    return [round(LAT0 + y / KY, 7), round(LNG0 + x / KX, 7)]

r = json.load(open('data/routing.json'))
ring_old_m = [np.array([*p, 1]) @ A for p in d['ring']]
def m2ll(x, y):
    return [round(LAT0 + y / KY, 7), round(LNG0 + x / KX, 7)]
# The east side as the owner redrew it (2026-10-25): vertices a..b of the drawn ring are replaced by points in metres.
ring_ll = [ll(p) for p in d['ring']]
east = d.get('ring_east_2026_10_25')
if east:
    a, b = east['replaces']
    new = [m2ll(x, ring_old_m[a][1] if y is None else y) for x, y in east['m']]
    ring_ll = ring_ll[:a] + new + ring_ll[b + 1:]
r['walkway_ring'] = ring_ll
r['walkways'] = [{'id': w['id'], 'kind': w['kind'], 'path': [ll(p) for p in w['px']]} for w in d['walkways']]
# Al-Baqi' (outside the Haram) as two rectangles that follow the stepped wall the owner traced:
# the walkway runs along its west wall (x ≈ 225 m) and steps east around its north-west corner.
ring_m = ring_old_m  # the drawn ring: the Al-Baqi' wall follows it, whatever the walk's east side is
# Ring vertices 6–8 trace that wall: 7→8 is the lower wall walk, 5→6 the step around the corner.
west_x = ring_m[7][0] + 4  # 4 m: places on the wall walk (e.g. 502, gates 355–364) stay outside
step_x = ring_m[6][0] + 4
step_y = ring_m[6][1] - 2.5
east_x, south_y, north_y = 368.3, -161.5, 63.7           # unchanged outer edges of the old rectangle
r['obstacles']['baqi_outside_haram'] = [m2ll(west_x, south_y), m2ll(west_x, step_y), m2ll(east_x, step_y), m2ll(east_x, south_y)]
r['obstacles']['baqi_outside_haram_north'] = [m2ll(step_x, step_y), m2ll(step_x, north_y), m2ll(east_x, north_y), m2ll(east_x, step_y)]
print(f'baqi: west wall x={west_x:.1f} m up to y={step_y:.1f} m, then x={step_x:.1f} m up to y={north_y} m')
r['women_prayer_areas'] = [{'id': a['id'], 'polygon': [ll(p) for p in a['px']]} for a in d['women_prayer_areas']]
open('data/routing.json', 'w').write(json.dumps(r, ensure_ascii=False, indent=1) + '\n')
print('ring', len(r['walkway_ring']), 'walkways', len(r['walkways']), 'women areas', len(r['women_prayer_areas']))
