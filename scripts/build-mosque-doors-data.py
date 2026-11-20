"""Extract exact 3D doorway bay coordinates for all 42 Mosque inner gates (1..42) from `haram-3d.glb`,
combining them with the owner's approved multi-bay structure and partial-open defaults [2026-11-20]:

  - 5-bay monumental gateways (7 gates: 8, 13, 17, 21, 25, 29, 34): 5 bays, 2 open by default
  - 3-bay gateways (3 gates: 2, 5, 37): 3 bays, 2 open by default
  - 2-bay gateways (7 gates: 3, 4, 10, 11, 32, 38, 39): 2 bays, 1 open by default (Gate 32 always closed)
  - 1-bay archways (remaining 25 gates): 1 bay, 1 open by default (18, 23, 26, 31 always closed)

Reads `public/models/haram-3d.glb`, `data/pois.json`, `data/overrides.json`, `src/data-next/alharamain-3d.ts`.
Writes `data/mosque-doors-3d.json` in `[lng, lat]` + model metres `[east, south]`.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
GLB_PATH = os.path.join(ROOT, 'public', 'models', 'haram-3d.glb')
POIS_PATH = os.path.join(ROOT, 'data', 'pois.json')
OVERRIDES_PATH = os.path.join(ROOT, 'data', 'overrides.json')
ANCHOR_SRC = os.path.join(ROOT, 'src', 'data-next', 'alharamain-3d.ts')
OUT_PATH = os.path.join(ROOT, 'data', 'mosque-doors-3d.json')

# Owner rules [2026-11-20] & [2026-11-13]
ALWAYS_CLOSED_GATES = {18, 23, 26, 31, 32}
NEVER_CLOSED_GATES = {1, 2}
FIVE_BAY_GATES = {8, 13, 17, 21, 25, 29, 34}
THREE_BAY_GATES = {2, 5, 37}
TWO_BAY_GATES = {3, 4, 10, 11, 32, 38, 39}


def load_mercator():
    txt = open(ANCHOR_SRC, encoding='utf-8').read()
    m = re.search(r'anchors:\s*\[\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]\]', txt)
    olng, olat = float(m.group(1)), float(m.group(2))
    R = 6_371_008.8
    C = 2 * math.pi * R
    mx = lambda lng: (180 + lng) / 360
    my = lambda lat: (180 - (180 / math.pi) * math.log(math.tan(math.pi / 4 + (lat * math.pi) / 360))) / 360
    lng_from_mx = lambda x: x * 360 - 180
    lat_from_my = lambda y: (360 / math.pi) * math.atan(math.exp(((180 - y * 360) * math.pi) / 180)) - 90
    omx, omy = mx(olng), my(olat)
    unit = (1 / C) * (1 / math.cos(math.radians(lat_from_my(omy))))
    to_m = lambda lng, lat: ((mx(lng) - omx) / unit, (my(lat) - omy) / unit)
    from_m = lambda east, south: (round(lng_from_mx(omx + east * unit), 7), round(lat_from_my(omy + south * unit), 7))
    return to_m, from_m


def mat4_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def trs_mat(nd):
    if 'matrix' in nd:
        return list(nd['matrix'])
    tx, ty, tz = nd.get('translation', [0, 0, 0])
    qx, qy, qz, qw = nd.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = nd.get('scale', [1, 1, 1])
    x2, y2, z2 = qx + qx, qy + qy, qz + qz
    xx, xy, xz = qx * x2, qx * y2, qx * z2
    yy, yz, zz = qy * y2, qy * z2, qz * z2
    wx, wy, wz = qw * x2, qw * y2, qw * z2
    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    ]


def xform(m, v):
    x, y, z = v
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def wall_outward(gate_id: int) -> tuple[int, int]:
    if gate_id in (1, 2) or (7 <= gate_id <= 14):
        return (-1, 0)
    if (28 <= gate_id <= 35) or gate_id in (40, 41):
        return (1, 0)
    if 15 <= gate_id <= 27:
        return (0, -1)
    return (0, 1)


def main():
    to_m, from_m = load_mercator()
    raw = open(GLB_PATH, 'rb').read()
    glb_sha256 = hashlib.sha256(raw).hexdigest()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + jlen])
    bin_data = raw[20 + jlen + 8 :]
    mats = gltf.get('materials', [])

    parents = {ch: ni for ni, nd in enumerate(gltf['nodes']) for ch in nd.get('children', [])}

    def world_mat(ni):
        m = trs_mat(gltf['nodes'][ni])
        p = parents.get(ni)
        while p is not None:
            m = mat4_mul(trs_mat(gltf['nodes'][p]), m)
            p = parents.get(p)
        return m

    def read_vec(acc_idx):
        acc = gltf['accessors'][acc_idx]
        bv = gltf['bufferViews'][acc['bufferView']]
        off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = bv.get('byteStride', 12)
        return [struct.unpack_from('<fff', bin_data, off + i * stride) for i in range(acc['count'])]

    def read_indices(prim):
        acc_i = gltf['accessors'][prim['indices']]
        bv_i = gltf['bufferViews'][acc_i['bufferView']]
        off_i = bv_i.get('byteOffset', 0) + acc_i.get('byteOffset', 0)
        ct = acc_i['componentType']
        dt = '<H' if ct == 5123 else '<I'
        sz = 2 if ct == 5123 else 4
        return [struct.unpack_from(dt, bin_data, off_i + k * sz)[0] for k in range(acc_i['count'])]

    def prim_components(ni, prim):
        wm = world_mat(ni)
        pts = [xform(wm, v) for v in read_vec(prim['attributes']['POSITION'])]
        idxs = read_indices(prim)
        adj = {k: set() for k in range(len(pts))}
        for k in range(0, len(idxs), 3):
            a, b, c = idxs[k], idxs[k + 1], idxs[k + 2]
            adj[a].update((b, c))
            adj[b].update((a, c))
            adj[c].update((a, b))
        seen, comps = set(), []
        for k in range(len(pts)):
            if k in seen:
                continue
            st, comp = [k], []
            seen.add(k)
            while st:
                u = st.pop()
                comp.append(pts[u])
                for v in adj[u]:
                    if v not in seen:
                        seen.add(v)
                        st.append(v)
            xs = [q[0] for q in comp]
            ys = [q[1] for q in comp]
            zs = [q[2] for q in comp]
            comps.append((min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
        return comps

    def prim_bbox(ni, prim):
        wm = world_mat(ni)
        pts = [xform(wm, v) for v in read_vec(prim['attributes']['POSITION'])]
        xs = [q[0] for q in pts]
        ys = [q[1] for q in pts]
        zs = [q[2] for q in pts]
        return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))

    # Extract key gateway primitives from haram-3d.glb
    plane002_nodes = []  # 5-bay monumental gateways
    deep_centers = {}    # DEEP node centers
    named_nodes = {}     # node_idx -> list of (mname, bbox)

    for ni, nd in enumerate(gltf['nodes']):
        if 'mesh' not in nd:
            continue
        mesh = gltf['meshes'][nd['mesh']]
        mname_mesh = mesh['name']
        entries = []
        for prim in mesh['primitives']:
            mname = mats[prim['material']]['name'] if 'material' in prim else ''
            if mname_mesh == 'Plane.002' and mname == 'Gate1':
                comps = [c for c in prim_components(ni, prim) if c[2] < 1.0 and c[3] > 3.0 and max(c[1] - c[0], c[5] - c[4]) > 2.0]
                plane002_nodes.append((ni, comps))
            if mname == 'DEEP':
                b = prim_bbox(ni, prim)
                deep_centers[ni] = ((b[0] + b[1]) / 2, (b[4] + b[5]) / 2)
            if mname in ('Gate1', 'GateR', 'Door3', 'Door5'):
                entries.append((mname, prim_bbox(ni, prim)))
        if entries:
            named_nodes[ni] = (mname_mesh, entries)

    # Match 7 monumental 5-bay nodes by centroid to Gates [8, 13, 17, 21, 25, 29, 34]
    pois = json.load(open(POIS_PATH, encoding='utf-8'))
    overrides = json.load(open(OVERRIDES_PATH, encoding='utf-8'))
    gate_pois = {}
    for p in pois:
        if p.get('subCategory') != 'gate_inner':
            continue
        lat, lng = p['lat'], p['lng']
        ov = overrides.get(str(p['id'])) or {}
        if 'n' in ov or 'e' in ov:
            lat += ov.get('n', 0) / 111320.0
            lng += ov.get('e', 0) / (111320.0 * math.cos(math.radians(lat)))
        gx, gz = to_m(lng, lat)
        gate_pois[p['id']] = (gx, gz, p['name_ar'])

    assert len(gate_pois) == 42, f'Expected 42 inner gates, got {len(gate_pois)}'

    bays_by_gate: dict[int, tuple[str, float, float, list[tuple[float, float]]]] = {}

    # 1. Monumental 5-bay gateways (Plane.002)
    for ni, comps in plane002_nodes:
        assert len(comps) == 5, f'Expected 5 bays on Plane.002 node {ni}, got {len(comps)}'
        centers = [((c[0] + c[1]) / 2, (c[4] + c[5]) / 2) for c in comps]
        mx_c = sum(c[0] for c in centers) / 5
        mz_c = sum(c[1] for c in centers) / 5
        gid = min(FIVE_BAY_GATES, key=lambda g: math.hypot(gate_pois[g][0] - mx_c, gate_pois[g][1] - mz_c))
        assert gid not in bays_by_gate
        centers.sort()
        bays_by_gate[gid] = ('monumental', 3.6, 5.5, centers)

    # 2. Triple-bay gateways (Gates 2, 5, 37)
    def node_center(ni, mat):
        for mname, b in named_nodes[ni][1]:
            if mname == mat:
                return ((b[0] + b[1]) / 2, (b[4] + b[5]) / 2)
        raise KeyError((ni, mat))

    # Gate 2: Old Mosque West wall (nodes 142, 143, 144 -> z ~ -96.57, -90.20, -83.72, x = -106.75)
    bays_by_gate[2] = ('old_mosque', 3.2, 5.4, sorted([(-106.75, node_center(n, 'GateR')[1]) for n in (142, 143, 144)]))
    # Gate 5: South Extension West (nodes 28, 26, 27 -> z = -113.58)
    bays_by_gate[5] = ('monumental', 3.5, 5.5, sorted([(node_center(n, 'Gate1')[0], -113.58) for n in (28, 26, 27)]))
    # Gate 37: South Extension East (nodes 31, 262, 30 -> z = -113.58)
    bays_by_gate[37] = ('monumental', 3.5, 5.5, sorted([(node_center(n, 'Gate1')[0], -113.58) for n in (31, 262, 30)]))

    # 3. Double-bay gateways (Gates 3, 4, 10, 11, 32, 38, 39)
    # Gate 3: Old Mosque West wall (nodes 146, 145 -> z = -109.42, -102.94, x = -106.75)
    bays_by_gate[3] = ('old_mosque', 3.2, 5.4, sorted([(-106.75, node_center(n, 'GateR')[1]) for n in (146, 145)]))
    # Gates 4, 38, 39: South wall Plane.061 / Plane.063 — flush with exterior South wall plane z = -121.40
    def two_sub_x(ni):
        comps = []
        for prim in gltf['meshes'][gltf['nodes'][ni]['mesh']]['primitives']:
            mname = mats[prim['material']]['name'] if 'material' in prim else ''
            if mname == 'Gate1':
                for c in prim_components(ni, prim):
                    if c[2] < 1.0 and 5.5 < c[3] < 7.0 and 2.5 < (c[1] - c[0]) < 3.5:
                        comps.append(((c[0] + c[1]) / 2, -121.40))
        assert len(comps) == 2, f'Expected 2 bays on node {ni}, got {comps}'
        return sorted(comps)

    bays_by_gate[4] = ('monumental', 3.0, 5.6, two_sub_x(25))
    bays_by_gate[38] = ('monumental', 3.0, 5.6, two_sub_x(166))
    bays_by_gate[39] = ('monumental', 3.0, 5.6, two_sub_x(165))
    # Gates 10, 11, 32: side walls snapped flush to haram-3d.glb exterior faces
    bays_by_gate[10] = ('arch', 3.0, 5.2, [(-252.13, -219.0), (-252.13, -213.0)])
    bays_by_gate[11] = ('arch', 3.0, 5.2, [(-263.02, -245.5), (-263.02, -239.5)])
    bays_by_gate[32] = ('arch', 3.0, 5.2, [(132.29, -219.8), (132.29, -213.8)])

    # 4. Single-bay archways (remaining 25 gates)
    deep_gate_nodes = {
        1: 162, 7: 18, 9: 16, 12: 15, 14: 17, 16: 13, 18: 9,
        20: 11, 22: 12, 24: 10, 26: 14, 28: 39, 30: 36, 33: 37, 35: 38,
    }
    for gid, ni in deep_gate_nodes.items():
        style = 'old_mosque' if gid == 1 else 'arch'
        w = 3.2 if gid == 1 else 3.4
        h = 5.2 if gid == 1 else 5.6
        bays_by_gate[gid] = (style, w, h, [deep_centers[ni]])

    # Plane.004 north recess portals: Gates 19, 23
    bays_by_gate[19] = ('arch', 3.1, 5.4, [node_center(7, 'Gate1')])
    bays_by_gate[23] = ('arch', 3.1, 5.4, [node_center(8, 'Gate1')])

    # Old Mosque East & South portals: Gates 40, 41, 42
    c40 = node_center(156, 'Door3')
    c41 = node_center(156, 'Door5')
    bays_by_gate[40] = ('old_mosque', 2.6, 4.8, [(-13.62, c40[1])])
    bays_by_gate[41] = ('old_mosque', 3.2, 5.0, [(-12.85, c41[1])])
    bays_by_gate[42] = ('old_mosque', 3.2, 5.0, [(-62.70, -57.64)])

    # Flat-wall numbered gates: 6, 15, 27, 31, 36
    bays_by_gate[6] = ('arch', 3.0, 5.2, [(-230.60, -121.40)])
    bays_by_gate[15] = ('arch', 3.0, 5.2, [(-228.30, -343.12)])
    bays_by_gate[27] = ('arch', 3.0, 5.2, [(104.30, -343.12)])
    bays_by_gate[31] = ('arch', 3.0, 5.2, [(143.18, -243.40)])
    bays_by_gate[36] = ('arch', 3.0, 5.2, [(103.60, -121.40)])

    assert set(bays_by_gate.keys()) == set(range(1, 43)), 'Missing or extra gate IDs!'

    # Assert bay counts match owner rules and check minimum inter-bay distance (>= 2.5 m)
    all_bay_pts = []
    gates_out = []
    for gid in range(1, 43):
        style, w, h, centers = bays_by_gate[gid]
        if gid in FIVE_BAY_GATES:
            expected_total, default_open = 5, 2
        elif gid in THREE_BAY_GATES:
            expected_total, default_open = 3, 2
        elif gid in TWO_BAY_GATES:
            expected_total = 2
            default_open = 0 if gid in ALWAYS_CLOSED_GATES else 1
        else:
            expected_total = 1
            default_open = 0 if gid in ALWAYS_CLOSED_GATES else 1
        assert len(centers) == expected_total, f'Gate {gid} expected {expected_total} bays, got {len(centers)}'

        ox, oz = wall_outward(gid)
        # Right-handed tangent T such that T x (+Y) = outward: T = [oz, -ox]
        tx, tz = oz, -ox
        cx = sum(p[0] for p in centers) / len(centers)
        cz = sum(p[1] for p in centers) / len(centers)
        glng, glat = from_m(cx, cz)

        bays_out = []
        for idx, (bx, bz) in enumerate(centers):
            for og, oi, ox2, oz2 in all_bay_pts:
                d = math.hypot(bx - ox2, bz - oz2)
                assert d >= 2.5, f'Overlap between gate {gid} bay {idx} and gate {og} bay {oi}: {d:.2f}m'
            all_bay_pts.append((gid, idx, bx, bz))
            blng, blat = from_m(bx, bz)
            bays_out.append({
                'bayIndex': idx,
                'x': round(bx, 3),
                'z': round(bz, 3),
                'lng': blng,
                'lat': blat,
                'widthM': w,
                'heightM': h,
            })

        gates_out.append({
            'id': gid,
            'style': style,
            'totalBays': expected_total,
            'defaultOpenBays': default_open,
            'x': round(cx, 3),
            'z': round(cz, 3),
            'lng': glng,
            'lat': glat,
            'outward': [ox, oz],
            'tangent': [tx, tz],
            'bays': bays_out,
        })

    doc = {
        'source': {
            'what': "Exact 3D doorway bay coordinates for all 42 inner Mosque gates extracted from haram-3d.glb with owner-approved bay counts and partial-open defaults (2026-11-20)",
            'haram3dSha256': glb_sha256,
            'generatedBy': 'scripts/build-mosque-doors-data.py',
        },
        'gates': gates_out,
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')

    print(f'wrote {OUT_PATH}: gates={len(gates_out)}, totalBays={len(all_bay_pts)}, bytes={os.path.getsize(OUT_PATH)}')


if __name__ == '__main__':
    main()
