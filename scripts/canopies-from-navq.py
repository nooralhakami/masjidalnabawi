"""Seed data/canopies.json, where each courtyard canopy and lamp post of the 3D view stands.

  python3 scripts/canopies-from-navq.py

Reads navQ's canopies file (public/models/haram-canopies.glb, placed at its anchor and turned 1°
clockwise, as src/data-next/alharamain-3d.ts does) and writes every node's centre on the ground:

  {"umbrellas": [[lng, lat], ...], "lamps": [[lng, lat], ...]}

umbrellas: navQ's open and folded canopies (meshes with "Canopy" in the node name and their fabric);
lamps: the short lamp posts (the mesh without fabric). Seven decimals: about a centimetre.

This is only a starting point: the owner corrects it on the satellite imagery with canopies.html
(owner, 2026-11-05: navQ's canopies stand in the wrong places and in the wrong numbers). Do not
re-run it once the owner has edited the file, or his positions are lost.
"""
import json, math, struct

GLB = 'public/models/haram-canopies.glb'
ANCHOR = (39.611732, 24.4668)  # the canopies file's anchor (alharamain-3d.ts)
ROTATION = 1  # degrees clockwise seen from above (threeDRotation)
R = 6378137.0


def main():
    b = open(GLB, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    g = json.loads(b[20:20 + n])
    fabric = {i for i, m in enumerate(g['materials']) if m.get('name') == 'uMB' or m.get('name') == 'steel.001'}
    with_fabric = {i for i, m in enumerate(g['meshes']) if any(p.get('material') in fabric for p in m['primitives'])}

    lng0, lat0 = map(math.radians, ANCHOR)
    y0 = math.log(math.tan(math.pi / 4 + lat0 / 2))
    scale = 1 / math.cos(lat0)  # Mercator metres per real metre at the anchor
    t = math.radians(ROTATION)
    out = {'umbrellas': [], 'lamps': []}
    for node in g['nodes']:
        if 'mesh' not in node:
            continue
        x, _, z = node.get('translation', [0, 0, 0])
        east = x * math.cos(t) - z * math.sin(t)
        south = x * math.sin(t) + z * math.cos(t)
        lng = math.degrees(lng0 + east * scale / R)
        lat = math.degrees(2 * math.atan(math.exp(y0 - south * scale / R)) - math.pi / 2)
        out['umbrellas' if node['mesh'] in with_fabric else 'lamps'].append([round(lng, 7), round(lat, 7)])
    with open('data/canopies.json', 'w') as f:
        f.write('{"umbrellas":[\n' + ',\n'.join(json.dumps(p) for p in out['umbrellas']) + '\n],"lamps":[\n' + ',\n'.join(json.dumps(p) for p in out['lamps']) + '\n]}\n')
    print(len(out['umbrellas']), 'umbrellas,', len(out['lamps']), 'lamps')


if __name__ == '__main__':
    main()
