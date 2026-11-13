"""Blender (bpy) environment renderer: a multi-category scene -> one aggregated GLB.

Run headless:
  Blender --background --python scripts/build-environment-glb.py -- [scene.json] [output.glb]

Categories (all optional): ground, streets, paths, trees, buildings, lighting.
  ground    {sizeM, color?}                       a flat plane at y=0
  streets   [{id, widthM, path:[[lng,lat],...]}]  lines -> flat asphalt ribbons
  paths     [{id, widthM, path:[[lng,lat],...]}]  lines -> pedestrian ribbons
  trees     [{id, pos:[lng,lat], heightM?, canopyM?}]  points -> instanced low-poly trees
  buildings [{id, kind, heightM, footprint:[[lng,lat],...], approved?}]  polygons -> prisms
  lighting  {preset:"day"|"night"}                tints the ground; drives preview renders

ZERO GUESSING (owner, 2026-11-04 / 2026-11-10): buildings are modelled only when the scene is
explicitly meta.synthetic (a labelled demo, never shipped) OR each record carries approved:true
with a finite heightM>0. Unapproved real buildings are dropped, never estimated. Streets, paths,
trees and ground are drawn from whatever verified data the caller passes; this tool invents no
geography of its own.

The mesh frame matches every other glTF the map draws (glb-layer.ts): X=East, Y=Up, Z=South, in
Web-Mercator metres about the Mosque anchor ORIGIN, exported with export_yup=False. Lighting here
only tones the scene and its Blender preview; the live map lights models via src/map/scene-light.ts.
"""
import json
import math
import os
import sys
import tempfile

import bmesh
import bpy

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_IN = os.path.join(REPO, "scripts", "environment-scene.example.json")
# The no-argument run renders the labelled synthetic example to a scratch path, never into the
# shipped public/models directory. Real verified data may be exported there explicitly.
DEFAULT_OUT = os.path.join(tempfile.gettempdir(), "environment-demo.glb")
SHIPPED_DIR = os.path.join(REPO, "public", "models")

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
KIND_INDEX = {v: k for k, v in KIND_NAME.items()}

# Ground tone by lighting preset (the live map uses scene-light.ts; this is for the GLB/preview).
GROUND_DAY = (0.78, 0.72, 0.62)
GROUND_NIGHT = (0.10, 0.11, 0.16)
STREET_COLOR = (0.30, 0.30, 0.32)
PATH_COLOR = (0.62, 0.58, 0.50)
TRUNK_COLOR = (0.42, 0.32, 0.24)
CANOPY_COLOR = (0.36, 0.52, 0.34)

NOMINAL_TREE_HEIGHT = 8.0
NOMINAL_TREE_CANOPY = 4.0


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


def material(name, color, roughness=0.85):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def mesh_object(name, bm, mats):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    for m in mats:
        obj.data.materials.append(m)
    return link(obj)


def add_ground(size, color):
    h = size / 2.0
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-h, 0, -h), (h, 0, -h), (h, 0, h), (-h, 0, h))]
    bm.faces.new(v)
    return mesh_object("ground", bm, [material("ground", color, 0.95)])


def ribbon_points(path_es, width, y):
    half = width / 2.0
    n = len(path_es)
    left, right = [], []
    for i, (e, s) in enumerate(path_es):
        if i == 0:
            de, ds = path_es[1][0] - e, path_es[1][1] - s
        elif i == n - 1:
            de, ds = e - path_es[i - 1][0], s - path_es[i - 1][1]
        else:
            de, ds = path_es[i + 1][0] - path_es[i - 1][0], path_es[i + 1][1] - path_es[i - 1][1]
        length = math.hypot(de, ds) or 1.0
        pe, ps = -ds / length * half, de / length * half
        left.append((e + pe, y, s + ps))
        right.append((e - pe, y, s - ps))
    return left, right


def add_ribbons(name, lines, width_default, color, y):
    bm = bmesh.new()
    count = 0
    for idx, line in enumerate(lines):
        path = line.get("path") or []
        if len(path) < 2:
            continue
        path_es = [metres(ll[0], ll[1]) for ll in path]
        width = float(line.get("widthM", width_default))
        # Stagger each ribbon's height so crossing lines never share a plane (no depth fighting).
        left, right = ribbon_points(path_es, width, y + idx * 0.02)
        lv = [bm.verts.new(p) for p in left]
        rv = [bm.verts.new(p) for p in right]
        for i in range(len(path_es) - 1):
            bm.faces.new((lv[i], lv[i + 1], rv[i + 1], rv[i]))
        count += 1
    if not count:
        bm.free()
        return None
    return mesh_object(name, bm, [material(name, color, 0.9)])


def add_prism(bm, ring, height):
    n = len(ring)
    bottom = [bm.verts.new((e, 0.0, s)) for e, s in ring]
    top = [bm.verts.new((e, height, s)) for e, s in ring]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.faces.new(tuple(reversed(top)))
    bm.faces.new(tuple(bottom))


def clean_ring(footprint):
    ring = list(footprint)
    if ring and ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring


def select_buildings(scene):
    """Zero guessing: a labelled synthetic demo, or only approved records with a verified height."""
    synthetic = bool((scene.get("meta") or {}).get("synthetic"))
    kept, dropped = [], []
    for b in scene.get("buildings") or []:
        height = b.get("heightM")
        ring = clean_ring(b.get("footprint") or [])
        ok = len(ring) >= 3 and isinstance(height, (int, float)) and height > 0
        if not synthetic and b.get("approved") is not True:
            ok = False
        if not ok:
            dropped.append(str(b.get("id", "?")))
            continue
        kind = b.get("kind", 0)
        kind = KIND_INDEX.get(kind, kind if isinstance(kind, int) else 0)
        kept.append(
            {
                "id": str(b.get("id", "")),
                "kind": kind if kind in KIND_BASE else 0,
                "height": float(height),
                "ring": [metres(ll[0], ll[1]) for ll in ring],
            }
        )
    return kept, dropped, synthetic


def add_buildings(buildings):
    by_kind = {}
    for b in buildings:
        by_kind.setdefault(b["kind"], []).append(b)
    objs = []
    for kind, group in sorted(by_kind.items()):
        bm = bmesh.new()
        for b in group:
            add_prism(bm, b["ring"], b["height"])
        name = "building-%s" % KIND_NAME.get(kind, "context")
        objs.append(mesh_object(name, bm, [material(name, KIND_BASE.get(kind, KIND_BASE[0]))]))
    return objs


def make_tree_mesh():
    """One low-poly tree (trunk + canopy) shared by every instance; two materials by face."""
    bm = bmesh.new()
    trunk_h = NOMINAL_TREE_HEIGHT * 0.45
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=6,
        radius1=NOMINAL_TREE_CANOPY * 0.10, radius2=NOMINAL_TREE_CANOPY * 0.07, depth=trunk_h,
    )
    for v in bm.verts:
        v.co.y += trunk_h / 2.0
    trunk_faces = set(bm.faces)
    before = set(bm.verts)
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=NOMINAL_TREE_CANOPY * 0.5)
    cy = trunk_h + NOMINAL_TREE_CANOPY * 0.35
    for v in bm.verts:
        if v not in before:
            v.co.y += cy
    for f in bm.faces:
        f.material_index = 0 if f in trunk_faces else 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("tree")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material("tree-trunk", TRUNK_COLOR, 0.9))
    mesh.materials.append(material("tree-canopy", CANOPY_COLOR, 0.9))
    return mesh


def add_trees(trees):
    pts = []
    for t in trees:
        pos = t.get("pos")
        if not pos or len(pos) != 2:
            continue
        pts.append((metres(pos[0], pos[1]), float(t.get("heightM", NOMINAL_TREE_HEIGHT))))
    if not pts:
        return []
    mesh = make_tree_mesh()
    objs = []
    for i, ((e, s), height) in enumerate(pts):
        obj = bpy.data.objects.new("tree-%03d" % i, mesh)  # shared mesh -> glTF instances
        obj.location = (e, 0.0, s)
        obj.scale = (height / NOMINAL_TREE_HEIGHT,) * 3
        objs.append(link(obj))
    return objs


def build(scene, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    preset = (scene.get("lighting") or {}).get("preset", "day")
    night = preset == "night"
    counts = {}

    ground = scene.get("ground")
    if ground:
        color = ground.get("color") or (GROUND_NIGHT if night else GROUND_DAY)
        add_ground(float(ground.get("sizeM", 600)), color)
        counts["ground"] = 1

    # Ribbons sit slightly above the ground (and paths above streets) to avoid depth fighting at
    # city scale, where a couple of centimetres is below the depth buffer's precision.
    streets = add_ribbons("street", scene.get("streets") or [], 12.0, STREET_COLOR, 0.10)
    if streets:
        counts["streets"] = len(scene.get("streets") or [])
    paths = add_ribbons("path", scene.get("paths") or [], 3.0, PATH_COLOR, 0.25)
    if paths:
        counts["paths"] = len(scene.get("paths") or [])

    trees = add_trees(scene.get("trees") or [])
    if trees:
        counts["trees"] = len(trees)

    buildings, dropped, synthetic = select_buildings(scene)
    if buildings:
        add_buildings(buildings)
        counts["buildings"] = len(buildings)

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        export_materials="EXPORT",
        use_selection=False,
    )
    return counts, dropped, synthetic


def main():
    inp, out = argv()
    if not os.path.exists(inp):
        print("ENV_GLB no scene: %s (nothing written)" % inp)
        return
    with open(inp, encoding="utf-8") as fh:
        scene = json.load(fh)
    synthetic = bool((scene.get("meta") or {}).get("synthetic"))
    out_real = os.path.realpath(out)
    if synthetic and (out_real == SHIPPED_DIR or out_real.startswith(SHIPPED_DIR + os.sep)):
        print("ENV_GLB refused: a synthetic demo must not be written into public/models (shipped). "
              "Choose a scratch output path. Nothing written.")
        return
    counts, dropped, synthetic = build(scene, out)
    if not counts:
        if os.path.exists(out):
            os.remove(out)
        print("ENV_GLB empty: no geometry; nothing written (%s)" % out)
        return
    label = (scene.get("meta") or {}).get("label", "")
    tag = "SYNTHETIC DEMO (not real geography)" if synthetic else "verified data"
    summary = ", ".join("%s=%d" % (k, v) for k, v in sorted(counts.items()))
    print("ENV_GLB ok [%s]: %s -> %s" % (tag, summary, out))
    if label:
        print("  label: %s" % label)
    if dropped:
        print("  dropped unapproved/invalid buildings: %s" % ", ".join(dropped))


main()