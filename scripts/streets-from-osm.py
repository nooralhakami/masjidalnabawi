"""Build data/streets.json — the street network round the Haram, for walking and for driving.

Source: OpenStreetMap (© OpenStreetMap contributors, ODbL). Fetch a fresh extract with:
    python3 scripts/streets-from-osm.py --fetch docs/routes/osm/roads-YYYY-MM-DD.json
or rebuild from a saved one:
    python3 scripts/streets-from-osm.py docs/routes/osm/roads-2026-10-09.json

Ways that share a node share an exact coordinate, so junctions are found by coordinate; roads that
merely cross at different levels (a tunnel under a street) never share one and stay apart.

Output (compact):
  nodes: [[lat, lng], …]
  ways:  [[mode, oneway, node indices…], …]   mode bit 1 = cars, bit 2 = walkers, bit 4 = underground,
                                                bit 8 = underground service road (car-park ramps),
                                                bit 16 = walkers only (footway, pedestrian, steps, path),
                                                bit 32 = has a name (a real pedestrian street such as Quba Avenue);
                                                oneway 1/-1/0 (cars only)
  parking_entrances: [[lat, lng], …]            amenity=parking_entrance (underground car park)
"""
import json, math, sys, urllib.parse, urllib.request

BBOX = (24.430, 39.565, 24.512, 39.640)  # the central area and the historic sites round it (Quba, Qiblatain, Uhud)
QUERY = (
    '[out:json][timeout:120];(way["highway"]({0},{1},{2},{3});'
    'node["amenity"="parking_entrance"]({0},{1},{2},{3}););out geom tags;'
).format(*BBOX)

CAR = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
       'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service', 'living_street', 'road'}
FOOT_ONLY = {'pedestrian', 'footway', 'steps', 'path', 'living_street'}
NO_FOOT = {'motorway', 'motorway_link'}  # trunk roads in the centre (King Faisal Road) have sidewalks


def fetch(out):
    req = urllib.request.Request(
        'https://overpass-api.de/api/interpreter',
        data=urllib.parse.urlencode({'data': QUERY}).encode(),
        headers={'User-Agent': 'masjid-nabawi-visitor-guide/1.0 (route data build script)', 'Accept': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=200) as r:
        open(out, 'wb').write(r.read())


def modes(t):
    hw = t.get('highway')
    if hw in (None, 'construction', 'proposed', 'cycleway', 'bus_guideway', 'raceway'):
        return 0
    if t.get('access') in ('no', 'private'):
        return 0
    car = hw in CAR and t.get('motor_vehicle') != 'no'
    underground = t.get('tunnel') in ('yes', 'building_passage') or t.get('layer', '0').startswith('-')
    # Walkers use footways anywhere, and streets above ground — not road tunnels or motorways.
    foot = t.get('foot') == 'yes' or hw in FOOT_ONLY or (hw not in NO_FOOT and not underground)
    if t.get('foot') == 'no':
        foot = False
    if not (car or foot):
        return 0
    ramp = underground and hw == 'service'
    foot_only = foot and not car
    named = bool(t.get('name'))
    return (1 if car else 0) | (2 if foot else 0) | (4 if underground else 0) | (8 if ramp else 0) | (16 if foot_only else 0) | (32 if named else 0)


def oneway(t):
    o = t.get('oneway')
    if o in ('yes', '1', 'true') or t.get('junction') in ('roundabout', 'circular') or t.get('highway') in ('motorway', 'motorway_link'):
        return 1 if o != '-1' else -1
    return -1 if o == '-1' else 0


def metres(a, b):
    k = 111_320
    return math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * k * math.cos(math.radians(a[0])))


def simplify(pts, keep, tol=1.0):
    """Douglas–Peucker on interior points that are not junctions."""
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        # extend the run while every skipped point stays within tol of the chord and is not a junction
        j = i + 1
        while j + 1 < len(pts) and pts[j] not in keep:
            a, c = pts[i], pts[j + 1]
            ok = True
            for m in range(i + 1, j + 1):
                ab = metres(a, c) or 1e-9
                # distance from pts[m] to chord a–c (small-area approximation)
                ax, ay = 0, 0
                cx, cy = (c[1] - a[1]) * 101_330, (c[0] - a[0]) * 111_320
                px, py = (pts[m][1] - a[1]) * 101_330, (pts[m][0] - a[0]) * 111_320
                if abs(cx * py - cy * px) / ab > tol:
                    ok = False
                    break
            if not ok:
                break
            j += 1
        out.append(pts[j])
        i = j
    return out


def main():
    args = sys.argv[1:]
    if args and args[0] == '--fetch':
        fetch(args[1])
        args = args[1:]
    src = json.load(open(args[0]))
    ways = [e for e in src['elements'] if e['type'] == 'way']
    raw = []
    count = {}
    for w in ways:
        m = modes(w['tags'])
        if not m:
            continue
        pts = [(round(g['lat'], 6), round(g['lon'], 6)) for g in w['geometry']]
        raw.append((m, oneway(w['tags']) if m & 1 else 0, pts))
        for i, p in enumerate(pts):
            count[p] = count.get(p, 0) + (2 if i in (0, len(pts) - 1) else 1)
    junction = {p for p, n in count.items() if n > 1}
    index = {}
    nodes = []
    out_ways = []
    for m, o, pts in raw:
        pts = simplify(pts, junction)
        ids = []
        for p in pts:
            if p not in index:
                index[p] = len(nodes)
                nodes.append(list(p))
            ids.append(index[p])
        out_ways.append([m, o, *ids])
    # Pedestrian streets are often mapped in pieces that stop short at a road (Quba Avenue stops
    # ~30 m short at each crossing). Join each walkers-only dead end to the nearest walkable point
    # within 35 m on another way: the street crossing that is not mapped.
    degree = {}
    for m, o, *ids in out_ways:
        for i, k in enumerate(ids):
            degree[k] = degree.get(k, 0) + (1 if i in (0, len(ids) - 1) else 2)
    walk_nodes = {}
    for wi, (m, o, *ids) in enumerate(out_ways):
        if m & 2:
            for k in ids:
                walk_nodes.setdefault(k, set()).add(wi)
    grid = {}
    for k in walk_nodes:
        la, ln = nodes[k]
        grid.setdefault((round(la * 2000), round(ln * 2000)), []).append(k)
    links = 0
    for wi, (m, o, *ids) in enumerate(list(out_ways)):
        if not (m & 16):
            continue
        for end in (ids[0], ids[-1]):
            if degree.get(end, 0) != 1:
                continue
            la, ln = nodes[end]
            gx, gy = round(la * 2000), round(ln * 2000)
            best, bd = None, 35.0
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for k in grid.get((gx + dx, gy + dy), []):
                        if k == end or wi in walk_nodes[k]:
                            continue
                        d = metres(nodes[end], nodes[k])
                        if d < bd:
                            best, bd = k, d
            if best is not None:
                out_ways.append([2 | 32, 0, end, best])  # a short walkers' link, not penalised
                links += 1
    entrances = [[round(e['lat'], 6), round(e['lon'], 6)] for e in src['elements'] if e['type'] == 'node']
    data = {
        'source': '© OpenStreetMap contributors, ODbL — openstreetmap.org/copyright',
        'osm_base': src.get('osm3s', {}).get('timestamp_osm_base'),
        'bbox': list(BBOX),
        'nodes': nodes,
        'ways': out_ways,
        'parking_entrances': entrances,
    }
    open('data/streets.json', 'w').write(json.dumps(data, separators=(',', ':')) + '\n')
    print(f'{len(nodes)} nodes, {len(out_ways)} ways ({links} crossing links), {len(entrances)} parking entrances')


if __name__ == '__main__':
    main()
