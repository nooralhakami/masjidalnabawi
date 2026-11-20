"""
The Mosque's Museum-Grade 3D Door Kit (Stage 3 upgrade, owner rules 2026-11-20),
matching the owner's 9 close-up reference photographs with embedded Diwan Thuluth
calligraphy, real 3D relief carpentry, 6-light sculpted horseshoe transom, hanging
filigree brass Mosque lantern, star marble floor, and a COMPLETELY OPEN-THROUGH
portal passage revealing the real 3D Mosque interior behind open doorways:

  DoorLeafLeft       Left hinged door leaf (origin at LEFT HINGE (0,0,0), X in [0.015, 0.995],
                     Z in [0.015, 0.76]), 0.16 m thick carved walnut/brass coffered leaf with
                     3D projecting moldings, heavy kickplate, 3 barrel hinges, and raised
                     semicircular central "محمد رسول الله" golden medallion relief on both faces.
  DoorLeafRight      Exact complementary right hinged leaf (X in [-0.995, -0.015]), meeting
                     cleanly at the center to complete the full circular central medallion.
  DoorPortalFrame    Unit doorway portal (width X in [-0.54, +0.54], height Z in [0, 1.02],
                     depth Y in [-0.32, +1.78], ZERO back wall!): dressed ashlar stone jambs,
                     rose-granite plinth, flanking brass gate plaques, sculpted 6-light
                     horseshoe transom with turned colonnettes, carved marble inscription
                     lintel ("ادخلوها بسلام آمنين" + rosettes), star marble threshold floor,
                     open soffit ceiling with suspended 4-bulb filigree brass Mosque lantern.
  DoorThresholdGlow  Unit quad on plaza floor extending outward (Y in [-1.0, 0.0]), warm light
                     spill rendered at night beneath open bays only.

Usage:
  node scripts/build-door-textures.mjs
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-door-kit-glb.py
"""

from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
ATLAS_PATH = Path(__file__).resolve().parent / "door-atlas.jpg"
OUTPUT_GLB = ROOT / "public" / "models" / "haram-doors-kit.glb"


def uv_from_px(cx: float, cy: float) -> tuple[float, float]:
    """Convert 1024x1024 canvas pixel coordinates (top-left origin) to Blender UVs (bottom-left origin)."""
    return (cx / 1024.0, 1.0 - cy / 1024.0)


def textured_material(name: str, img, metallic=0.35, roughness=0.42, base_tint=(1.0, 1.0, 1.0, 1.0)):
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    if base_tint == (1.0, 1.0, 1.0, 1.0):
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = base_tint
        nt.links.new(tex.outputs["Color"], mix.inputs["A"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return m


def solid_material(name: str, rgba, metallic=0.0, roughness=0.5, blend=False):
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
    if not ATLAS_PATH.exists():
        raise FileNotFoundError(f"Missing door atlas {ATLAS_PATH}; run `node scripts/build-door-textures.mjs` first")
    img = bpy.data.images.load(str(ATLAS_PATH))
    img.pack()
    MATS.update(
        {
            "doorAtlas": textured_material("doorAtlas", img, metallic=0.38, roughness=0.38),
            "doorStone": textured_material("doorStone", img, metallic=0.0, roughness=0.64),
            "marbleFloor": textured_material("marbleFloor", img, metallic=0.04, roughness=0.22),
            "transomGlass": textured_material("transomGlass", img, metallic=0.0, roughness=0.18),
            "doorGold": solid_material("doorGold", (0.90, 0.70, 0.27, 1.0), metallic=0.92, roughness=0.26),
            "doorWood": solid_material("doorWood", (0.24, 0.14, 0.08, 1.0), metallic=0.12, roughness=0.52),
            "lanternBulb": solid_material("lanternBulb", (1.0, 0.94, 0.76, 1.0), metallic=0.0, roughness=0.15),
            "thresholdGlow": solid_material("thresholdGlow", (1.0, 0.88, 0.62, 0.36), metallic=0.0, roughness=0.90, blend=True),
        }
    )


class Builder:
    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats: list[str] = []

    def _mi(self, mat: str) -> int:
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def face(self, pts, mat, uvs=None):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self._mi(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
        return f

    def box(self, x0, x1, y0, y1, z0, z1, mat, uv_front=None, uv_back=None, uv_side=None, uv_top=None):
        """
        Axis-aligned box with optional pixel-space UV boxes:
        uv_* = (cx0, cy0, cx1, cy1) on 1024x1024 canvas where (cx0, cy0) is left/top?
        Wait: explicitly pass `(cx_at_min_u, cy_at_z1_top, cx_at_max_u, cy_at_z0_bot)`.
        """
        c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        bot = [(x, y, z0) for x, y in c]
        top = [(x, y, z1) for x, y in c]

        def q_uv(spec, flip_u=False):
            if not spec:
                return None
            c0, ct, c1, cb = spec
            ua, ub = (uv_from_px(c1, 0)[0], uv_from_px(c0, 0)[0]) if flip_u else (uv_from_px(c0, 0)[0], uv_from_px(c1, 0)[0])
            vt = uv_from_px(0, ct)[1]
            vb = uv_from_px(0, cb)[1]
            return [(ua, vb), (ub, vb), (ub, vt), (ua, vt)]

        # Front -Y: edge (x0,y0) -> (x1,y0) -> top (x1,y0,z1) -> (x0,y0,z1)
        self.face([bot[0], bot[1], top[1], top[0]], mat, q_uv(uv_front or uv_side))
        # Right +X: (x1,y0) -> (x1,y1)
        self.face([bot[1], bot[2], top[2], top[1]], mat, q_uv(uv_side))
        # Back +Y: (x1,y1) -> (x0,y1)
        self.face([bot[2], bot[3], top[3], top[2]], mat, q_uv(uv_back or uv_front or uv_side))
        # Left -X: (x0,y1) -> (x0,y0)
        self.face([bot[3], bot[0], top[0], top[3]], mat, q_uv(uv_side))
        # Bottom
        self.face(list(reversed(bot)), mat, q_uv(uv_side))
        # Top
        if uv_top:
            tc0, tcy0, tc1, tcy1 = uv_top
            u0, v0 = uv_from_px(tc0, tcy0)
            u1, v1 = uv_from_px(tc1, tcy1)
            self.face(top, mat, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        else:
            self.face(top, mat, q_uv(uv_side))

    def cylinder_z(self, cx, cy, z0, z1, rx, ry, n, mat):
        bot = [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n), z0) for i in range(n)]
        top = [(x, y, z1) for x, y, _ in bot]
        for i in range(n):
            j = (i + 1) % n
            self.face([bot[i], bot[j], top[j], top[i]], mat)
        self.face(list(reversed(bot)), mat)
        self.face(top, mat)

    def finish(self):
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


def door_leaf(side: str):
    """
    Build DoorLeafLeft (X in [0.015, 0.995]) or DoorLeafRight (X in [-0.995, -0.015]).
    Swings strictly inward about hinge X=0, Y=0. Both faces receive crisp non-mirrored Arabic relief.
    """
    is_left = side == "L"
    name = "DoorLeafLeft" if is_left else "DoorLeafRight"
    b = Builder(name)

    xa, xb = (0.015, 0.995) if is_left else (-0.995, -0.015)
    z0, z1 = 0.015, 0.760

    # Front (-Y) maps [xa -> xb] onto [0 -> 256] (left) or [256 -> 512] (right)
    # Back (+Y) maps [xb -> xa] onto [256 -> 512] (left back) or [0 -> 256] (right back) so text reads RTL on both faces!
    f_cx0, f_cx1 = (0.0, 256.0) if is_left else (256.0, 512.0)
    b_cx_at_xb, b_cx_at_xa = (256.0, 512.0) if is_left else (256.0, 0.0)

    def px_for_front_x(x):
        t = (x - xa) / (xb - xa)
        return f_cx0 + t * (f_cx1 - f_cx0)

    def px_for_back_x(x):
        t = (x - xa) / (xb - xa)
        return b_cx_at_xa + t * (b_cx_at_xb - b_cx_at_xa)

    def py_for_z(z):
        tz = max(0.0, min(1.0, (z - z0) / (z1 - z0)))
        return 1024.0 * (1.0 - tz)

    def leaf_uv(x_min, x_max, z_min, z_max, is_back=False):
        if is_back:
            # Back face loop runs (x_max, z_min) -> (x_min, z_min) -> (x_min, z_max) -> (x_max, z_max)
            c0 = px_for_back_x(x_max)
            c1 = px_for_back_x(x_min)
        else:
            c0 = px_for_front_x(x_min)
            c1 = px_for_front_x(x_max)
        return (c0, py_for_z(z_max), c1, py_for_z(z_min))

    gold_uv = (60.0, 930.0, 120.0, 990.0)
    wood_uv = (110.0, 300.0, 160.0, 360.0)

    # 1. Core thick carved leaf panel (0.14 m thick: y in [-0.07, +0.07])
    b.box(
        xa, xb, -0.07, 0.07, z0, z1, "doorAtlas",
        uv_front=leaf_uv(xa, xb, z0, z1, False),
        uv_back=leaf_uv(xa, xb, z0, z1, True),
        uv_side=wood_uv,
    )

    # 2. Raised brass kickplate at bottom (y +/- 0.082, z in [0.015, 0.105])
    b.box(
        xa, xb, -0.082, 0.082, 0.015, 0.105, "doorAtlas",
        uv_front=leaf_uv(xa, xb, 0.015, 0.105, False),
        uv_back=leaf_uv(xa, xb, 0.015, 0.105, True),
        uv_side=gold_uv,
    )

    # 3. Projecting perimeter golden arabesque rails (outer vertical stile, upper cornice, lower sill rail)
    sx0, sx1 = (xa, xa + 0.078) if is_left else (xb - 0.078, xb)
    b.box(
        sx0, sx1, -0.082, 0.082, 0.105, z1, "doorAtlas",
        uv_front=leaf_uv(sx0, sx1, 0.105, z1, False),
        uv_back=leaf_uv(sx0, sx1, 0.105, z1, True),
        uv_side=gold_uv,
    )
    # Upper studded brass cornice (z in [0.60, 0.655]) & top cap rail (z in [0.735, 0.76])
    for za, zb in ((0.602, 0.652), (0.734, 0.760)):
        b.box(
            xa, xb, -0.082, 0.082, za, zb, "doorAtlas",
            uv_front=leaf_uv(xa, xb, za, zb, False),
            uv_back=leaf_uv(xa, xb, za, zb, True),
            uv_side=gold_uv,
        )

    # 4. Ornate golden astragal vertical meeting-edge bar
    ax0, ax1 = (0.975, 1.00) if is_left else (-1.00, -0.975)
    b.box(ax0, ax1, -0.084, 0.084, 0.015, z1, "doorGold")

    # 5. Three 3D heavy brass barrel hinges along the hinge stile
    hx = 0.012 if is_left else -0.012
    for hz in (0.14, 0.43, 0.71):
        b.cylinder_z(hx, -0.04, hz - 0.024, hz + 0.024, 0.024, 0.024, 8, "doorGold")
        b.cylinder_z(hx, 0.04, hz - 0.024, hz + 0.024, 0.024, 0.024, 8, "doorGold")

    # 6. Raised 3D semicircular half-medallion relief boss on BOTH faces centered on meeting seam!
    seam_x = 0.995 if is_left else -0.995
    med_z = z0 + (z1 - z0) * (1.0 - 545.0 / 1024.0)  # matches atlas my=545 exactly (~0.364)
    rx = 0.305
    rz = 0.114
    segs = 12
    # Seam angles sweeping into left leaf (PI/2 .. 3*PI/2) or right leaf (-PI/2 .. +PI/2)
    a_start = math.pi * 0.5 if is_left else -math.pi * 0.5
    a_end = math.pi * 1.5 if is_left else math.pi * 0.5

    for face_y, base_y, is_back in ((-0.094, -0.070, False), (0.094, 0.070, True)):
        px_fn = px_for_back_x if is_back else px_for_front_x
        center_v = (seam_x, face_y, med_z)
        center_uv = uv_from_px(px_fn(seam_x), py_for_z(med_z))
        rim_pts = []
        base_pts = []
        rim_uvs = []
        for k in range(segs + 1):
            a = a_start + (a_end - a_start) * (k / segs)
            px = seam_x + math.cos(a) * rx
            pz = med_z + math.sin(a) * rz
            rim_pts.append((px, face_y, pz))
            base_pts.append((px, base_y, pz))
            rim_uvs.append(uv_from_px(px_fn(px), py_for_z(pz)))
        for k in range(segs):
            if face_y < 0:
                b.face([center_v, rim_pts[k + 1], rim_pts[k]], "doorAtlas", [center_uv, rim_uvs[k + 1], rim_uvs[k]])
                b.face([base_pts[k], base_pts[k + 1], rim_pts[k + 1], rim_pts[k]], "doorGold")
            else:
                b.face([center_v, rim_pts[k], rim_pts[k + 1]], "doorAtlas", [center_uv, rim_uvs[k], rim_uvs[k + 1]])
                b.face([base_pts[k + 1], base_pts[k], rim_pts[k], rim_pts[k + 1]], "doorGold")
        # Close flat diameter cap at seam
        if face_y < 0:
            b.face([base_pts[-1], rim_pts[-1], rim_pts[0], base_pts[0]], "doorGold")
        else:
            b.face([base_pts[0], rim_pts[0], rim_pts[-1], base_pts[-1]], "doorGold")

    b.finish()


def door_portal_frame():
    """
    Open-through architectural portal frame (NO back wall!):
    marble star floor, dressed stone jambs & plinth, engraved brass side plaques,
    sculpted 6-light horseshoe arched transom, marble "ادخلوها بسلام آمنين" lintel,
    open ceiling soffit, and suspended 4-bulb brass Mosque lantern.
    """
    b = Builder("DoorPortalFrame")

    ashlar_uv = (520.0, 516.0, 1016.0, 672.0)
    granite_uv = (520.0, 680.0, 1016.0, 764.0)
    plaque_front = (516.0, 8.0, 1020.0, 250.0)
    plaque_back = (1020.0, 8.0, 516.0, 250.0)
    nameplate_uv = (772.0, 400.0, 1020.0, 508.0)
    glass_uv = (516.0, 260.0, 1020.0, 392.0)
    lantern_uv = (516.0, 400.0, 764.0, 508.0)

    # 1. Polished 8-pointed star marble floor (no central wall; completely open through!)
    b.box(
        -0.50, 0.50, -0.34, 1.78, 0.00, 0.020, "marbleFloor",
        uv_top=(520.0, 774.0, 1016.0, 1018.0),
        uv_side=granite_uv,
    )

    # 2. Outer stone doorway jambs (granite lower dado + dressed sandstone ashlar upper cheeks)
    for sx0, sx1 in ((-0.54, -0.46), (0.46, 0.54)):
        # Rose-granite dado plinth + cap molding (z in [0, 0.28])
        b.box(sx0, sx1, -0.18, 1.25, 0.00, 0.27, "doorStone", uv_front=granite_uv, uv_side=granite_uv)
        b.box(sx0 - 0.006, sx1 + 0.006, -0.19, 1.26, 0.27, 0.292, "doorStone", uv_front=granite_uv, uv_side=granite_uv)
        # Upper dressed sandstone jamb piers (z in [0.292, 1.02])
        b.box(sx0, sx1, -0.18, 1.25, 0.292, 1.02, "doorStone", uv_front=ashlar_uv, uv_side=ashlar_uv)
        # Inner carved teak frame trim casing around the leaves (x at +-0.455)
        tx0, tx1 = (-0.465, -0.448) if sx0 < 0 else (0.448, 0.465)
        b.box(tx0, tx1, -0.09, 0.11, 0.015, 0.896, "doorWood")
        gx0, gx1 = (-0.458, -0.446) if sx0 < 0 else (0.446, 0.458)
        b.box(gx0, gx1, -0.095, 0.095, 0.015, 0.768, "doorGold")

    # 3. Flanking golden brass small gate nameplates on left & right stone jambs
    for px0, px1 in ((-0.525, -0.475), (0.475, 0.525)):
        b.box(px0, px1, -0.195, -0.175, 0.355, 0.405, "doorAtlas", uv_front=nameplate_uv, uv_side=(60.0, 930.0, 120.0, 990.0))

    # 4. Sculpted 6-light horseshoe arched transom (z in [0.762, 0.896], y in [-0.09, +0.09])
    b.box(-0.465, 0.465, -0.095, 0.095, 0.756, 0.770, "doorGold")  # golden sill molding
    b.box(-0.465, 0.465, -0.088, 0.088, 0.770, 0.778, "doorWood")
    b.box(-0.465, 0.465, -0.088, 0.088, 0.880, 0.896, "doorWood")  # top header rail
    # Stained-glass continuous backlit core recessed inside the transom frame
    b.box(-0.450, 0.450, -0.018, 0.018, 0.778, 0.882, "transomGlass", uv_front=glass_uv, uv_back=glass_uv, uv_side=glass_uv)
    # 5 real 3D turned brass-capped mullions & 6 carved wooden/gold horseshoe arches
    for k in range(1, 6):
        mx = -0.450 + k * 0.150
        b.box(mx - 0.008, mx + 0.008, -0.068, 0.068, 0.774, 0.856, "doorWood")
        b.box(mx - 0.011, mx + 0.011, -0.072, 0.072, 0.774, 0.786, "doorGold")
        b.box(mx - 0.011, mx + 0.011, -0.072, 0.072, 0.844, 0.858, "doorGold")
    for k in range(6):
        ax_mid = -0.375 + k * 0.150
        # Curved horseshoe arch spandrel & golden arch rib segments over each glass light
        pts_ang = [math.pi * (i / 6.0) for i in range(7)]
        for i in range(6):
            a0, a1 = pts_ang[i], pts_ang[i + 1]
            # Spandrel top wood infill down to circular arch curve
            lx0 = ax_mid + math.cos(a0) * 0.066
            lz0 = 0.842 + math.sin(a0) * 0.036
            lx1 = ax_mid + math.cos(a1) * 0.066
            lz1 = 0.842 + math.sin(a1) * 0.036
            for fy, rev in ((-0.062, False), (0.062, True)):
                quad = [(lx0, fy, lz0), (lx1, fy, lz1), (lx1, fy, 0.882), (lx0, fy, 0.882)]
                b.face(list(reversed(quad)) if rev else quad, "doorWood")
            # Projecting golden horseshoe arch rim band
            rx0 = ax_mid + math.cos(a0) * 0.058
            rz0 = 0.842 + math.sin(a0) * 0.031
            rx1 = ax_mid + math.cos(a1) * 0.058
            rz1 = 0.842 + math.sin(a1) * 0.031
            for fy, rev in ((-0.068, False), (0.068, True)):
                quad = [(rx0, fy, rz0), (rx1, fy, rz1), (rx1, fy, rz1 + 0.007), (rx0, fy, rz0 + 0.007)]
                b.face(list(reversed(quad)) if rev else quad, "doorGold")

    # 5. Projecting Carved Cream Marble Lintel Plaque ("ادخلوها بسلام آمنين" + Rosettes)
    b.box(
        -0.525, 0.525, -0.15, 0.12, 0.896, 1.008, "doorStone",
        uv_front=plaque_front, uv_back=plaque_back, uv_side=ashlar_uv,
    )
    # Upper stepped stone cornice over the lintel
    b.box(-0.545, 0.545, -0.185, 0.145, 1.008, 1.028, "doorStone", uv_front=ashlar_uv, uv_side=ashlar_uv)

    # 6. Overhead open-through passage soffit (bridges portal thickness, completely clear below z=0.768!)
    b.box(-0.465, 0.465, 0.09, 1.48, 0.768, 0.798, "doorStone", uv_side=ashlar_uv)
    b.box(-0.465, 0.465, 0.09, 1.48, 0.896, 0.945, "doorStone", uv_side=ashlar_uv)

    # 7. Real 3D Suspended Golden Brass Mosque Lantern with 4 glowing circular bulbs
    ly = 0.82  # suspended cleanly above open doorway passage
    b.cylinder_z(0.0, ly, 0.655, 0.768, 0.008, 0.008, 6, "doorGold")  # suspension rod
    b.cylinder_z(0.0, ly, 0.630, 0.655, 0.042, 0.042, 8, "doorGold")  # lantern domed cap
    # Tapered 4-sided filigree lantern shade (bottom slightly wider than top)
    tw, bw = 0.048, 0.068
    z_top, z_bot = 0.630, 0.535
    c_top = [(-tw, ly - tw, z_top), (tw, ly - tw, z_top), (tw, ly + tw, z_top), (-tw, ly + tw, z_top)]
    c_bot = [(-bw, ly - bw, z_bot), (bw, ly - bw, z_bot), (bw, ly + bw, z_bot), (-bw, ly + bw, z_bot)]
    l_uv = [(uv_from_px(lantern_uv[0], lantern_uv[3])[0], uv_from_px(lantern_uv[0], lantern_uv[3])[1]),
            (uv_from_px(lantern_uv[2], lantern_uv[3])[0], uv_from_px(lantern_uv[2], lantern_uv[3])[1]),
            (uv_from_px(lantern_uv[2], lantern_uv[1])[0], uv_from_px(lantern_uv[2], lantern_uv[1])[1]),
            (uv_from_px(lantern_uv[0], lantern_uv[1])[0], uv_from_px(lantern_uv[0], lantern_uv[1])[1])]
    for i in range(4):
        j = (i + 1) % 4
        b.face([c_bot[i], c_bot[j], c_top[j], c_top[i]], "doorAtlas", l_uv)
    b.face(list(reversed(c_bot)), "doorGold")
    # 4 bright glowing bulbs underneath the lantern base
    for bx, by in ((-0.032, -0.032), (0.032, -0.032), (-0.032, 0.032), (0.032, 0.032)):
        b.cylinder_z(bx, ly + by, z_bot - 0.016, z_bot, 0.016, 0.016, 8, "lanternBulb")

    b.finish()


def door_threshold_glow():
    b = Builder("DoorThresholdGlow")
    # Extends outward from y=0 to y=-1.0 (scaled dynamically by open fraction & night intensity)
    b.face([(-0.5, 0.0, 0.045), (0.5, 0.0, 0.045), (0.5, -1.0, 0.045), (-0.5, -1.0, 0.045)], "thresholdGlow")
    b.finish()


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    clear_scene()
    make_materials()
    door_leaf("L")
    door_leaf("R")
    door_portal_frame()
    door_threshold_glow()
    OUTPUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_GLB),
        export_format="GLB",
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print(f"Exported museum-grade open-through Door Kit GLB to {OUTPUT_GLB} ({OUTPUT_GLB.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
