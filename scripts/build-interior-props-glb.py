"""
The Mosque's interior props (owner, 2026-11-18: "the columns and the Mosque's inside, very
professionally"), built in Blender as one prototype each; the 3D layer stands them where the
interior plan puts them (src/domain/interior-floor.ts), so the file stays small:

  InteriorColumn      white marble shaft on an octagonal plinth with its Qur'an shelves, the brass
                      air vent collar, a gilded capital and the stone impost the arches spring from
  ColumnLanterns      the four brass lanterns on the impost's faces
  InteriorArch        a striped (ablaq) arch, dark and cream voussoirs, and the cream wall above it
                      up to the ceiling, spanning one bay (`--pitch`, the column grid's step)
  InteriorChandelier  a brass ring of lamps with a lantern at its heart, hung in a bay

As the owner's photographs show them (صور مراجع/, 2026-11-14 and 2026-11-18). Metres; Blender
X east, Y north, Z up; glTF (export_yup) X east, Y up, Z south, like navQ's models.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-interior-props-glb.py -- --pitch 18
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_GLB = ROOT / "public" / "models" / "haram-interior-props.glb"

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PITCH = float(argv[argv.index("--pitch") + 1]) if "--pitch" in argv else 18.0

# Heights (m): the impost tops the column at SPRING; the flat ceiling of the halls at CEILING.
SPRING = 7.55
CEILING = 12.4
IMPOST_W = 1.5


def material(name: str, rgba, metallic=0.0, roughness=0.6):
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m


MATS: dict = {}


def make_materials() -> None:
    MATS.update(
        {
            "columnMarble": material("columnMarble", (0.93, 0.92, 0.89, 1), 0.0, 0.25),
            "shelfBooks": material("shelfBooks", (0.30, 0.34, 0.26, 1), 0.0, 0.8),
            "brass": material("brass", (0.72, 0.55, 0.28, 1), 1.0, 0.35),
            "gold": material("gold", (0.86, 0.68, 0.32, 1), 1.0, 0.3),
            "impostStone": material("impostStone", (0.62, 0.62, 0.6, 1), 0.0, 0.7),
            "archDark": material("archDark", (0.17, 0.18, 0.19, 1), 0.0, 0.45),
            "archLight": material("archLight", (0.92, 0.89, 0.82, 1), 0.0, 0.45),
            "archSpandrel": material("archSpandrel", (0.88, 0.84, 0.76, 1), 0.0, 0.6),
            "glassLamp": material("glassLamp", (1.0, 0.92, 0.72, 1), 0.0, 0.2),
        }
    )


class Builder:
    """Faces with their materials, gathered into one mesh object."""

    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.mats: list[str] = []

    def _mi(self, mat: str) -> int:
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def face(self, pts, mat):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self._mi(mat)
        return f

    def frustum(self, n, r0, r1, z0, z1, mat, rot=0.0, cx=0.0, cy=0.0):
        """An n-sided prism or frustum standing on the ground plane, capped both ends."""
        a = [rot + 2 * math.pi * i / n for i in range(n)]
        bot = [(cx + r0 * math.cos(t), cy + r0 * math.sin(t), z0) for t in a]
        top = [(cx + r1 * math.cos(t), cy + r1 * math.sin(t), z1) for t in a]
        for i in range(n):
            j = (i + 1) % n
            self.face([bot[i], bot[j], top[j], top[i]], mat)
        self.face(list(reversed(bot)), mat)
        self.face(top, mat)

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        bot = [(x, y, z0) for x, y in c]
        top = [(x, y, z1) for x, y in c]
        for i in range(4):
            j = (i + 1) % 4
            self.face([bot[i], bot[j], top[j], top[i]], mat)
        self.face(list(reversed(bot)), mat)
        self.face(top, mat)

    def finish(self, extras: dict | None = None):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(MATS[m])
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        for k, v in (extras or {}).items():
            obj[k] = v
        return obj


def column():
    b = Builder("InteriorColumn")
    oct_rot = math.pi / 8
    b.frustum(8, 0.82, 0.82, 0.0, 1.15, "columnMarble", oct_rot)  # the plinth
    b.frustum(8, 0.835, 0.835, 0.28, 0.92, "shelfBooks", oct_rot)  # its Qur'an shelves
    b.frustum(8, 0.88, 0.88, 1.15, 1.22, "columnMarble", oct_rot)  # its cap
    b.frustum(24, 0.5, 0.5, 1.22, 1.5, "brass", 0)  # the air vent collar
    b.frustum(24, 0.42, 0.42, 1.5, 5.9, "columnMarble", 0)  # the shaft
    b.frustum(24, 0.46, 0.46, 5.9, 6.02, "gold", 0)  # the neck ring
    b.frustum(24, 0.46, 0.74, 6.02, 6.85, "gold", 0)  # the gilded capital
    h = IMPOST_W / 2
    b.box(-h - 0.03, h + 0.03, -h - 0.03, h + 0.03, 6.85, 6.97, "gold")  # gilded band
    b.box(-h, h, -h, h, 6.97, SPRING, "impostStone")  # the impost
    b.finish({"spring": SPRING})


def lanterns():
    b = Builder("ColumnLanterns")
    off = IMPOST_W / 2 + 0.2
    for dx, dy in ((off, 0), (-off, 0), (0, off), (0, -off)):
        b.box(dx - 0.16, dx + 0.16, dy - 0.16, dy + 0.16, 6.98, 7.42, "glassLamp")
        b.box(dx - 0.19, dx + 0.19, dy - 0.19, dy + 0.19, 6.92, 6.98, "brass")
        b.frustum(4, 0.27, 0.05, 7.42, 7.62, "brass", math.pi / 4, dx, dy)
    b.finish()


def arch():
    """One bay's striped arch along X, from impost to impost, and the wall over it to the ceiling."""
    b = Builder("InteriorArch")
    a = (PITCH - IMPOST_W) / 2  # half the clear span
    rise = min(a, CEILING - SPRING - 1.0)
    ring = 0.8  # depth of the voussoirs (intrados to extrados)
    d = 0.5  # half the arch's thickness through the wall
    n = 21
    intra = lambda t: (a * math.cos(t), SPRING + rise * math.sin(t))
    extra = lambda t: ((a + ring) * math.cos(t), SPRING + (rise + ring) * math.sin(t))
    for i in range(n):
        t0, t1 = math.pi * i / n, math.pi * (i + 1) / n
        mat = "archDark" if i % 2 == 0 else "archLight"
        (x0, z0), (x1, z1) = intra(t0), intra(t1)
        (X0, Z0), (X1, Z1) = extra(t0), extra(t1)
        for y in (-d, d):  # the two faces
            pts = [(x0, y, z0), (x1, y, z1), (X1, y, Z1), (X0, y, Z0)]
            b.face(pts if y > 0 else list(reversed(pts)), mat)
        b.face([(x0, -d, z0), (x1, -d, z1), (x1, d, z1), (x0, d, z0)], mat)  # the soffit
    # The wall over the arch: from the extrados up to the ceiling, the whole pitch wide.
    w = PITCH / 2
    m = 24
    top = CEILING
    for i in range(m):
        t0, t1 = math.pi * i / m, math.pi * (i + 1) / m
        (X0, Z0), (X1, Z1) = extra(t0), extra(t1)
        for y in (-d * 0.8, d * 0.8):
            pts = [(X0, y, Z0), (X1, y, Z1), (X1, y, top), (X0, y, top)]
            b.face(list(reversed(pts)) if y > 0 else pts, "archSpandrel")
    for sx in (-1, 1):  # the haunches out to the imposts' centres
        X = sx * (a + ring)
        for y in (-d * 0.8, d * 0.8):
            pts = [(X, y, SPRING), (sx * w, y, SPRING), (sx * w, y, top), (X, y, top)]
            b.face(pts if (y > 0) == (sx > 0) else list(reversed(pts)), "archSpandrel")
    b.box(-w, w, -d * 0.8, d * 0.8, top - 0.05, top, "archSpandrel")  # the soffit of the ceiling beam
    b.finish({"pitch": PITCH, "spring": SPRING, "ceiling": CEILING})


def chandelier():
    b = Builder("InteriorChandelier")
    b.box(-0.04, 0.04, -0.04, 0.04, 9.9, CEILING, "brass")  # its rod
    n = 48
    for i in range(n):  # the ring, a band of brass
        t0, t1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for r0, r1 in ((2.05, 2.05), (1.9, 1.9)):
            p0 = (r0 * math.cos(t0), r0 * math.sin(t0))
            p1 = (r1 * math.cos(t1), r1 * math.sin(t1))
            b.face([(p0[0], p0[1], 9.2), (p1[0], p1[1], 9.2), (p1[0], p1[1], 9.34), (p0[0], p0[1], 9.34)], "brass")
    for i in range(24):  # its lamps
        t = 2 * math.pi * i / 24
        x, y = 1.98 * math.cos(t), 1.98 * math.sin(t)
        b.frustum(6, 0.09, 0.09, 9.34, 9.56, "glassLamp", 0, x, y)
    b.frustum(8, 0.32, 0.32, 9.1, 9.85, "glassLamp", 0)  # the lantern at its heart
    b.frustum(8, 0.36, 0.08, 9.85, 10.05, "brass", 0)
    b.frustum(8, 0.08, 0.36, 8.95, 9.1, "brass", 0)
    for i in range(4):  # arms from the heart to the ring
        t = math.pi * i / 2
        c, s = math.cos(t), math.sin(t)
        b.face([(0.3 * c - 0.04 * s, 0.3 * s + 0.04 * c, 9.3), (1.92 * c - 0.04 * s, 1.92 * s + 0.04 * c, 9.3), (1.92 * c + 0.04 * s, 1.92 * s - 0.04 * c, 9.3), (0.3 * c + 0.04 * s, 0.3 * s - 0.04 * c, 9.3)], "brass")
    b.finish()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    column()
    lanterns()
    arch()
    chandelier()
    OUTPUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_GLB),
        export_format="GLB",
        export_yup=True,
        export_extras=True,
        export_apply=True,
        export_draco_mesh_compression_enable=False,
    )
    print("wrote", OUTPUT_GLB, OUTPUT_GLB.stat().st_size, "bytes")


main()
