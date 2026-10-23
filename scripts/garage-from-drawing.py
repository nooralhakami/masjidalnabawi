"""Turn the owner's drawing of the underground car park roads into data/garage.json.

Fits an affine pixel→metre transform on the facility markers seen in the drawing, reports the
residuals, then writes every lane, entrance, exit and lot entry as lat/lng (same local projection
as src/routing/walk.ts). A lot's entry and exit (the arrows) are placed on the nearest entry or exit
road. Run:
    python3 scripts/garage-from-drawing.py docs/routes/garage-2026-10-13.json
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
print(f'residuals over {len(P)} facilities: max {res.max():.2f} m, mean {res.mean():.2f} m')

def m(px):
    return np.array([*px, 1]) @ A

def ll(xy):
    return [round(LAT0 + xy[1] / KY, 7), round(LNG0 + xy[0] / KX, 7)]

lanes = {l['id']: [m(p) for p in l['px']] for l in d['lanes']}

# The car park lies under the plazas, never under the mosque: a road drawn over the mosque's
# rectangle (as in src/routing/walk.ts: its outline shrunk 3 m) is moved out to its nearest side,
# 2 m clear. Report every move so the owner can check it.
r = json.load(open('data/routing.json'))
mosque = np.array([[(ln - LNG0) * KX, (la - LAT0) * KY] for la, ln in r['obstacles']['mosque_building']])
x0, y0 = mosque.min(axis=0) + 3
x1, y1 = mosque.max(axis=0) - 3
CLEAR = 5.0  # 2 m clear, plus the 2.5 m a route keeps right of the middle of the road
def near_mosque(x, y):
    return x0 - CLEAR < x < x1 + CLEAR and y0 - CLEAR < y < y1 + CLEAR

for lid in list(lanes):
    # A segment that only cuts a corner of the area gets points every 2 m there, so it can be moved too.
    pts = lanes[lid]
    dense = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(np.ceil(np.hypot(*(b - a)) / 2)))
        steps = [a + (b - a) * k / n for k in range(1, n + 1)]
        dense += steps if any(near_mosque(*q) for q in steps) else [b]
    lanes[lid] = pts = dense
    moved = []
    sides = []
    for i, (x, y) in enumerate(pts):
        side = None
        if near_mosque(x, y):
            out = min((x - (x0 - CLEAR), 'w'), ((x1 + CLEAR) - x, 'e'), (y - (y0 - CLEAR), 's'), ((y1 + CLEAR) - y, 'n'))
            side = out[1]
            nx, ny = {'w': (x0 - CLEAR, y), 'e': (x1 + CLEAR, y), 's': (x, y0 - CLEAR), 'n': (x, y1 + CLEAR)}[side]
            moved.append(round(float(np.hypot(nx - x, ny - y)), 1))
            pts[i] = np.array([nx, ny])
        sides.append(side)
    # Where the road passes from one side of the mosque to the next, it turns at the corner.
    corner = {frozenset('es'): (x1 + CLEAR, y0 - CLEAR), frozenset('en'): (x1 + CLEAR, y1 + CLEAR), frozenset('ws'): (x0 - CLEAR, y0 - CLEAR), frozenset('wn'): (x0 - CLEAR, y1 + CLEAR)}
    out_pts = [pts[0]]
    for k in range(1, len(pts)):
        pair = frozenset((sides[k - 1] or '') + (sides[k] or ''))
        if sides[k - 1] and sides[k] and sides[k - 1] != sides[k] and pair in corner:
            out_pts.append(np.array(corner[pair]))
        out_pts.append(pts[k])
    lanes[lid] = out_pts
    if moved:
        print(f'{lid}: {len(moved)} point(s) moved out of the mosque by up to {max(moved)} m')

def nearest_on(ids, p):
    """Nearest point on one of the given lanes: (distance, point, lane id)."""
    best = None
    for l in d['lanes']:
        if l['id'] not in ids:
            continue
        pts = lanes[l['id']]
        for a, b in zip(pts, pts[1:]):
            ab = b - a
            u = max(0.0, min(1.0, float(np.dot(p - a, ab) / (np.dot(ab, ab) or 1e-9))))
            q = a + ab * u
            dist = float(np.hypot(*(p - q)))
            if best is None or dist < best[0]:
                best = (dist, q, l['id'])
    return best

lots = []
for lot in d['lots']:
    e = nearest_on({lot['entry_lane']}, m(lot['entry_px']))
    x = nearest_on({lot['exit_lane']}, m(lot['exit_px']))
    per_level = {}
    for level, alt in ((k, v) for k, v in lot.items() if k in ('A', 'B')):
        ae = nearest_on({alt['entry_lane']}, m(alt['entry_px']))
        ax = nearest_on({alt['exit_lane']}, m(alt['exit_px']))
        per_level[level] = {'entry': ll(ae[1]), 'entry_lane': ae[2], 'exit': ll(ax[1]), 'exit_lane': ax[2]}
        print(f"lot {lot['id'] - 900:2} level {level}: entry on {ae[2]} ({ae[0]:.1f} m), exit on {ax[2]} ({ax[0]:.1f} m)")
    lots.append({'id': lot['id'], 'side': lot['side'], **({'levels': per_level} if per_level else {}), 'entry': ll(e[1]), 'entry_lane': e[2], 'exit': ll(x[1]), 'exit_lane': x[2], 'certain': lot.get('certain', True)})
    print(f"lot {lot['id'] - 900:2}: entry on {e[2]} ({e[0]:.1f} m from the arrow), exit on {x[2]} ({x[0]:.1f} m)")

# Extra drawings (a closer look at one side): each calibrated on its own facility markers. They give
# the way to an entrance above ground (an approach, ending at the car park mouth) and the way from an
# exit back to the streets (a departure).
approaches, departures = {}, {}
for extra in d.get('extra_drawings', []):
    x = json.load(open(extra))
    PX = np.array([[*c['px'], 1] for c in x['control_points']], float)
    MX = np.array([c['m'] for c in x['control_points']], float)
    AX, *_ = np.linalg.lstsq(PX, MX, rcond=None)
    rx = np.hypot(*(PX @ AX - MX).T)
    print(f'{extra}: residuals over {len(PX)} facilities: max {rx.max():.2f} m, mean {rx.mean():.2f} m')
    for a in x.get('approaches', []):
        approaches[a['entrance']] = [ll(np.array([*p, 1]) @ AX) for p in a['px']]
    for dep in x.get('departures', []):
        departures[dep['exit']] = [ll(np.array([*p, 1]) @ AX) for p in dep['px']]

entrances = [{k: v for k, v in e.items() if not k.startswith('_')} for e in d['entrances']]
for e in entrances:
    if e['id'] in approaches:
        e['approach'] = approaches[e['id']]
        # The car park road starts at the mouth, where the approach ends.
        e['street'] = e['approach'][-1]
        # How far the approach's end is from the underground road it leads into (a check on the two drawings).
        lane = lanes[e['lane']]
        end = np.array([(e['approach'][-1][1] - LNG0) * KX, (e['approach'][-1][0] - LAT0) * KY])
        gap = min(float(np.hypot(*(end - (a + (b - a) * max(0, min(1, np.dot(end - a, b - a) / np.dot(b - a, b - a))))))) for a, b in zip(lane, lane[1:]))
        print(f"approach to {e['id']}: {len(e['approach'])} points, ends {gap:.1f} m from the road {e['lane']}")
exits = [dict(x) for x in d['exits']]
for x in exits:
    lane = lanes[x['lane']]
    x['mouth'] = ll(lane[-1])  # where the exit road leaves the car park (its last point)
    if x['id'] in departures:
        x['departure'] = departures[x['id']]
        start = np.array([(x['departure'][0][1] - LNG0) * KX, (x['departure'][0][0] - LAT0) * KY])
        print(f"departure from {x['id']}: starts {float(np.hypot(*(start - lane[-1]))):.1f} m from the end of the road {x['lane']}")

# Lanes already in lat/lng (scripts/qurban-lanes.py: the Qurban entrance, owner 2026-10-23), their
# entrance and exit (level A only).
extra = json.load(open(d['extra_lanes_file']))['lanes'] if d.get('extra_lanes_file') else []
for e in d.get('extra_entrances', []):
    lane = next(l for l in extra if l['id'] == e['lane'])
    entrances.append({'id': e['id'], 'lane': e['lane'], 'level': e['level'], 'street': lane['path'][0] if e.get('at') == 'start' else lane['path'][-1]})
for x in d.get('extra_exits', []):
    lane = next(l for l in extra if l['id'] == x['lane'])
    exits.append({'id': x['id'], 'lane': x['lane'], 'level': x['level'], 'street': lane['path'][-1], 'mouth': lane['path'][-1]})

out = {
    '_note': 'Generated by scripts/garage-from-drawing.py from ' + sys.argv[1] + '. Do not edit by hand: change the drawing data and rebuild.',
    'rule': 'oneway',
    'lanes': [
        {'id': l['id'], 'kind': l['kind'], 'certain': l['certain'], 'oneway': l.get('oneway', True),
         **({'levels': l['levels']} if 'levels' in l else {}),
         **({'inferred': True} if l.get('inferred') else {}),
         **({'from_level': l['from_level'], 'to_level': l['to_level']} if 'from_level' in l else {}),
         'path': [ll(p) for p in lanes[l['id']]]}
        for l in d['lanes']
    ] + extra,
    'entrances': entrances,
    'exits': exits,
    'lots': lots,
}
open('data/garage.json', 'w').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
print('lanes', len(out['lanes']), 'lots', len(out['lots']), '→ data/garage.json')
