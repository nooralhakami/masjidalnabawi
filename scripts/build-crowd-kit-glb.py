"""
Builds `public/models/haram-crowd-kit.glb` inside Blender 5.3.0:
  - Sample 2 aesthetic ("Smooth + Baked Fabric Atlas"): faceless, realistic proportions, dignified modest attire
  - 7 nationality / attire archetypes x 2 detail tiers (LOD0, LOD1) + 1 ultra-lightweight LOD2 silhouette = 15 meshes
  - Coordinates in crowd-layer glTF space: +X forward, +Y up (0..1.75m), +Z right
  - Each mesh carries POSITION, NORMAL, TEXCOORD_0, COLOR_0 (dye mask), JOINTS_0 (12-bone rig), WEIGHTS_0
  - Embedded 512x512 JPEG fabric atlas generated in Blender/NumPy with 8 px bleed gutters

Run from repo root:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-crowd-kit-glb.py
"""

import gzip
import json
import math
import os
import struct
import tempfile
import bpy
import bmesh
import numpy as np
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "models", "haram-crowd-kit.glb")

# Dye mask channels packed into COLOR_0 (RGBA uint8):
#   R=255: robe / tunic primary fabric (multiplied by a_robe)
#   G=255: headgear / hijab fabric (multiplied by a_head, with woven pattern preserved)
#   B=255: skin (face, neck, hands, exposed right arm of Ihram)
#   A=255: fixed atlas color (Iqal, Songkok, footwear, Sadri vest accent, Kaftan trim, Ihram belt)
MASK_ROBE = (255, 0, 0, 0)
MASK_HEAD = (0, 255, 0, 0)
MASK_SKIN = (0, 0, 255, 0)
MASK_FIXED = (0, 0, 0, 255)


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def build_fabric_atlas_jpeg() -> bytes:
    """Create a 512x512 4x2 fabric atlas in Blender/NumPy and compress to JPEG bytes."""
    W, H = 512, 512
    TW, TH = 128, 256  # 4 cols x 2 rows
    PAD = 8
    arr = np.zeros((H, W, 4), dtype=np.float32)
    arr[:, :, 3] = 1.0

    def fill_tile(idx: int, fn):
        col = idx % 4
        row = idx // 4
        x0, y0 = col * TW, row * TH
        inner_w, inner_h = TW - 2 * PAD, TH - 2 * PAD
        yy, xx = np.mgrid[0:inner_h, 0:inner_w]
        u = xx.astype(np.float32) / float(inner_w - 1)
        v = yy.astype(np.float32) / float(inner_h - 1)
        rgb = fn(xx, yy, u, v)
        tile = np.ones((TH, TW, 3), dtype=np.float32)
        tile[PAD : TH - PAD, PAD : TW - PAD, :] = np.clip(rgb, 0.0, 1.0)
        # Edge-clamp padding to eliminate mipmap seam bleed
        tile[:PAD, :, :] = tile[PAD : PAD + 1, :, :]
        tile[TH - PAD :, :, :] = tile[TH - PAD - 1 : TH - PAD, :, :]
        tile[:, :PAD, :] = tile[:, PAD : PAD + 1, :]
        tile[:, TW - PAD :, :] = tile[:, TW - PAD - 1 : TW - PAD, :]
        # Flip Y for top-down image pixel storage vs glTF UV bottom-up convention
        arr[H - (y0 + TH) : H - y0, x0 : x0 + TW, :3] = tile[::-1, :, :]

    # Tile 0: Crisp white cotton Thobe / Tunic with fine slub & vertical placket strip
    def tile_thobe(xx, yy, u, v):
        slub = 0.018 * np.sin(yy * 0.45) + 0.012 * np.cos(xx * 0.85)
        placket = (np.abs(u - 0.5) < 0.045) & (v > 0.62) & (v < 0.93)
        shade = 0.95 + slub - 0.05 * (1.0 - v)
        rgb = np.stack([shade, shade * 0.99, shade * 0.97], axis=-1)
        rgb[placket] *= 0.93
        return rgb

    # Tile 1: Iconic Saudi crimson-and-cream herringbone Shemagh + bordered edge
    def tile_shemagh(xx, yy, u, v):
        base = np.zeros((yy.shape[0], xx.shape[1], 3), dtype=np.float32)
        base[:, :, 0] = 0.97
        base[:, :, 1] = 0.94
        base[:, :, 2] = 0.89
        gx = ((xx // 4) % 2) ^ ((yy // 4) % 2)
        diag = ((xx + yy) // 3) % 2 == 0
        checks = ((xx % 12) < 7) & ((yy % 12) < 7)
        border = (v < 0.09) | (v > 0.91)
        red = (checks & (gx.astype(bool) | diag)) | (border & ((xx % 4) < 3))
        base[red, 0] = 0.68
        base[red, 1] = 0.12
        base[red, 2] = 0.14
        return base

    # Tile 2: South Asian herringbone cotton Kameez
    def tile_kameez(xx, yy, u, v):
        wave = 0.025 * np.sin(xx * 0.6 + yy * 0.3)
        shade = 0.93 + wave - 0.05 * (1.0 - v)
        return np.stack([shade * 0.96, shade * 0.98, shade], axis=-1)

    # Tile 3: Indonesian Batik Parang/Kawung geometric weave
    def tile_batik(xx, yy, u, v):
        rgb = np.zeros((yy.shape[0], xx.shape[1], 3), dtype=np.float32)
        rgb[:, :, 0] = 0.14
        rgb[:, :, 1] = 0.25
        rgb[:, :, 2] = 0.37
        du = ((xx + yy) % 20) / 20.0
        dv = ((xx - yy) % 20) / 20.0
        ring = ((np.abs(du - 0.5) + np.abs(dv - 0.5)) > 0.36) & ((np.abs(du - 0.5) + np.abs(dv - 0.5)) < 0.48)
        dot = ((du - 0.5) ** 2 + (dv - 0.5) ** 2) < 0.018
        rgb[ring, 0] = 0.79
        rgb[ring, 1] = 0.64
        rgb[ring, 2] = 0.32
        rgb[dot, 0] = 0.92
        rgb[dot, 1] = 0.87
        rgb[dot, 2] = 0.74
        return rgb

    # Tile 4: Ihram cotton terry waffle weave
    def tile_ihram(xx, yy, u, v):
        waffle = 0.045 * (((xx % 5) < 2) ^ ((yy % 5) < 2)).astype(np.float32)
        c = 0.92 + waffle - 0.03 * (1.0 - v)
        return np.stack([c, c * 0.99, c * 0.96], axis=-1)

    # Tile 5: Modest woven Abaya crepe (rich charcoal with subtle weave so folds show)
    def tile_abaya(xx, yy, u, v):
        weave = 0.016 * np.sin(xx * 0.65 + yy * 0.65)
        shade = 0.115 + weave + 0.015 * v
        return np.stack([shade, shade * 1.03, shade * 1.15], axis=-1)

    # Tile 6: Kaftan embroidered chest weave
    def tile_kaftan(xx, yy, u, v):
        weave = 0.02 * np.sin(xx * 0.5 + yy * 0.5)
        emb = (np.abs(u - 0.5) < 0.11) & (v > 0.58) & (v < 0.90) & (((xx + yy) % 8) < 4)
        base = 0.92 + weave - 0.04 * (1.0 - v)
        rgb = np.stack([base, base * 0.98, base * 0.94], axis=-1)
        rgb[emb, 0] = 0.78
        rgb[emb, 1] = 0.63
        rgb[emb, 2] = 0.30
        return rgb

    # Tile 7: Packed utility swatches by U bands:
    #   u in [0.00..0.25]: Jet black (Iqal, Songkok, black belt/shoes)
    #   u in [0.25..0.50]: Cream knit Kufi / Taqiyah
    #   u in [0.50..0.75]: Olive-charcoal Sadri waistcoat wool
    #   u in [0.75..1.00]: Dark leather sandal brown
    def tile_swatches(xx, yy, u, v):
        rgb = np.zeros((yy.shape[0], xx.shape[1], 3), dtype=np.float32)
        m0 = u < 0.25
        m1 = (u >= 0.25) & (u < 0.50)
        m2 = (u >= 0.50) & (u < 0.75)
        m3 = u >= 0.75
        weave = 0.015 * np.sin(xx * 0.7 + yy * 0.7)
        rgb[m0] = np.array([0.075, 0.075, 0.085])
        rgb[m1] = np.stack([0.92 + weave[m1], 0.89 + weave[m1], 0.82 + weave[m1]], axis=-1)
        rgb[m2] = np.stack([0.28 + weave[m2], 0.33 + weave[m2], 0.29 + weave[m2]], axis=-1)
        rgb[m3] = np.array([0.24, 0.16, 0.10])
        return rgb

    fill_tile(0, tile_thobe)
    fill_tile(1, tile_shemagh)
    fill_tile(2, tile_kameez)
    fill_tile(3, tile_batik)
    fill_tile(4, tile_ihram)
    fill_tile(5, tile_abaya)
    fill_tile(6, tile_kaftan)
    fill_tile(7, tile_swatches)

    # Flip top-to-bottom for Blender RGBA float buffer (bottom-left origin)
    blender_arr = arr[::-1, :, :]
    img = bpy.data.images.new("CrowdAtlas", width=W, height=H, alpha=False)
    img.pixels.foreach_set(blender_arr.ravel())

    tmp_jpg = os.path.join(tempfile.gettempdir(), "haram_crowd_atlas_tmp.jpg")
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 82
    scene.render.image_settings.color_mode = "RGB"
    img.save_render(tmp_jpg)
    with open(tmp_jpg, "rb") as f:
        data = f.read()
    os.remove(tmp_jpg)
    return data


def tile_uv(tile_idx: int, u: float, v: float) -> tuple[float, float]:
    """Map local tile UV in [0..1] into the padded sub-rectangle of the 4x2 atlas."""
    col = tile_idx % 4
    row = tile_idx // 4
    TW, TH, PAD, W, H = 128.0, 256.0, 10.0, 512.0, 512.0
    u_px = col * TW + PAD + clamp(u, 0.0, 1.0) * (TW - 2.0 * PAD)
    v_px = row * TH + PAD + clamp(v, 0.0, 1.0) * (TH - 2.0 * PAD)
    return (u_px / W, v_px / H)


# ---------------------------------------------------------------------------
# Skeletal Weighting (must match `src/domain/crowd-rig.ts` bone indices 0..11)
# ---------------------------------------------------------------------------
#  0 pelvis     (y=0.92)     6 arm_r_upper (y=1.38, z=+0.20)
#  1 spine_low  (y=1.06)     7 arm_r_lower (y=1.12, z=+0.22)
#  2 spine_high (y=1.32)     8 leg_l_upper (y=0.88, z=-0.085)
#  3 head       (y=1.50)     9 leg_l_lower (y=0.46, z=-0.085)
#  4 arm_l_upper(y=1.38)    10 leg_r_upper (y=0.88, z=+0.085)
#  5 arm_l_lower(y=1.12)    11 leg_r_lower (y=0.46, z=+0.085)


def pack_weights(pairs: list[tuple[int, float]]) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    filtered = [(j, max(0.0, w)) for j, w in pairs if w > 1e-4]
    filtered.sort(key=lambda kv: -kv[1])
    filtered = filtered[:4]
    total = sum(w for _, w in filtered) or 1.0
    norm = [(j, w / total) for j, w in filtered]
    j_out = [0, 0, 0, 0]
    w_out = [0, 0, 0, 0]
    for i, (j, w) in enumerate(norm):
        j_out[i] = j
        w_out[i] = int(round(w * 255.0))
    # Guarantee uint8 sum == 255 for exact rigid transforms
    w_out[0] = clamp(w_out[0] + (255 - sum(w_out)), 0, 255)
    return (tuple(j_out), tuple(w_out))


def smooth_step(a: float, b: float, x: float) -> float:
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def compute_vertex_weights(pos_gl: tuple[float, float, float], part_tag: str) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Assign clean skinning weights in glTF coordinates (+X forward, +Y up, +Z right)."""
    _x, y, z = pos_gl

    if part_tag == "head":
        return pack_weights([(3, 1.0)])
    if part_tag == "shawl":
        # Upper portion rotates with head (3); chest/shoulder drape follows spine_high (2)
        t = smooth_step(1.26, 1.48, y)
        return pack_weights([(2, 1.0 - t), (3, t)])
    if part_tag in ("arm_l", "arm_r"):
        j_up = 4 if part_tag == "arm_l" else 6
        j_lo = 5 if part_tag == "arm_l" else 7
        shoulder_t = smooth_step(1.30, 1.43, y) * (1.0 - smooth_step(0.14, 0.21, abs(z)))
        elbow_t = smooth_step(1.04, 1.18, y)  # 1 above elbow, 0 forearm/hand
        w_spine = shoulder_t * 0.75
        w_arm = 1.0 - w_spine
        return pack_weights([(2, w_spine), (j_up, w_arm * elbow_t), (j_lo, w_arm * (1.0 - elbow_t))])
    if part_tag in ("leg_l", "leg_r"):
        j_up = 8 if part_tag == "leg_l" else 10
        j_lo = 9 if part_tag == "leg_l" else 11
        hip_t = smooth_step(0.84, 0.94, y)
        knee_t = smooth_step(0.40, 0.52, y)
        return pack_weights([(0, hip_t * 0.45), (j_up, (1.0 - hip_t * 0.45) * knee_t), (j_lo, (1.0 - hip_t * 0.45) * (1.0 - knee_t))])

    # Torso / Full-length robe ("body"):
    if y >= 0.93:
        if y >= 1.42:
            t = smooth_step(1.42, 1.50, y)
            return pack_weights([(2, 1.0 - t), (3, t)])
        if y >= 1.16:
            t = smooth_step(1.16, 1.32, y)
            return pack_weights([(1, 1.0 - t), (2, t)])
        t = smooth_step(0.95, 1.10, y)
        return pack_weights([(0, 1.0 - t), (1, t)])

    # Flowing lower robe below pelvis: split smoothly across legs + pelvis blend at hip
    hip_w = smooth_step(0.76, 0.93, y)
    leg_w = 1.0 - hip_w
    knee_t = smooth_step(0.38, 0.54, y)
    r_side = smooth_step(-0.08, 0.08, z)  # 0 left (-Z), 1 right (+Z)
    l_side = 1.0 - r_side
    return pack_weights([
        (0, hip_w),
        (8, leg_w * l_side * knee_t),
        (9, leg_w * l_side * (1.0 - knee_t)),
        (10, leg_w * r_side * knee_t),
        (11, leg_w * r_side * (1.0 - knee_t)),
    ])


# ---------------------------------------------------------------------------
# Blender BMesh Character Builder (authored in Blender Z-up -> exported to +X fwd, +Y up, +Z right)
# ---------------------------------------------------------------------------
# In Blender: X = forward (+X nose), Y = left (+Y shoulder), Z = up (0..1.75)
# Transform to crowd-layer space: (x_gl, y_gl, z_gl) = (x_bl, z_bl, -y_bl)


class CharacterBuilder:
    def __init__(self, scale_h: float = 1.75):
        self.bm = bmesh.new()
        self.uv_layer = self.bm.loops.layers.uv.new("UVMap")
        self.h = scale_h
        # Per-vertex metadata keyed by `v.index` after indexing cleanly
        self.v_meta: list[tuple[tuple[int, int, int, int], tuple[int, int, int, int], tuple[int, int, int, int]]] = []
        self._vert_part: dict[int, str] = {}
        self._vert_mask: dict[int, tuple[int, int, int, int]] = {}
        self._vid = 0

    def new_vert(self, co_bl: tuple[float, float, float], part_tag: str, mask: tuple[int, int, int, int]):
        v = self.bm.verts.new(co_bl)
        vid = self._vid
        self._vid += 1
        v.index = vid
        self._vert_part[vid] = part_tag
        self._vert_mask[vid] = mask
        return v

    def add_face(self, verts, uvs, smooth=True):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
        f.smooth = smooth
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv_layer].uv = uv

    def add_lathe(self, rings, segs: int, tile: int, part_tag: str, mask: tuple[int, int, int, int], cap_top=True, cap_bot=True, offset_y=0.0, offset_x=0.0, swatch_u: float | None = None):
        """rings: [(z, r_fwd_x, r_side_y, x_off, pleat_amp), ...]"""
        v_rings = []
        n_rings = len(rings)
        for ri, (z, rx, ry, xoff, pleat) in enumerate(rings):
            row = []
            for k in range(segs):
                ang = 2.0 * math.pi * k / segs
                p = 1.0 + pleat * math.cos(5.0 * ang) if pleat else 1.0
                vx = rx * p * math.cos(ang) + xoff + offset_x
                vy = ry * p * math.sin(ang) + offset_y
                row.append(self.new_vert((vx, vy, z), part_tag, mask))
            v_rings.append(row)

        for ri in range(n_rings - 1):
            a, b = v_rings[ri], v_rings[ri + 1]
            v0, v1 = ri / (n_rings - 1), (ri + 1) / (n_rings - 1)
            for k in range(segs):
                kn = (k + 1) % segs
                u0 = swatch_u if swatch_u is not None else (k / segs)
                u1 = swatch_u if swatch_u is not None else ((k + 1) / segs)
                self.add_face(
                    (a[k], a[kn], b[kn], b[k]),
                    (tile_uv(tile, u0, v0), tile_uv(tile, u1, v0), tile_uv(tile, u1, v1), tile_uv(tile, u0, v1)),
                )

        if cap_bot and rings[0][1] > 0.005:
            uv_c = tile_uv(tile, swatch_u if swatch_u is not None else 0.5, 0.0)
            self.add_face(list(reversed(v_rings[0])), [uv_c] * segs)
        if cap_top and rings[-1][1] > 0.005:
            uv_c = tile_uv(tile, swatch_u if swatch_u is not None else 0.5, 1.0)
            self.add_face(v_rings[-1], [uv_c] * segs)

    def add_limb(self, pts, segs: int, tile: int, part_tag: str, mask: tuple[int, int, int, int], swatch_u: float | None = None):
        """pts: [(Vector(x_fwd, y_side, z_up), r_fwd_x, r_side_y), ...]"""
        v_rings = []
        n_pts = len(pts)
        for i, (pt, rx, ry) in enumerate(pts):
            if i == 0:
                tan = (pts[1][0] - pt).normalized()
            elif i == n_pts - 1:
                tan = (pt - pts[i - 1][0]).normalized()
            else:
                tan = (pts[i + 1][0] - pts[i - 1][0]).normalized()
            ref = Vector((1, 0, 0)) if abs(tan.x) < 0.9 else Vector((0, 1, 0))
            u_vec = tan.cross(ref).normalized()
            v_vec = tan.cross(u_vec).normalized()
            row = []
            for k in range(segs):
                ang = 2.0 * math.pi * k / segs
                co = pt + u_vec * (rx * math.cos(ang)) + v_vec * (ry * math.sin(ang))
                row.append(self.new_vert((co.x, co.y, co.z), part_tag, mask))
            v_rings.append(row)

        for ri in range(n_pts - 1):
            a, b = v_rings[ri], v_rings[ri + 1]
            v0, v1 = 1.0 - ri / (n_pts - 1), 1.0 - (ri + 1) / (n_pts - 1)
            for k in range(segs):
                kn = (k + 1) % segs
                u0 = swatch_u if swatch_u is not None else (k / segs)
                u1 = swatch_u if swatch_u is not None else ((k + 1) / segs)
                self.add_face(
                    (a[k], a[kn], b[kn], b[k]),
                    (tile_uv(tile, u0, v0), tile_uv(tile, u1, v0), tile_uv(tile, u1, v1), tile_uv(tile, u0, v1)),
                )

        uv0 = tile_uv(tile, swatch_u if swatch_u is not None else 0.5, 1.0)
        uv1 = tile_uv(tile, swatch_u if swatch_u is not None else 0.5, 0.0)
        self.add_face(list(reversed(v_rings[0])), [uv0] * segs)
        self.add_face(v_rings[-1], [uv1] * segs)

    def add_drape(self, z_levels, u_segs: int, tile: int, part_tag: str, mask: tuple[int, int, int, int], cap_z: float):
        """Partial wrap open at +X (face): sweep from +gap to 2*pi - gap."""
        grid = []
        for zi, (z, rx, ry, xoff, gap, dip) in enumerate(z_levels):
            a_start = gap
            a_end = 2.0 * math.pi - gap
            row = []
            for ui in range(u_segs + 1):
                t = ui / u_segs
                ang = a_start + (a_end - a_start) * t
                vx = rx * math.cos(ang) + xoff
                vy = ry * math.sin(ang)
                vz = z + dip * (1.0 - abs(math.sin(ang)))
                row.append(self.new_vert((vx, vy, vz), part_tag, mask))
            grid.append(row)

        for zi in range(len(grid) - 1):
            v0, v1 = zi / (len(grid) - 1), (zi + 1) / (len(grid) - 1)
            for ui in range(u_segs):
                u0, u1 = ui / u_segs, (ui + 1) / u_segs
                self.add_face(
                    (grid[zi][ui], grid[zi][ui + 1], grid[zi + 1][ui + 1], grid[zi + 1][ui]),
                    (tile_uv(tile, u0, v0), tile_uv(tile, u1, v0), tile_uv(tile, u1, v1), tile_uv(tile, u0, v1)),
                )

        top_c = self.new_vert((0.0, 0.0, cap_z), part_tag, mask)
        top_row = grid[-1]
        for ui in range(u_segs):
            self.add_face(
                (top_row[ui], top_row[ui + 1], top_c),
                (tile_uv(tile, ui / u_segs, 0.9), tile_uv(tile, (ui + 1) / u_segs, 0.9), tile_uv(tile, 0.5, 1.0)),
            )

    def add_iqal(self, center_z: float, r_maj: float, r_min: float, maj_segs: int, min_segs: int):
        tilt = math.radians(-5.0)
        ct, st = math.cos(tilt), math.sin(tilt)
        rings = []
        for i in range(maj_segs):
            th = 2.0 * math.pi * i / maj_segs
            ca, sa = math.cos(th), math.sin(th)
            ring = []
            for j in range(min_segs):
                ph = 2.0 * math.pi * j / min_segs
                r = r_maj + r_min * math.cos(ph)
                lx, ly, lz = r * ca, r * sa, r_min * math.sin(ph)
                rx = lx * ct - lz * st
                rz = lx * st + lz * ct + center_z
                ring.append(self.new_vert((rx, ly, rz), "head", MASK_FIXED))
            rings.append(ring)

        uv = tile_uv(7, 0.12, 0.5)
        for i in range(maj_segs):
            inext = (i + 1) % maj_segs
            for j in range(min_segs):
                jn = (j + 1) % min_segs
                self.add_face((rings[i][j], rings[inext][j], rings[inext][jn], rings[i][jn]), [uv, uv, uv, uv])

    def finalize(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.verts.ensure_lookup_table()
        self.bm.faces.ensure_lookup_table()

        me = bpy.data.meshes.new("TmpExtract")
        self.bm.to_mesh(me)
        me.calc_loop_triangles()

        # Build deduplicated indexed glTF vertex buffer keyed by `(v.index, round(u*4096), round(v*4096), normal_bucket)`
        uv_layer = me.uv_layers.active.data
        positions = []
        normals = []
        uvs = []
        colors = []
        joints = []
        weights = []
        indices = []
        cache: dict[tuple, int] = {}

        for tri in me.loop_triangles:
            for li in tri.loops:
                loop = me.loops[li]
                vi = loop.vertex_index
                co = me.vertices[vi].co
                no = loop.normal
                uv = uv_layer[li].uv

                # Swizzle Blender (+X fwd, +Y left, +Z up) -> crowd-layer glTF (+X fwd, +Y up, +Z right)
                px, py, pz = co.x, co.z, -co.y
                nx, ny, nz = no.x, no.z, -no.y
                nl = math.hypot(nx, ny, nz) or 1.0
                nx, ny, nz = nx / nl, ny / nl, nz / nl

                key = (
                    vi,
                    int(round(uv.x * 2048.0)),
                    int(round(uv.y * 2048.0)),
                    int(round(nx * 64.0)),
                    int(round(ny * 64.0)),
                    int(round(nz * 64.0)),
                )
                idx = cache.get(key)
                if idx is None:
                    idx = len(positions) // 3
                    cache[key] = idx
                    positions.extend((px, py, pz))
                    normals.extend((nx, ny, nz))
                    uvs.extend((uv.x, 1.0 - uv.y))  # glTF image origin is top-left
                    colors.extend(self._vert_mask[vi])
                    j, w = compute_vertex_weights((px, py, pz), self._vert_part[vi])
                    joints.extend(j)
                    weights.extend(w)
                indices.append(idx)

        self.bm.free()
        bpy.data.meshes.remove(me)
        return {
            "positions": positions,
            "normals": normals,
            "uvs": uvs,
            "colors": colors,
            "joints": joints,
            "weights": weights,
            "indices": indices,
            "tris": len(indices) // 3,
        }


def build_archetype_mesh(arch: int, lod: int):
    """
    arch 0..6: gulf_man, south_asian_man, se_asian_man, ihram_man, kaftan_man, abaya_woman, bright_hijab_woman
    lod 0 (high Sample 2), lod 1 (mid Lite)
    """
    b = CharacterBuilder(scale_h=1.75)
    h = 1.75
    is_woman = arch in (5, 6)
    w_s = 0.90 if is_woman else 1.0

    segs = 10 if lod == 0 else 6
    lsegs = 6 if lod == 0 else 4
    pl = 0.032 if lod == 0 else 0.0

    # 1. Sandals / Shoes (feet aligned along +X forward, ±Y left/right)
    for sy in (-0.085, 0.085):
        leg_tag = "leg_l" if sy > 0 else "leg_r"
        rings = (
            [
                (0.004, 0.095, 0.044, 0.02, 0.0),
                (0.048, 0.072, 0.038, 0.005, 0.0),
            ]
            if lod == 1
            else [
                (0.004, 0.095, 0.044, 0.02, 0.0),
                (0.032, 0.084, 0.040, 0.015, 0.0),
                (0.055, 0.056, 0.035, 0.0, 0.0),
            ]
        )
        b.add_lathe(rings, max(4, lsegs), 7, leg_tag, MASK_FIXED, offset_y=sy, swatch_u=0.88)

    # 2. Lower + Upper Torso / Robe
    if arch in (1, 2):  # South Asian Shalwar Kameez / Indonesian Batik + Pants
        for sy in (-0.085, 0.085):
            leg_tag = "leg_l" if sy > 0 else "leg_r"
            pts = (
                [
                    (Vector((0.0, sy, 0.05)), 0.058 if arch == 1 else 0.048, 0.056),
                    (Vector((0.0, sy * 0.72, h * 0.54)), 0.070, 0.068),
                ]
                if lod == 1
                else [
                    (Vector((0.0, sy, 0.05)), 0.058 if arch == 1 else 0.048, 0.056),
                    (Vector((0.0, sy, h * 0.27)), 0.070 if arch == 1 else 0.060, 0.068),
                    (Vector((0.0, sy * 0.72, h * 0.54)), 0.070, 0.068),
                ]
            )
            pant_mask = MASK_ROBE if arch == 1 else MASK_FIXED
            pant_swatch = None if arch == 1 else 0.14  # dark charcoal trousers on SE Asian
            b.add_limb(pts, lsegs, 0 if arch == 1 else 7, leg_tag, pant_mask, swatch_u=pant_swatch)

        if arch == 1:
            # Kameez + olive Sadri waistcoat
            top_rings = (
                [
                    (h * 0.43, 0.138, 0.192, 0.0, 0.0),
                    (h * 0.65, 0.125, 0.172, 0.0, 0.0),
                    (h * 0.77, 0.128, 0.212, 0.0, 0.0),
                    (h * 0.825, 0.098, 0.118, 0.0, 0.0),
                ]
                if lod == 1
                else [
                    (h * 0.43, 0.140, 0.195, 0.0, pl),
                    (h * 0.56, 0.125, 0.168, 0.0, pl * 0.5),
                    (h * 0.67, 0.128, 0.175, 0.0, 0.0),
                    (h * 0.77, 0.130, 0.214, 0.0, 0.0),
                    (h * 0.825, 0.100, 0.120, 0.0, 0.0),
                ]
            )
            b.add_lathe(top_rings, segs, 2, "body", MASK_ROBE)
            if lod == 0:
                b.add_lathe(
                    [
                        (h * 0.58, 0.138, 0.180, 0.0, 0.0),
                        (h * 0.68, 0.141, 0.188, 0.0, 0.0),
                        (h * 0.76, 0.142, 0.198, 0.0, 0.0),
                        (h * 0.818, 0.108, 0.130, 0.0, 0.0),
                    ],
                    segs,
                    7,
                    "body",
                    MASK_FIXED,
                    swatch_u=0.62,
                )
        else:
            # Batik shirt
            top_rings = [
                (h * 0.48, 0.130, 0.178, 0.0, pl * 0.3),
                (h * 0.64, 0.126, 0.174, 0.0, 0.0),
                (h * 0.78, 0.130, 0.214, 0.0, 0.0),
                (h * 0.83, 0.098, 0.116, 0.0, 0.0),
            ]
            b.add_lathe(top_rings, segs, 3, "body", MASK_ROBE)
    elif arch == 3:  # Ihram pilgrim: Izar + belt + torso + diagonal Rida over left shoulder (+Y)
        b.add_lathe(
            [
                (0.055, 0.156, 0.202, 0.0, pl),
                (h * 0.30, 0.144, 0.186, 0.0, pl * 0.7),
                (h * 0.54, 0.136, 0.178, 0.0, 0.0),
            ],
            segs,
            4,
            "body",
            MASK_ROBE,
        )
        # Belt
        if lod == 0:
            b.add_lathe(
                [(h * 0.53, 0.142, 0.184, 0.0, 0.0), (h * 0.56, 0.142, 0.184, 0.0, 0.0)],
                segs,
                7,
                "body",
                MASK_FIXED,
                swatch_u=0.38,
            )
        # Upper chest (skin with bare right shoulder)
        b.add_lathe(
            [
                (h * 0.54, 0.128, 0.168, 0.0, 0.0),
                (h * 0.69, 0.130, 0.182, 0.0, 0.0),
                (h * 0.78, 0.126, 0.208, 0.0, 0.0),
                (h * 0.825, 0.092, 0.112, 0.0, 0.0),
            ],
            segs,
            7,
            "body",
            MASK_SKIN,
            swatch_u=0.38,
        )
        # Diagonal Rida drape over LEFT shoulder (+Y in Blender -> -Z in glTF so RIGHT arm stays bare!)
        b.add_limb(
            [
                (Vector((0.02, -0.15, h * 0.56)), 0.140, 0.055),
                (Vector((0.01, -0.02, h * 0.68)), 0.145, 0.135),
                (Vector((0.00, 0.11, h * 0.78)), 0.125, 0.105),
            ],
            max(6, segs - 2),
            4,
            "body",
            MASK_ROBE,
        )
    else:  # Full-length robes: gulf_man (0), kaftan_man (4), abaya_woman (5), bright_hijab_woman (6)
        tile_main = 0 if arch == 0 else (6 if arch == 4 else (5 if arch == 5 else 2))
        bot_rx = 0.18 if is_woman else 0.162
        bot_ry = 0.245 * w_s if is_woman else 0.212
        rings = (
            [
                (0.055, bot_rx, bot_ry, 0.0, 0.0),
                (h * 0.49, 0.135, 0.175 * w_s, 0.0, 0.0),
                (h * 0.775, 0.132, 0.212 * w_s, 0.0, 0.0),
                (h * 0.83, 0.096, 0.114 * w_s, 0.0, 0.0),
            ]
            if lod == 1
            else [
                (0.055, bot_rx, bot_ry, 0.0, pl),
                (h * 0.27, bot_rx * 0.88, bot_ry * 0.90, 0.0, pl * 0.8),
                (h * 0.49, 0.135, 0.175 * w_s, 0.0, pl * 0.4),
                (h * 0.66, 0.128, 0.172 * w_s, 0.0, 0.0),
                (h * 0.775, 0.132, 0.214 * w_s, 0.0, 0.0),
                (h * 0.83, 0.096, 0.115 * w_s, 0.0, 0.0),
            ]
        )
        b.add_lathe(rings, segs, tile_main, "body", MASK_ROBE)
        if arch == 0 and lod == 0:
            # Crisp Thobe standing collar
            b.add_lathe(
                [(h * 0.82, 0.072, 0.072, 0.0, 0.0), (h * 0.848, 0.068, 0.068, 0.0, 0.0)],
                segs,
                0,
                "body",
                MASK_ROBE,
            )

    # 3. Arms / Sleeves + Hands
    sh_in_y = 0.140 * w_s
    sh_y = 0.200 * w_s
    el_y = 0.212 * w_s
    wr_y = 0.218 * w_s
    sh_z = h * 0.778
    for side in (-1, 1):  # +1 left (+Y), -1 right (-Y)
        arm_tag = "arm_l" if side > 0 else "arm_r"
        # Expose right arm skin on Ihram (`side == -1` in Blender = +Z right side in glTF)
        is_bare = arch == 3 and side == -1
        arm_mask = MASK_SKIN if is_bare else MASK_ROBE
        arm_tile = 7 if is_bare else (3 if arch == 2 else (5 if arch == 5 else (4 if arch == 3 else (2 if arch in (1, 6) else (6 if arch == 4 else 0)))))
        pts = (
            [
                (Vector((0.0, side * sh_in_y, sh_z + 0.006)), 0.048, 0.044),
                (Vector((0.0, side * sh_y, sh_z - 0.032)), 0.056, 0.054),
                (Vector((0.0, side * wr_y, sh_z - h * 0.285)), 0.042, 0.038),
            ]
            if lod == 1
            else [
                (Vector((0.0, side * sh_in_y, sh_z + 0.006)), 0.048, 0.044),
                (Vector((0.0, side * sh_y, sh_z - 0.032)), 0.058, 0.054),
                (Vector((0.0, side * el_y, sh_z - h * 0.155)), 0.050, 0.046),
                (Vector((0.0, side * wr_y, sh_z - h * 0.285)), 0.042, 0.038),
            ]
        )
        b.add_limb(pts, lsegs, arm_tile, arm_tag, arm_mask, swatch_u=0.38 if is_bare else None)
        b.add_limb(
            [
                (Vector((0.0, side * wr_y, sh_z - h * 0.29)), 0.030, 0.024),
                (Vector((0.0, side * (wr_y - 0.004), sh_z - h * 0.36)), 0.026, 0.020),
            ],
            max(4, lsegs - 1),
            7,
            arm_tag,
            MASK_SKIN,
            swatch_u=0.38,
        )

    # 4. Neck & Serene Faceless Head
    neck_z0, head_base_z, head_top_z = h * 0.825, h * 0.865, h
    b.add_lathe(
        [(neck_z0, 0.060, 0.060, 0.0, 0.0), (head_base_z + 0.01, 0.056, 0.056, 0.0, 0.0)],
        max(5, lsegs),
        7,
        "head",
        MASK_SKIN,
        swatch_u=0.38,
    )
    h_rx = 0.102 if is_woman else 0.108
    h_ry = 0.088 if is_woman else 0.094
    head_rings = (
        [
            (head_base_z, h_rx * 0.72, h_ry * 0.66, 0.006, 0.0),
            (head_base_z + 0.09, h_rx, h_ry, -0.002, 0.0),
            (head_top_z, h_rx * 0.42, h_ry * 0.38, -0.004, 0.0),
        ]
        if lod == 1
        else [
            (head_base_z, h_rx * 0.72, h_ry * 0.65, 0.008, 0.0),
            (head_base_z + 0.045, h_rx * 0.96, h_ry * 0.94, 0.004, 0.0),
            (head_base_z + 0.095, h_rx, h_ry, -0.002, 0.0),
            (head_top_z - 0.025, h_rx * 0.88, h_ry * 0.86, -0.004, 0.0),
            (head_top_z, h_rx * 0.38, h_ry * 0.35, -0.004, 0.0),
        ]
    )
    b.add_lathe(head_rings, segs, 7, "head", MASK_SKIN, swatch_u=0.38)

    # 5. Headgear / Modest Hijab
    if arch == 0:  # Saudi Shemagh + Double Iqal
        z_lv = [
            (head_top_z - 0.48, 0.16, 0.24, -0.02, 0.56, -0.03),
            (head_top_z - 0.32, 0.15, 0.21, -0.015, 0.52, 0.0),
            (head_top_z - 0.15, 0.124, 0.132, -0.008, 0.40, 0.0),
            (head_top_z - 0.03, 0.120, 0.118, -0.005, 0.26, 0.0),
            (head_top_z + 0.016, 0.094, 0.092, -0.002, 0.20, 0.0),
        ]
        if lod == 1:
            z_lv = [z_lv[0], z_lv[2], z_lv[4]]
        b.add_drape(z_lv, max(6, segs), 1, "shawl", MASK_HEAD, head_top_z + 0.022)
        if lod == 0:
            b.add_iqal(head_top_z - 0.016, 0.120, 0.013, 12, 5)
            b.add_iqal(head_top_z + 0.008, 0.116, 0.012, 12, 5)
        else:
            b.add_iqal(head_top_z - 0.005, 0.118, 0.015, 8, 4)
    elif arch in (1, 4):  # Rounded Kufi / Taqiyah skullcap
        b.add_lathe(
            [
                (head_top_z - 0.042, 0.109, 0.098, -0.003, 0.0),
                (head_top_z - 0.008, 0.105, 0.095, -0.003, 0.0),
                (head_top_z + 0.016, 0.036, 0.032, -0.003, 0.0),
            ],
            segs,
            7,
            "head",
            MASK_HEAD,
            swatch_u=0.38,
        )
    elif arch == 2:  # Flat crisp Indonesian Songkok
        b.add_lathe(
            [
                (head_top_z - 0.044, 0.114, 0.098, -0.003, 0.0),
                (head_top_z + 0.026, 0.112, 0.094, -0.003, 0.0),
                (head_top_z + 0.036, 0.104, 0.084, -0.003, 0.0),
            ],
            segs,
            7,
            "head",
            MASK_FIXED,
            swatch_u=0.12,
        )
    elif arch in (5, 6):  # Modest draped Shayla / Hijab / Khimar
        z_lv = [
            (head_top_z - 0.35, 0.162, 0.228, -0.004, 0.08, -0.05),
            (head_top_z - 0.23, 0.146, 0.192, -0.004, 0.12, 0.0),
            (head_top_z - 0.15, 0.118, 0.120, -0.004, 0.52, 0.0),
            (head_top_z - 0.04, 0.116, 0.106, -0.004, 0.50, 0.0),
            (head_top_z + 0.016, 0.092, 0.086, -0.002, 0.06, 0.0),
        ]
        if lod == 1:
            z_lv = [z_lv[0], z_lv[2], z_lv[4]]
        b.add_drape(z_lv, max(6, segs), 2, "shawl", MASK_HEAD, head_top_z + 0.022)

    return b.finalize()


def build_lod2_mesh():
    """Ultra-lightweight architectural crowd silhouette (~32 tris) for distant courtyards (`z 17..17.8`)."""
    b = CharacterBuilder(scale_h=1.75)
    h = 1.75
    b.add_lathe(
        [
            (0.02, 0.155, 0.205, 0.0, 0.0),
            (h * 0.78, 0.130, 0.205, 0.0, 0.0),
            (h * 0.85, 0.085, 0.095, 0.0, 0.0),
        ],
        6,
        0,
        "body",
        MASK_ROBE,
        cap_top=True,
        cap_bot=True,
    )
    b.add_lathe(
        [
            (h * 0.85, 0.088, 0.084, 0.0, 0.0),
            (h, 0.072, 0.068, 0.0, 0.0),
        ],
        6,
        7,
        "head",
        MASK_HEAD,
        cap_top=True,
        cap_bot=False,
        swatch_u=0.38,
    )
    return b.finalize()


def pad4(buf: bytearray):
    while len(buf) % 4 != 0:
        buf.append(0)


def write_glb(meshes: list[tuple[str, dict]], atlas_jpg: bytes, out_path: str):
    bin_buf = bytearray()
    buffer_views = []
    accessors = []
    gltf_meshes = []
    gltf_nodes = []

    def add_view(raw: bytes, stride: int | None = None) -> int:
        pad4(bin_buf)
        offset = len(bin_buf)
        bin_buf.extend(raw)
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw)}
        if stride is not None:
            bv["byteStride"] = stride
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_acc(bv: int, comp: int, count: int, acc_type: str, normalized: bool = False, bounds=None) -> int:
        acc = {"bufferView": bv, "componentType": comp, "count": count, "type": acc_type}
        if normalized:
            acc["normalized"] = True
        if bounds is not None:
            acc["min"] = bounds[0]
            acc["max"] = bounds[1]
        accessors.append(acc)
        return len(accessors) - 1

    # Embed JPEG atlas image at index 0
    atlas_bv = add_view(atlas_jpg)

    for mesh_idx, (name, data) in enumerate(meshes):
        v_count = len(data["positions"]) // 3
        pos_arr = np.asarray(data["positions"], dtype=np.float32).reshape(v_count, 3)
        min_p = pos_arr.min(axis=0).tolist()
        max_p = pos_arr.max(axis=0).tolist()

        bv_pos = add_view(pos_arr.tobytes())
        bv_nrm = add_view(np.asarray(data["normals"], dtype=np.float32).tobytes())
        bv_uv = add_view(np.asarray(data["uvs"], dtype=np.float32).tobytes())
        bv_col = add_view(np.asarray(data["colors"], dtype=np.uint8).tobytes())
        bv_jnt = add_view(np.asarray(data["joints"], dtype=np.uint8).tobytes())
        bv_wgt = add_view(np.asarray(data["weights"], dtype=np.uint8).tobytes())
        bv_idx = add_view(np.asarray(data["indices"], dtype=np.uint16).tobytes())

        acc_pos = add_acc(bv_pos, 5126, v_count, "VEC3", bounds=(min_p, max_p))
        acc_nrm = add_acc(bv_nrm, 5126, v_count, "VEC3")
        acc_uv = add_acc(bv_uv, 5126, v_count, "VEC2")
        acc_col = add_acc(bv_col, 5121, v_count, "VEC4", normalized=True)
        acc_jnt = add_acc(bv_jnt, 5121, v_count, "VEC4")
        acc_wgt = add_acc(bv_wgt, 5121, v_count, "VEC4", normalized=True)
        acc_idx = add_acc(bv_idx, 5123, len(data["indices"]), "SCALAR")

        gltf_meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": acc_pos,
                            "NORMAL": acc_nrm,
                            "TEXCOORD_0": acc_uv,
                            "COLOR_0": acc_col,
                            "JOINTS_0": acc_jnt,
                            "WEIGHTS_0": acc_wgt,
                        },
                        "indices": acc_idx,
                        "material": 0,
                        "mode": 4,
                    }
                ],
            }
        )
        gltf_nodes.append({"name": name, "mesh": mesh_idx})

    pad4(bin_buf)
    gltf = {
        "asset": {"version": "2.0", "generator": "haramain-crowd-builder-blender-5.3"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(gltf_nodes)))}],
        "nodes": gltf_nodes,
        "meshes": gltf_meshes,
        "materials": [
            {
                "name": "CrowdFabricAtlas",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.85,
                },
            }
        ],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": atlas_bv, "mimeType": "image/jpeg"}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_buf)}],
    }

    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    while len(json_bytes) % 4 != 0:
        json_bytes.append(0x20)

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buf)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_buf), 0x004E4942))
        f.write(bin_buf)

    gz_len = len(gzip.compress(open(out_path, "rb").read(), compresslevel=9))
    print(f"CROWD_GLB_WRITTEN: {out_path} raw={total_len}B gzip={gz_len}B atlas={len(atlas_jpg)}B meshes={len(meshes)}")
    for name, data in meshes:
        print(f"  {name}: tris={data['tris']} verts={len(data['positions']) // 3}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    atlas_jpg = build_fabric_atlas_jpeg()
    meshes = []
    for lod in (0, 1):
        for arch in range(7):
            meshes.append((f"Archetype_{arch}_LOD{lod}", build_archetype_mesh(arch, lod)))
    meshes.append(("Crowd_LOD2", build_lod2_mesh()))
    write_glb(meshes, atlas_jpg, OUT_GLB)


if __name__ == "__main__":
    main()
