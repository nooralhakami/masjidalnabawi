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
  OttomanColumn       white marble column of the Rawdah & old Mosque with gilded lower cladding
  OttomanChandelier   vertical gilded Ottoman chandelier with white-and-blue hanging glass lamps
  ChamberGrille       1 m exterior-only unit of the Sacred Chamber's golden grille & green plaque
                      (completely solid opaque back — respectful, zero interior depiction)
  SalamRail           1 m unit of the low gilded brass railing along the Greeting Passage
  ProphetMinbar       the Prophetic Pulpit with gilded stairs and emerald conical canopy
  ProphetMihrab       the Prophetic Mihrab in inlaid black/white marble with gilded crown
  WomenWoodPartition  1 m unit of the warm teak wooden partition separating women's prayer areas

As the owner's photographs show them (~/Desktop/ملحقات المجلد المركزي/خريطة المسجد النبوي/صور مراجع/, 2026-11-14 and 2026-11-18). Metres; Blender
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
            "chamberEmerald": material("chamberEmerald", (0.06, 0.25, 0.14, 1), 0.0, 0.35),
            "chamberDark": material("chamberDark", (0.05, 0.07, 0.06, 1), 0.2, 0.65),
            "chamberSolid": material("chamberSolid", (0.04, 0.14, 0.09, 1), 0.0, 0.8),
            "ottomanBlue": material("ottomanBlue", (0.12, 0.28, 0.62, 1), 0.0, 0.3),
            "ottomanMarble": material("ottomanMarble", (0.96, 0.95, 0.91, 1), 0.0, 0.22),
            "teakWood": material("teakWood", (0.48, 0.30, 0.14, 1), 0.0, 0.55),
            "woodDark": material("woodDark", (0.33, 0.20, 0.09, 1), 0.0, 0.6),
            "woodLight": material("woodLight", (0.60, 0.41, 0.21, 1), 0.0, 0.5),
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


def ottoman_column():
    """White Ottoman column of the Rawdah and old Mosque with gilded lower cladding (photo 07)."""
    b = Builder("OttomanColumn")
    oct_rot = math.pi / 8
    b.frustum(8, 0.56, 0.56, 0.0, 0.72, "ottomanMarble", oct_rot)  # base plinth
    b.frustum(8, 0.575, 0.575, 0.14, 0.58, "archDark", oct_rot)  # inlaid dark base panels
    b.frustum(8, 0.58, 0.58, 0.72, 0.80, "gold", oct_rot)  # lower gold trim ring
    b.frustum(8, 0.54, 0.54, 0.80, 2.52, "ottomanMarble", oct_rot)  # paneled lower cladding
    # Vertical gilded border ribs around the octagonal cladding
    for i in range(8):
        a = oct_rot + 2 * math.pi * i / 8
        rx, ry = 0.545 * math.cos(a), 0.545 * math.sin(a)
        b.box(rx - 0.025, rx + 0.025, ry - 0.025, ry + 0.025, 0.82, 2.52, "gold")
    b.frustum(8, 0.565, 0.565, 1.56, 1.80, "chamberDark", oct_rot)  # dark medallion band
    b.frustum(8, 0.57, 0.57, 1.53, 1.56, "gold", oct_rot)
    b.frustum(8, 0.57, 0.57, 1.80, 1.83, "gold", oct_rot)
    b.frustum(12, 0.56, 0.60, 2.52, 2.84, "gold", 0)  # scalloped gilded crown collar
    b.frustum(20, 0.40, 0.40, 2.84, 5.90, "ottomanMarble", 0)  # smooth white marble shaft
    b.frustum(20, 0.44, 0.44, 5.90, 6.02, "gold", 0)  # neck ring
    b.frustum(16, 0.44, 0.70, 6.02, 6.88, "gold", 0)  # ornate gilded Ottoman capital
    h = 0.68
    b.box(-h - 0.03, h + 0.03, -h - 0.03, h + 0.03, 6.88, 7.00, "gold")
    b.box(-h, h, -h, h, 7.00, SPRING, "ottomanMarble")
    b.finish({"style": "ottoman"})


def ottoman_chandelier():
    """Vertical gilded Ottoman chandelier with white-and-cobalt hanging glass lamps (photos 01/03/13)."""
    b = Builder("OttomanChandelier")
    b.box(-0.04, 0.04, -0.04, 0.04, 10.6, CEILING, "gold")
    b.frustum(10, 0.36, 0.36, 8.55, 10.25, "glassLamp", 0)  # central lantern cylinder
    for i in range(6):
        t = 2 * math.pi * i / 6
        rx, ry = 0.37 * math.cos(t), 0.37 * math.sin(t)
        b.box(rx - 0.025, rx + 0.025, ry - 0.025, ry + 0.025, 8.55, 10.25, "gold")
    b.frustum(10, 0.40, 0.14, 10.25, 10.68, "gold", 0)  # upper gilded crown
    b.frustum(12, 0.52, 0.42, 8.15, 8.55, "glassLamp", 0)  # lower bowl
    b.frustum(12, 0.56, 0.56, 8.48, 8.62, "gold", 0)  # equatorial gilded band
    b.frustum(10, 0.16, 0.42, 7.98, 8.15, "ottomanBlue", 0)  # cobalt finial cap
    for i in range(6):
        t = 2 * math.pi * i / 6
        cx, cy = 0.92 * math.cos(t), 0.92 * math.sin(t)
        # Arm from crown out to hanging lamp
        mx, my = 0.62 * math.cos(t), 0.62 * math.sin(t)
        b.box(mx - 0.03, mx + 0.03, my - 0.03, my + 0.03, 9.25, 9.85, "gold")
        b.frustum(8, 0.14, 0.14, 8.38, 9.02, "glassLamp", 0, cx, cy)  # white lamp cylinder
        b.frustum(8, 0.155, 0.08, 9.02, 9.22, "gold", 0, cx, cy)  # brass cap
        b.frustum(8, 0.08, 0.14, 8.24, 8.38, "ottomanBlue", 0, cx, cy)  # cobalt tip
    b.finish({"style": "ottoman"})


def chamber_grille():
    """1 m exterior-only unit of the Sacred Chamber's golden grille & emerald Qur'anic plaques
    (photos 01/03). Faces -Y in Blender (+Z in glTF). Solid opaque back seals the chamber completely."""
    b = Builder("ChamberGrille")
    # Solid closed backing slab (strict dignity rule: zero interior depiction)
    b.box(-0.5, 0.5, 0.06, 0.40, 0.0, 7.45, "chamberSolid")
    # Emerald marble plinth along the base
    b.box(-0.5, 0.5, -0.08, 0.06, 0.0, 0.42, "chamberEmerald")
    b.box(-0.5, 0.5, -0.09, 0.06, 0.42, 0.50, "gold")
    # Lower ornate golden grille backed by dark bronze
    b.box(-0.5, 0.5, 0.00, 0.06, 0.50, 3.45, "chamberDark")
    for x in (-0.46, -0.23, 0.0, 0.23, 0.46):
        b.box(x - 0.025, x + 0.025, -0.05, 0.02, 0.50, 3.45, "gold")
    for z in (1.15, 1.85, 2.55, 3.25):
        b.box(-0.5, 0.5, -0.05, 0.02, z - 0.025, z + 0.025, "gold")
    # Central gilded medallion boss & framing bands
    b.box(-0.18, 0.18, -0.07, 0.00, 2.72, 3.20, "gold")
    b.box(-0.5, 0.5, -0.07, 0.06, 3.45, 3.58, "gold")
    # Emerald inscription plaque with gilded frame & calligraphic bands (abstract gilded lines)
    b.box(-0.5, 0.5, -0.08, 0.06, 3.58, 4.58, "chamberEmerald")
    b.box(-0.5, 0.5, -0.10, -0.06, 3.58, 3.66, "gold")
    b.box(-0.5, 0.5, -0.10, -0.06, 4.50, 4.58, "gold")
    b.box(-0.44, 0.44, -0.095, -0.07, 3.86, 3.96, "gold")
    b.box(-0.44, 0.44, -0.095, -0.07, 4.18, 4.28, "gold")
    # Upper brass lattice screen to the cornice
    b.box(-0.5, 0.5, 0.00, 0.06, 4.58, 7.22, "chamberDark")
    for x in (-0.44, -0.22, 0.0, 0.22, 0.44):
        b.box(x - 0.02, x + 0.02, -0.04, 0.02, 4.58, 7.22, "brass")
    for z in (5.2, 5.85, 6.5, 7.12):
        b.box(-0.5, 0.5, -0.04, 0.02, z - 0.02, z + 0.02, "brass")
    b.box(-0.5, 0.5, -0.09, 0.40, 7.22, 7.45, "gold")
    b.finish({"unitLength": 1.0})


def chamber_roof():
    """1 m x 1 m opaque emerald-and-gold cap sealing the Sacred Chamber from above (strict dignity rule)."""
    b = Builder("ChamberRoof")
    b.box(-0.5, 0.5, -0.5, 0.5, 7.25, 7.45, "chamberEmerald")
    b.box(-0.5, 0.5, -0.5, -0.46, 7.40, 7.50, "gold")
    b.box(-0.5, 0.5, 0.46, 0.5, 7.40, 7.50, "gold")
    b.box(-0.5, -0.46, -0.5, 0.5, 7.40, 7.50, "gold")
    b.box(0.46, 0.5, -0.5, 0.5, 7.40, 7.50, "gold")
    b.finish({"unitSize": 1.0})


def salam_rail():
    """1 m unit of the low gilded brass railing separating visitors in the Greeting Passage (photo 03)."""
    b = Builder("SalamRail")
    b.box(-0.5, 0.5, -0.08, 0.08, 0.0, 0.12, "chamberEmerald")  # low marble curb
    b.box(-0.5, 0.5, -0.04, 0.04, 0.16, 0.22, "gold")  # lower rail
    b.box(-0.5, 0.5, -0.05, 0.05, 0.96, 1.06, "gold")  # top handrail
    b.box(-0.5, -0.42, -0.055, 0.055, 0.12, 1.08, "brass")  # rhythmic post every metre
    for x in (-0.32, -0.14, 0.04, 0.22, 0.40):
        b.box(x - 0.02, x + 0.02, -0.025, 0.025, 0.22, 0.96, "gold")
    b.finish({"unitLength": 1.0})


def prophet_minbar():
    """The Prophetic Pulpit (photos 07/10): north doorway (+Y), rising gilded steps, emerald spire canopy."""
    b = Builder("ProphetMinbar")
    # Entry portal on north (+Y)
    b.box(-0.85, 0.85, 1.82, 2.10, 0.0, 3.65, "ottomanMarble")
    b.box(-0.55, 0.55, 1.80, 2.13, 0.0, 2.55, "teakWood")  # carved double door
    b.box(-0.90, 0.90, 1.78, 2.14, 3.55, 3.85, "gold")  # gilded crown
    # Stepped staircase rising southward (+1.8 -> -0.9)
    steps = 8
    for i in range(steps):
        y1 = 1.80 - i * (2.70 / steps)
        y0 = 1.80 - (i + 1) * (2.70 / steps)
        zt = 0.25 + (i + 1) * (2.35 / steps)
        b.box(-0.78, 0.78, y0, y1, 0.0, zt, "ottomanMarble")
        b.box(-0.82, -0.72, y0, y1, zt, zt + 0.72, "gold")  # west gilded balustrade
        b.box(0.72, 0.82, y0, y1, zt, zt + 0.72, "gold")  # east gilded balustrade
    # Side filigree panels under stairs
    b.box(-0.84, -0.77, -0.90, 1.80, 0.0, 1.45, "teakWood")
    b.box(0.77, 0.84, -0.90, 1.80, 0.0, 1.45, "teakWood")
    # Elevated pulpit platform & canopy on south (-Y)
    b.box(-0.85, 0.85, -2.10, -0.90, 0.0, 2.60, "ottomanMarble")
    b.box(-0.88, 0.88, -2.12, -0.88, 2.52, 2.66, "gold")
    for sx in (-0.70, 0.70):
        for sy in (-1.95, -1.05):
            b.frustum(10, 0.08, 0.08, 2.66, 4.55, "ottomanMarble", 0, sx, sy)
            b.frustum(10, 0.11, 0.11, 4.55, 4.72, "gold", 0, sx, sy)
    b.box(-0.88, 0.88, -2.12, -0.88, 4.72, 5.10, "gold")  # ornate gilded hood
    b.frustum(8, 0.76, 0.06, 5.10, 6.45, "chamberEmerald", math.pi / 8, 0.0, -1.50)  # emerald conical spire
    b.frustum(8, 0.10, 0.02, 6.45, 6.85, "gold", 0, 0.0, -1.50)  # gilded finial
    b.finish()


def prophet_mihrab():
    """The Prophetic Mihrab (photos 07/13): inlaid black/white marble niche facing north (+Y) with gold crown."""
    b = Builder("ProphetMihrab")
    # Main solid back & flanking marble piers
    b.box(-1.40, 1.40, -0.55, -0.10, 0.0, 4.55, "ottomanMarble")
    b.box(-1.40, -0.72, -0.10, 0.55, 0.0, 4.55, "ottomanMarble")
    b.box(0.72, 1.40, -0.10, 0.55, 0.0, 4.55, "ottomanMarble")
    # Inlaid dark marble bands & niche recess
    b.box(-0.72, 0.72, -0.10, 0.06, 0.0, 3.25, "chamberEmerald")
    for z in (0.6, 1.4, 2.2, 3.0, 3.8):
        b.box(-1.42, -0.70, 0.48, 0.58, z, z + 0.32, "archDark")
        b.box(0.70, 1.42, 0.48, 0.58, z, z + 0.32, "archDark")
    # Twin gilded flanking columns & arch lintel
    for sx in (-0.72, 0.72):
        b.frustum(10, 0.11, 0.11, 0.0, 3.25, "gold", 0, sx, 0.48)
    b.box(-1.44, 1.44, -0.58, 0.60, 3.25, 3.55, "gold")
    b.box(-1.44, 1.44, -0.58, 0.60, 4.55, 5.15, "gold")  # gilded Ottoman cresting crown
    b.finish()


def women_wood_partition():
    """1 m unit of the warm teak wooden partition separating women's prayer areas (photos 01/02)."""
    b = Builder("WomenWoodPartition")
    b.box(-0.5, 0.5, -0.075, 0.075, 0.0, 0.16, "woodDark")  # base plinth
    b.box(-0.5, 0.5, -0.055, 0.055, 0.16, 1.56, "teakWood")  # warm recessed wood panel
    # Vertical framing stiles & horizontal rails
    b.box(-0.5, -0.43, -0.08, 0.08, 0.0, 2.25, "woodDark")
    b.box(0.43, 0.5, -0.08, 0.08, 0.0, 2.25, "woodDark")
    b.box(-0.43, 0.43, -0.07, 0.07, 1.52, 1.62, "woodDark")  # mid rail
    b.box(-0.43, 0.43, -0.075, 0.075, 2.13, 2.25, "woodDark")  # top rail
    # Upper mashrabiya lattice mullions
    b.box(-0.43, 0.43, -0.035, 0.035, 1.62, 2.13, "woodLight")
    for x in (-0.28, -0.10, 0.08, 0.26):
        b.box(x - 0.025, x + 0.025, -0.06, 0.06, 1.62, 2.13, "woodDark")
    b.finish({"unitLength": 1.0, "height": 2.25})


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    column()
    lanterns()
    arch()
    chandelier()
    ottoman_column()
    ottoman_chandelier()
    chamber_grille()
    chamber_roof()
    salam_rail()
    prophet_minbar()
    prophet_mihrab()
    women_wood_partition()
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
