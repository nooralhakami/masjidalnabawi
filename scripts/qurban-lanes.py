"""Turn the owner's draft of the Qurban entrance roads into lat/lng lanes for the route planner.

Reads docs/routes/garage-qurban-draft-2026-10-23.json (pixels of two of the owner's drawings, as
scripts/garage-map.py uses them), converts every confirmed lane to lat/lng, snaps each end that is
within SNAP_M of a road to that road (so the planner joins them), and writes
docs/routes/garage-qurban-2026-10-23.json, which scripts/garage-from-drawing.py then adds to
data/garage.json. Lane 38 is merged into 42 and 47 (purple) is unconfirmed: neither is written.
    python3 scripts/qurban-lanes.py
"""
import json, math
import numpy as np

LAT0, LNG0 = 24.4673, 39.6111
KY = 111_320
KX = KY * math.cos(math.radians(LAT0))
SNAP_M = 5.0

m = lambda la, lo: ((lo - LNG0) * KX, (la - LAT0) * KY)
ll = lambda xy: [round(LAT0 + xy[1] / KY, 7), round(LNG0 + xy[0] / KX, 7)]

pois = {x['id']: x for x in json.load(open('data/pois.json'))}
ov = json.load(open('data/overrides.json'))
g = json.load(open('data/garage.json'))
dr = json.load(open('docs/routes/garage-qurban-draft-2026-10-23.json'))

# Screenshot pixels → metres, on the gates 360-369.
cp = dr['control_points']
ax = np.array([c['px'][0] for c in cp]); ay = np.array([c['px'][1] for c in cp])
mp = [m(pois[c['id']]['lat'], pois[c['id']]['lng']) for c in cp]
fx = np.polyfit(ax, [p[0] for p in mp], 1); fy = np.polyfit(ay, [p[1] for p in mp], 1)
# Crop pixels → metres, on the facilities 201-204 (with the position nudges).
cc = dr['crop_control_points']
fm = {}
for c in cc:
    q = pois[c['id']]; o = ov.get(str(c['id']), {})
    fm[c['id']] = m(q['lat'] + o.get('north', 0) / KY, q['lng'] + o.get('east', 0) / KX)
cfx = np.polyfit([c['px'][0] for c in cc], [fm[c['id']][0] for c in cc], 1)
cfy = np.polyfit([c['px'][1] for c in cc], [fm[c['id']][1] for c in cc], 1)

def metres(l):
    if l.get('space') == 'crop':
        return [np.array([np.polyval(cfx, x), np.polyval(cfy, y)]) for x, y in l['px']]
    return [np.array([np.polyval(fx, x), np.polyval(fy, y)]) for x, y in l['px']]

# The entry road, moved east (owner, 2026-10-23): pixels of garage-map.png, calibrated on facilities 201-204.
c2 = dr['crop2_control_points']
f2x = np.polyfit([c['px'][0] for c in c2], [fm[c['id']][0] for c in c2], 1)
f2y = np.polyfit([c['px'][1] for c in c2], [fm[c['id']][1] for c in c2], 1)

# The exit road, moved a little east (owner, 2026-10-23): pixels of another crop of garage-map.png.
c3 = dr['crop3_control_points']
f3x = np.polyfit([c['px'][0] for c in c3], [fm[c['id']][0] for c in c3], 1)
f3y = np.polyfit([c['px'][1] for c in c3], [fm[c['id']][1] for c in c3], 1)

SKIP = {'a-qurban-west-stub', 'purple-unconfirmed'}
# The kind and levels the planner needs (the draft only drew colours).
SPEC = {
    'qurban-road-in-A': dict(kind='entry', levels=['A']),
    'qurban-road-out-A': dict(kind='exit', levels=['A']),
    'a-qurban-arc': dict(kind='link', levels=['A']),
    'qurban-ramp-link': dict(kind='link', levels=['B']),
    'ramp-up-qurban': dict(kind='ramp_up', from_level='B', to_level='A'),
    'ramp-down-qurban': dict(kind='ramp_down', from_level='A', to_level='B'),
    'a-qurban-west-down': dict(kind='link', levels=['A']),
    'a-qurban-west-east': dict(kind='link', levels=['A']),
    'a-qurban-exit-curve': dict(kind='exit', levels=['A']),
    'a-qurban-to-east-up': dict(kind='link', levels=['A']),
    'a-qurban-east-up': dict(kind='link', levels=['A']),
}
# The cyan link ends at the foot of the yellow ramp, which the planner joins itself.
NO_SNAP = {('qurban-ramp-link', -1), ('qurban-road-in-A', -1), ('qurban-road-in-A', 0), ('qurban-road-out-A', 0), ('qurban-road-out-A', -1)}
# Lane 44 meets the moved exit road about 9 m east of where it used to end.
SNAP_OVERRIDE = {('a-qurban-exit-curve', -1): 12.0}
lanes = {l['id']: metres(l) for l in dr['lanes'] if l['id'] not in SKIP}
for l in dr['lanes']:
    if l.get('px_east'):
        lanes[l['id']] = [np.array([np.polyval(f2x, x), np.polyval(f2y, y)]) for x, y in l['px_east']]
    if l.get('px_exit_east'):
        lanes[l['id']] = [np.array([np.polyval(f3x, x), np.polyval(f3y, y)]) for x, y in l['px_exit_east']]
existing = {l['id']: [np.array(m(*p)) for p in l['path']] for l in g['lanes'] if not l['id'].endswith('-qurban') and l['id'] not in lanes}

def covers(levels, level):
    return levels is None or level in levels

def nearest(p, pool):
    best = (1e9, None, None)
    for lid, pts in pool.items():
        for a, b in zip(pts, pts[1:]):
            ab = b - a
            u = max(0.0, min(1.0, float(np.dot(p - a, ab) / (np.dot(ab, ab) or 1e-9))))
            q = a + ab * u
            d = float(np.hypot(*(p - q)))
            if d < best[0]:
                best = (d, q, lid)
    return best

levels_of = {l['id']: l.get('levels') for l in g['lanes'] if not l.get('from_level')}
for lid, pts in lanes.items():
    spec = SPEC[lid]
    for end in (0, -1):
        # A ramp joins a road of the level it leaves (start) or reaches (end); any other lane, a road it shares a level with.
        want = [spec['from_level'] if end == 0 else spec['to_level']] if 'from_level' in spec else (spec.get('levels') or ['A', 'B'])
        pool = {k: v for k, v in existing.items() if any(covers(levels_of.get(k), w) for w in want)}
        pool.update({k: v for k, v in lanes.items() if k != lid and 'from_level' not in SPEC[k] and any(covers(SPEC[k].get('levels'), w) for w in want)})
        d, q, other = nearest(pts[end], pool)
        print(f"{lid:22} {'start' if end == 0 else 'end  '}: {d:5.1f} m from {other}")
        if (lid, end) in NO_SNAP:
            continue
        if d <= SNAP_OVERRIDE.get((lid, end), 8.0 if 'from_level' in spec else SNAP_M):
            pts[end] = q
# Both mouths meet at the Qurban marker (owner, 2026-10-23): the entry road on its east side, the exit
# road on its west side, a small kerb between. The north ends stay where the drawing put them (the entry
# at the corner, then a short link to where lane 46 starts; the exit where lane 44 meets it) and the
# south parts are redrawn as smooth curves from the mouths to those ends.
mk = dr['entrance_marker']
C = np.array(m(mk['lat'], mk['lng']))
half = mk['kerb_m'] / 2

def curve(a, b, n=10):
    """A cubic Bezier from a to b, leaving a and reaching b running north-south."""
    k = 0.45 * float(np.hypot(*(b - a)))
    sgn = 1.0 if b[1] > a[1] else -1.0
    p1, p2 = a + np.array([0.0, sgn * k]), b - np.array([0.0, sgn * k])
    return [(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * b for t in np.linspace(0, 1, n)]

corner = lanes['qurban-road-in-A'][-1]
lanes['qurban-road-in-A'] = curve(C + np.array([half, 0.0]), corner) + [lanes['a-qurban-east-up'][0].copy()]
top = lanes['qurban-road-out-A'][0]
lanes['qurban-road-out-A'] = curve(top, C - np.array([half, 0.0]))

out = {
    '_note': 'Generated by scripts/qurban-lanes.py from docs/routes/garage-qurban-draft-2026-10-23.json (owner, 2026-10-23). Do not edit by hand.',
    'lanes': [{'id': lid, **SPEC[lid], 'certain': True, 'oneway': True, 'path': [ll(p) for p in pts]} for lid, pts in lanes.items()],
}
json.dump(out, open('docs/routes/garage-qurban-2026-10-23.json', 'w'), ensure_ascii=False, indent=1)
open('docs/routes/garage-qurban-2026-10-23.json', 'a').write('\n')
print(len(out['lanes']), 'lanes → docs/routes/garage-qurban-2026-10-23.json')
