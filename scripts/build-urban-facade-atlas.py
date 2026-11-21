"""
Generate the architectural Trim Sheet Atlas (`scripts/urban-facade-atlas.jpg`, 512x512)
and Glass / Night Emission Mask (`scripts/urban-facade-mask.jpg`, 512x512) for Stage 6
urban surroundings using Blender 5.3.0 bundled numpy + bpy.data.images.

Top-down pixel layout (y in [0, 512), where y=0 is TOP of JPEG = v_gltf=0.0 = v_blender=1.0):
  - Band 0  [  0.. 52) : Islamic Parapet Crown & Frieze (10.1% — crenellated stone, geometric trim, cornice)
  - Band 1  [ 52..176) : Style 0 — Warm Madinah Cream Limestone (24.2% — 2 stacked floors x 4 bays, arched windows + mashrabiya)
  - Band 2  [176..300) : Style 1 — Contemporary Sandstone + Vertical Glass Curtain (24.2% — 2 floors x 4 bays)
  - Band 3  [300..412) : Style 2 — Ivory Travertine + Recessed Ribbon Windows (21.9% — 2 floors x 4 bays, warm gold stringcourses)
  - Band 4  [412..492) : Commercial Arcade Podium 0-9m (15.6% — stone piers, pointed arches, bronze storefront glazing, shop glow)
  - Band 5  [492..512) : Auxiliary Strip (3.9%):
      * x [  0..128) : Dark asphalt with dashed white centerline
      * x [128..256) : Warm travertine sidewalk / promenade paving
      * x [256..384) : Roof terrace concrete gravel & louver trim
      * x [384..448) : Date palm ringed fibrous trunk bark
      * x [448..512) : Deep olive-green date palm frond foliage

Mask channels in `urban-facade-mask.jpg`:
  - R = glassMask (1.0 on windows / curtain glass / shopfront glazing -> Fresnel sky reflection)
  - G = roomMask  (1.0 inside individual hotel room panes with soft curtain borders -> procedural night scatter)
  - B = glowMask  (1.0 on ground commercial shopfronts, canopy soffit, crown uplight trim, lantern heads)

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-urban-facade-atlas.py
"""

from __future__ import annotations

from pathlib import Path
import numpy as np
import bpy

ROOT = Path(__file__).resolve().parent.parent
OUT_ATLAS = ROOT / "scripts" / "urban-facade-atlas.jpg"
OUT_MASK = ROOT / "scripts" / "urban-facade-mask.jpg"

W = 512
H = 512


def fill_rect(buf: np.ndarray, y0: int, y1: int, x0: int, x1: int, rgb: tuple[int, int, int]) -> None:
    y0c, y1c = max(0, y0), min(H, y1)
    x0c, x1c = max(0, x0), min(W, x1)
    if y1c > y0c and x1c > x0c:
        buf[y0c:y1c, x0c:x1c, :3] = np.array(rgb, dtype=np.float32) / 255.0


def add_stone_grain(buf: np.ndarray, y0: int, y1: int, x0: int, x1: int, amp: float = 0.025, seed: int = 7) -> None:
    rng = np.random.default_rng(seed)
    h = max(1, y1 - y0)
    w = max(1, x1 - x0)
    noise = (rng.random((h, w, 1), dtype=np.float32) - 0.5) * 2.0 * amp
    buf[y0:y1, x0:x1, :3] = np.clip(buf[y0:y1, x0:x1, :3] + noise, 0.0, 1.0)


def paint_window_pane(
    albedo: np.ndarray,
    mask: np.ndarray,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    frame_rgb: tuple[int, int, int],
    glass_rgb: tuple[int, int, int],
    sill_rgb: tuple[int, int, int],
    arched: bool = False,
    curtain_glow: bool = True,
) -> None:
    # Outer recessed shadow & stone frame
    fill_rect(albedo, y0, y1, x0, x1, frame_rgb)
    # Stone sill projecting below
    fill_rect(albedo, y1, y1 + 3, max(0, x0 - 2), min(W, x1 + 2), sill_rgb)

    gx0, gx1 = x0 + 3, x1 - 3
    gy0, gy1 = y0 + 3, y1 - 3
    if gx1 <= gx0 or gy1 <= gy0:
        return

    # Paint glass interior with subtle vertical sky/reflection gradient
    gh = gy1 - gy0
    gw = gx1 - gx0
    grad = np.linspace(1.08, 0.78, gh, dtype=np.float32)[:, None, None]
    base_g = np.array(glass_rgb, dtype=np.float32) / 255.0
    pane = np.clip(base_g[None, None, :] * grad, 0.0, 1.0)

    # Mask valid glass shape (rectangular or pointed Islamic arch top)
    yy, xx = np.mgrid[0:gh, 0:gw]
    inside = np.ones((gh, gw), dtype=bool)
    if arched:
        arch_h = max(4, gh // 3)
        cx = (gw - 1) * 0.5
        half_w = max(1.0, gw * 0.5)
        upper = yy < arch_h
        rel_y = (arch_h - yy) / float(arch_h)
        max_dx = half_w * np.sqrt(np.clip(1.0 - np.maximum(rel_y, 0.0) ** 1.6, 0.0, 1.0))
        inside = (~upper) | (np.abs(xx - cx) <= max_dx)

    # Set glass albedo + R glass mask
    cur = albedo[gy0:gy1, gx0:gx1, :3]
    albedo[gy0:gy1, gx0:gx1, :3] = np.where(inside[:, :, None], pane, cur)
    mask[gy0:gy1, gx0:gx1, 0] = np.where(inside, 1.0, mask[gy0:gy1, gx0:gx1, 0])

    # Interior room window mask (G channel) with soft curtain vignetting on left/right edges
    if curtain_glow:
        u_rel = np.abs((xx / max(1.0, gw - 1)) - 0.5) * 2.0
        v_rel = yy / max(1.0, gh - 1)
        curtain = np.clip(1.05 - 0.35 * (u_rel ** 2) - 0.18 * v_rel, 0.35, 1.0)
        mask[gy0:gy1, gx0:gx1, 1] = np.where(inside, curtain, mask[gy0:gy1, gx0:gx1, 1])

    # Fine bronze mullion crossbar in middle
    mid_x = (gx0 + gx1) // 2
    mid_y = gy0 + int(gh * 0.48)
    fill_rect(albedo, gy0, gy1, mid_x, mid_x + 1, frame_rgb)
    fill_rect(albedo, mid_y, mid_y + 2, gx0, gx1, frame_rgb)
    mask[gy0:gy1, mid_x : mid_x + 1, 1] *= 0.25
    mask[mid_y : mid_y + 2, gx0:gx1, 1] *= 0.25


def build_textures() -> None:
    albedo = np.zeros((H, W, 4), dtype=np.float32)
    mask = np.zeros((H, W, 4), dtype=np.float32)
    albedo[:, :, 3] = 1.0
    mask[:, :, 3] = 1.0

    # =========================================================================
    # BAND 0: Islamic Parapet Crown & Carved Geometric Frieze [y: 0..52)
    # =========================================================================
    fill_rect(albedo, 0, 52, 0, W, (228, 214, 186))
    # Dark crenellation cutouts at very top y [0..10)
    fill_rect(albedo, 0, 10, 0, W, (148, 134, 112))
    for x in range(0, W, 32):
        # Stepped merlon tooth
        fill_rect(albedo, 0, 10, x + 4, x + 28, (236, 224, 198))
        fill_rect(albedo, 2, 10, x + 10, x + 22, (244, 234, 210))
    # Bronze cornice & hidden parapet uplight channel y [10..15)
    fill_rect(albedo, 10, 15, 0, W, (176, 146, 86))
    mask[11:14, :, 2] = 0.85  # crown architectural uplight glow (B channel)
    # Carved Islamic diamond & octagonal frieze y [15..42)
    fill_rect(albedo, 15, 42, 0, W, (214, 196, 162))
    for x in range(0, W, 32):
        fill_rect(albedo, 19, 38, x + 3, x + 29, (182, 162, 128))
        fill_rect(albedo, 22, 35, x + 6, x + 26, (232, 218, 190))
        fill_rect(albedo, 25, 32, x + 11, x + 21, (162, 136, 92))
    # Deep shadow soffit & lower molding y [42..52)
    fill_rect(albedo, 42, 46, 0, W, (192, 174, 142))
    fill_rect(albedo, 46, 52, 0, W, (132, 118, 96))
    add_stone_grain(albedo, 0, 52, 0, W, amp=0.022, seed=11)

    # =========================================================================
    # BAND 1: Style 0 — Warm Madinah Cream Limestone (2 floors) [y: 52..176)
    # =========================================================================
    fill_rect(albedo, 52, 176, 0, W, (236, 222, 194))
    # Horizontal ashlar stone seams
    for y in range(52, 176, 12):
        fill_rect(albedo, y, y + 1, 0, W, (212, 196, 166))
    # 2 floors x 4 bays = 8 window bays (each floor 62px tall, bay 128px wide)
    for fy in (52, 114):
        # Floor spandrel belt course & mashrabiya relief panel
        fill_rect(albedo, fy + 48, fy + 62, 0, W, (218, 200, 168))
        fill_rect(albedo, fy + 52, fy + 58, 0, W, (198, 178, 144))
        for bx in range(0, W, 64):
            # Subtle vertical limestone pilaster between bays
            if bx % 128 == 0:
                fill_rect(albedo, fy, fy + 62, bx, bx + 10, (242, 231, 208))
                fill_rect(albedo, fy, fy + 62, W - 6, W, (242, 231, 208))
            # Arched double-bay hotel window
            paint_window_pane(
                albedo,
                mask,
                fy + 6,
                fy + 45,
                bx + 16,
                bx + 54,
                frame_rgb=(98, 78, 52),
                glass_rgb=(36, 54, 72),
                sill_rgb=(205, 186, 152),
                arched=True,
            )
            # Carved spandrel medallion under window
            fill_rect(albedo, fy + 50, fy + 59, bx + 20, bx + 50, (186, 166, 134))
            fill_rect(albedo, fy + 52, fy + 57, bx + 25, bx + 45, (216, 198, 166))
    add_stone_grain(albedo, 52, 176, 0, W, amp=0.020, seed=21)

    # =========================================================================
    # BAND 2: Style 1 — Sandstone Pilasters + Vertical Glass Curtain [y: 176..300)
    # =========================================================================
    fill_rect(albedo, 176, 300, 0, W, (214, 198, 172))
    for bx in range(0, W, 64):
        # Vertical travertine pier column
        fill_rect(albedo, 176, 300, bx, bx + 14, (230, 218, 194))
        fill_rect(albedo, 176, 300, bx + 12, bx + 14, (176, 162, 138))
        # Continuous dark-bronze tinted curtain glass bay across 2 floors with dark spandrel band
        for fy in (176, 238):
            paint_window_pane(
                albedo,
                mask,
                fy + 4,
                fy + 50,
                bx + 16,
                bx + 60,
                frame_rgb=(62, 56, 50),
                glass_rgb=(30, 48, 66),
                sill_rgb=(88, 82, 74),
                arched=False,
            )
            # Smoked curtain spandrel glass panel between floors
            fill_rect(albedo, fy + 50, fy + 62, bx + 16, bx + 60, (42, 50, 60))
            mask[fy + 51 : fy + 61, bx + 17 : bx + 59, 0] = 0.72  # reflective spandrel glass
    add_stone_grain(albedo, 176, 300, 0, W, amp=0.016, seed=31)

    # =========================================================================
    # BAND 3: Style 2 — Ivory Travertine + Recessed Ribbon Windows [y: 300..412)
    # =========================================================================
    fill_rect(albedo, 300, 412, 0, W, (242, 232, 212))
    for fy in (300, 356):
        # Projecting limestone floor slab & warm gold-ochre reveal trim
        fill_rect(albedo, fy + 42, fy + 56, 0, W, (226, 212, 184))
        fill_rect(albedo, fy + 45, fy + 49, 0, W, (186, 152, 92))
        fill_rect(albedo, fy + 52, fy + 55, 0, W, (198, 184, 158))
        for bx in range(0, W, 64):
            fill_rect(albedo, fy, fy + 42, bx, bx + 8, (245, 236, 218))
            paint_window_pane(
                albedo,
                mask,
                fy + 5,
                fy + 40,
                bx + 10,
                bx + 58,
                frame_rgb=(86, 74, 58),
                glass_rgb=(40, 58, 74),
                sill_rgb=(210, 194, 164),
                arched=False,
            )
    add_stone_grain(albedo, 300, 412, 0, W, amp=0.018, seed=41)

    # =========================================================================
    # BAND 4: Commercial Arcade Podium 0..8.8m [y: 412..492)
    # =========================================================================
    # Warm stone podium background + top cornice (y 412..422) + mezzanine (422..452) + ground colonnade (452..492)
    fill_rect(albedo, 412, 492, 0, W, (216, 198, 166))
    fill_rect(albedo, 412, 418, 0, W, (236, 224, 198))
    fill_rect(albedo, 418, 422, 0, W, (152, 134, 104))
    # Mezzanine commercial arched windows y [423..449)
    for bx in range(0, W, 64):
        fill_rect(albedo, 422, 492, bx, bx + 11, (226, 210, 180))  # strong arcade stone pier
        paint_window_pane(
            albedo,
            mask,
            424,
            448,
            bx + 14,
            bx + 58,
            frame_rgb=(74, 58, 42),
            glass_rgb=(54, 62, 68),
            sill_rgb=(190, 172, 140),
            arched=True,
        )
        # Warm lit retail shop interior behind glass on ground floor y [454..492)
        fill_rect(albedo, 452, 492, bx + 13, bx + 61, (194, 174, 140))  # stone arch hood
        fill_rect(albedo, 456, 492, bx + 15, bx + 59, (74, 56, 40))    # bronze storefront frame
        # Warm shopfront window interior (cream-amber lit retail display)
        fill_rect(albedo, 459, 490, bx + 18, bx + 56, (186, 144, 92))
        fill_rect(albedo, 461, 476, bx + 20, bx + 54, (228, 192, 134))
        # Dark granite plinth at sidewalk line y [487..492)
        fill_rect(albedo, 487, 492, bx, bx + 13, (124, 114, 102))
        mask[459:488, bx + 18 : bx + 56, 0] = 0.85  # storefront glass reflection
        mask[459:488, bx + 18 : bx + 56, 2] = 0.92  # commercial ground floor warm night glow (B channel)
    add_stone_grain(albedo, 412, 492, 0, W, amp=0.022, seed=51)

    # =========================================================================
    # BAND 5: Auxiliary Strip [y: 492..512)
    # =========================================================================
    # 5a. Asphalt road with dashed white center markings [x: 0..128)
    fill_rect(albedo, 492, 512, 0, 128, (54, 58, 65))
    add_stone_grain(albedo, 492, 512, 0, 128, amp=0.032, seed=61)
    # Edge curb wear & dashed center stripe
    fill_rect(albedo, 493, 494, 0, 128, (152, 150, 144))
    fill_rect(albedo, 510, 511, 0, 128, (152, 150, 144))
    fill_rect(albedo, 501, 503, 18, 64, (225, 224, 218))
    fill_rect(albedo, 501, 503, 86, 118, (225, 224, 218))

    # 5b. Travertine sidewalk / median stone [x: 128..256)
    fill_rect(albedo, 492, 512, 128, 256, (206, 194, 170))
    for x in range(128, 256, 16):
        fill_rect(albedo, 492, 512, x, x + 1, (176, 164, 142))
    add_stone_grain(albedo, 492, 512, 128, 256, amp=0.025, seed=62)

    # 5c. Roof terrace gravel & bronze/steel MEP louver grid [x: 256..384)
    fill_rect(albedo, 492, 512, 256, 384, (176, 166, 150))
    add_stone_grain(albedo, 492, 512, 256, 384, amp=0.035, seed=63)
    for y in range(495, 510, 4):
        fill_rect(albedo, y, y + 1, 260, 380, (124, 116, 104))

    # 5d. Date palm trunk fibrous bark [x: 384..448)
    fill_rect(albedo, 492, 512, 384, 448, (112, 84, 58))
    for y in range(493, 512, 4):
        fill_rect(albedo, y, y + 2, 384, 448, (86, 62, 42))
    add_stone_grain(albedo, 492, 512, 384, 448, amp=0.03, seed=64)

    # 5e. Deep olive-green palm frond [x: 448..512)
    fill_rect(albedo, 492, 512, 448, 512, (62, 98, 42))
    for x in range(450, 512, 6):
        fill_rect(albedo, 492, 512, x, x + 2, (82, 120, 54))
    add_stone_grain(albedo, 492, 512, 448, 512, amp=0.025, seed=65)

    # Save via bpy.data.images (note: Blender image buffer is bottom-up, so flip vertically)
    def save_jpeg(arr: np.ndarray, out_path: Path, quality: int) -> None:
        scene = bpy.context.scene
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = quality
        # Subtle linear compensation so shader color stays warm and legible under glTF sRGB decoding
        flipped = np.ascontiguousarray(arr[::-1, :, :], dtype=np.float32)
        img = bpy.data.images.new(out_path.stem, width=W, height=H, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color" if "mask" in out_path.name else "sRGB"
        img.pixels.foreach_set(flipped.ravel())
        img.save_render(filepath=str(out_path), scene=scene)
        bpy.data.images.remove(img)
        print(f"Saved {out_path} ({out_path.stat().st_size} bytes)")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    save_jpeg(albedo, OUT_ATLAS, quality=78)
    save_jpeg(mask, OUT_MASK, quality=76)


if __name__ == "__main__":
    build_textures()
