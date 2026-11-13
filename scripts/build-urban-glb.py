"""Blender (bpy) pipeline: approved urban GeoJSON -> one aggregated GLB of building massing.

Run headless:  Blender --background --python scripts/build-urban-glb.py -- [input.json] [output.glb]
Defaults: public/models/urban-3d.json -> public/models/urban-3d.glb (repo-root relative).

Reads ONLY the validated, owner-approved collection produced by scripts/build-urban-3d.mjs.
With no approved buildings it writes no geometry (and clears a stale output of its own), so the
zero-guessing rule holds: nothing is modelled that the owner has not approved.

The mesh frame matches every other glTF the map draws (glb-layer.ts): X=East, Y=Up, Z=South,
in Web-Mercator metres about the Mosque anchor ORIGIN. Exported with export_yup=False so the
Blender axes are stored as-is and line up with that frame.
"""
import json
import math
import os
import sys

import bmesh
import bpy

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_IN = os.path.join(REPO, "public", "models", "urban-3d.json")
DEFAULT_OUT = os.path.join(REPO, "public", "models", "urban-3d.glb")

# The Mosque anchor every glTF node is drawn about (glb-layer.ts ORIGIN).
ORIGIN = (39.611752, 24.466806)
EARTH_CIRCUMFERENCE = 2 * math.pi * 6378137.0

# Warm stone per kind, the same base palette as src/map/urban-layer.ts (KIND_BASE).
KIND_BASE = {
    0: (0.80, 0.73, 0.62),  # context: granite beige
    1: (0.86, 0.79, 0.67),  # hotel: sandstone
    2: (0.82, 0.67, 0.54),  # food: terracotta
    3: (0.70, 0.76, 0.66),  # landmark: muted green
}
KIND_NAME = {0: "context", 1: "hotel", 2: "food", 3: "landmark"}


def merc_x(lng):
    return (180.0 + lng) / 360.0


def merc_y(lat):
    return (180.0 - (180.0 / math.pi * math.log(math.tan(math.pi / 4 + lat * math.pi / 360)))) / 360.0


def lat_from_merc_y(y):
    y2 = 180.0 - y * 360.0
    return 360.0 / math.pi * math.atan(math.exp(y2 * math.pi / 180)) - 90.0


_OX, _OY = merc_x(ORIGIN[0]), merc_y(ORIGIN[1])
_PER_METRE = (1.0 / EARTH_CIRCUMFERENCE) * (1.0 / math.cos(math.radians(lat_from_merc_y(_OY))))


def metres(lng, lat):
    """[east, south] Web-Mercator metres from the anchor, exactly as glb-layer.metresFromOrigin."""
    return ((merc_x(lng) - _OX) / _PER_METRE, (merc_y(lat) - _OY) / _PER_METRE)


def argv():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    inp = args[0] if len(args) > 0 else DEFAULT_IN
    out = args[1] if len(args) > 1 else DEFAULT_OUT
    return inp, out


def load_buildings(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    out = []
    for feat in data.get("features", []):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        height = props.get("height")
        if geom.get("type") != "Polygon" or not isinstance(height, (int, float)) or height <= 0:
            continue
        ring = geom["coordinates"][0]
        if ring and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        out.append(
            {
                "id": str(props.get("id", feat.get("id", ""))),
                "kind": int(props.get("kind", 0)),
                "height": float(height),
                "ring": [metres(ll[0], ll[1]) for ll in ring],
            }
        )
    return out


def stone_material(kind):
    name = "urban-%s" % KIND_NAME.get(kind, "context")
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    r, g, b = KIND_BASE.get(kind, KIND_BASE[0])
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    return mat


def add_prism(bm, ring, height):
    n = len(ring)
    base = len(bm.verts)
    bottom = [bm.verts.new((e, 0.0, s)) for e, s in ring]
    top = [bm.verts.new((e, height, s)) for e, s in ring]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.faces.new(tuple(reversed(top)))
    bm.faces.new(tuple(bottom))
    return base


def build(buildings, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    by_kind = {}
    for b in buildings:
        by_kind.setdefault(b["kind"], []).append(b)
    total_verts = 0
    for kind, group in sorted(by_kind.items()):
        bm = bmesh.new()
        for b in group:
            add_prism(bm, b["ring"], b["height"])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new("urban-%s" % KIND_NAME.get(kind, "context"))
        bm.to_mesh(mesh)
        bm.free()
        total_verts += len(mesh.vertices)
        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.data.materials.append(stone_material(kind))
        bpy.context.collection.objects.link(obj)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        export_materials="EXPORT",
        use_selection=False,
    )
    return total_verts


def main():
    inp, out = argv()
    buildings = load_buildings(inp)
    if not buildings:
        # No approvals: ship no massing. Clear only our own previous output, never other files.
        if os.path.exists(out):
            os.remove(out)
        print("URBAN_GLB empty: 0 approved buildings; no geometry written (%s)" % out)
        return
    verts = build(buildings, out)
    print(
        "URBAN_GLB ok: %d buildings, %d kinds, %d verts -> %s"
        % (len(buildings), len({b['kind'] for b in buildings}), verts, out)
    )


main()