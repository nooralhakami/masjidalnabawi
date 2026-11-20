"""
The Mosque's 3D Door Kit (Stage 3 of the realism master plan, owner rules 2026-11-20),
matching the owner's reference photograph (`ادخلوها بسلام امنين.jpeg`):

  DoorPortalFrame    Unit doorway opening (width X in [-0.5, +0.5], height Z in [0, 1.0],
                     depth Y in metres: front -Y, recessed lit hall alcove +Y to +1.85 m):
                     side jambs, upper stained-glass transom (6 blue/gold arched lights),
                     stone inscription plaque with flanking golden rosettes, marble threshold,
                     and warm lit interior hall alcove so open doors reveal genuine 3D depth.
  DoorLeafLeft       Left hinged door leaf (origin at LEFT HINGE (0,0,0), X in [0.02, 0.99],
                     Z in [0.02, 0.76]), ornate walnut/bronze leaf with gold frame, diagonal
                     brass lattice on both faces, upper frieze, and central half-medallion.
  DoorLeafRight      Right hinged door leaf (origin at RIGHT HINGE (0,0,0), X in [-0.99, -0.02]),
                     exact mirror of DoorLeafLeft.
  DoorThresholdGlow  Unit quad on plaza floor extending outward (-Y in [-1.0, 0.0]), warm light
                     spill rendered at night beneath open bays only.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-door-kit-glb.py
"""

from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_GLB = ROOT / "public" / "models" / "haram-doors-kit.glb"


def material(name: str, rgba, metallic=0.0, roughness=0.5, blend=False):
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if blend:
        m.blend_method = "BLEND"
        bsdf.inputs["Alpha"].default_value = rgba[3]
    return m


MATS: dict = {}


def make_materials() -> None:
    MATS.update(
        {
            "doorWood": material("doorWood", (0.20, 0.14, 0.08, 1.0), 0.15, 0.55),
            "gold": material("gold", (0.85, 0.67, 0.28, 1.0), 0.92, 0.28),
            "brass": material("brass", (0.72, 0.54, 0.22, 1.0), 0.85, 0.35),
            "transomBlue": material("transomBlue", (0.14, 0.32, 0.66, 1.0), 0.0, 0.20),
            "plaqueStone": material("plaqueStone", (0.87, 0.82, 0.72, 1.0), 0.0, 0.65),
            "hallInterior": material("hallInterior", (0.76, 0.66, 0.52, 1.0), 0.0, 0.70),
            "glassLamp": material("glassLamp", (1.0, 0.92, 0.72, 1.0), 0.0, 0.20),
            "thresholdGlow": material("thresholdGlow", (1.0, 0.88, 0.62, 0.34), 0.0, 0.90, blend=True),
        }
    )


class Builder:
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

    def box(self, x0, x1, y0, y1, z0, z1, mat):
        c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        bot = [(x, y, z0) for x, y in c]
        top = [(x, y, z1) for x, y in c]
        for i in range(4):
            j = (i + 1) % 4
            self.face([bot[i], bot[j], top[j], top[i]], mat)
        self.face(list(reversed(bot)), mat)
        self.face(top, mat)

    def disc_y(self, cx, y, cz, rx, rz, n, mat, facing=-1):
        pts = [(cx + rx * math.cos(2 * math.pi * i / n), y, cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
        if facing < 0:
            pts.reverse()
        self.face(pts, mat)

    def diag_bar(self, x0, z0, x1, z1, y0, y1, half_t, mat):
        dx, dz = x1 - x0, z1 - z0
        ln = math.hypot(dx, dz) or 1.0
        nx, nz = (-dz / ln) * half_t, (dx / ln) * half_t
        for y, rev in ((y0, False), (y1, True)):
            pts = [(x0 - nx, y, z0 - nz), (x1 - nx, y, z1 - nz), (x1 + nx, y, z1 + nz), (x0 + nx, y, z0 + nz)]
            self.face(list(reversed(pts)) if rev else pts, mat)

    def finish(self):
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
        return obj


def door_portal_frame():
    b = Builder("DoorPortalFrame")
    # Recessed lit interior hall alcove (y = 0 .. +1.85 m inward)
    b.box(-0.49, 0.49, 1.80, 1.86, 0.02, 0.78, "hallInterior")  # back hall wall
    b.box(-0.36, 0.36, 1.77, 1.80, 0.56, 0.72, "glassLamp")     # warm lit upper hall frieze
    b.box(-0.50, -0.45, 0.10, 1.84, 0.02, 0.78, "hallInterior") # left alcove cheek
    b.box(0.45, 0.50, 0.10, 1.84, 0.02, 0.78, "hallInterior")   # right alcove cheek
    b.box(-0.49, 0.49, 0.06, 1.84, 0.74, 0.78, "hallInterior")  # alcove ceiling soffit
    b.box(-0.49, 0.49, -0.10, 1.84, 0.00, 0.025, "plaqueStone") # marble threshold floor

    # Outer carved doorway jambs and golden reveal molding
    b.box(-0.51, -0.45, -0.06, 0.16, 0.00, 1.00, "plaqueStone")
    b.box(0.45, 0.51, -0.06, 0.16, 0.00, 1.00, "plaqueStone")
    b.box(-0.46, -0.435, -0.07, 0.14, 0.00, 0.76, "gold")
    b.box(0.435, 0.46, -0.07, 0.14, 0.00, 0.76, "gold")
    b.box(-0.46, 0.46, -0.07, 0.14, 0.75, 0.77, "gold")        # transom sill

    # Upper stained-glass transom (z in [0.77, 0.89]) with 6 cobalt-blue arched lights
    b.box(-0.46, 0.46, -0.05, 0.12, 0.77, 0.89, "doorWood")
    for k in range(6):
        x0 = -0.42 + k * 0.14
        x1 = x0 + 0.11
        b.box(x0, x1, -0.065, -0.04, 0.785, 0.875, "transomBlue")
        b.box(x0 - 0.008, x0 + 0.006, -0.07, -0.04, 0.78, 0.88, "gold")
    b.box(0.41, 0.425, -0.07, -0.04, 0.78, 0.88, "gold")

    # Carved stone inscription plaque above transom (z in [0.89, 1.00])
    b.box(-0.51, 0.51, -0.06, 0.16, 0.89, 1.00, "plaqueStone")
    b.box(-0.46, 0.46, -0.075, -0.05, 0.89, 0.905, "gold")
    b.box(-0.46, 0.46, -0.075, -0.05, 0.985, 1.00, "gold")
    # Decorative calligraphy relief strip & two flanking circular rosettes
    b.box(-0.28, 0.28, -0.072, -0.055, 0.932, 0.956, "gold")
    b.disc_y(-0.37, -0.075, 0.945, 0.032, 0.025, 10, "gold", -1)
    b.disc_y(0.37, -0.075, 0.945, 0.032, 0.025, 10, "gold", -1)
    b.finish()


def door_leaf(side: str):
    """side='L': hinge at (0,0,0), extends +X [0.02, 0.99]. side='R': hinge at (0,0,0), extends -X [-0.99, -0.02]."""
    sgn = 1.0 if side == "L" else -1.0
    name = "DoorLeafLeft" if side == "L" else "DoorLeafRight"
    b = Builder(name)
    x_a, x_b = (0.02, 0.99) if sgn > 0 else (-0.99, -0.02)
    b.box(x_a, x_b, -0.04, 0.04, 0.02, 0.75, "doorWood")
    # Hinge pin cylinder edge
    hx0, hx1 = (0.00, 0.04) if sgn > 0 else (-0.04, 0.00)
    b.box(hx0, hx1, -0.05, 0.05, 0.02, 0.75, "gold")

    # Raised golden perimeter frame (visible both sides)
    if sgn > 0:
        b.box(0.03, 0.11, -0.055, 0.055, 0.02, 0.75, "gold")
        b.box(0.92, 0.99, -0.055, 0.055, 0.02, 0.75, "gold")
    else:
        b.box(-0.11, -0.03, -0.055, 0.055, 0.02, 0.75, "gold")
        b.box(-0.99, -0.92, -0.055, 0.055, 0.02, 0.75, "gold")
    b.box(x_a, x_b, -0.055, 0.055, 0.02, 0.07, "gold")
    b.box(x_a, x_b, -0.055, 0.055, 0.62, 0.75, "gold")

    # Diagonal brass lattice bars on both faces (-Y outer, +Y inner)
    for k in range(3):
        z0 = 0.08 + k * 0.18
        z1 = z0 + 0.18
        lx0, lx1 = (0.12, 0.90) if sgn > 0 else (-0.90, -0.12)
        b.diag_bar(lx0, z0, lx1, z1, -0.052, 0.052, 0.015, "brass")
        b.diag_bar(lx1, z0, lx0, z1, -0.052, 0.052, 0.015, "brass")

    # Central meeting-stile golden medallion half (completes full circular boss when closed)
    mx0, mx1 = (0.76, 0.99) if sgn > 0 else (-0.99, -0.76)
    b.box(mx0, mx1, -0.06, 0.06, 0.28, 0.42, "gold")
    b.finish()


def door_threshold_glow():
    b = Builder("DoorThresholdGlow")
    # Extends outward from y=0 to y=-1.0 (scaled dynamically by open fraction & night intensity)
    b.face([(-0.5, -1.0, 0.04), (0.5, -1.0, 0.04), (0.5, 0.0, 0.04), (-0.5, 0.0, 0.04)], "thresholdGlow")
    b.finish()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    door_portal_frame()
    door_leaf("L")
    door_leaf("R")
    door_threshold_glow()
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
