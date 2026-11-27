"""
Build the Stage 6 hotel zone GLBs (`public/models/urban-{south,west,north,sw}-stage6.glb`) and the
Stage 7 context GLB (`public/models/urban-context-stage7.glb`) from `data/urban-approved.json`
and the architectural Trim Sheet Atlas (`scripts/urban-facade-atlas.jpg`
& `scripts/urban-facade-mask.jpg`) in Blender 5.3.0.

Coordinate frame matches `src/domain/frames.ts` & `src/map/glb-layer.ts`:
  - Blender world: X = east (m), Y = -south / north (m), Z = up (m) relative to ORIGIN_LNG/LAT
  - glTF (export_yup=True): X = east, Y = up, Z = south

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-urban-glb.py -- --zone all
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
INPUT_JSON = ROOT / "data" / "urban-approved.json"
FENCE_JSON = ROOT / "data" / "haram-fence.json"
ATLAS_JPG = ROOT / "scripts" / "urban-facade-atlas.jpg"
MASK_JPG = ROOT / "scripts" / "urban-facade-mask.jpg"

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_RADIUS_M = 6_371_008.8
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M
ATLAS_H = 512.0
ATLAS_W = 512.0
MAX_GZIP_BYTES = 250 * 1024

# Pixel bands (top-down y in [0, 512)) from `build-urban-facade-atlas.py` with 1px inner margin.
BAND_CROWN = (1.0, 51.0)
BAND_PODIUM = (413.0, 491.0)
BAND_CORNICE = (413.0, 420.0)
UV_ROOF_PATCH = (262.0 / ATLAS_W, 378.0 / ATLAS_W, 494.0, 510.0)
UV_GLOW_PATCH = (22.0 / ATLAS_W, 50.0 / ATLAS_W, 463.0, 484.0)
UV_STONE_PATCH = (2.0 / ATLAS_W, 10.0 / ATLAS_W, 54.0, 62.0)


def v_px(y_top_down: float) -> float:
    """Convert top-down atlas pixel coordinate to Blender UV V (glTF exports `1 - v_blender`)."""
    return 1.0 - (y_top_down / ATLAS_H)


def _mercator_x(lng: float) -> float:
    return (180.0 + lng) / 360.0


def _mercator_y(lat: float) -> float:
    return (180.0 - (180.0 / math.pi) * math.log(math.tan(math.pi / 4.0 + (lat * math.pi) / 360.0))) / 360.0


ORIGIN_MX = _mercator_x(ORIGIN_LNG)
ORIGIN_MY = _mercator_y(ORIGIN_LAT)
MODEL_METRE_UNITS = (1.0 / EARTH_CIRCUMFERENCE_M) * (1.0 / math.cos(math.radians(ORIGIN_LAT)))


def to_blender_xy(lng: float, lat: float) -> tuple[float, float]:
    """Return `(east, -south)` metres in Blender space matching `toModelMetres`."""
    east = (_mercator_x(lng) - ORIGIN_MX) / MODEL_METRE_UNITS
    south = (_mercator_y(lat) - ORIGIN_MY) / MODEL_METRE_UNITS
    return east, -south


def signed_area(pts: list[tuple[float, float]]) -> float:
    a = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return 0.5 * a


def clean_polygon(ring_lng_lat: list[list[float]]) -> list[tuple[float, float]]:
    raw = [to_blender_xy(c[0], c[1]) for c in ring_lng_lat[:-1]]
    dedup: list[tuple[float, float]] = []
    for p in raw:
        if not dedup or math.hypot(p[0] - dedup[-1][0], p[1] - dedup[-1][1]) > 0.25:
            dedup.append(p)
    if len(dedup) >= 2 and math.hypot(dedup[0][0] - dedup[-1][0], dedup[0][1] - dedup[-1][1]) <= 0.25:
        dedup.pop()
    if len(dedup) < 3:
        dedup = raw[:]

    out = dedup[:]
    changed = True
    while changed and len(out) > 4:
        changed = False
        nxt: list[tuple[float, float]] = []
        n = len(out)
        for i in range(n):
            a = out[(i - 1) % n]
            b = out[i]
            c = out[(i + 1) % n]
            abx, aby = b[0] - a[0], b[1] - a[1]
            bcx, bcy = c[0] - b[0], c[1] - b[1]
            la = math.hypot(abx, aby)
            lc = math.hypot(bcx, bcy)
            if la > 1e-6 and lc > 1e-6:
                sin_ang = abs(abx * bcy - aby * bcx) / (la * lc)
                if sin_ang < 0.025 and (abx * bcx + aby * bcy) > 0:
                    changed = True
                    continue
            nxt.append(b)
        if len(nxt) >= 3:
            out = nxt

    if signed_area(out) < 0:
        out.reverse()
    return out


def simplify_polyline(pts: list[tuple[float, float]], tol: float = 0.65) -> list[tuple[float, float]]:
    if len(pts) <= 2:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        ax, ay = out[-1]
        if math.hypot(p[0] - ax, p[1] - ay) >= tol:
            out.append(p)
    out.append(pts[-1])
    if len(out) <= 2:
        return out
    res = [out[0]]
    for i in range(1, len(out) - 1):
        ax, ay = res[-1]
        bx, by = out[i]
        cx, cy = out[i + 1]
        dx, dy = cx - ax, cy - ay
        l = math.hypot(dx, dy)
        if l > 1e-6:
            perp = abs((bx - ax) * dy - (by - ay) * dx) / l
            if perp < tol:
                continue
        res.append(out[i])
    res.append(out[-1])
    return res


def point_in_poly(p: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[(i - 1) % n]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def poly_centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    a = signed_area(pts)
    if abs(a) < 1e-4:
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    cx = 0.0
    cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    return cx / (6.0 * a), cy / (6.0 * a)


def offset_polygon(pts: list[tuple[float, float]], offset_m: float) -> list[tuple[float, float]] | None:
    """Offset a CCW 2D polygon (`offset_m < 0` inward, `> 0` outward), returning None if degenerate."""
    n = len(pts)
    if n < 3:
        return None
    orig_area = abs(signed_area(pts))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_dim = min(max(xs) - min(xs), max(ys) - min(ys))
    if offset_m < 0 and (orig_area < 25.0 or abs(offset_m) > 0.14 * min_dim):
        return None

    lines: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for i in range(n):
        p0 = pts[i]
        p1 = pts[(i + 1) % n]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        elen = math.hypot(dx, dy)
        if elen < 1e-6:
            return None
        nx, ny = dy / elen, -dx / elen
        lines.append(((p0[0] + nx * offset_m, p0[1] + ny * offset_m), (dx / elen, dy / elen)))

    res: list[tuple[float, float]] = []
    limit = max(1.0, abs(offset_m) * 3.5)
    for i in range(n):
        (p0x, p0y), (d0x, d0y) = lines[(i - 1) % n]
        (p1x, p1y), (d1x, d1y) = lines[i]
        det = d0x * d1y - d0y * d1x
        if abs(det) < 1e-3:
            cand = (pts[i][0] + d1y * offset_m, pts[i][1] - d1x * offset_m)
        else:
            t = ((p1x - p0x) * d1y - (p1y - p0y) * d1x) / det
            cand = (p0x + t * d0x, p0y + t * d0y)
        if math.hypot(cand[0] - pts[i][0], cand[1] - pts[i][1]) > limit:
            return None
        res.append(cand)

    new_area = signed_area(res)
    if new_area <= 0:
        return None
    if offset_m < 0 and new_area < 0.42 * orig_area:
        return None
    return res


def add_uv_quad(
    bm: bmesh.types.BMesh,
    uv_layer: bmesh.types.BMLayerItem,
    coords: tuple[tuple[float, float, float], ...],
    uvs: tuple[tuple[float, float], ...],
    mat_idx: int = 0,
) -> None:
    verts = [bm.verts.new(c) for c in coords]
    try:
        f = bm.faces.new(verts)
    except ValueError:
        return
    f.material_index = mat_idx
    for loop, uv in zip(f.loops, uvs):
        loop[uv_layer].uv = uv


def add_wall_ring(
    bm: bmesh.types.BMesh,
    uv_layer: bmesh.types.BMLayerItem,
    pts: list[tuple[float, float]],
    z0: float,
    z1: float,
    v_gltf_bot: float,
    v_gltf_top: float,
    inward: bool = False,
    mat_idx: int = 0,
) -> None:
    vb0 = 1.0 - v_gltf_bot
    vb1 = 1.0 - v_gltf_top
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        elen = math.hypot(x1 - x0, y1 - y0)
        if elen < 0.05:
            continue
        bays = max(1, round(elen / 2.0))
        u1 = bays / 8.0
        if not inward:
            add_uv_quad(
                bm,
                uv_layer,
                ((x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)),
                ((0.0, vb0), (u1, vb0), (u1, vb1), (0.0, vb1)),
                mat_idx,
            )
        else:
            add_uv_quad(
                bm,
                uv_layer,
                ((x1, y1, z0), (x0, y0, z0), (x0, y0, z1), (x1, y1, z1)),
                ((0.0, vb0), (u1, vb0), (u1, vb1), (0.0, vb1)),
                mat_idx,
            )


def _cross2(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _pt_in_tri(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> bool:
    c1 = _cross2(a, b, p)
    c2 = _cross2(b, c, p)
    c3 = _cross2(c, a, p)
    return c1 >= -1e-9 and c2 >= -1e-9 and c3 >= -1e-9


def _same_pt(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return abs(a[0] - b[0]) < 1e-7 and abs(a[1] - b[1]) < 1e-7


def _bridge_holes(outer_ccw: list[tuple[float, float]], holes_ccw: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    """Connect CCW inner holes into a CCW outer ring using Eberly's mutually-visible bridge cut."""
    merged = list(outer_ccw)
    # Process holes from rightmost maximum-X to leftmost so each +X ray only hits already-merged boundary.
    ordered_holes = []
    for h in holes_ccw:
        cw = list(reversed(h)) if signed_area(h) > 0 else list(h)
        m_idx = max(range(len(cw)), key=lambda i: (cw[i][0], cw[i][1]))
        ordered_holes.append((cw[m_idx][0], m_idx, cw))
    ordered_holes.sort(key=lambda t: t[0], reverse=True)

    for _, m_idx, hole_cw in ordered_holes:
        mx, my = hole_cw[m_idx]
        n = len(merged)
        best_x = float("inf")
        hit_edge = -1
        hit_vertex = -1
        for i in range(n):
            a = merged[i]
            b = merged[(i + 1) % n]
            # Consider edges straddling horizontal ray +X from (mx, my)
            if (a[1] <= my <= b[1]) or (b[1] <= my <= a[1]):
                if abs(a[1] - b[1]) < 1e-9:
                    if abs(a[1] - my) < 1e-9:
                        for vi, vp in ((i, a), ((i + 1) % n, b)):
                            if vp[0] >= mx - 1e-9 and vp[0] < best_x:
                                best_x = vp[0]
                                hit_vertex = vi
                                hit_edge = i
                    continue
                t = (my - a[1]) / (b[1] - a[1])
                ix = a[0] + t * (b[0] - a[0])
                if ix >= mx - 1e-9 and ix < best_x:
                    best_x = ix
                    hit_edge = i
                    if abs(t) < 1e-9:
                        hit_vertex = i
                    elif abs(t - 1.0) < 1e-9:
                        hit_vertex = (i + 1) % n
                    else:
                        hit_vertex = -1
        assert hit_edge >= 0, f"Bridge ray failed for hole vertex {(mx, my)}"

        if hit_vertex >= 0:
            p_idx = hit_vertex
        else:
            a_i = hit_edge
            b_i = (hit_edge + 1) % n
            p_idx = a_i if merged[a_i][0] >= merged[b_i][0] else b_i
            m_pt = (mx, my)
            i_pt = (best_x, my)
            p_pt = merged[p_idx]
            # Orient search triangle (m_pt, i_pt, p_pt) CCW
            tri = (m_pt, i_pt, p_pt) if _cross2(m_pt, i_pt, p_pt) >= 0 else (m_pt, p_pt, i_pt)
            best_ang = float("inf")
            best_dist = float("inf")
            best_reflex = -1
            for k in range(n):
                if k == p_idx:
                    continue
                vk = merged[k]
                if _same_pt(vk, m_pt) or _same_pt(vk, p_pt):
                    continue
                prev_v = merged[(k - 1) % n]
                next_v = merged[(k + 1) % n]
                if _cross2(prev_v, vk, next_v) < -1e-9 and _pt_in_tri(vk, *tri):
                    dx = vk[0] - mx
                    dy = abs(vk[1] - my)
                    ang = math.atan2(dy, max(dx, 1e-12))
                    dist = math.hypot(dx, dy)
                    if ang < best_ang - 1e-9 or (abs(ang - best_ang) <= 1e-9 and dist < best_dist):
                        best_ang = ang
                        best_dist = dist
                        best_reflex = k
            if best_reflex >= 0:
                p_idx = best_reflex

        rotated_hole = hole_cw[m_idx:] + hole_cw[:m_idx]
        merged = merged[: p_idx + 1] + rotated_hole + [hole_cw[m_idx], merged[p_idx]] + merged[p_idx + 1 :]
    return merged


def triangulate_poly_with_holes(
    outer_ccw: list[tuple[float, float]], holes_ccw: list[list[tuple[float, float]]]
) -> list[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]]:
    """Triangulate a CCW polygon with CCW holes into CCW triangles via bridge-cut + ear-clipping."""
    ring = _bridge_holes(outer_ccw, holes_ccw)
    pts = list(ring)
    tris: list[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]] = []
    guard = len(pts) * len(pts) + 20
    while len(pts) > 3 and guard > 0:
        guard -= 1
        n = len(pts)
        clipped = False
        for pass_eps in (1e-9, -1e-9):
            for i in range(n):
                a = pts[(i - 1) % n]
                b = pts[i]
                c = pts[(i + 1) % n]
                area2 = _cross2(a, b, c)
                if area2 <= pass_eps:
                    continue
                ok = True
                for j in range(n):
                    if j == (i - 1) % n or j == i or j == (i + 1) % n:
                        continue
                    v = pts[j]
                    if _same_pt(v, a) or _same_pt(v, b) or _same_pt(v, c):
                        continue
                    if _pt_in_tri(v, a, b, c):
                        ok = False
                        break
                if ok:
                    if area2 > 1e-7:
                        tris.append((a, b, c))
                    pts.pop(i)
                    clipped = True
                    break
            if clipped:
                break
        if not clipped:
            # Remove zero-area collinear/bridge vertex if stalled
            removed = False
            for i in range(n):
                a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
                if abs(_cross2(a, b, c)) <= 1e-6:
                    pts.pop(i)
                    removed = True
                    break
            if not removed:
                break
    if len(pts) == 3 and _cross2(pts[0], pts[1], pts[2]) > 1e-7:
        tris.append((pts[0], pts[1], pts[2]))

    expected_area = abs(signed_area(outer_ccw)) - sum(abs(signed_area(h)) for h in holes_ccw)
    tri_area = sum(0.5 * _cross2(a, b, c) for a, b, c in tris)
    if abs(tri_area - expected_area) > max(1.0, expected_area * 0.01):
        raise RuntimeError(f"Holed roof triangulation area mismatch: got {tri_area:.2f} vs expected {expected_area:.2f}")
    return tris


def add_cap_poly(
    bm: bmesh.types.BMesh,
    uv_layer: bmesh.types.BMLayerItem,
    pts: list[tuple[float, float]],
    z: float,
    uv_patch: tuple[float, float, float, float],
    flip_down: bool = False,
    mat_idx: int = 0,
    holes: list[list[tuple[float, float]]] | None = None,
) -> None:
    u0, u1, y_top, y_bot = uv_patch
    v_top, v_bot = v_px(y_top), v_px(y_bot)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    span_x = max(max(xs) - min(xs), 1.0)
    span_y = max(max(ys) - min(ys), 1.0)
    min_x, min_y = min(xs), min(ys)

    if holes:
        tris = triangulate_poly_with_holes(pts, holes)
        for a, b, c in tris:
            tri = (c, b, a) if flip_down else (a, b, c)
            verts = [bm.verts.new((x, y, z)) for (x, y) in tri]
            try:
                f = bm.faces.new(verts)
            except ValueError:
                continue
            f.material_index = mat_idx
            for loop in f.loops:
                vx, vy, _ = loop.vert.co
                tx = (vx - min_x) / span_x
                ty = (vy - min_y) / span_y
                loop[uv_layer].uv = (u0 + tx * (u1 - u0), v_bot + ty * (v_top - v_bot))
        return

    ring = pts[::-1] if flip_down else pts
    verts = [bm.verts.new((x, y, z)) for (x, y) in ring]
    try:
        f = bm.faces.new(verts)
    except ValueError:
        return
    f.material_index = mat_idx
    for loop in f.loops:
        vx, vy, _ = loop.vert.co
        tx = (vx - min_x) / span_x
        ty = (vy - min_y) / span_y
        loop[uv_layer].uv = (u0 + tx * (u1 - u0), v_bot + ty * (v_top - v_bot))


def add_box(
    bm: bmesh.types.BMesh,
    uv_layer: bmesh.types.BMLayerItem | None,
    p_min: tuple[float, float, float],
    p_max: tuple[float, float, float],
    yaw_rad: float = 0.0,
    center_xy: tuple[float, float] = (0.0, 0.0),
    uv_side: tuple[float, float, float, float] = UV_STONE_PATCH,
    uv_bottom: tuple[float, float, float, float] | None = None,
    mat_idx: int = 0,
) -> None:
    x0, y0, z0 = p_min
    x1, y1, z1 = p_max
    ca, sa = math.cos(yaw_rad), math.sin(yaw_rad)
    cx, cy = center_xy

    def xf(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, lz)

    b0, b1, b2, b3 = xf(x0, y0, z0), xf(x1, y0, z0), xf(x1, y1, z0), xf(x0, y1, z0)
    t0, t1, t2, t3 = xf(x0, y0, z1), xf(x1, y0, z1), xf(x1, y1, z1), xf(x0, y1, z1)

    su0, su1, sy0, sy1 = uv_side
    sv0, sv1 = v_px(sy1), v_px(sy0)
    side_uv = ((su0, sv0), (su1, sv0), (su1, sv1), (su0, sv1))

    bu0, bu1, by0, by1 = uv_bottom or uv_side
    bv0, bv1 = v_px(by1), v_px(by0)
    bot_uv = ((bu0, bv0), (bu1, bv0), (bu1, bv1), (bu0, bv1))

    faces = [
        ((b0, b1, t1, t0), side_uv),
        ((b1, b2, t2, t1), side_uv),
        ((b2, b3, t3, t2), side_uv),
        ((b3, b0, t0, t3), side_uv),
        ((t0, t1, t2, t3), side_uv),
        ((b3, b2, b1, b0), bot_uv),
    ]
    for coords, uvs in faces:
        verts = [bm.verts.new(c) for c in coords]
        try:
            f = bm.faces.new(verts)
        except ValueError:
            continue
        f.material_index = mat_idx
        if uv_layer is not None:
            for loop, uv in zip(f.loops, uvs):
                loop[uv_layer].uv = uv


def build_hotel_mesh(b: dict, mat_facade: bpy.types.Material) -> bpy.types.Object:
    pts = clean_polygon(b["polygon"])
    raw_holes = [clean_polygon(hr) for hr in (b.get("holes") or []) if len(hr) >= 4]
    holes = [hp for hp in raw_holes if len(hp) >= 3 and abs(signed_area(hp)) >= 10.0 and all(point_in_poly(p, pts) for p in hp)]
    h = float(b["heightM"])
    style_id = int(b.get("styleId", 0)) % 3
    podium_h = 8.8
    cornice_h = 9.1
    crown_bot = max(cornice_h + 3.15, h - 2.2)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # 1. Commercial Arcade Podium (0.0 -> 8.8 m) + projecting stone cornice (8.6 -> 9.1 m)
    add_wall_ring(bm, uv_layer, pts, 0.0, podium_h, BAND_PODIUM[1] / ATLAS_H, BAND_PODIUM[0] / ATLAS_H, inward=False)
    for hp in holes:
        add_wall_ring(bm, uv_layer, hp, 0.0, cornice_h, BAND_PODIUM[1] / ATLAS_H, BAND_PODIUM[0] / ATLAS_H, inward=True)
    cornice_pts = offset_polygon(pts, 0.28)
    if cornice_pts is not None:
        add_wall_ring(bm, uv_layer, cornice_pts, 8.6, cornice_h, BAND_CORNICE[1] / ATLAS_H, BAND_CORNICE[0] / ATLAS_H, inward=False)
        add_cap_poly(bm, uv_layer, cornice_pts, cornice_h, UV_STONE_PATCH, flip_down=False, holes=holes)
    else:
        add_cap_poly(bm, uv_layer, pts, cornice_h, UV_STONE_PATCH, flip_down=False, holes=holes)

    # 2. Hotel Entrance Canopy on edge closest to `entrance` (context buildings have none)
    ex, ey = to_blender_xy(b["entrance"][1], b["entrance"][0]) if b.get("entrance") else (float("inf"), float("inf"))
    best_edge = 0
    best_d = float("inf")
    best_proj = pts[0]
    for i in range(len(pts)):
        a, c = pts[i], pts[(i + 1) % len(pts)]
        dx, dy = c[0] - a[0], c[1] - a[1]
        l2 = dx * dx + dy * dy
        if l2 < 4.0:
            continue
        t = max(0.15, min(0.85, ((ex - a[0]) * dx + (ey - a[1]) * dy) / l2))
        px, py = a[0] + t * dx, a[1] + t * dy
        d = math.hypot(ex - px, ey - py)
        if d < best_d:
            best_d = d
            best_edge = i
            best_proj = (px, py)
    ea, eb = pts[best_edge], pts[(best_edge + 1) % len(pts)]
    edx, edy = eb[0] - ea[0], eb[1] - ea[1]
    elen = math.hypot(edx, edy)
    if elen >= 2.6 and b.get("entrance"):
        canopy_w = min(4.6, elen * 0.55)
        add_box(
            bm,
            uv_layer,
            (-canopy_w * 0.5, -1.45, 3.8),
            (canopy_w * 0.5, 0.05, 4.2),
            yaw_rad=math.atan2(edy, edx),
            center_xy=best_proj,
            uv_side=UV_STONE_PATCH,
            uv_bottom=UV_GLOW_PATCH,
        )

    # 3. Modular Tower Body (9.1 m -> crown_bot) as 1 clean vertical ring!
    # Encode `v_gltf = 2.0 + style_id * 10.0 + cycles` (2 floors = 6.30 m = 1.0 cycle)
    # so the WebGL2 shader folds cleanly into the style band with exact 3.15 m/floor proportions!
    inset_m = -0.35 if b["areaM2"] >= 600 else -0.20
    cand_tower = offset_polygon(pts, inset_m)
    if cand_tower is not None and all(all(point_in_poly(p, cand_tower) for p in hp) for hp in holes):
        tower_pts = cand_tower
    else:
        tower_pts = pts
    shaft_h = crown_bot - cornice_h
    n_floors = max(1, round(shaft_h / 3.15))
    cycles = n_floors * 0.5
    v_gltf_bot = 2.0 + style_id * 10.0
    v_gltf_top = v_gltf_bot + cycles
    add_wall_ring(bm, uv_layer, tower_pts, cornice_h, crown_bot, v_gltf_bot, v_gltf_top, inward=False)
    for hp in holes:
        add_wall_ring(bm, uv_layer, hp, cornice_h, crown_bot, v_gltf_bot, v_gltf_top, inward=True)

    # 4. Islamic Parapet Crown (crown_bot -> H) & Roof + Low MEP Louver Penthouse + North Roof Sign
    add_wall_ring(bm, uv_layer, tower_pts, crown_bot, h, BAND_CROWN[1] / ATLAS_H, BAND_CROWN[0] / ATLAS_H, inward=False)
    for hp in holes:
        add_wall_ring(bm, uv_layer, hp, crown_bot, h, BAND_CROWN[1] / ATLAS_H, BAND_CROWN[0] / ATLAS_H, inward=True)
    add_cap_poly(bm, uv_layer, tower_pts, h, UV_ROOF_PATCH, flip_down=False, holes=holes)

    cx, cy = poly_centroid(tower_pts)
    xs = [p[0] for p in tower_pts]
    ys = [p[1] for p in tower_pts]
    mep_hx = max(1.4, min(4.2, (max(xs) - min(xs)) * 0.16))
    mep_hy = max(1.4, min(4.2, (max(ys) - min(ys)) * 0.16))
    mep_corners = [
        (cx - mep_hx, cy - mep_hy),
        (cx + mep_hx, cy - mep_hy),
        (cx + mep_hx, cy + mep_hy),
        (cx - mep_hx, cy + mep_hy),
        (cx, cy),
    ]
    if all(point_in_poly(p, tower_pts) and not any(point_in_poly(p, hp) for hp in holes) for p in mep_corners):
        # 5-face MEP penthouse on roof (omit bottom face touching roof deck)
        x0, x1, y0, y1, z0, z1 = cx - mep_hx, cx + mep_hx, cy - mep_hy, cy + mep_hy, h, h + 0.38
        u0, u1, yp0, yp1 = UV_ROOF_PATCH
        vp0, vp1 = v_px(yp1), v_px(yp0)
        suv = ((u0, vp0), (u1, vp0), (u1, vp1), (u0, vp1))
        for coords in (
            ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)),
            ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)),
            ((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)),
            ((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)),
            ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)),
        ):
            add_uv_quad(bm, uv_layer, coords, suv)

    north_edge = max(
        range(len(tower_pts)),
        key=lambda i: 0.5 * (tower_pts[i][1] + tower_pts[(i + 1) % len(tower_pts)][1]),
    )
    na, nb = tower_pts[north_edge], tower_pts[(north_edge + 1) % len(tower_pts)]
    ndx, ndy = nb[0] - na[0], nb[1] - na[1]
    nlen = math.hypot(ndx, ndy)
    if nlen >= 4.0:
        sign_hw = min(3.5, nlen * 0.25)
        yaw_s = math.atan2(ndy, ndx)
        ca_s, sa_s = math.cos(yaw_s), math.sin(yaw_s)
        scx, scy = 0.5 * (na[0] + nb[0]), 0.5 * (na[1] + nb[1])
        # Outward normal offset 0.14 m north of parapet face (single crisp glowing sign strip)
        ox, oy = sa_s * 0.14, -ca_s * 0.14
        sx0, sy0 = scx + ox - ca_s * sign_hw, scy + oy - sa_s * sign_hw
        sx1, sy1 = scx + ox + ca_s * sign_hw, scy + oy + sa_s * sign_hw
        gu0, gu1, gy0, gy1 = UV_GLOW_PATCH
        gv0, gv1 = v_px(gy1), v_px(gy0)
        add_uv_quad(
            bm,
            uv_layer,
            ((sx0, sy0, h - 0.90), (sx1, sy1, h - 0.90), (sx1, sy1, h - 0.12), (sx0, sy0, h - 0.12)),
            ((gu0, gv0), (gu1, gv0), (gu1, gv1), (gu0, gv1)),
        )

    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")

    is_context = b.get("kind") == "context"
    name = f"urban-context-{b['buildingId']}" if is_context else f"urban-hotel-{b['poiId']}-{b['buildingId']}"
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat_facade)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if not is_context:
        obj["poiId"] = int(b["poiId"])
        obj["footprintSplit"] = b["footprintSplit"]
    else:
        obj["source"] = b["source"]
    obj["buildingId"] = b["buildingId"]
    obj["zone"] = b.get("zone", "south")
    obj["heightM"] = float(h)
    obj["heightSource"] = b["heightSource"]
    obj["styleId"] = style_id
    obj["seed"] = float(b["seed"])
    obj["tint"] = float(b["tint"])
    obj["kind"] = "context" if is_context else "building"
    return obj


def make_facade_material() -> bpy.types.Material:
    mat = bpy.data.materials.new(name="UrbanFacadeMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.65
    bsdf.inputs["Emission Strength"].default_value = 1.0

    img_albedo = bpy.data.images.load(str(ATLAS_JPG))
    img_albedo.colorspace_settings.name = "sRGB"
    tex_albedo = nt.nodes.new("ShaderNodeTexImage")
    tex_albedo.image = img_albedo
    nt.links.new(tex_albedo.outputs["Color"], bsdf.inputs["Base Color"])

    img_mask = bpy.data.images.load(str(MASK_JPG))
    img_mask.colorspace_settings.name = "Non-Color"
    tex_mask = nt.nodes.new("ShaderNodeTexImage")
    tex_mask.image = img_mask
    nt.links.new(tex_mask.outputs["Color"], bsdf.inputs["Emission Color"])
    return mat


def patch_and_verify_glb(
    glb_path: Path, data: dict, zone: str, zone_buildings: list[dict], footprinted: list[dict]
) -> None:
    raw = glb_path.read_bytes()
    magic, version, _ = struct.unpack_from("<3I", raw, 0)
    assert magic == 0x46546C67 and version == 2
    json_len, json_type = struct.unpack_from("<2I", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8").rstrip("\x00 "))
    rest = raw[20 + json_len :]

    gltf.setdefault("asset", {})["extras"] = {
        "schema": data["schema"],
        "stage": data["stage"],
        "tier": data["tier"],
        "approvedBy": data["approvedBy"],
        "approvedAt": data["approvedAt"],
        "heightMode": data["heightMode"],
        "zone": zone,
        "buildingCount": len(footprinted),
        "approvedPoiIds": [int(b["poiId"]) for b in zone_buildings],
        "footprintedPoiIds": [int(b["poiId"]) for b in footprinted],
    }

    imgs = gltf.get("images", [])
    mats = gltf.get("materials", [])
    facade_mat = mats[0] if mats else {}
    has_base = "baseColorTexture" in facade_mat.get("pbrMetallicRoughness", {})
    has_emis = "emissiveTexture" in facade_mat
    if len(imgs) < 2 or not has_base or not has_emis:
        raise RuntimeError(f"Expected 2 embedded textures (baseColor={has_base}, emissive={has_emis}, images={len(imgs)})")

    accs = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    expected_h = {int(b["poiId"]): float(b["heightM"]) for b in footprinted}
    checked = 0
    for node in gltf.get("nodes", []):
        name = node.get("name", "")
        if not name.startswith("urban-hotel-"):
            continue
        pid = int(node["extras"]["poiId"])
        max_y = max(accs[prim["attributes"]["POSITION"]]["max"][1] for prim in meshes[node["mesh"]]["primitives"])
        exp_h = expected_h[pid]
        if abs(max_y - exp_h) > 1.5:
            raise RuntimeError(f"Height mismatch for {name}: got maxY={max_y:.2f} vs expected {exp_h:.2f}")
        checked += 1
    assert checked == len(footprinted)

    new_json = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    pad = (4 - (len(new_json) % 4)) % 4
    new_json_padded = new_json + b" " * pad
    new_total = 12 + 8 + len(new_json_padded) + len(rest)
    final_bytes = struct.pack("<3I", magic, version, new_total) + struct.pack("<2I", len(new_json_padded), json_type) + new_json_padded + rest
    glb_path.write_bytes(final_bytes)

    gz = len(gzip.compress(final_bytes))
    print(f"Exported {glb_path}: raw={len(final_bytes)} B, gzip={gz} B ({gz / 1024:.1f} KiB), buildings={checked}, images={len(imgs)}")
    if gz > MAX_GZIP_BYTES:
        raise RuntimeError(f"GLB gzip size {gz} B exceeds {MAX_GZIP_BYTES} B budget")


def build_zone(zone: str, data: dict) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)

    mat_facade = make_facade_material()

    zone_buildings = [b for b in data["buildings"] if b.get("zone") == zone]
    footprinted = [b for b in zone_buildings if b.get("hasFootprint") and len(b.get("polygon", [])) >= 4]
    if not footprinted:
        raise RuntimeError(f"No footprinted buildings found for zone {zone!r}")

    for b in footprinted:
        if b.get("heightSource") not in ("osm_levels", "estimated_display_only", "owner_verified") or b["heightM"] < 10.0:
            raise RuntimeError(f"Invalid height provenance for {b['buildingId']}: {b['heightSource']} / {b['heightM']}")
        build_hotel_mesh(b, mat_facade)

    output_glb = ROOT / "public" / "models" / f"urban-{zone}-stage6.glb"
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_glb),
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_extras=True,
        export_apply=True,
        export_image_format="JPEG",
        export_image_quality=80,
        export_draco_mesh_compression_enable=False,
    )
    patch_and_verify_glb(output_glb, data, zone, zone_buildings, footprinted)


def build_context(data: dict) -> None:
    """Stage 7: the central-area buildings that are not listed hotels, in their own lazy GLB."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat_facade = make_facade_material()
    ctx = data.get("contextBuildings") or []
    if not ctx:
        raise RuntimeError("No contextBuildings in data/urban-approved.json")
    for b in ctx:
        if b.get("heightSource") not in ("osm_levels", "estimated_display_only") or b["heightM"] < 10.0:
            raise RuntimeError(f"Invalid height provenance for {b['buildingId']}: {b['heightSource']} / {b['heightM']}")
        build_hotel_mesh(b, mat_facade)

    output_glb = ROOT / "public" / "models" / "urban-context-stage7.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output_glb),
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_extras=True,
        export_apply=True,
        export_image_format="JPEG",
        export_image_quality=80,
        export_draco_mesh_compression_enable=False,
    )
    raw = output_glb.read_bytes()
    magic, version, _ = struct.unpack_from("<3I", raw, 0)
    json_len, json_type = struct.unpack_from("<2I", raw, 12)
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8").rstrip("\x00 "))
    rest = raw[20 + json_len :]
    gltf.setdefault("asset", {})["extras"] = {
        "schema": data["schema"],
        "stage": data["stage"],
        "tier": data["tier"],
        "approvedBy": data["approvedBy"],
        "approvedAt": data["approvedAt"],
        "heightMode": data["heightMode"],
        "zone": "context",
        "buildingCount": len(ctx),
        "contextBuildingIds": [b["buildingId"] for b in ctx],
    }
    accs = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    expected_h = {b["buildingId"]: float(b["heightM"]) for b in ctx}
    checked = 0
    for node in gltf.get("nodes", []):
        bid = node["extras"]["buildingId"]
        max_y = max(accs[prim["attributes"]["POSITION"]]["max"][1] for prim in meshes[node["mesh"]]["primitives"])
        if abs(max_y - expected_h[bid]) > 1.5:
            raise RuntimeError(f"Height mismatch for {node['name']}: got maxY={max_y:.2f} vs expected {expected_h[bid]:.2f}")
        checked += 1
    assert checked == len(ctx)
    new_json = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    new_json += b" " * ((4 - (len(new_json) % 4)) % 4)
    final = struct.pack("<3I", magic, version, 12 + 8 + len(new_json) + len(rest)) + struct.pack("<2I", len(new_json), json_type) + new_json + rest
    output_glb.write_bytes(final)
    gz = len(gzip.compress(final))
    print(f"Exported {output_glb}: raw={len(final)} B, gzip={gz} B ({gz / 1024:.1f} KiB), context buildings={checked}")
    if gz > MAX_GZIP_BYTES:
        raise RuntimeError(f"GLB gzip size {gz} B exceeds {MAX_GZIP_BYTES} B budget")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--zone", choices=["south", "west", "north", "sw", "context", "all"], default="south")
    args = parser.parse_args(argv)

    data = json.loads(INPUT_JSON.read_text("utf-8"))
    if data.get("tier") != "verified" or data.get("approvedBy") != "owner" or data.get("schema") != "haram-urban-approved-v2":
        raise RuntimeError("Refusing build: data/urban-approved.json failed A7/v2 approval check")

    zones = ["south", "west", "north", "sw", "context"] if args.zone == "all" else [args.zone]
    for zone in zones:
        if zone == "context":
            build_context(data)
        else:
            build_zone(zone, data)


if __name__ == "__main__":
    main()
