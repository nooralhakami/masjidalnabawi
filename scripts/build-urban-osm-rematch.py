"""
Stage 7: line the central-area 3D buildings up with the satellite imagery the map shows.

Why: the Stage 6 footprints came from Microsoft ML footprints (`ms-haram-bbox-2026-11-11`), which sit
5-15 m off the Esri/Maxar imagery, and 119 of the 228 hotels were cut out of merged blocks by a
provisional pin partition. Many real towers had no footprint at all, so the 3D boxes did not match
what the owner sees under them (owner request, 2026-11-22).

What it does (idempotent, re-runnable):
  1. Reads the OSM buildings snapshot `docs/routes/osm/buildings-2026-11-22.json` (ODbL, traced on the
     same kind of imagery) and keeps the buildings inside the first ring road (`CENTRAL_ZONE`), outside
     the Haram fence, excluding mosques/historic buildings, kiosks (< 150 m2) and the Saqifah heritage.
  2. Re-links every approved hotel (`data/urban-approved.json`) to the OSM building that contains its
     Authority 2026 guide pin (`hotels-joined.json`), or the nearest one within 15 m. Two or more hotels
     in one OSM building split it along its long axis between their pins (`footprintSplit: osm_split`):
     the outer outline stays the real one.
  3. Recomputes each hotel's centre, area, street-facing entrance and drive drop-off, and moves the
     hotel marker in `data/pois.json` inside its building (owner request: "ضع الفنادق في أماكنها الصحيحة").
  4. Adds the remaining central-area OSM buildings as non-clickable context towers (`contextBuildings`),
     with display-only heights, so the city fabric matches the imagery.
  5. Drops street lamps / palms that the new footprints now cover.

Heights stay display-only estimates unless OSM carries `building:levels` (never shown as facts).

Usage:
  python3 scripts/build-urban-osm-rematch.py
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE1 = Path(
    "/Users/nooraddeen/Desktop/ملحقات المجلد المركزي/rea/مشاريع التحليل/alharamain-navq-2026-11-18"
)
OSM_SNAPSHOT = ROOT / "docs" / "routes" / "osm" / "buildings-2026-11-22.json"
URBAN_JSON = ROOT / "data" / "urban-approved.json"
POIS_JSON = ROOT / "data" / "pois.json"
FENCE_JSON = ROOT / "data" / "haram-fence.json"
STREETS_JSON = ROOT / "data" / "streets.json"

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_RADIUS_M = 6_371_008.8
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M
COS_ORIGIN = math.cos(math.radians(ORIGIN_LAT))

# Inner edge of the first ring road (King Faisal Rd), traced on the Esri imagery (lng, lat).
CENTRAL_ZONE: list[tuple[float, float]] = [
    (39.602602, 24.470432), (39.603031, 24.471311), (39.603760, 24.472287), (39.604726, 24.473342),
    (39.605799, 24.473947), (39.606228, 24.474045), (39.610949, 24.474094), (39.611592, 24.474045),
    (39.614167, 24.473801), (39.614275, 24.471213), (39.613523, 24.468625), (39.613523, 24.465598), (39.616957, 24.465647), (39.617600, 24.464963),
    (39.617386, 24.463694), (39.616313, 24.463352), (39.603438, 24.463303), (39.602687, 24.464035),
    (39.602419, 24.465159), (39.602419, 24.467112), (39.602473, 24.469065),
]

# Saqifat Bani Sa'idah heritage structures are modelled by `src/map/saqifah-3d.ts`.
HERITAGE_OSM_IDS = {"w775419642", "w775419643", "w775419644", "w775419645"}
# The low red-roofed arcade south of the south courtyards (one 17,000 m2 outline): its roofs already
# read correctly on the imagery, and a tower block over them would hide them.
NOT_TOWERS_OSM_IDS = {"w625518412"}
# Low-rise civic buildings (museums, markets, gardens, courts) when OSM gives no level count.
LOW_RISE_NAME = re.compile(r"متحف|بستان|سوق|محكمة|حديقة|museum|market|garden", re.IGNORECASE)
TUNNEL_NAME = re.compile(r"tunnel|نفق", re.IGNORECASE)
NAME_MATCH_RADIUS_M = 80.0
# Open plazas outside the Haram fence where no gap tower may be added (lng, lat), traced on the imagery:
# the western courtyard (with the Saqifah garden) and the square at Bab al-Salam / Masjid al-Ghamamah.
OPEN_PLAZAS: list[list[tuple[float, float]]] = [
    [(39.605101, 24.471067), (39.607891, 24.471067), (39.607891, 24.468186), (39.607301, 24.468186),
     (39.607301, 24.467624), (39.606657, 24.467624), (39.606657, 24.468137), (39.605101, 24.468137)],
    [(39.606121, 24.467307), (39.607381, 24.467307), (39.607381, 24.46633), (39.607435, 24.466233),
     (39.607435, 24.465549), (39.606603, 24.465549), (39.606121, 24.466135)],
]
SKIP_BUILDING_VALUES = {"construction", "roof", "mosque", "kiosk", "toilets"}
MS_FOOTPRINTS = STAGE1 / "hotels" / "footprints" / "ms-haram-bbox-2026-11-11.json"
MIN_CONTEXT_AREA_M2 = 150.0
MATCH_RADIUS_M = 15.0
SIMPLIFY_TOL_M = 0.45
# Guide #169 has no Google link in the Authority guide: its Stage 6 marker stands in for the pin
# (fixed here so re-runs do not chase the marker this script moves).
FALLBACK_PINS: dict[int, tuple[float, float]] = {169: (39.6070051, 24.4723609)}


# ---------------------------------------------------------------------------------------------
# Geometry: local Web-Mercator metres from the origin, x = east, y = north
# ---------------------------------------------------------------------------------------------
def _mercator_x(lng: float) -> float:
    return (180.0 + lng) / 360.0


def _mercator_y(lat: float) -> float:
    return (180.0 - (180.0 / math.pi) * math.log(math.tan(math.pi / 4.0 + (lat * math.pi) / 360.0))) / 360.0


ORIGIN_MX = _mercator_x(ORIGIN_LNG)
ORIGIN_MY = _mercator_y(ORIGIN_LAT)
XY = tuple[float, float]


def to_xy(lng: float, lat: float) -> XY:
    scale = EARTH_CIRCUMFERENCE_M * COS_ORIGIN
    return (_mercator_x(lng) - ORIGIN_MX) * scale, (ORIGIN_MY - _mercator_y(lat)) * scale


def from_xy(x: float, y: float) -> XY:
    scale = EARTH_CIRCUMFERENCE_M * COS_ORIGIN
    mx = ORIGIN_MX + x / scale
    my = ORIGIN_MY - y / scale
    lng = mx * 360.0 - 180.0
    lat = (360.0 / math.pi) * math.atan(math.exp((180.0 - my * 360.0) * math.pi / 180.0)) - 90.0
    return lng, lat


def seeded_unit(key: str, salt: int) -> float:
    digest = hashlib.sha256(f"{key}:{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def poly_area(pts: list[XY]) -> float:
    s = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return 0.5 * s


def centroid_xy(pts: list[XY]) -> XY:
    a = poly_area(pts)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    f = 1.0 / (6.0 * a)
    return cx * f, cy * f


def clean_ring_xy(pts: list[XY]) -> list[XY]:
    out: list[XY] = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.05:
            out.append(p)
    if len(out) >= 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 0.05:
        out.pop()
    if poly_area(out) < 0.0:
        out.reverse()
    return out


def _dp(pts: list[XY], tol: float) -> list[XY]:
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    best_i, best_d = 0, -1.0
    for i in range(1, len(pts) - 1):
        d, _ = dist_pt_seg(pts[i], a, b)
        if d > best_d:
            best_i, best_d = i, d
    if best_d <= tol:
        return [a, b]
    return _dp(pts[: best_i + 1], tol)[:-1] + _dp(pts[best_i:], tol)


def simplify_ring(ring: list[XY], tol: float = SIMPLIFY_TOL_M) -> list[XY]:
    """Douglas-Peucker on a closed ring, split at the two farthest-apart vertices."""
    if len(ring) <= 4:
        return ring
    i0 = 0
    i1 = max(range(len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    a = _dp(ring[i0 : i1 + 1], tol)
    b = _dp(ring[i1:] + [ring[0]], tol)
    out = a[:-1] + b[:-1]
    return clean_ring_xy(out) if len(out) >= 3 and abs(poly_area(out)) > 0.9 * abs(poly_area(ring)) else ring


def point_in_poly(pt: XY, poly: list[XY]) -> bool:
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def dist_pt_seg(pt: XY, a: XY, b: XY) -> tuple[float, XY]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 < 1e-12:
        return math.hypot(pt[0] - a[0], pt[1] - a[1]), a
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2))
    proj = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(pt[0] - proj[0], pt[1] - proj[1]), proj


def dist_pt_poly_edges(pt: XY, poly: list[XY]) -> float:
    return min(dist_pt_seg(pt, poly[i], poly[(i + 1) % len(poly)])[0] for i in range(len(poly)))


def bbox(poly: list[XY]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def entrance_side_from_normal(nx: float, ny: float) -> str:
    if abs(nx) >= abs(ny):
        return "east" if nx >= 0 else "west"
    return "north" if ny >= 0 else "south"


def clip_halfplane(poly: list[XY], origin: XY, normal: XY, offset: float) -> list[XY]:
    """Keep points where dot(p - origin, normal) <= offset (Sutherland-Hodgman)."""
    if len(poly) < 3:
        return []

    def signed(p: XY) -> float:
        return (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] - offset

    out: list[XY] = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        da, db = signed(a), signed(b)
        if da <= 1e-9:
            out.append(a)
            if db > 1e-9:
                t = da / (da - db)
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        elif db <= 1e-9:
            t = da / (da - db)
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    cleaned = clean_ring_xy(out) if len(out) >= 3 else []
    return cleaned if len(cleaned) >= 3 and abs(poly_area(cleaned)) > 1.0 else []


def dominant_edge_angle(poly: list[XY]) -> float:
    bins: dict[int, float] = defaultdict(float)
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        elen = math.hypot(x1 - x0, y1 - y0)
        if elen >= 1.0:
            bins[round(math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90.0)] += elen
    return math.radians(max(bins.items(), key=lambda kv: kv[1])[0]) if bins else 0.0


def split_shared_polygon(base: list[XY], members: list[dict]) -> dict[int, list[XY]]:
    """Split one real OSM outline between k hotels into strips along its long axis, cut half-way
    between their guide pins (0.9 m seam), so the outer outline stays the real one."""
    k = len(members)
    theta = dominant_edge_angle(base)
    ux, uy = math.cos(theta), math.sin(theta)
    vx, vy = -uy, ux
    us = [p[0] * ux + p[1] * uy for p in base]
    vs = [p[0] * vx + p[1] * vy for p in base]
    pin_u = [m["xy"][0] * ux + m["xy"][1] * uy for m in members]
    pin_v = [m["xy"][0] * vx + m["xy"][1] * vy for m in members]
    span_u, span_v = max(us) - min(us), max(vs) - min(vs)
    spread_u, spread_v = max(pin_u) - min(pin_u), max(pin_v) - min(pin_v)
    # Cut across the direction the pins are spread along; fall back to the long axis.
    use_u = spread_u >= spread_v if max(spread_u, spread_v) >= 6.0 else span_u >= span_v
    ax, ay = (ux, uy) if use_u else (vx, vy)
    lo, hi = (min(us), max(us)) if use_u else (min(vs), max(vs))
    ordered = sorted(members, key=lambda m: (m["xy"][0] * ax + m["xy"][1] * ay, m["key"]))
    projs = [m["xy"][0] * ax + m["xy"][1] * ay for m in ordered]
    span = hi - lo

    def cut(cuts: list[float]) -> dict[int, list[XY]]:
        res: dict[int, list[XY]] = {}
        for i, m in enumerate(ordered):
            cell = list(base)
            if i > 0:
                cell = clip_halfplane(cell, (0.0, 0.0), (-ax, -ay), -(cuts[i] + 0.45))
            if i < k - 1:
                cell = clip_halfplane(cell, (0.0, 0.0), (ax, ay), cuts[i + 1] - 0.45)
            if cell:
                res[m["key"]] = clean_ring_xy(cell)
        return res

    uniform = [lo + span * i / k for i in range(k + 1)]
    if max(projs) - min(projs) < 3.0:
        return cut(uniform)
    min_slice = min(max(9.0, 0.5 * span / k), 0.85 * span / k)
    cuts = [lo]
    for i in range(k - 1):
        mid = 0.5 * (projs[i] + projs[i + 1])
        cuts.append(max(cuts[-1] + min_slice, min(hi - (k - 1 - i) * min_slice, mid)))
    cuts.append(hi)
    res = cut(cuts)
    if len(res) != k or any(abs(poly_area(c)) < 90.0 for c in res.values()):
        res = cut(uniform)
    return res


def interior_point(poly: list[XY]) -> XY:
    """A point well inside the outline (max distance to its edges on a 1 m grid): the marker spot."""
    c = centroid_xy(poly)
    if point_in_poly(c, poly) and dist_pt_poly_edges(c, poly) >= 3.0:
        return c
    x0, y0, x1, y1 = bbox(poly)
    best, best_d = c, -1.0
    y = y0 + 0.5
    while y < y1:
        x = x0 + 0.5
        while x < x1:
            if point_in_poly((x, y), poly):
                d = dist_pt_poly_edges((x, y), poly) - 0.02 * math.hypot(x - c[0], y - c[1])
                if d > best_d:
                    best, best_d = (x, y), d
            x += 1.0
        y += 1.0
    return best


def covered_share(poly: list[XY], others: list[list[XY]]) -> float:
    """Share of `poly` (sampled on a 2 m grid) lying inside any of `others`."""
    x0, y0, x1, y1 = bbox(poly)
    near = [o for o in others if not (bbox(o)[2] < x0 or bbox(o)[0] > x1 or bbox(o)[3] < y0 or bbox(o)[1] > y1)]
    if not near:
        return 0.0
    tot = hit = 0
    y = y0 + 1.0
    while y < y1:
        x = x0 + 1.0
        while x < x1:
            if point_in_poly((x, y), poly):
                tot += 1
                if any(point_in_poly((x, y), o) for o in near):
                    hit += 1
            x += 2.0
        y += 2.0
    return hit / tot if tot else 0.0


def build_haram_fence_polygon(fence: dict) -> list[XY]:
    pts = [(pt[0], pt[1]) for run in fence["runs"] for pt in run["path"]]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    pts.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    return clean_ring_xy([to_xy(lng, lat) for lng, lat in pts])


def ring_lnglat(poly: list[XY]) -> list[list[float]]:
    ring = [[round(from_xy(x, y)[0], 7), round(from_xy(x, y)[1], 7)] for x, y in poly]
    return ring + [ring[0]]


def latlng(pt: XY) -> list[float]:
    lng, lat = from_xy(*pt)
    return [round(lat, 7), round(lng, 7)]


def osm_levels(tags: dict) -> int | None:
    raw = tags.get("building:levels")
    if not raw:
        return None
    try:
        return int(round(float(str(raw).split(";")[0].strip())))
    except ValueError:
        return None


def norm_name(name: str) -> str:
    """Arabic hotel name reduced for exact comparison: no diacritics/tatweel, unified alef/ya/ta,
    Latin digits, no punctuation and no leading "فندق"."""
    s = re.sub(r"[\u064B-\u0652\u0640]", "", name or "")
    s = s.translate(str.maketrans("أإآةى٠١٢٣٤٥٦٧٨٩", "اااهي0123456789"))
    s = re.sub(r"[()\[\]\-ـ،,.]", " ", s)
    return " ".join(t for t in s.split() if t != "فندق")


def display_height(floors: int) -> float:
    """Same storey model as Stage 6: 8.8 m arcade podium + 3.15 m floors + 2.2 m crown."""
    return round(8.8 + max(floors - 2, 2) * 3.15 + 2.2, 1)


# ---------------------------------------------------------------------------------------------
def load_osm_buildings(fence_poly: list[XY]) -> list[dict]:
    zone_xy = [to_xy(lng, lat) for lng, lat in CENTRAL_ZONE]
    data = json.loads(OSM_SNAPSHOT.read_text("utf-8"))
    out: list[dict] = []
    for e in data["elements"]:
        tags = e.get("tags") or {}
        if e["type"] == "way" and len(e.get("geometry") or []) >= 4:
            geom = e["geometry"]
            oid = f"w{e['id']}"
        elif e["type"] == "relation":
            outer = [m for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            if len(outer) != 1:
                continue
            geom = outer[0]["geometry"]
            oid = f"r{e['id']}"
        else:
            continue
        ring = clean_ring_xy([to_xy(g["lon"], g["lat"]) for g in geom])
        if len(ring) < 3:
            continue
        c = centroid_xy(ring)
        if not point_in_poly(c, zone_xy) or point_in_poly(c, fence_poly):
            continue
        out.append(
            {
                "osm": oid,
                "tags": tags,
                "ring": ring,
                "area": abs(poly_area(ring)),
                "bbox": bbox(ring),
                "worship": tags.get("amenity") == "place_of_worship" or "historic" in tags,
            }
        )
    return out


def main() -> None:
    urban = json.loads(URBAN_JSON.read_text("utf-8"))
    pois = json.loads(POIS_JSON.read_text("utf-8"))
    fence = json.loads(FENCE_JSON.read_text("utf-8"))
    streets = json.loads(STREETS_JSON.read_text("utf-8"))
    joined = json.loads((STAGE1 / "hotels/hotels-joined.json").read_text("utf-8"))
    pins = {h["number"]: (h["lng"], h["lat"]) for h in joined if h.get("lat") is not None}
    pins.update({n: p for n, p in FALLBACK_PINS.items() if n not in pins})
    poi_by_id = {p["id"]: p for p in pois}

    fence_poly = build_haram_fence_polygon(fence)
    osm = [b for b in load_osm_buildings(fence_poly) if b["osm"] not in HERITAGE_OSM_IDS and not b["worship"]]
    print(f"OSM buildings inside the central zone (not Haram / worship / heritage): {len(osm)}")

    # --- 1. Link every approved hotel to its OSM building --------------------------------------
    # An OSM building named exactly like the hotel (within 80 m of its guide pin) wins; otherwise
    # the building under the guide pin, or the nearest one within 15 m.
    osm_by_name: dict[str, list[dict]] = defaultdict(list)
    for o in osm:
        for nm in {norm_name(o["tags"][k]) for k in ("name", "name:ar") if o["tags"].get(k)}:
            osm_by_name[nm].append(o)
    hotels = urban["buildings"]
    groups: dict[str, list[dict]] = defaultdict(list)
    unmatched: list[dict] = []
    stats_link: dict[str, int] = defaultdict(int)
    for b in hotels:
        pin = pins.get(b["guideNumber"])
        if pin is None:
            poi = poi_by_id[b["poiId"]]
            pin = (poi["lng"], poi["lat"])
        p = to_xy(*pin)
        named = [o for o in osm_by_name.get(norm_name(b["name_ar"]), []) if dist_pt_poly_edges(p, o["ring"]) <= NAME_MATCH_RADIUS_M]
        hit = [o for o in osm if point_in_poly(p, o["ring"])]
        best = named[0] if len(named) == 1 else min(hit, key=lambda o: o["area"]) if hit else None
        if len(named) == 1:
            stats_link["name"] += 1
        if best is None:
            near = [
                (dist_pt_poly_edges(p, o["ring"]), o)
                for o in osm
                if o["bbox"][0] - 30 < p[0] < o["bbox"][2] + 30 and o["bbox"][1] - 30 < p[1] < o["bbox"][3] + 30
            ]
            near.sort(key=lambda t: t[0])
            if near and near[0][0] <= MATCH_RADIUS_M:
                best = near[0][1]
        if best is None:
            unmatched.append(b)
            continue
        groups[best["osm"]].append({"key": b["poiId"], "xy": p, "building": b})

    print(f"hotels linked by exact OSM name: {stats_link['name']}")
    osm_by_id = {o["osm"]: o for o in osm}
    resolved: dict[int, tuple[list[XY], str, dict]] = {}
    for oid, members in groups.items():
        o = osm_by_id[oid]
        base = simplify_ring(o["ring"])
        if len(members) == 1:
            resolved[members[0]["key"]] = (base, "single", o)
            continue
        parts = split_shared_polygon(base, members)
        assert len(parts) == len(members), f"split failed for {oid}"
        for key, cell in parts.items():
            resolved[key] = (cell, "osm_split", o)

    # Hotels whose pin sits on no OSM building keep their Stage 6 outline only if it is clear of
    # every OSM building; otherwise they stay pin-only (marker only, no invented tower).
    taken = [r[0] for r in resolved.values()]
    for b in unmatched:
        if b["hasFootprint"] and len(b["polygon"]) >= 4:
            poly = clean_ring_xy([to_xy(c[0], c[1]) for c in b["polygon"][:-1]])
            if covered_share(poly, [o["ring"] for o in osm] + taken) < 0.15:
                resolved[b["poiId"]] = (poly, b["footprintSplit"] if b["footprintSplit"] != "provisional_pin_partition" else "single", {})
                continue
        print(f"  pin-only (no building under the guide pin): #{b['guideNumber']} {b['name_ar']}")

    used_osm = set(groups)
    hotel_polys = {pid: r[0] for pid, r in resolved.items()}
    for pid, poly in hotel_polys.items():
        for pt in poly:
            assert not point_in_poly(pt, fence_poly), f"hotel {pid} intrudes the Haram fence"

    # --- 2. Context buildings: every other central OSM building -------------------------------
    context: list[dict] = []
    hotel_list = list(hotel_polys.values())
    for o in osm:
        if o["osm"] in used_osm:
            continue
        if o["area"] < MIN_CONTEXT_AREA_M2 or o["tags"].get("building") in SKIP_BUILDING_VALUES or o["osm"] in NOT_TOWERS_OSM_IDS:
            continue
        if TUNNEL_NAME.search(o["tags"].get("name", "") + o["tags"].get("name:en", "")):
            continue
        poly = simplify_ring(o["ring"])
        if any(point_in_poly(pt, fence_poly) for pt in poly):
            continue
        if covered_share(poly, hotel_list + [c["_xy"] for c in context]) > 0.15:
            continue
        context.append({"_xy": poly, "_osm": o})

    # --- 3. Street segments for entrances and drop-offs ---------------------------------------
    zone_xy = [to_xy(lng, lat) for lng, lat in CENTRAL_ZONE]
    zx0, zy0, zx1, zy1 = bbox(zone_xy)
    s_nodes = streets["nodes"]
    drive_segs: list[tuple[XY, XY]] = []
    walk_segs: list[tuple[XY, XY]] = []
    for w in streets["ways"]:
        mode, _oneway, *nids = w
        if mode & 4:  # tunnels
            continue
        pts = [to_xy(s_nodes[i][1], s_nodes[i][0]) for i in nids]
        for a, b2 in zip(pts, pts[1:]):
            mid = (0.5 * (a[0] + b2[0]), 0.5 * (a[1] + b2[1]))
            if not (zx0 - 60 < mid[0] < zx1 + 60 and zy0 - 60 < mid[1] < zy1 + 60):
                continue
            if point_in_poly(mid, fence_poly):
                continue
            walk_segs.append((a, b2))
            if mode & 1:
                drive_segs.append((a, b2))

    # --- 3b. Towers in the imagery that OSM has not mapped yet ---------------------------------
    # Microsoft footprints sit a steady few metres south-west of the OSM (imagery-aligned) outlines.
    # The shift is measured here from one-to-one pairs; shifted back, an MS outline that no mapped
    # building covers and no road crosses fills the gap (`source: ms_shifted`).
    ms_feats = json.loads(MS_FOOTPRINTS.read_text("utf-8"))["features"]
    ms_rings = [clean_ring_xy([to_xy(c[0], c[1]) for c in f["geometry"]["coordinates"][0]]) for f in ms_feats]
    ms_rings = [r for r in ms_rings if len(r) >= 3]
    osm_cen = [(centroid_xy(o["ring"]), o["area"]) for o in osm]
    shifts: list[XY] = []
    for r in ms_rings:
        c, a = centroid_xy(r), abs(poly_area(r))
        if a < 200 or not point_in_poly(c, zone_xy):
            continue
        cand = [oc for oc, oa in osm_cen if math.hypot(oc[0] - c[0], oc[1] - c[1]) < 25 and 0.7 < oa / a < 1.4]
        if len(cand) == 1:
            shifts.append((cand[0][0] - c[0], cand[0][1] - c[1]))
    sx = sorted(s[0] for s in shifts)[len(shifts) // 2]
    sy = sorted(s[1] for s in shifts)[len(shifts) // 2]
    print(f"MS -> OSM shift from {len(shifts)} pairs: {sx:+.1f} m east, {sy:+.1f} m north")
    plaza_xy = [[to_xy(lng, lat) for lng, lat in pz] for pz in OPEN_PLAZAS]
    road_pts = [(a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t) for a, b2 in drive_segs for t in (0.0, 0.25, 0.5, 0.75)]
    gap_added = 0
    for r in ms_rings:
        poly = simplify_ring([(x + sx, y + sy) for x, y in r])
        c, a = centroid_xy(poly), abs(poly_area(poly))
        if a < 200 or not point_in_poly(c, zone_xy) or any(point_in_poly(pt, fence_poly) for pt in poly):
            continue
        x0, y0, x1, y1 = bbox(poly)
        if any(x0 < p[0] < x1 and y0 < p[1] < y1 and point_in_poly(p, poly) for p in road_pts):
            continue
        if covered_share(poly, [o["ring"] for o in osm] + list(hotel_polys.values()) + [k["_xy"] for k in context]) > 0.12:
            continue
        # Open plazas carry canopies, kiosks and paving patterns that MS mistakes for roofs.
        if any(point_in_poly(c, pz) for pz in plaza_xy):
            continue
        context.append({"_xy": poly, "_osm": {"osm": None, "tags": {}, "ms": f"ms{round(c[0])}_{round(c[1])}"}})
        gap_added += 1
    print(f"gap towers from shifted MS footprints: {gap_added}")

    all_polys = list(hotel_polys.values()) + [c["_xy"] for c in context]
    all_boxes = [bbox(p) for p in all_polys]

    def clear_of_buildings(pt: XY, min_clear: float) -> bool:
        if point_in_poly(pt, fence_poly):
            return False
        for poly, (x0, y0, x1, y1) in zip(all_polys, all_boxes):
            if x0 - 2 < pt[0] < x1 + 2 and y0 - 2 < pt[1] < y1 + 2:
                if point_in_poly(pt, poly) or dist_pt_poly_edges(pt, poly) < min_clear:
                    return False
        return True

    def near_segs(segs: list[tuple[XY, XY]], pt: XY, r: float) -> list[tuple[XY, XY]]:
        return [s for s in segs if min(s[0][0], s[1][0]) - r < pt[0] < max(s[0][0], s[1][0]) + r and min(s[0][1], s[1][1]) - r < pt[1] < max(s[0][1], s[1][1]) + r]

    def dropoff_for(pt: XY) -> list[float]:
        for r in (60.0, 150.0, 400.0):
            best_d, best_pt = float("inf"), None
            for a, b2 in near_segs(drive_segs, pt, r):
                d, proj = dist_pt_seg(pt, a, b2)
                if d < best_d and clear_of_buildings(proj, 0.2):
                    best_d, best_pt = d, proj
            if best_pt is not None:
                return latlng(best_pt)
        raise RuntimeError("no drivable street for drop-off")

    def entrance_for(poly: list[XY], pin: XY) -> tuple[XY, str]:
        cand_best, best_score = None, float("inf")
        cen = centroid_xy(poly)
        roads = near_segs(drive_segs, cen, 90.0)
        walks = near_segs(walk_segs, cen, 90.0)
        n = len(poly)
        for i in range(n):
            a, b2 = poly[i], poly[(i + 1) % n]
            ex, ey = b2[0] - a[0], b2[1] - a[1]
            elen = math.hypot(ex, ey)
            if elen < 2.0:
                continue
            nx, ny = ey / elen, -ex / elen  # outward for a CCW ring (flipped below if not)
            if point_in_poly((0.5 * (a[0] + b2[0]) + nx * 0.5, 0.5 * (a[1] + b2[1]) + ny * 0.5), poly):
                nx, ny = -nx, -ny
            for u in (0.5, 0.35, 0.65):
                mx, my = a[0] + ex * u, a[1] + ey * u
                for push in (0.9, 1.4, 2.2):
                    c = (mx + nx * push, my + ny * push)
                    if not clear_of_buildings(c, 0.15):
                        continue
                    d_road = min((dist_pt_seg(c, s0, s1)[0] for s0, s1 in roads), default=90.0)
                    d_foot = min((dist_pt_seg(c, s0, s1)[0] for s0, s1 in walks), default=90.0)
                    score = min(d_road, d_foot + 4.0) * 2.0 + 0.12 * math.hypot(c[0] - pin[0], c[1] - pin[1]) + push * 0.5
                    if score < best_score:
                        best_score, cand_best = score, (c, entrance_side_from_normal(nx, ny))
        if cand_best is None:
            raise RuntimeError("no clear entrance on any facade")
        return cand_best

    # --- 4. Rewrite the hotels ----------------------------------------------------------------
    stats = defaultdict(int)
    for b in hotels:
        pid = b["poiId"]
        poi = poi_by_id.get(pid)
        pin_ll = pins.get(b["guideNumber"]) or (poi["lng"], poi["lat"])
        pin = to_xy(*pin_ll)
        if pid not in resolved:
            stats["pin_only"] += 1
            b.update({"hasFootprint": False, "footprintSplit": "none", "polygon": [], "areaM2": 0.0})
            b.update({"levels": None, "displayFloors": None, "heightM": 0.0, "heightSource": "none", "confidence": "none"})
            ent = pin if clear_of_buildings(pin, 0.25) else entrance_for([(pin[0] - 1, pin[1] - 1), (pin[0] + 1, pin[1] - 1), (pin[0] + 1, pin[1] + 1), (pin[0] - 1, pin[1] + 1)], pin)[0]
            b["center"] = latlng(pin)
            b["entrance"] = latlng(ent)
            b["dropoff"] = dropoff_for(ent)
            continue
        poly, split, o = resolved[pid]
        stats[split] += 1
        was_pin_only = not b["hasFootprint"]
        b["hasFootprint"] = True
        b["footprintSplit"] = split
        b["polygon"] = ring_lnglat(poly)
        b["areaM2"] = round(abs(poly_area(poly)), 1)
        b["center"] = latlng(centroid_xy(poly))
        if o.get("osm"):
            b["osm"] = o["osm"]
        ent, side = entrance_for(poly, pin)
        b["entrance"] = latlng(ent)
        b["entranceSide"] = side
        b["dropoff"] = dropoff_for(ent)
        lv = osm_levels(o.get("tags") or {})
        if lv is not None:
            b.update({"levels": lv, "displayFloors": max(3, min(18, lv)), "heightM": display_height(max(3, min(18, lv))), "heightSource": "osm_levels", "confidence": "osm"})
        elif was_pin_only or b["heightSource"] == "none":
            floors = 11 + int(seeded_unit(str(pid), 1) * 3.0)
            b.update({"levels": None, "displayFloors": floors, "heightM": display_height(floors), "heightSource": "estimated_display_only", "confidence": "display_only"})
            b["styleId"] = int(seeded_unit(str(pid), 2) * 3.0) % 3
            b["tint"] = round((seeded_unit(str(pid), 4) - 0.5) * 0.11, 4)
        if poi is not None:
            mark = interior_point(poly)
            mlng, mlat = from_xy(*mark)
            poi["lat"], poi["lng"] = round(mlat, 7), round(mlng, 7)
            if o.get("osm"):
                poi["osm"] = o["osm"]
    print("hotels:", dict(stats))

    # --- 5. Context buildings records ---------------------------------------------------------
    hotel_centres = [(to_xy(b["center"][1], b["center"][0]), b["zone"]) for b in hotels]
    ctx_out: list[dict] = []
    for c in sorted(context, key=lambda c: c["_osm"]["osm"] or c["_osm"]["ms"]):
        o, poly = c["_osm"], c["_xy"]
        cen = centroid_xy(poly)
        zone = min(hotel_centres, key=lambda hc: math.hypot(hc[0][0] - cen[0], hc[0][1] - cen[1]))[1]
        area = abs(poly_area(poly))
        lv = osm_levels(o["tags"])
        key = o["osm"] or o["ms"]
        if lv is not None:
            floors, src, conf = max(3, min(18, lv)), "osm_levels", "osm"
        else:
            r = seeded_unit(key, 1)
            floors = (5 + int(r * 3.0)) if area < 450 else (10 + int(r * 3.0)) if area < 1000 else (11 + int(r * 3.0))
            if LOW_RISE_NAME.search(o["tags"].get("name", "")):
                floors = 3
            src, conf = "estimated_display_only", "display_only"
        rec = {
            "buildingId": f"C{key}",
            "osm": o["osm"],
            "source": "osm" if o["osm"] else "ms_shifted",
            "zone": zone,
            "kind": "context",
            "areaM2": round(area, 1),
            "center": latlng(cen),
            "levels": lv,
            "displayFloors": floors,
            "heightM": display_height(floors),
            "heightSource": src,
            "confidence": conf,
            "styleId": int(seeded_unit(key, 2) * 3.0) % 3,
            "seed": round(seeded_unit(key, 3), 4),
            "tint": round((seeded_unit(key, 4) - 0.5) * 0.11, 4),
            "polygon": ring_lnglat(poly),
        }
        name = o["tags"].get("name:ar") or o["tags"].get("name")
        if name:
            rec["name"] = name
        ctx_out.append(rec)
    print(f"context buildings: {len(ctx_out)} ({sum(1 for c in ctx_out if 'name' in c)} named)")

    # --- 6. Props now covered by a footprint are dropped --------------------------------------
    dropped = 0
    for zone, props in (urban.get("urbanPropsByZone") or {}).items():
        for kind in ("streetLamps", "palms"):
            keep = []
            for p in props.get(kind, []):
                pt = to_xy(p["lng"], p["lat"])
                if clear_of_buildings(pt, 0.6):
                    keep.append(p)
                else:
                    dropped += 1
            props[kind] = keep
    if "urbanProps" in urban and "south" in (urban.get("urbanPropsByZone") or {}):
        urban["urbanProps"] = urban["urbanPropsByZone"]["south"]
    print(f"props dropped under new footprints: {dropped}")

    urban["stage"] = "stage-7-osm-satellite-match"
    urban["approvedAt"] = "2026-11-22"
    urban["footprintSource"] = "osm-2026-11-22-satellite-aligned+authority-2026-guide-pins"
    urban["contextBuildings"] = ctx_out
    URBAN_JSON.write_text(json.dumps(urban, ensure_ascii=False, indent=2) + "\n", "utf-8")
    POIS_JSON.write_text(json.dumps(pois, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"wrote {URBAN_JSON.relative_to(ROOT)} and {POIS_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
