"""
Saqifat Bani Sa'idah garden and the western plaza's furniture, modelled to match reality
(owner request 2026-11-22, with his night photograph of the garden from the north-east).

Sources:
  - Garden outline and fountain: OSM `leisure=garden` way 1154475918 «سقيفة بني ساعدة» and
    `amenity=fountain` way 667631015 (ODbL, 2026-11-22).
  - The old building on the garden's south side: OSM ways 775419642 / 775419643 (as `saqifah-3d.ts`).
  - The 32 high-mast lights of the western plaza: their bases read off the Esri/Maxar imagery, where
    each mast shows as a V (the leaning pole and its shadow meeting at the foot).
  - The six security booths: the small cabins visible on the same imagery.
  - Everything else (the palms and trees, the fence with its white panels, the gate kiosk, the red
    barriers, the rooftop frame): the owner's photograph, placed in the outline by eye.

Frame: metres from the Mosque's anchor (39.611752, 24.466806); glTF X east, Y up, Z south, like
`haram-fence.glb`, so `ALHARAMAIN_MODELS` places it unturned. Also writes `data/saqifah-westplaza.json`
(the same layout, for the 2D map).

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-saqifah-westplaza-glb.py
"""

from __future__ import annotations

import gzip
import json
import math
import random
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
OUT_GLB = ROOT / "public" / "models" / "saqifah-westplaza.glb"
OUT_JSON = ROOT / "data" / "saqifah-westplaza.json"
MAX_GZIP_BYTES = 250 * 1024

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * 6_371_008.8

GARDEN = [  # OSM way 1154475918, (lng, lat), counter-clockwise from the west vertex
    (39.6064424, 24.4705120),
    (39.6065288, 24.4700821),
    (39.6070718, 24.4700748),
    (39.6070804, 24.4704295),
    (39.6065954, 24.4705809),
]
FOUNTAIN = (39.6068495, 24.4702429, 5.0)  # OSM way 667631015: centre and radius (m)
OLD_BUILDING = [  # OSM 775419642 (west) and 775419643 (east)
    [(39.606563, 24.470064), (39.606815, 24.470066), (39.606816, 24.46998), (39.606564, 24.469978)],
    [(39.606822, 24.470062), (39.607052, 24.470061), (39.607051, 24.469977), (39.606821, 24.469978)],
]
MASTS = [
    (39.6055167, 24.4707246), (39.6067681, 24.4706731), (39.6060096, 24.4706617), (39.6055212, 24.4702359),
    (39.6074653, 24.4700184), (39.6060154, 24.4698097), (39.6055723, 24.4698047), (39.6068191, 24.4693689),
    (39.6061051, 24.4693438), (39.6055093, 24.4689447), (39.6051444, 24.4689217), (39.6064676, 24.4688532),
    (39.6065569, 24.4684187), (39.6051515, 24.4684478), (39.6055180, 24.4684481), (39.6059840, 24.4684489),
    (39.6055318, 24.4693369), (39.6061192, 24.4689157), (39.6075355, 24.4706442), (39.6075355, 24.4702340),
    (39.6075355, 24.4698202), (39.6075355, 24.4693698), (39.6075355, 24.4689048), (39.6075355, 24.4684470),
    (39.6071050, 24.4705416), (39.6070527, 24.4690146), (39.6070446, 24.4684543), (39.6060388, 24.4703585),
    (39.6051617, 24.4707174), (39.6051617, 24.4702340), (39.6051537, 24.4698202), (39.6051537, 24.4693442),
]
BOOTHS = [
    (39.6062681, 24.4698935), (39.6063285, 24.4694357), (39.6064290, 24.4689780), (39.6065296, 24.4685386),
    (39.6061273, 24.4702487), (39.6075878, 24.4707614),
]
MAST_H = 26.0


def _mx(lng: float) -> float:
    return (180.0 + lng) / 360.0


def _my(lat: float) -> float:
    return (180.0 - (180.0 / math.pi) * math.log(math.tan(math.pi / 4.0 + (lat * math.pi) / 360.0))) / 360.0


UNITS = (1.0 / EARTH_CIRCUMFERENCE_M) * (1.0 / math.cos(math.radians(ORIGIN_LAT)))


def bxy(lng: float, lat: float) -> tuple[float, float]:
    """(east, north) metres in Blender space (glTF: X east, Z south)."""
    return (_mx(lng) - _mx(ORIGIN_LNG)) / UNITS, -(_my(lat) - _my(ORIGIN_LAT)) / UNITS


def lnglat(x: float, y: float) -> list[float]:
    mx = _mx(ORIGIN_LNG) + x * UNITS
    my = _my(ORIGIN_LAT) - y * UNITS
    lng = mx * 360.0 - 180.0
    lat = (360.0 / math.pi) * math.atan(math.exp((180.0 - my * 360.0) * math.pi / 180.0)) - 90.0
    return [round(lng, 7), round(lat, 7)]


# ------------------------------------------------------------------------------------------------
# Materials (their names drive the night lighting in `src/map/scene-light.ts`, file `saqifah`)
# ------------------------------------------------------------------------------------------------
MATS: dict[str, bpy.types.Material] = {}
PALETTE = {
    "sq_plaster": (0.80, 0.74, 0.63, 1.0),
    "sq_roof": (0.62, 0.59, 0.55, 1.0),
    "sq_window": (0.10, 0.11, 0.12, 1.0),
    "sq_steel": (0.16, 0.17, 0.18, 1.0),
    "sq_panel": (0.90, 0.90, 0.88, 1.0),
    "sq_curb": (0.83, 0.81, 0.77, 1.0),
    "sq_maroon": (0.45, 0.12, 0.14, 1.0),
    "sq_barrier": (0.68, 0.18, 0.24, 1.0),
    "sq_sign": (0.86, 0.36, 0.48, 1.0),
    "sq_kiosk": (0.93, 0.93, 0.91, 1.0),
    "sq_dark": (0.14, 0.14, 0.15, 1.0),
    "sq_dirt": (0.47, 0.38, 0.28, 1.0),
    "sq_path": (0.66, 0.57, 0.45, 1.0),
    "sq_grass": (0.30, 0.42, 0.20, 1.0),
    "sq_rim": (0.36, 0.48, 0.58, 1.0),
    "sq_water": (0.10, 0.14, 0.16, 1.0),
    "sq_trunk": (0.42, 0.36, 0.30, 1.0),
    "sq_frond": (0.24, 0.40, 0.18, 1.0),
    "sq_fan": (0.30, 0.47, 0.22, 1.0),
    "sq_dry": (0.62, 0.52, 0.32, 1.0),
    "sq_leaf1": (0.20, 0.36, 0.15, 1.0),
    "sq_leaf2": (0.29, 0.44, 0.19, 1.0),
    "sq_leaf3": (0.36, 0.48, 0.25, 1.0),
    "sq_mast": (0.62, 0.64, 0.66, 1.0),
    "sq_lamp": (0.95, 0.94, 0.88, 1.0),
    "sq_boothroof": (0.22, 0.23, 0.25, 1.0),
}


def mat(name: str) -> bpy.types.Material:
    if name not in MATS:
        m = bpy.data.materials.new(name=name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = PALETTE[name]
        bsdf.inputs["Roughness"].default_value = 0.8
        MATS[name] = m
    return MATS[name]


class Builder:
    """One bmesh per material group, so the file has few meshes and draw calls."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.bm = bmesh.new()
        self.mats: list[str] = []

    def mi(self, m: str) -> int:
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def face(self, pts: list[tuple[float, float, float]], m: str) -> None:
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
            f.material_index = self.mi(m)
        except ValueError:
            pass

    def box(self, cx: float, cy: float, z0: float, w: float, d: float, h: float, yaw: float, m: str, top: str | None = None) -> None:
        c, s = math.cos(yaw), math.sin(yaw)
        pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
        ring = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]
        for i in range(4):
            (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % 4]
            self.face([(x0, y0, z0), (x1, y1, z0), (x1, y1, z0 + h), (x0, y0, z0 + h)], m)
        self.face([(x, y, z0 + h) for x, y in ring], top or m)

    def prism(self, ring: list[tuple[float, float]], z0: float, z1: float, m: str, top: str | None = None, sides: bool = True) -> None:
        if sides:
            for i in range(len(ring)):
                (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % len(ring)]
                self.face([(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)], m)
        self.face([(x, y, z1) for x, y in ring], top or m)

    def cyl(self, cx: float, cy: float, z0: float, z1: float, r0: float, r1: float, m: str, n: int = 8, lean: tuple[float, float] = (0, 0), cap: bool = False) -> None:
        bot = [(cx + r0 * math.cos(2 * math.pi * k / n), cy + r0 * math.sin(2 * math.pi * k / n), z0) for k in range(n)]
        top = [(cx + lean[0] + r1 * math.cos(2 * math.pi * k / n), cy + lean[1] + r1 * math.sin(2 * math.pi * k / n), z1) for k in range(n)]
        for k in range(n):
            self.face([bot[k], bot[(k + 1) % n], top[(k + 1) % n], top[k]], m)
        if cap:
            self.face(top, m)

    def blob(self, cx: float, cy: float, cz: float, r: float, m: str, sx: float = 1.0, sz: float = 0.8) -> None:
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=r)
        for v in res["verts"]:
            v.co.x = cx + v.co.x * sx
            v.co.y = cy + v.co.y * sx
            v.co.z = cz + v.co.z * sz
        idx = self.mi(m)
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = idx

    def finish(self, kind: str) -> bpy.types.Object:
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(mat(m))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj["kind"] = kind
        return obj


# ------------------------------------------------------------------------------------------------
def quad_uv(u: float, v: float) -> tuple[float, float]:
    """A point of the garden by (u along the north-east fence from its NE end to the west, v from that fence to the old building)."""
    p00, p10, p01, p11 = bxy(*GARDEN[3]), bxy(*GARDEN[0]), bxy(*GARDEN[2]), bxy(*GARDEN[1])
    a = (p00[0] + (p10[0] - p00[0]) * u, p00[1] + (p10[1] - p00[1]) * u)
    b = (p01[0] + (p11[0] - p01[0]) * u, p01[1] + (p11[1] - p01[1]) * u)
    return a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v


def point_in(pt: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y = pt
    inside = False
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[i - 1]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def fan_palm(b: Builder, x: float, y: float, h: float, rng: random.Random) -> None:
    """Washingtonia: slender trunk, a skirt of dry fronds under a round crown of fan leaves."""
    lean = (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5))
    b.cyl(x, y, 0.0, h - 1.6, 0.30, 0.22, "sq_trunk", 7, (lean[0] * 0.85, lean[1] * 0.85))
    tx, ty = x + lean[0], y + lean[1]
    b.cyl(tx, ty, h - 3.2, h - 0.2, 0.55, 0.78, "sq_dry", 8, cap=False)
    n = 14
    for k in range(n):
        a = 2 * math.pi * (k + rng.random() * 0.4) / n
        tilt = rng.uniform(-0.15, 0.55)
        L = rng.uniform(1.5, 1.9)
        base = (tx, ty, h)
        tip = (tx + math.cos(a) * L, ty + math.sin(a) * L, h + tilt * L)
        side = (-math.sin(a) * 0.75, math.cos(a) * 0.75)
        b.face([base, (tip[0] + side[0], tip[1] + side[1], tip[2] - 0.25), tip], "sq_fan")
        b.face([base, tip, (tip[0] - side[0], tip[1] - side[1], tip[2] - 0.25)], "sq_fan")


def date_palm(b: Builder, x: float, y: float, h: float, rng: random.Random) -> None:
    """Phoenix dactylifera: thicker trunk, a crown of long arching pinnate fronds."""
    lean = (rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6))
    b.cyl(x, y, 0.0, h, 0.38, 0.30, "sq_trunk", 7, lean)
    tx, ty = x + lean[0], y + lean[1]
    b.blob(tx, ty, h, 0.55, "sq_dry", 1.0, 0.7)
    n = 18
    for k in range(n):
        a = 2 * math.pi * (k + rng.random() * 0.5) / n
        L = rng.uniform(3.0, 3.8)
        up = rng.uniform(0.15, 0.9)
        ca, sa = math.cos(a), math.sin(a)
        w = 0.34
        p0 = (tx, ty, h + 0.2)
        p1 = (tx + ca * L * 0.5, ty + sa * L * 0.5, h + 0.2 + up * L * 0.45)
        p2 = (tx + ca * L, ty + sa * L, h + 0.2 + up * L * 0.25 - 0.9)
        nx, ny = -sa * w, ca * w
        b.face([(p0[0] + nx * 0.3, p0[1] + ny * 0.3, p0[2]), (p1[0] + nx, p1[1] + ny, p1[2]), (p1[0] - nx, p1[1] - ny, p1[2]), (p0[0] - nx * 0.3, p0[1] - ny * 0.3, p0[2])], "sq_frond")
        b.face([(p1[0] + nx, p1[1] + ny, p1[2]), (p2[0], p2[1], p2[2]), (p1[0] - nx, p1[1] - ny, p1[2])], "sq_frond")


def leafy_tree(b: Builder, x: float, y: float, h: float, r: float, rng: random.Random) -> None:
    b.cyl(x, y, 0.0, h * 0.55, 0.22, 0.16, "sq_trunk", 6)
    for _ in range(4):
        b.blob(x + rng.uniform(-r * 0.45, r * 0.45), y + rng.uniform(-r * 0.45, r * 0.45), h * 0.62 + rng.uniform(0, r * 0.5), r * rng.uniform(0.55, 0.8), rng.choice(["sq_leaf1", "sq_leaf2", "sq_leaf3"]), 1.0, 0.85)


def shrub(b: Builder, x: float, y: float, r: float, rng: random.Random) -> None:
    for _ in range(2):
        b.blob(x + rng.uniform(-r * 0.3, r * 0.3), y + rng.uniform(-r * 0.3, r * 0.3), r * 0.55, r * rng.uniform(0.7, 1.0), rng.choice(["sq_leaf2", "sq_leaf3"]), 1.0, 0.75)


def fence(b: Builder, a: tuple[float, float], c: tuple[float, float], maroon: bool, skip: tuple[float, float] | None = None) -> None:
    """Concrete kerb, steel posts and rails, vertical bars, and every third bay a white panel."""
    dx, dy = c[0] - a[0], c[1] - a[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    yaw = math.atan2(dy, dx)
    bays = max(1, round(L / 2.4))
    step = L / bays
    rail = "sq_maroon" if maroon else "sq_steel"
    top = 1.75 if maroon else 1.5
    for k in range(bays):
        s0, s1 = k * step, (k + 1) * step
        if skip and s1 > skip[0] and s0 < skip[1]:
            continue
        x0, y0 = a[0] + ux * s0, a[1] + uy * s0
        x1, y1 = a[0] + ux * s1, a[1] + uy * s1
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        b.box(mx, my, 0.0, step, 0.32, 0.38, yaw, "sq_curb")
        b.box(x0, y0, 0.38, 0.09, 0.09, top - 0.38, yaw, rail)
        b.box(mx, my, top - 0.05, step, 0.05, 0.05, yaw, rail)
        b.box(mx, my, 0.5, step, 0.04, 0.04, yaw, rail)
        if k % 3 == 1 and not maroon:
            b.face([(x0 + ux * 0.1, y0 + uy * 0.1, 0.45), (x1 - ux * 0.1, y1 - uy * 0.1, 0.45), (x1 - ux * 0.1, y1 - uy * 0.1, 1.42), (x0 + ux * 0.1, y0 + uy * 0.1, 1.42)], "sq_panel")
        else:
            bars = int(step / 0.22)
            for j in range(1, bars):
                t = s0 + j * step / bars
                bx, by = a[0] + ux * t, a[1] + uy * t
                b.face([(bx - ux * 0.018, by - uy * 0.018, 0.4), (bx + ux * 0.018, by + uy * 0.018, 0.4), (bx + ux * 0.018, by + uy * 0.018, top - 0.05), (bx - ux * 0.018, by - uy * 0.018, top - 0.05)], rail)


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(1447)
    ring = [bxy(*p) for p in GARDEN]

    # 1. Ground: the garden's earth (raised bed), a little lawn, a path from the gate, rings of kerbs.
    g = Builder("SaqifahGround")
    g.prism(ring, 0.0, 0.12, "sq_dirt", sides=False)
    for pts in ([(0.02, 0.05), (0.26, 0.05), (0.24, 0.48), (0.03, 0.5)], [(0.58, 0.05), (0.92, 0.06), (0.9, 0.2), (0.6, 0.2)]):
        g.prism([quad_uv(u, v) for u, v in pts], 0.12, 0.14, "sq_grass", sides=False)
    fx, fy = bxy(FOUNTAIN[0], FOUNTAIN[1])
    # The gate: on the north-east fence, a third of the way along the near side from its NE corner.
    ne_a, ne_c = ring[3], ring[4]
    ne_len = math.hypot(ne_c[0] - ne_a[0], ne_c[1] - ne_a[1])
    near_len = ne_len + math.hypot(ring[0][0] - ne_c[0], ring[0][1] - ne_c[1])
    gate_s = min(0.34 * near_len, ne_len - 3.0)
    gx = ne_a[0] + (ne_c[0] - ne_a[0]) * gate_s / ne_len
    gy = ne_a[1] + (ne_c[1] - ne_a[1]) * gate_s / ne_len
    gdx, gdy = fx - gx, fy - gy
    gl = math.hypot(gdx, gdy)
    g.box((gx + fx) / 2, (gy + fy) / 2, 0.12, gl, 2.4, 0.03, math.atan2(gdy, gdx), "sq_path")
    for cx, cy, r in ((fx, fy, 9.0), (*quad_uv(0.76, 0.56), 5.5)):
        n = 28
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            g.box(cx + r * math.cos((a0 + a1) / 2), cy + r * math.sin((a0 + a1) / 2), 0.12, r * (a1 - a0) + 0.05, 0.18, 0.14, (a0 + a1) / 2 + math.pi / 2, "sq_curb")
    # The fountain: a round basin with a blue-grey rim and dark water.
    g.cyl(fx, fy, 0.12, 0.75, FOUNTAIN[2], FOUNTAIN[2], "sq_rim", 24)
    g.cyl(fx, fy, 0.75, 0.75, FOUNTAIN[2], FOUNTAIN[2] - 0.35, "sq_rim", 24)
    g.cyl(fx, fy, 0.55, 0.55, FOUNTAIN[2] - 0.35, 0.01, "sq_water", 24)
    g.finish("ground")

    # 2. Fence round the garden: the gate kiosk on the north-east side, maroon railing at its NE corner.
    f = Builder("SaqifahFence")
    edges = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
    ne_edge = (ring[3], ring[4])  # NE vertex -> north apex
    for a, c in edges:
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        is_ne = (a, c) == ne_edge
        near_ne = a == ring[3] or c == ring[3]
        if near_ne and L > 8:
            # Maroon railing for the 6 m either side of the NE corner, as in the photograph.
            ux, uy = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            if a == ring[3]:
                mid = (a[0] + ux * 6, a[1] + uy * 6)
                fence(f, a, mid, True)
                fence(f, mid, c, False, (gate_s - 6 - 1.9, gate_s - 6 + 1.9) if is_ne else None)
            else:
                mid = (c[0] - ux * 6, c[1] - uy * 6)
                fence(f, a, mid, False)
                fence(f, mid, c, True)
        else:
            fence(f, a, c, False, (gate_s - 1.9, gate_s + 1.9) if is_ne else None)
    f.finish("fence")

    # 3. The gate kiosk (white cabin, dark grille), two pink sign boards, the stacked red barriers.
    k = Builder("SaqifahKiosk")
    ex, ey = ne_edge[1][0] - ne_edge[0][0], ne_edge[1][1] - ne_edge[0][1]
    yaw = math.atan2(ey, ex)
    nx, ny = ey / ne_len, -ex / ne_len  # outward normal of the NE fence (towards the plaza)
    if point_in((gx + nx, gy + ny), ring):
        nx, ny = -nx, -ny
    kx, ky = gx + nx * 0.6, gy + ny * 0.6
    k.box(kx, ky, 0.0, 3.6, 2.7, 2.7, yaw, "sq_kiosk")
    k.box(kx, ky, 2.7, 3.9, 3.0, 0.22, yaw, "sq_kiosk")
    k.face([(kx + nx * 1.37 - ex / ne_len * 1.2, ky + ny * 1.37 - ey / ne_len * 1.2, 0.05), (kx + nx * 1.37 + ex / ne_len * 1.2, ky + ny * 1.37 + ey / ne_len * 1.2, 0.05), (kx + nx * 1.37 + ex / ne_len * 1.2, ky + ny * 1.37 + ey / ne_len * 1.2, 2.2), (kx + nx * 1.37 - ex / ne_len * 1.2, ky + ny * 1.37 - ey / ne_len * 1.2, 2.2)], "sq_dark")
    for off in (3.6, 5.4):
        sx, sy = gx + ex / ne_len * off + nx * 0.25, gy + ey / ne_len * off + ny * 0.25
        k.box(sx, sy, 0.4, 1.4, 0.06, 1.0, yaw, "sq_sign")
    for j in range(6):
        s_b = ne_len - 12.0 + j * 2.1
        bx, by = ne_edge[0][0] + ex / ne_len * s_b, ne_edge[0][1] + ey / ne_len * s_b
        k.box(bx + nx * 1.8, by + ny * 1.8, 0.0, 2.0, 0.6, 0.28 + 0.24 * (j % 2), yaw + rng.uniform(-0.08, 0.08), "sq_barrier")
    k.finish("kiosk")

    # 4. The old building on the south side: plastered walls with small windows, a parapet, rooftop
    # machinery, and the steel frame box on the east roof.
    hb = Builder("SaqifahOldBuilding")
    for idx, pts in enumerate(OLD_BUILDING):
        r = [bxy(*p) for p in pts]
        hb.prism(r, 0.0, 6.4, "sq_plaster", top="sq_roof")
        for i in range(4):
            (x0, y0), (x1, y1) = r[i], r[(i + 1) % 4]
            L = math.hypot(x1 - x0, y1 - y0)
            ux, uy = (x1 - x0) / L, (y1 - y0) / L
            onx, ony = uy, -ux
            cxm, cym = sum(p[0] for p in r) / 4, sum(p[1] for p in r) / 4
            if (x0 + onx - cxm) ** 2 + (y0 + ony - cym) ** 2 < (x0 - cxm) ** 2 + (y0 - cym) ** 2:
                onx, ony = -onx, -ony
            hb.box((x0 + x1) / 2 + onx * 0.08, (y0 + y1) / 2 + ony * 0.08, 6.4, L, 0.25, 0.8, math.atan2(uy, ux), "sq_plaster")
            for w in range(1, int(L / 3.2)):
                t = w * L / int(L / 3.2)
                wx, wy = x0 + ux * t + onx * 0.03, y0 + uy * t + ony * 0.03
                for z in (1.2, 4.2):
                    hb.face([(wx - ux * 0.55, wy - uy * 0.55, z), (wx + ux * 0.55, wy + uy * 0.55, z), (wx + ux * 0.55, wy + uy * 0.55, z + 1.3), (wx - ux * 0.55, wy - uy * 0.55, z + 1.3)], "sq_window")
        cx, cy = sum(p[0] for p in r) / 4, sum(p[1] for p in r) / 4
        for j in range(3):
            hb.box(cx + rng.uniform(-8, 8), cy + rng.uniform(-2.5, 2.5), 6.4, rng.uniform(1.2, 2.4), rng.uniform(1.0, 1.6), rng.uniform(0.8, 1.4), 0.0, "sq_roof")
        if idx == 1:
            # The steel frame box on the east roof (left of the photograph).
            fx0, fy0 = r[0][0] + (r[1][0] - r[0][0]) * 0.85, r[0][1] + (r[3][1] - r[0][1]) * 0.5
            for ox in (-2.2, 2.2):
                for oy in (-1.8, 1.8):
                    hb.box(fx0 + ox, fy0 + oy, 6.4, 0.15, 0.15, 3.6, 0.0, "sq_steel")
            hb.box(fx0, fy0, 10.0, 5.0, 4.2, 0.25, 0.0, "sq_steel")
            hb.box(fx0, fy0, 6.4, 3.0, 2.2, 1.8, 0.0, "sq_roof")
    hb.finish("building")

    # 5. Planting, placed in the outline as the photograph shows it: date palms and lawn by the NE
    # corner, a tall fan palm before the building, round shrubs either side of the fountain, a big
    # shade tree behind it, and the dense west half of fan palms with dry skirts, date palms and trees.
    fan = [(0.20, 0.80, 14.0), (0.58, 0.40, 13.0), (0.66, 0.22, 15.0), (0.74, 0.52, 12.0), (0.83, 0.30, 16.0), (0.90, 0.62, 13.0), (0.80, 0.82, 14.0), (0.95, 0.18, 12.0), (0.62, 0.86, 15.0), (0.88, 0.92, 11.0), (0.70, 0.70, 10.5)]
    dates = [(0.06, 0.22, 7.0), (0.14, 0.12, 8.0), (0.10, 0.42, 6.0), (0.28, 0.30, 4.5), (0.44, 0.13, 4.8), (0.52, 0.64, 8.0), (0.76, 0.12, 9.0), (0.38, 0.86, 7.0), (0.97, 0.45, 8.0)]
    trees = [(0.46, 0.76, 6.5, 3.0), (0.64, 0.10, 5.0, 2.6), (0.84, 0.14, 5.5, 2.8), (0.94, 0.82, 5.0, 2.4), (0.24, 0.58, 4.5, 2.2), (0.70, 0.93, 6.0, 2.6), (0.55, 0.28, 4.0, 2.0)]
    shrubs_uv = [(0.18, 0.64, 1.1), (0.34, 0.08, 0.9), (0.88, 0.45, 1.2), (0.98, 0.72, 1.0), (0.28, 0.93, 1.0), (0.50, 0.95, 1.2), (0.72, 0.36, 1.0), (0.04, 0.62, 0.9)]
    p = Builder("SaqifahPlants")
    layout: list[dict] = []

    def clear_of_fountain(x: float, y: float, r: float) -> tuple[float, float]:
        d = math.hypot(x - fx, y - fy)
        if d < FOUNTAIN[2] + r + 0.6:
            k2 = (FOUNTAIN[2] + r + 0.6) / max(d, 0.01)
            return fx + (x - fx) * k2, fy + (y - fy) * k2
        return x, y

    for u, v, h in fan:
        x, y = clear_of_fountain(*quad_uv(u, v), 0.8)
        fan_palm(p, x, y, h, rng)
        layout.append({"kind": "fan_palm", "at": lnglat(x, y), "heightM": h, "crownM": 1.8})
    for u, v, h in dates:
        x, y = clear_of_fountain(*quad_uv(u, v), 1.5)
        date_palm(p, x, y, h, rng)
        layout.append({"kind": "date_palm", "at": lnglat(x, y), "heightM": h, "crownM": 3.2})
    for u, v, h, r in trees:
        x, y = clear_of_fountain(*quad_uv(u, v), r)
        leafy_tree(p, x, y, h, r, rng)
        layout.append({"kind": "tree", "at": lnglat(x, y), "heightM": h, "crownM": r})
    for x, y, r in [(fx - 7.2, fy + 0.6, 1.3), (fx + 7.0, fy - 0.8, 1.4), (fx + 0.8, fy + 7.0, 1.1)] + [(*quad_uv(u, v), r) for u, v, r in shrubs_uv]:
        shrub(p, x, y, r, rng)
        layout.append({"kind": "shrub", "at": lnglat(x, y), "heightM": round(r * 1.3, 1), "crownM": r})
    p.finish("plants")

    # 6. The western plaza: 32 high masts with a crown of floodlights, and the security booths.
    ms = Builder("WestPlazaMasts")
    lamps = Builder("WestPlazaLamps")
    for lng, lat in MASTS:
        x, y = bxy(lng, lat)
        ms.box(x, y, 0.0, 0.9, 0.9, 0.5, 0.0, "sq_curb")
        ms.cyl(x, y, 0.5, MAST_H, 0.32, 0.16, "sq_mast", 8)
        ms.cyl(x, y, MAST_H - 0.3, MAST_H + 0.1, 1.5, 1.5, "sq_mast", 10)
        ms.cyl(x, y, MAST_H + 0.1, MAST_H + 0.6, 0.35, 0.1, "sq_mast", 8, cap=True)
        for j in range(10):
            a = 2 * math.pi * j / 10
            hx, hy = x + 1.5 * math.cos(a), y + 1.5 * math.sin(a)
            lamps.box(hx, hy, MAST_H - 0.75, 0.5, 0.4, 0.45, a, "sq_lamp")
    ms.finish("mast")
    lamps.finish("lamp")
    bo = Builder("WestPlazaBooths")
    for lng, lat in BOOTHS:
        x, y = bxy(lng, lat)
        bo.box(x, y, 0.0, 2.2, 2.2, 2.4, 0.0, "sq_kiosk")
        base = [(x - 1.35, y - 1.35, 2.4), (x + 1.35, y - 1.35, 2.4), (x + 1.35, y + 1.35, 2.4), (x - 1.35, y + 1.35, 2.4)]
        apex = (x, y, 3.3)
        for i in range(4):
            bo.face([base[i], base[(i + 1) % 4], apex], "sq_boothroof")
        bo.face([(x - 0.5, y - 1.11, 0.05), (x + 0.5, y - 1.11, 0.05), (x + 0.5, y - 1.11, 2.0), (x - 0.5, y - 1.11, 2.0)], "sq_dark")
    bo.finish("booth")

    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_extras=True,
        export_apply=True,
        export_draco_mesh_compression_enable=False,
    )
    raw = OUT_GLB.read_bytes()
    gz = len(gzip.compress(raw))
    print(f"Exported {OUT_GLB}: raw={len(raw)} B, gzip={gz} B ({gz / 1024:.1f} KiB)")
    if gz > MAX_GZIP_BYTES:
        raise RuntimeError(f"GLB gzip size {gz} B exceeds {MAX_GZIP_BYTES} B")

    OUT_JSON.write_text(
        json.dumps(
            {
                "source": "OSM 1154475918 (garden), 667631015 (fountain), 775419642/3 (building); masts and booths read off Esri/Maxar imagery; planting from the owner's photograph (2026-11-22)",
                "garden": [list(p) for p in GARDEN] + [list(GARDEN[0])],
                "fountain": {"at": [FOUNTAIN[0], FOUNTAIN[1]], "radiusM": FOUNTAIN[2]},
                "plants": layout,
                "masts": [list(m) for m in MASTS],
                "mastHeightM": MAST_H,
                "booths": [list(b) for b in BOOTHS],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        "utf-8",
    )
    print(f"Wrote {OUT_JSON}: {len(layout)} plants, {len(MASTS)} masts, {len(BOOTHS)} booths")


if __name__ == "__main__":
    main()
