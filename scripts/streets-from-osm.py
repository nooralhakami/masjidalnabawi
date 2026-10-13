"""Build data/streets.json — the street network round the Haram, for walking and for driving.

Source: OpenStreetMap (© OpenStreetMap contributors, ODbL). Fetch a fresh extract with:
    python3 scripts/streets-from-osm.py --fetch docs/routes/osm/roads-YYYY-MM-DD.json
or rebuild from a saved one:
    python3 scripts/streets-from-osm.py docs/routes/osm/roads-2026-10-09.json \
        --restrictions=docs/routes/osm/restrictions-2026-10-13.json --parking=docs/routes/osm/parking-2026-10-13.json

Ways that share a node share an exact coordinate, so junctions are found by coordinate; roads that
merely cross at different levels (a tunnel under a street) never share one and stay apart.

Output (compact):
  nodes: [[lat, lng], …]
  ways:  [[mode, oneway, node indices…], …]   mode bit 1 = cars, bit 2 = walkers, bit 4 = underground,
                                                bit 8 = underground service road (car-park ramps),
                                                bit 16 = walkers only (footway, pedestrian, steps, path),
                                                bit 32 = has a name (a real pedestrian street such as Quba Avenue),
                                                bits 64–448 = road class for cars (ROAD_CLASS, << 6);
                                                oneway 1/-1/0 (cars only)
  parking_entrances: [[lat, lng], …]            amenity=parking_entrance (underground car park)
  restrictions: [[from, via, to, kind], …]      OSM turn restrictions as node indices: kind 0 = no (no
                                                turn from→via→to), 1 = only (from→via must go on to `to`)
  parkings: [[lat, lng], …]                     public car parks (amenity=parking, not private), for
                                                driving to a place outside the Haram

Cars use public roads only (owner, 2026-10-13: no unofficial short cuts that earn visitors a traffic
fine): never a car-park aisle, a driveway, a drive-through, an alley, an emergency access, a private
or customers-only road, a reversible or alternating one, or an unnamed service road — except the
ramps of the underground car park (underground service roads).
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


# Road class for cars, from the most to the least important: routing prefers the main roads.
ROAD_CLASS = {
    'motorway': 0, 'motorway_link': 0, 'trunk': 0, 'trunk_link': 0,
    'primary': 1, 'primary_link': 1,
    'secondary': 2, 'secondary_link': 2,
    'tertiary': 3, 'tertiary_link': 3,
    'unclassified': 4,
    'residential': 5, 'living_street': 5, 'road': 5,
    'service': 6,
}
NO_CARS = ('no', 'private', 'customers', 'delivery', 'agricultural', 'forestry', 'emergency', 'permit')
SERVICE_NOT_PUBLIC = ('parking_aisle', 'driveway', 'drive-through', 'alley', 'emergency_access')


def car_ok(t, underground):
    """Whether a car may use this way as a public road."""
    hw = t.get('highway')
    if hw not in CAR:
        return False
    if any(t.get(k) in NO_CARS for k in ('access', 'vehicle', 'motor_vehicle', 'motorcar')):
        return False
    if t.get('oneway') in ('reversible', 'alternating'):
        return False
    if hw == 'service':
        if t.get('service') in SERVICE_NOT_PUBLIC:
            return False
        # A plain service road is usually a hotel's or a building's own access: only the car park's
        # ramps (underground) and named ones are public roads.
        return underground or bool(t.get('name'))
    return True


def car_park_access(ways, entrances, hops=4):
    """
    The service roads that lead from a public road to a mapped car-park entrance (up to `hops` ways
    away, never an aisle, a driveway or a private road): the official way in and out of the car park.
    """
    at = {}
    for w in ways:
        for g in w['geometry']:
            at.setdefault((round(g['lat'], 6), round(g['lon'], 6)), []).append(w)
    ok = set()
    for e in entrances:
        frontier = [(w, 0) for w in at.get(e, [])]
        seen = set()
        while frontier:
            w, h = frontier.pop(0)
            t = w['tags']
            if w['id'] in seen or h > hops or t.get('highway') != 'service':
                continue
            seen.add(w['id'])
            if t.get('service') in SERVICE_NOT_PUBLIC and t.get('tunnel') != 'yes':
                continue
            if any(t.get(k) in NO_CARS for k in ('access', 'vehicle', 'motor_vehicle', 'motorcar')):
                continue
            ok.add(w['id'])
            for g in (w['geometry'][0], w['geometry'][-1]):
                frontier += [(o, h + 1) for o in at.get((round(g['lat'], 6), round(g['lon'], 6)), [])]
    return ok


def modes(t, access=False):
    """`access`: a service road leading to a car-park entrance (see car_park_access)."""
    hw = t.get('highway')
    if hw in (None, 'construction', 'proposed', 'cycleway', 'bus_guideway', 'raceway'):
        return 0
    underground = t.get('tunnel') in ('yes', 'building_passage') or t.get('layer', '0').startswith('-')
    if t.get('access') in ('no', 'private') and not car_ok(t, underground):
        return 0
    car = car_ok(t, underground) or (access and hw == 'service')
    # Walkers use footways anywhere, and streets above ground — not road tunnels or motorways.
    foot = t.get('foot') == 'yes' or hw in FOOT_ONLY or (hw not in NO_FOOT and not underground)
    if t.get('foot') == 'no':
        foot = False
    if not (car or foot):
        return 0
    ramp = underground and hw == 'service'
    foot_only = foot and not car
    named = bool(t.get('name'))
    cls = ROAD_CLASS.get(hw, 6) if car else 0
    return (1 if car else 0) | (2 if foot else 0) | (4 if underground else 0) | (8 if ramp else 0) | (16 if foot_only else 0) | (32 if named else 0) | (cls << 6)


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
    extra = {a.split('=', 1)[0]: a.split('=', 1)[1] for a in args[1:] if '=' in a}
    rsrc = json.load(open(extra['--restrictions'])) if '--restrictions' in extra else {}
    restrictions_src = rsrc.get('elements', [])
    via_coords = {int(k): (round(v[0], 6), round(v[1], 6)) for k, v in rsrc.get('via_nodes', {}).items()}
    parking_src = json.load(open(extra['--parking']))['elements'] if '--parking' in extra else []
    ways = [e for e in src['elements'] if e['type'] == 'way']
    entrance_pts = [(round(e['lat'], 6), round(e['lon'], 6)) for e in src['elements'] if e['type'] == 'node' and e.get('tags', {}).get('amenity') == 'parking_entrance']
    access_ways = car_park_access(ways, entrance_pts)
    raw = []
    count = {}
    osm_pt = dict(via_coords)  # OSM node id → point: the via nodes (and node ids in the extract, when present)
    for w in ways:
        m = modes(w['tags'], w['id'] in access_ways)
        if not m:
            continue
        pts = [(round(g['lat'], 6), round(g['lon'], 6)) for g in w['geometry']]
        for nid, p in zip(w.get('nodes', []), pts):
            osm_pt[nid] = p
        raw.append((m, oneway(w['tags']) if m & 1 else 0, pts, w['id']))
        for i, p in enumerate(pts):
            count[p] = count.get(p, 0) + (2 if i in (0, len(pts) - 1) else 1)
    junction = {p for p, n in count.items() if n > 1}
    # Keep the via nodes of turn restrictions as junctions.
    for r in restrictions_src:
        for mbr in r.get('members', []):
            if mbr['role'] == 'via' and mbr['type'] == 'node' and mbr['ref'] in osm_pt:
                junction.add(osm_pt[mbr['ref']])
    index = {}
    nodes = []
    out_ways = []
    way_ids = {}  # OSM way id → its node indices in the output
    for m, o, pts, wid in raw:
        pts = simplify(pts, junction)
        ids = []
        for p in pts:
            if p not in index:
                index[p] = len(nodes)
                nodes.append(list(p))
            ids.append(index[p])
        out_ways.append([m, o, *ids])
        if m & 1:
            way_ids[wid] = ids
    # Turn restrictions as node indices: the node before the via node on the 'from' way, the via
    # node, and the node after it on the 'to' way.
    restrictions = []
    skipped = 0
    for r in restrictions_src:
        kind = r.get('tags', {}).get('restriction', '')
        if not (kind.startswith('no_') or kind.startswith('only_')):
            continue
        frm = [mb['ref'] for mb in r['members'] if mb['role'] == 'from' and mb['type'] == 'way']
        to = [mb['ref'] for mb in r['members'] if mb['role'] == 'to' and mb['type'] == 'way']
        via = [mb['ref'] for mb in r['members'] if mb['role'] == 'via' and mb['type'] == 'node']
        if len(frm) != 1 or len(to) != 1 or len(via) != 1 or frm[0] not in way_ids or to[0] not in way_ids or via[0] not in osm_pt:
            skipped += 1
            continue
        v = index.get(osm_pt[via[0]])
        def around(ids):
            if v not in ids:
                return []
            i = ids.index(v)
            return [ids[j] for j in (i - 1, i + 1) if 0 <= j < len(ids)]
        for u in around(way_ids[frm[0]]):
            for w2 in around(way_ids[to[0]]):
                restrictions.append([u, v, w2, 0 if kind.startswith('no_') else 1])
    parkings = []
    for e in parking_src:
        t = e.get('tags', {})
        if t.get('access') in NO_CARS or t.get('parking') in ('carports', 'garage_boxes'):
            continue
        c = e.get('center') or (e if 'lat' in e else None)
        if c:
            parkings.append([round(c['lat'], 6), round(c['lon'], 6)])
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
        'restrictions': restrictions,
        'parkings': parkings,
    }
    open('data/streets.json', 'w').write(json.dumps(data, separators=(',', ':')) + '\n')
    print(f'{len(nodes)} nodes, {len(out_ways)} ways ({links} crossing links), {len(entrances)} parking entrances, '
          f'{len(restrictions)} turn restriction pairs ({skipped} relations skipped), {len(parkings)} public car parks, '
          f'{len(access_ways)} car-park access roads kept')


if __name__ == '__main__':
    main()
