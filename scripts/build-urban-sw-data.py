"""
Build Stage 6 Zone 4 (Southwest SW 302-396) verified & tagged urban data from:
  - Stage 1 extracted Authority 2026 hotel index & Google Maps links (`hotels/hotels-joined.json`, `hotels/hotels-2026.geojson`)
  - Extracted OSM buildings (`hotels/footprints/osm-buildings-2026-10-08.json`) for 4 non-overlapping SW footprints (`#302, #342, #377, #388`) and real `building:levels`
  - Repository `data/urban-approved.json`, `data/pois.json`, `data/haram-fence.json`, `data/streets.json`, `data/i18n.json`

Idempotent behavior:
  - Preserves all Zone 1 South (`zone == "south"`, 57 hotels, 171 corridors), Zone 2 West (`zone == "west"`, 39 hotels, 94 corridors), and Zone 3 North (`zone == "north"`, 61 hotels, 90 corridors) entries and their `urbanPropsByZone` intact.
  - Replaces any prior Zone 4 Southwest (`zone == "sw"`) buildings, corridors, and `urbanPropsByZone.sw`.
  - Deduplicates `#373` (`المناخة روتانا برج(1)`) into existing verified `POI 735` (`S017`, `فندق المناخة روتانا (برج ١)` in `zone == "south"`), leaving `#372` (`المناخة روتانا برج(2)`) with its single Tower 2 MS footprint (`SW372`, `577.8 m²`), and reuses existing `POI 741` (`فندق حياة جراند`) for `#331`.
  - Keeps `#307` (`منازل الرحمة`) as pin-only (`hasFootprint: false`) because it has no MS footprint and its nearest OSM building belongs to `#308`.
  - Updates `data/i18n.json` across all 26 locales.
  - Renders the Zone 4 Southwest Review Atlas board in `الملفات المؤقتة/لوحة-مراجعة-الجنوب-الغربي-المرحلة-6.png`.

Usage:
  python3 scripts/build-urban-sw-data.py
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE1 = Path(
    "/Users/nooraddeen/Desktop/ملحقات المجلد المركزي/rea/مشاريع التحليل/alharamain-navq-2026-11-18"
)
RENDER_BIN = STAGE1 / "boards" / "render"
BOARD_SPEC_PATH = Path("/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/zone-sw-stage6-board.json")
BOARD_PNG_PATH = Path(
    "/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/لوحة-مراجعة-الجنوب-الغربي-المرحلة-6.png"
)

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_RADIUS_M = 6_371_008.8
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M
COS_ORIGIN = math.cos(math.radians(ORIGIN_LAT))

# Existing verified POI in data/pois.json reused directly in Zone 4 SW
EXISTING_POI_BY_GUIDE = {
    331: 741,  # فندق حياة جراند
}

# Guide #373 (`المناخة روتانا برج(1)`) is already approved in Zone 1 South as POI 735 (`S017`, `فندق المناخة روتانا (برج ١)`)
DUPLICATE_GUIDE_TO_PRIMARY_POI = {
    373: 735,
}

# 4 verified non-overlapping OSM hotel footprints (2 missing MS footprints #302 & #388 + 2 tiny MS roof slivers #342 & #377)
OSM_FOOTPRINT_BY_GUIDE = {
    302: 625628213,  # فندق منازل الصادق (350.7 m2)
    342: 388392246,  # مرجان المدينة الذهبي (497.8 m2 replacing 86.2 m2 4-pt MS sliver)
    377: 369464175,  # برادايس (915.0 m2 replacing 132.7 m2 MS roof sliver)
    388: 626031189,  # فندق طيف النبراس (486.0 m2)
}

EN_HOTEL_NAMES = {
    "منازل الصادق - زوار": "Manazel Al-Sadiq Zowar Hotel",
    "ميراج السلام": "Mirage Al-Salam Hotel",
    "منازل الفلاح الذهبي": "Manazel Al-Falah Golden Hotel",
    "كيان الماسي": "Kayan Al-Masi Hotel",
    "البسفور": "Bosphorus Hotel",
    "منازل الرحمة": "Manazel Al-Rahmah Hotel",
    "روابي الزهراء": "Rawabi Al-Zahraa Hotel",
    "السعفة الذهبية": "As-Saafa Golden Hotel",
    "ديوان روز": "Diwan Rose Hotel",
    "البسفور (2)": "Bosphorus 2 Hotel",
    "ارجوان المدينة": "Arjwan Al-Madinah Hotel",
    "رؤيا الأندلس النخبة": "Roaya Al-Andalus Elite Hotel",
    "وردة الصفا": "Wardat Al-Safa Hotel",
    "ضيافة المختارة": "Diyafat Al-Mukhtara Hotel",
    "السعفة": "As-Saafa Hotel",
    "ارجوان السلام": "Arjwan Al-Salam Hotel",
    "سدرة المدينة": "Sidrat Al-Madinah Hotel",
    "بر الإيمان": "Birr Al-Eiman Hotel",
    "ارجوان روز": "Arjwan Rose Hotel",
    "ديار الهدى": "Diyar Al-Huda Hotel",
    "حياة جراند": "Hayah Grand Hotel",
    "بلازا إن أحد": "Plaza Inn Ohud Hotel",
    "ابراج طابة الفضي": "Abraj Taba Silver Hotel",
    "البركة كريم": "Al-Baraka Karim Hotel",
    "اعمار طيبة": "Emaar Taiba Hotel",
    "ديار السلام الفضي": "Diyar Al-Salam Silver Hotel",
    "ديوان المدينة": "Diwan Al-Madinah Hotel",
    "ديار النخيل": "Diyar Al-Nakheel Hotel",
    "الفيروز الذهبي": "Al-Fayrouz Golden Hotel",
    "رؤيا الأندلس البلاتيني": "Roaya Al-Andalus Platinum Hotel",
    "مرجان المدينة الذهبي": "Murjan Al-Madinah Golden Hotel",
    "لؤلؤة المدينة": "Luluat Al-Madinah Hotel",
    "كيان المدينة": "Kayan Al-Madinah Hotel",
    "لؤلؤة الضيافة": "Luluat Al-Diyafah Hotel",
    "برج المرجان العالمي": "Burj Al-Murjan International Hotel",
    "ندى السلام": "Nada Al-Salam Hotel",
    "حياة السلام الفضي": "Hayat Al-Salam Silver Hotel",
    "ازهار سلسبيل": "Azhar Salsabil Hotel",
    "جراند الصافي": "Grand Al-Safi Hotel",
    "سما الذهبي": "Sama Golden Hotel",
    "روز هوليداي i2": "Rose Holiday i2 Hotel",
    "جوهرة الرشيد": "Jawharat Al-Rasheed Hotel",
    "المختارة الذهبي": "Al-Mukhtara Golden Hotel",
    "رؤى الضيافة": "Rua Al-Diyafah Hotel",
    "رؤى جراند": "Rua Grand Hotel",
    "روز هوليداي i1": "Rose Holiday i1 Hotel",
    "المختارة الماسي": "Al-Mukhtara Diamond Hotel",
    "وردة الريان": "Wardat Al-Rayyan Hotel",
    "الأندلس دار السلام": "Al-Andalus Dar Al-Salam Hotel",
    "سما الماسي": "Sama Al-Masi Hotel",
    "منازل التقوى": "Manazel Al-Taqwa Hotel",
    "وردة السعادة": "Wardat Al-Saadah Hotel",
    "جراند الشهباء": "Grand Al-Shahba Hotel",
    "كرم المدينة": "Karam Al-Madinah Hotel",
    "ميلينيوم طيبة": "Millennium Taiba Hotel",
    "المناخة روتانا برج(2)": "Al-Manakha Rotana Hotel (Tower 2)",
    "نجوم المدينة": "Nujoom Al-Madinah Hotel",
    "جوار طيبة": "Jiwar Taiba Hotel",
    "برادايس": "Paradise Hotel",
    "رؤى طيبة بلس": "Rua Taiba Plus Hotel",
    "ديار المدينة": "Diyar Al-Madinah Hotel",
    "روضة المختار": "Rawdat Al-Mukhtar Hotel",
    "سبال": "Sebal Hotel",
    "الأمان العربية": "Al-Aman Al-Arabia Hotel",
    "طيبة روز": "Taiba Rose Hotel",
    "رحاب هارموني": "Rehab Harmony Hotel",
    "حياة الماسي": "Hayat Al-Masi Hotel",
    "محمدية الزهراء": "Muhammadiyah Al-Zahraa Hotel",
    "انوار الزهراء": "Anwar Al-Zahraa Hotel",
    "طيف النبراس": "Taif Al-Nebrass Hotel",
    "ميرامار": "Miramar Hotel",
}

SW_BBOX = {"min_lat": 24.4628, "max_lat": 24.4675, "min_lng": 39.6022, "max_lng": 39.6073}


def _mercator_x(lng: float) -> float:
    return (180.0 + lng) / 360.0


def _mercator_y(lat: float) -> float:
    return (180.0 - (180.0 / math.pi) * math.log(math.tan(math.pi / 4.0 + (lat * math.pi) / 360.0))) / 360.0


ORIGIN_MX = _mercator_x(ORIGIN_LNG)
ORIGIN_MY = _mercator_y(ORIGIN_LAT)


def to_xy(lng: float, lat: float) -> tuple[float, float]:
    scale = EARTH_CIRCUMFERENCE_M * COS_ORIGIN
    x = (_mercator_x(lng) - ORIGIN_MX) * scale
    y = (ORIGIN_MY - _mercator_y(lat)) * scale
    return x, y


def from_xy(x: float, y: float) -> tuple[float, float]:
    scale = EARTH_CIRCUMFERENCE_M * COS_ORIGIN
    mx = ORIGIN_MX + x / scale
    my = ORIGIN_MY - y / scale
    lng = mx * 360.0 - 180.0
    lat = (360.0 / math.pi) * math.atan(math.exp((180.0 - my * 360.0) * math.pi / 180.0)) - 90.0
    return lng, lat


def seeded_unit(pid: int, salt: int) -> float:
    digest = hashlib.sha256(f"{pid}:{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def poly_area(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return 0.5 * s


def centroid_xy(pts: list[tuple[float, float]]) -> tuple[float, float]:
    a = poly_area(pts)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    cx = 0.0
    cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    f = 1.0 / (6.0 * a)
    return (cx * f, cy * f)


def clean_ring_xy(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.05:
            out.append(p)
    if len(out) >= 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 0.05:
        out.pop()
    if poly_area(out) < 0.0:
        out.reverse()
    return out


def point_in_poly(pt: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


def dist_pt_seg(
    pt: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, tuple[float, float]]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 < 1e-12:
        return math.hypot(pt[0] - a[0], pt[1] - a[1]), a
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2))
    proj = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(pt[0] - proj[0], pt[1] - proj[1]), proj


def dist_pt_poly_edges(pt: tuple[float, float], poly: list[tuple[float, float]]) -> float:
    n = len(poly)
    best = float("inf")
    for i in range(n):
        d, _ = dist_pt_seg(pt, poly[i], poly[(i + 1) % n])
        if d < best:
            best = d
    return best


def entrance_side_from_normal(nx: float, ny: float) -> str:
    if abs(nx) >= abs(ny):
        return "east" if nx >= 0 else "west"
    return "north" if ny >= 0 else "south"


def clip_halfplane(
    poly: list[tuple[float, float]], origin: tuple[float, float], normal: tuple[float, float], offset: float
) -> list[tuple[float, float]]:
    """Keep points where dot(p - origin, normal) <= offset (CCW Sutherland-Hodgman)."""
    if len(poly) < 3:
        return []

    def signed(p: tuple[float, float]) -> float:
        return (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] - offset

    out: list[tuple[float, float]] = []
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        da = signed(a)
        db = signed(b)
        if da <= 1e-9:
            out.append(a)
            if db > 1e-9:
                t = da / (da - db)
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        elif db <= 1e-9:
            t = da / (da - db)
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    cleaned: list[tuple[float, float]] = []
    for pt in out:
        if not cleaned or math.hypot(pt[0] - cleaned[-1][0], pt[1] - cleaned[-1][1]) > 1e-4:
            cleaned.append(pt)
    if len(cleaned) >= 2 and math.hypot(cleaned[0][0] - cleaned[-1][0], cleaned[0][1] - cleaned[-1][1]) <= 1e-4:
        cleaned.pop()
    return cleaned if len(cleaned) >= 3 and abs(poly_area(cleaned)) > 1.0 else []


def dominant_edge_angle(poly: list[tuple[float, float]]) -> float:
    bins: dict[int, float] = defaultdict(float)
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        elen = math.hypot(dx, dy)
        if elen < 1.0:
            continue
        ang = math.degrees(math.atan2(dy, dx)) % 90.0
        bins[round(ang)] += elen
    best_deg = max(bins.items(), key=lambda kv: kv[1])[0] if bins else 0.0
    return math.radians(best_deg)


def _apply_strip_cuts(
    base: list[tuple[float, float]],
    ordered: list[dict],
    ax: float,
    ay: float,
    cuts: list[float],
    gap_half: float = 0.45,
) -> dict[int, list[tuple[float, float]]]:
    result: dict[int, list[tuple[float, float]]] = {}
    k = len(ordered)
    for i, m in enumerate(ordered):
        cell = list(base)
        if i > 0:
            cut_in = cuts[i] + gap_half
            cell = clip_halfplane(cell, (0.0, 0.0), (-ax, -ay), -cut_in)
        if i < k - 1:
            cut_out = cuts[i + 1] - gap_half
            cell = clip_halfplane(cell, (0.0, 0.0), (ax, ay), cut_out)
        if cell:
            result[m["number"]] = clean_ring_xy(cell)
    return result


def split_shared_polygon(
    raw_xy: list[tuple[float, float]], members: list[dict]
) -> dict[int, list[tuple[float, float]]]:
    base = clean_ring_xy(raw_xy)
    k = len(members)
    theta = dominant_edge_angle(base)
    ux, uy = math.cos(theta), math.sin(theta)
    vx, vy = -uy, ux

    us = [p[0] * ux + p[1] * uy for p in base]
    vs = [p[0] * vx + p[1] * vy for p in base]
    span_u = max(us) - min(us)
    span_v = max(vs) - min(vs)

    pin_u = [m["xy"][0] * ux + m["xy"][1] * uy for m in members]
    pin_v = [m["xy"][0] * vx + m["xy"][1] * vy for m in members]
    spread_u = max(pin_u) - min(pin_u)
    spread_v = max(pin_v) - min(pin_v)

    use_u = span_u >= span_v
    if abs(span_u - span_v) < 8.0 and abs(spread_u - spread_v) > 2.0:
        use_u = spread_u >= spread_v

    if use_u:
        ax, ay = ux, uy
        lo, hi = min(us), max(us)
        ordered = sorted(members, key=lambda m: (m["xy"][0] * ux + m["xy"][1] * uy, m["number"]))
    else:
        ax, ay = vx, vy
        lo, hi = min(vs), max(vs)
        ordered = sorted(members, key=lambda m: (m["xy"][0] * vx + m["xy"][1] * vy, m["number"]))

    span = hi - lo
    projs = [m["xy"][0] * ax + m["xy"][1] * ay for m in ordered]
    if max(projs) - min(projs) < 3.0:
        uniform_cuts = [lo + (span * i / k) for i in range(k + 1)]
        return _apply_strip_cuts(base, ordered, ax, ay, uniform_cuts)

    min_slice = min(max(11.0, 0.52 * (span / k)), (span / k) * 0.85)
    cuts: list[float] = [lo]
    for i in range(k - 1):
        mid = 0.5 * (projs[i] + projs[i + 1])
        min_pos = cuts[-1] + min_slice
        max_pos = hi - (k - 1 - i) * min_slice
        c = max(min_pos, min(max_pos, mid))
        cuts.append(c)
    cuts.append(hi)

    result = _apply_strip_cuts(base, ordered, ax, ay, cuts)
    if len(result) != k or any(abs(poly_area(c)) < 120.0 for c in result.values()):
        uniform_cuts = [lo + (span * i / k) for i in range(k + 1)]
        result = _apply_strip_cuts(base, ordered, ax, ay, uniform_cuts)
    return result


def build_haram_fence_polygon(haram_data: dict) -> list[tuple[float, float]]:
    pts_ll: list[tuple[float, float]] = []
    for run in haram_data["runs"]:
        for pt in run["path"]:
            pts_ll.append((pt[0], pt[1]))
    cx = sum(p[0] for p in pts_ll) / len(pts_ll)
    cy = sum(p[1] for p in pts_ll) / len(pts_ll)
    pts_ll.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    return clean_ring_xy([to_xy(lng, lat) for lng, lat in pts_ll])


def main() -> None:
    joined = json.loads((STAGE1 / "hotels/hotels-joined.json").read_text("utf-8"))
    if isinstance(joined, dict):
        joined = joined.get("hotels", [])
    hotels_geo = json.loads((STAGE1 / "hotels/hotels-2026.geojson").read_text("utf-8"))
    osm_data = json.loads((STAGE1 / "hotels/footprints/osm-buildings-2026-10-08.json").read_text("utf-8"))
    haram_fence = json.loads((ROOT / "data/haram-fence.json").read_text("utf-8"))
    streets = json.loads((ROOT / "data/streets.json").read_text("utf-8"))
    pois = json.loads((ROOT / "data/pois.json").read_text("utf-8"))
    existing_urban = json.loads((ROOT / "data/urban-approved.json").read_text("utf-8"))

    haram_poly = build_haram_fence_polygon(haram_fence)

    # Remove any prior Zone 4 SW new POIs (2302..2396) for idempotency
    pois = [p for p in pois if not (p.get("subCategory") == "hotel" and 2300 <= p["id"] <= 2399)]
    poi_by_id = {p["id"]: p for p in pois}

    # Preserve South, West, and North buildings intact (linking guideNumber 373 onto S017 / POI 735)
    preserved_buildings = [b for b in existing_urban["buildings"] if b["zone"] in ("south", "west", "north")]
    preserved_polys_xy: dict[int, list[tuple[float, float]]] = {}
    for b in preserved_buildings:
        if b["poiId"] == 735:
            b["guideNumber"] = 373
        if b["hasFootprint"] and len(b["polygon"]) >= 4:
            preserved_polys_xy[b["poiId"]] = clean_ring_xy([to_xy(c[0], c[1]) for c in b["polygon"][:-1]])

    if 735 in poi_by_id:
        p735 = poi_by_id[735]
        p735["guideNumber"] = 373
        toks = (p735.get("alias") or "").split()
        if "373" not in toks:
            toks.append("373")
        p735["alias"] = " ".join(toks).strip()

    # Preserve South, West, and North corridors
    preserved_corridors = []
    preserved_way_indices: set[int] = set()
    for c in existing_urban.get("streetCorridors", []):
        z = c.get("zone", "south")
        if z in ("south", "west", "north"):
            tagged = dict(c)
            tagged["zone"] = z
            preserved_corridors.append(tagged)
            preserved_way_indices.add(tagged["wayIndex"])

    # Preserve South, West, and North props
    props_by_zone_existing = existing_urban.get("urbanPropsByZone") or {}
    south_props = props_by_zone_existing.get("south", existing_urban["urbanProps"])
    west_props = props_by_zone_existing.get("west", {"parkingPortals": [], "streetLamps": [], "palms": []})
    north_props = props_by_zone_existing.get("north", {"parkingPortals": [], "streetLamps": [], "palms": []})

    # Index OSM elements and collect OSM building:levels in SW
    osm_by_id: dict[int, dict] = {}
    osm_levels_buildings: list[dict] = []
    for e in osm_data.get("elements", []):
        if "id" in e:
            osm_by_id[e["id"]] = e
        tags = e.get("tags") or {}
        if "building:levels" not in tags or not e.get("geometry"):
            continue
        try:
            lvl = int(round(float(str(tags["building:levels"]).split(";")[0].strip())))
        except ValueError:
            continue
        pts = e["geometry"]
        if len(pts) < 3:
            continue
        clat = sum(g["lat"] for g in pts) / len(pts)
        clng = sum(g["lon"] for g in pts) / len(pts)
        if SW_BBOX["min_lat"] <= clat <= SW_BBOX["max_lat"] and SW_BBOX["min_lng"] <= clng <= SW_BBOX["max_lng"]:
            raw_ring = [to_xy(g["lon"], g["lat"]) for g in pts]
            osm_levels_buildings.append(
                {
                    "osm": f"w{e['id']}",
                    "name": tags.get("name", ""),
                    "levels": lvl,
                    "center_xy": to_xy(clng, clat),
                    "ring_xy": clean_ring_xy(raw_ring),
                }
            )
    print(f"OSM buildings with building:levels in SW: {len(osm_levels_buildings)}")

    # Extract surface street polylines in SW for dropoffs & SW corridor geometry
    s_nodes = streets["nodes"]
    surface_drivable_segs: list[tuple[tuple[float, float], tuple[float, float], int, int]] = []
    surface_all_segs: list[tuple[tuple[float, float], tuple[float, float], int]] = []
    sw_corridors: list[dict] = []

    for way_idx, w in enumerate(streets["ways"]):
        mode, oneway, *nids = w
        if mode & 4:  # Skip underground tunnel lanes
            continue
        coords_latlng = [s_nodes[i] for i in nids]
        pts_xy = [to_xy(lng, lat) for lat, lng in coords_latlng]

        in_sw = any(
            SW_BBOX["min_lat"] <= lat <= SW_BBOX["max_lat"]
            and SW_BBOX["min_lng"] <= lng <= SW_BBOX["max_lng"]
            for lat, lng in coords_latlng
        )
        if not in_sw:
            continue

        filtered_coords: list[list[float]] = []
        for i in range(len(coords_latlng) - 1):
            lat0, lng0 = coords_latlng[i]
            lat1, lng1 = coords_latlng[i + 1]
            p0, p1 = pts_xy[i], pts_xy[i + 1]
            if point_in_poly(p0, haram_poly) and point_in_poly(p1, haram_poly):
                continue
            mid = (0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1]))
            if point_in_poly(mid, haram_poly):
                continue
            surface_all_segs.append((p0, p1, mode))
            if mode & 1:
                surface_drivable_segs.append((p0, p1, mode, way_idx))
            if (
                way_idx not in preserved_way_indices
                and not point_in_poly(p0, haram_poly)
                and not point_in_poly(p1, haram_poly)
                and SW_BBOX["min_lat"] <= lat0 <= SW_BBOX["max_lat"]
                and SW_BBOX["min_lng"] <= lng0 <= SW_BBOX["max_lng"]
                and SW_BBOX["min_lat"] <= lat1 <= SW_BBOX["max_lat"]
                and SW_BBOX["min_lng"] <= lng1 <= SW_BBOX["max_lng"]
            ):
                if not filtered_coords:
                    filtered_coords.append([round(lng0, 6), round(lat0, 6)])
                filtered_coords.append([round(lng1, 6), round(lat1, 6)])

        if len(filtered_coords) < 2:
            continue
        car_class = (mode >> 6) & 7
        if mode & 8:
            kind = "ramp"
            width_m = 6.5
        elif mode & 1:
            if car_class <= 1:
                kind = "arterial"
                width_m = 13.0
            elif car_class <= 3:
                kind = "boulevard"
                width_m = 9.5
            elif car_class <= 5:
                kind = "local"
                width_m = 7.0
            else:
                kind = "service"
                width_m = 5.0
        elif (mode & 16) and (mode & 32):
            kind = "promenade"
            width_m = 5.5
        else:
            kind = "footway"
            width_m = 3.0

        sw_corridors.append(
            {
                "wayIndex": way_idx,
                "zone": "sw",
                "kind": kind,
                "road": bool(mode & 1),
                "widthM": width_m,
                "oneway": oneway,
                "coords": filtered_coords,
            }
        )

    print(f"SW surface OSM corridors: {len(sw_corridors)}, drivable segs: {len(surface_drivable_segs)}")

    # Load SW hotels: 72 matched from hotels-joined.json - #373 deduplicated into South POI 735 = 71 total
    sw_raw_by_num = {h["number"]: h for h in joined if h["zone"] == "SW"}
    sw_joined: dict[int, dict] = {}
    for num, h in sorted(sw_raw_by_num.items()):
        if num in DUPLICATE_GUIDE_TO_PRIMARY_POI:
            continue
        if h.get("lat") is not None and h.get("lng") is not None:
            sw_joined[num] = h

    assert 373 not in sw_joined
    assert len(sw_joined) == 71, f"Expected 71 SW hotels, got {len(sw_joined)}"

    sw_fp_by_num = {
        f["properties"]["number"]: f
        for f in hotels_geo["features"]
        if f["properties"]["zone"] == "SW" and f["properties"]["role"] == "footprint"
    }

    # Group MS polygons by ring geometry (skipping guides overridden by cleaner OSM footprints)
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for num, h in sorted(sw_joined.items()):
        fp = sw_fp_by_num.get(num)
        if fp and num not in OSM_FOOTPRINT_BY_GUIDE:
            ring = fp["geometry"]["coordinates"][0]
            key = tuple(tuple(round(c, 6) for c in pt) for pt in ring)
            groups[key].append({"number": num, "hotel": h, "xy": to_xy(h["lng"], h["lat"]), "fp": fp})

    resolved_polys: dict[int, tuple[list[tuple[float, float]], str]] = {}
    shared_siblings: dict[int, list[int]] = {}
    for _key, members in groups.items():
        raw_ring = members[0]["fp"]["geometry"]["coordinates"][0]
        raw_xy = clean_ring_xy([to_xy(c[0], c[1]) for c in raw_ring[:-1]])
        if len(members) == 1:
            resolved_polys[members[0]["number"]] = (raw_xy, "single")
        else:
            nums = [m["number"] for m in members]
            for num in nums:
                shared_siblings[num] = nums
            parts = split_shared_polygon(raw_xy, members)
            for num, cell in parts.items():
                resolved_polys[num] = (clean_ring_xy(cell), "provisional_pin_partition")

    # Add the 4 non-overlapping OSM footprints (#302, #342, #377, #388)
    for gnum, oid in OSM_FOOTPRINT_BY_GUIDE.items():
        assert gnum not in resolved_polys
        elem = osm_by_id[oid]
        pts = elem["geometry"]
        raw_ring = clean_ring_xy([to_xy(g["lon"], g["lat"]) for g in pts])
        resolved_polys[gnum] = (raw_ring, "single")

    # Verify #307 (منازل الرحمة) is the only pin-only hotel in SW
    no_fp = [n for n in sorted(sw_joined) if n not in resolved_polys]
    assert no_fp == [307], f"Expected pin-only [307], got {no_fp}"

    # Combined polygon dictionary (South + West + North + SW) for collision-free entrances/dropoffs/props
    all_polys_xy: dict[int, list[tuple[float, float]]] = dict(preserved_polys_xy)
    for gnum in sorted(sw_joined):
        pid = EXISTING_POI_BY_GUIDE.get(gnum, 2000 + gnum)
        if gnum in resolved_polys:
            poly_xy = resolved_polys[gnum][0]
            assert len(poly_xy) >= 3, f"Degenerate polygon for #{gnum}"
            area = abs(poly_area(poly_xy))
            assert area >= 120.0, f"Area too small for #{gnum}: {area:.1f}m2"
            for pt in poly_xy:
                assert not point_in_poly(pt, haram_poly), f"SW hotel #{gnum} intrudes Haram fence"
                d_f = dist_pt_poly_edges(pt, haram_poly)
                assert d_f >= 3.5, f"SW hotel #{gnum} too close to Haram fence: {d_f:.2f}m"
            all_polys_xy[pid] = poly_xy

    def outside_all_polys_and_haram(pt_xy: tuple[float, float], min_clear: float = 0.25) -> bool:
        if point_in_poly(pt_xy, haram_poly):
            return False
        for poly_xy in all_polys_xy.values():
            if point_in_poly(pt_xy, poly_xy):
                return False
            if min_clear > 0 and dist_pt_poly_edges(pt_xy, poly_xy) < min_clear:
                return False
        return True

    def nearest_drivable_dropoff(target_xy: tuple[float, float]) -> tuple[float, float]:
        best_d = float("inf")
        best_pt = target_xy
        for p0, p1, _mode, _w in surface_drivable_segs:
            d, proj = dist_pt_seg(target_xy, p0, p1)
            if not outside_all_polys_and_haram(proj, 0.2):
                continue
            if d < best_d:
                best_d = d
                best_pt = proj
        lng, lat = from_xy(*best_pt)
        return round(lat, 7), round(lng, 7)

    sw_buildings_out: list[dict] = []

    for gnum in sorted(sw_joined):
        h = sw_joined[gnum]
        pid = EXISTING_POI_BY_GUIDE.get(gnum, 2000 + gnum)
        existing_poi = poi_by_id.get(pid) if gnum in EXISTING_POI_BY_GUIDE else None
        name_ar = existing_poi["name_ar"] if existing_poi else h["name_ar"]
        google_name = h.get("google_name") or name_ar
        osm_id = (
            existing_poi.get("osm")
            if existing_poi
            else (f"w{OSM_FOOTPRINT_BY_GUIDE[gnum]}" if gnum in OSM_FOOTPRINT_BY_GUIDE else None)
        )

        if gnum in resolved_polys:
            poly_xy, fp_split = resolved_polys[gnum]
            has_fp = True
            cx_xy, cy_xy = centroid_xy(poly_xy)
            clng, clat = from_xy(cx_xy, cy_xy)
            center_latlng = [round(clat, 7), round(clng, 7)]
            area_m2 = round(abs(poly_area(poly_xy)), 1)
            ring_lnglat = [[round(from_xy(x, y)[0], 7), round(from_xy(x, y)[1], 7)] for (x, y) in poly_xy]
            ring_lnglat.append(ring_lnglat[0])

            # Pick exterior street-facing entrance strictly outside all 219 polygons & Haram fence
            best_score = float("inf")
            best_cand: tuple[tuple[float, float], str] | None = None
            n = len(poly_xy)
            pin_xy = to_xy(h["lng"], h["lat"])
            for i in range(n):
                a, b = poly_xy[i], poly_xy[(i + 1) % n]
                ex_dx, ex_dy = b[0] - a[0], b[1] - a[1]
                elen = math.hypot(ex_dx, ex_dy)
                if elen < 2.0:
                    continue
                nx, ny = ex_dy / elen, -ex_dx / elen
                side = entrance_side_from_normal(nx, ny)
                for u in (0.5, 0.35, 0.65):
                    mx = a[0] + ex_dx * u
                    my = a[1] + ex_dy * u
                    for push in (0.9, 1.4, 2.2):
                        cand_xy = (mx + nx * push, my + ny * push)
                        if not outside_all_polys_and_haram(cand_xy, 0.15):
                            continue
                        d_road = min(dist_pt_seg(cand_xy, sp0, sp1)[0] for sp0, sp1, _m, _w in surface_drivable_segs)
                        d_foot = min(dist_pt_seg(cand_xy, sp0, sp1)[0] for sp0, sp1, _m in surface_all_segs)
                        d_st = min(d_road, d_foot + 4.0)
                        d_pin = math.hypot(cand_xy[0] - pin_xy[0], cand_xy[1] - pin_xy[1])
                        score = d_st * 2.0 + 0.12 * d_pin + push * 0.5
                        if score < best_score:
                            best_score = score
                            best_cand = (cand_xy, side)
            if best_cand is None:
                raise RuntimeError(f"Could not find safe exterior entrance for SW POI {pid} (#{gnum})")
            ent_xy, entrance_side = best_cand
            elng, elat = from_xy(*ent_xy)
            entrance_ll = [round(elat, 7), round(elng, 7)]
            drp_lat, drp_lng = nearest_drivable_dropoff(ent_xy)
            dropoff_ll = [drp_lat, drp_lng]

            # Height provenance: check OSM building:levels by polygon containment first, else estimated_display_only
            matched_osm_lvl = None
            for ob in osm_levels_buildings:
                if (
                    point_in_poly(ob["center_xy"], poly_xy)
                    or point_in_poly((cx_xy, cy_xy), ob["ring_xy"])
                    or point_in_poly(pin_xy, ob["ring_xy"])
                ):
                    matched_osm_lvl = ob["levels"]
                    if not osm_id:
                        osm_id = ob["osm"]
                    break

            r_floor = seeded_unit(pid, 1)
            r_style = seeded_unit(pid, 2)
            r_seed = seeded_unit(pid, 3)
            r_tint = seeded_unit(pid, 4)

            if matched_osm_lvl is not None:
                levels = matched_osm_lvl
                display_floors = max(5, min(18, matched_osm_lvl))
                height_source = "osm_levels"
                confidence = "osm"
            else:
                levels = None
                is_front_corridor = center_latlng[1] >= 39.6056 and area_m2 >= 900.0
                if is_front_corridor:
                    display_floors = 12 + int(r_floor * 3.0)  # 12..14 front Al-Salam / Al-Manakha corridor
                elif area_m2 >= 1000.0:
                    display_floors = 11 + int(r_floor * 3.0)  # 11..13 large blocks
                else:
                    display_floors = 10 + int(r_floor * 3.0)  # 10..12 inner SW blocks
                height_source = "estimated_display_only"
                confidence = "display_only"

            height_m = round(8.8 + max(display_floors - 2, 2) * 3.15 + 2.2, 1)
            style_id = int(r_style * 3.0) % 3
            seed = round(r_seed, 4)
            tint = round((r_tint - 0.5) * 0.11, 4)
        else:
            # #307 (منازل الرحمة) pin-only
            poly_xy = []
            fp_split = "none"
            has_fp = False
            center_latlng = [round(h["lat"], 7), round(h["lng"], 7)]
            area_m2 = 0.0
            ring_lnglat = []
            entrance_side = "north"
            ent_xy = to_xy(center_latlng[1], center_latlng[0])
            if not outside_all_polys_and_haram(ent_xy, 0.25):
                best_d = float("inf")
                best_pt = ent_xy
                for sp0, sp1, _m in surface_all_segs:
                    d, proj = dist_pt_seg(ent_xy, sp0, sp1)
                    if outside_all_polys_and_haram(proj, 0.25) and d < best_d:
                        best_d = d
                        best_pt = proj
                ent_xy = best_pt
            assert outside_all_polys_and_haram(ent_xy, 0.15), f"Pin-only entrance #{gnum} inside building or fence"
            elng, elat = from_xy(*ent_xy)
            entrance_ll = [round(elat, 7), round(elng, 7)]
            drp_lat, drp_lng = nearest_drivable_dropoff(ent_xy)
            dropoff_ll = [drp_lat, drp_lng]
            levels = None
            display_floors = None
            height_m = 0.0
            height_source = "none"
            confidence = "none"
            style_id = 0
            seed = round(seeded_unit(pid, 3), 4)
            tint = 0.0

        sw_buildings_out.append(
            {
                "buildingId": f"SW{gnum}",
                "poiId": pid,
                "guideNumber": gnum,
                "zone": "sw",
                "name_ar": name_ar,
                "osm": osm_id,
                "areaM2": area_m2,
                "center": center_latlng,
                "entranceSide": entrance_side,
                "entrance": entrance_ll,
                "dropoff": dropoff_ll,
                "hasFootprint": has_fp,
                "footprintSplit": fp_split,
                "levels": levels,
                "displayFloors": display_floors,
                "heightM": height_m,
                "heightSource": height_source,
                "confidence": confidence,
                "styleId": style_id,
                "seed": seed,
                "tint": tint,
                "polygon": ring_lnglat,
            }
        )

        # Idempotently update existing or insert new POI in data/pois.json
        if pid in poi_by_id:
            p = poi_by_id[pid]
            p["guideNumber"] = gnum
            tokens = (p.get("alias") or "").split()
            if str(gnum) not in tokens:
                tokens.append(str(gnum))
            cur_alias = " ".join(tokens).strip()
            if google_name and google_name not in p["name_ar"] and google_name not in cur_alias:
                cur_alias = f"{cur_alias} {google_name}".strip()
            p["alias"] = cur_alias
        else:
            # Separate coincident shared-block pins (#352/#358 at 0.00 m, #326/#330 at 5.9 m) to split cell centroids
            poi_lat, poi_lng = h["lat"], h["lng"]
            if has_fp and gnum in shared_siblings:
                sibs = [s for s in shared_siblings[gnum] if s != gnum and s in sw_joined]
                min_sib_d = min(
                    math.hypot(
                        to_xy(sw_joined[s]["lng"], sw_joined[s]["lat"])[0] - to_xy(poi_lng, poi_lat)[0],
                        to_xy(sw_joined[s]["lng"], sw_joined[s]["lat"])[1] - to_xy(poi_lng, poi_lat)[1],
                    )
                    for s in sibs
                )
                if min_sib_d < 8.0:
                    poi_lat, poi_lng = center_latlng[0], center_latlng[1]

            alias_parts = [str(gnum)]
            if google_name and google_name != name_ar:
                alias_parts.append(google_name)
            new_poi = {
                "id": pid,
                "name_ar": name_ar,
                "category": "hotels",
                "subCategory": "hotel",
                "lat": round(poi_lat, 7),
                "lng": round(poi_lng, 7),
                "direction": "west" if poi_lat >= 24.4654 else "south",
                "description_ar": f"فندق في المنطقة الجنوبية الغربية (دليل الهيئة 2026 — رقم {gnum}).",
                "alias": " ".join(alias_parts),
                "source": "pm-central-guide-ar-2026",
                "guideNumber": gnum,
            }
            pois.append(new_poi)
            poi_by_id[pid] = new_poi

    # Generate SW props (streetLamps, palms) strictly outside all 219 buildings, road asphalt, & Haram fence
    road_segs_xy = []
    for c in sw_corridors:
        if not c["road"]:
            continue
        pts = [to_xy(lng, lat) for lng, lat in c["coords"]]
        for i in range(len(pts) - 1):
            road_segs_xy.append((pts[i], pts[i + 1], c["widthM"], c["kind"]))

    def near_building_edge(pt_xy: tuple[float, float], clearance: float) -> bool:
        for poly_xy in all_polys_xy.values():
            if point_in_poly(pt_xy, poly_xy) or dist_pt_poly_edges(pt_xy, poly_xy) < clearance:
                return True
        return False

    def near_road_asphalt(pt_xy: tuple[float, float], pad_m: float = 0.4) -> bool:
        for a, b, w, _ in road_segs_xy:
            if dist_pt_seg(pt_xy, a, b)[0] < w * 0.5 + pad_m:
                return True
        return False

    street_lamps: list[dict] = []
    seen_lamps: list[tuple[float, float]] = []
    for a, b, w, _kind in road_segs_xy:
        dx, dy = b[0] - a[0], b[1] - a[1]
        slen = math.hypot(dx, dy)
        if slen < 14.0:
            continue
        ux, uy = dx / slen, dy / slen
        nx, ny = -uy, ux
        ang = math.atan2(dy, dx)
        offset = w * 0.5 + 1.35
        s = 9.0
        idx = 0
        while s < slen - 7.0 and len(street_lamps) < 60:
            side = 1.0 if idx % 2 == 0 else -1.0
            cand = (a[0] + ux * s + nx * side * offset, a[1] + uy * s + ny * side * offset)
            idx += 1
            s += 28.0
            if point_in_poly(cand, haram_poly) or dist_pt_poly_edges(cand, haram_poly) < 3.5:
                continue
            if near_building_edge(cand, 0.9) or near_road_asphalt(cand, 0.3):
                continue
            if any(math.hypot(cand[0] - lx, cand[1] - ly) < 16.0 for lx, ly in seen_lamps):
                continue
            seen_lamps.append(cand)
            llng, llat = from_xy(*cand)
            street_lamps.append(
                {
                    "lat": round(llat, 7),
                    "lng": round(llng, 7),
                    "rotRad": round(ang + (0.0 if side > 0 else math.pi), 3),
                }
            )

    palms: list[dict] = []
    seen_palms: list[tuple[float, float]] = []
    for c in sw_corridors:
        if c["kind"] not in ("boulevard", "arterial", "promenade"):
            continue
        pts = [to_xy(lng, lat) for lng, lat in c["coords"]]
        off = c["widthM"] * 0.5 + (2.0 if c["road"] else 1.2)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            slen = math.hypot(dx, dy)
            if slen < 12.0:
                continue
            ux, uy = dx / slen, dy / slen
            nx, ny = -uy, ux
            s = 7.0
            while s < slen - 6.0 and len(palms) < 45:
                cand = (a[0] + ux * s + nx * off, a[1] + uy * s + ny * off)
                s += 24.0
                if point_in_poly(cand, haram_poly) or dist_pt_poly_edges(cand, haram_poly) < 4.5:
                    continue
                if near_building_edge(cand, 1.3) or near_road_asphalt(cand, 0.5):
                    continue
                if any(math.hypot(cand[0] - px, cand[1] - py) < 13.5 for px, py in seen_palms):
                    continue
                if any(math.hypot(cand[0] - lx, cand[1] - ly) < 4.5 for lx, ly in seen_lamps):
                    continue
                seen_palms.append(cand)
                plng, plat = from_xy(*cand)
                palms.append(
                    {
                        "lat": round(plat, 7),
                        "lng": round(plng, 7),
                        "scale": round(0.88 + seeded_unit(len(palms) + 477, 9) * 0.28, 3),
                        "rotRad": round(seeded_unit(len(palms) + 499, 5) * math.tau, 3),
                    }
                )

    sw_props = {
        "parkingPortals": [],
        "streetLamps": street_lamps[:60],
        "palms": palms[:45],
    }

    combined_buildings = preserved_buildings + sw_buildings_out
    combined_corridors = preserved_corridors + sw_corridors

    urban_out = {
        "schema": "haram-urban-approved-v2",
        "stage": "stage-6-zones-south-west-north-sw",
        "tier": "verified",
        "approvedBy": "owner",
        "approvedAt": "2026-11-21",
        "footprintSource": "microsoft-building-footprints-audit+osm-west-5+osm-north-6+osm-sw-4+authority-2026-guide",
        "streetSource": "data/streets.json (osm-verified)",
        "heightMode": "verified_and_estimated_display_only",
        "zonesApproved": ["south", "west", "north", "sw"],
        "buildings": combined_buildings,
        "streetCorridors": combined_corridors,
        "urbanProps": south_props,
        "urbanPropsByZone": {
            "south": south_props,
            "west": west_props,
            "north": north_props,
            "sw": sw_props,
        },
    }

    (ROOT / "data/urban-approved.json").write_text(
        json.dumps(urban_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "data/pois.json").write_text(
        json.dumps(pois, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # Update data/i18n.json across all 26 locales for every SW hotel
    i18n_path = ROOT / "data/i18n.json"
    i18n_data = json.loads(i18n_path.read_text("utf-8"))
    for p in pois:
        if p["name_ar"] in EN_HOTEL_NAMES and p.get("subCategory") == "hotel":
            ar_name = p["name_ar"]
            en_name = EN_HOTEL_NAMES[ar_name]
            for lang, pack in i18n_data.items():
                if lang == "ar":
                    continue
                names_map = pack.setdefault("names", {})
                if p["id"] >= 2000 or ar_name not in names_map:
                    names_map[ar_name] = ar_name if lang in ("ur", "fa", "ps") else en_name
    i18n_path.write_text(json.dumps(i18n_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    n_fp = sum(1 for b in sw_buildings_out if b["hasFootprint"])
    n_osm = sum(1 for b in sw_buildings_out if b["heightSource"] == "osm_levels")
    n_est = sum(1 for b in sw_buildings_out if b["heightSource"] == "estimated_display_only")
    n_split = sum(1 for b in sw_buildings_out if b["footprintSplit"] == "provisional_pin_partition")
    print(
        f"Saved Zone 4 SW ({len(sw_buildings_out)} hotels: {n_fp} footprinted, {n_split} provisional-split, "
        f"{len(sw_buildings_out)-n_fp} pin-only; heights osm:{n_osm} est:{n_est}); "
        f"SW corridors={len(sw_corridors)}, lamps={len(sw_props['streetLamps'])}, palms={len(sw_props['palms'])}"
    )
    print(
        f"Total data/urban-approved.json: {len(combined_buildings)} hotels, {len(combined_corridors)} corridors | "
        f"data/pois.json: {len(pois)} POIs (hotels: {sum(1 for p in pois if p['subCategory'] == 'hotel')})"
    )

    # Render Zone 4 Southwest Review Atlas Board
    layers: list[dict] = []
    layers.append(
        {
            "t": "poly",
            "c": [[lng, lat] for lng, lat in [from_xy(x, y) for x, y in haram_poly]],
            "fill": "#e4dccb88",
            "stroke": "#9d8b6c",
            "lw": 1.5,
        }
    )
    for c in sw_corridors:
        col = "#4a515d" if c["road"] else "#bfa985"
        lw = 3.0 if c["kind"] in ("arterial", "boulevard") else (2.0 if c["road"] else 1.2)
        layers.append({"t": "line", "c": c["coords"], "stroke": col, "lw": lw})
    for b in sw_buildings_out:
        if b["hasFootprint"]:
            if b["footprintSplit"] == "provisional_pin_partition":
                fill = "#d97706aa"
                stroke = "#7c2d12"
            elif b["heightSource"] == "osm_levels":
                fill = "#1d6fd8bb"
                stroke = "#0f3f7a"
            else:
                fill = "#2d7d46bb"
                stroke = "#134724"
            layers.append({"t": "poly", "c": b["polygon"], "fill": fill, "stroke": stroke, "lw": 1.6})
            layers.append(
                {
                    "t": "pt",
                    "c": [b["entrance"][1], b["entrance"][0]],
                    "r": 3.2,
                    "fill": "#0ea5e9",
                    "stroke": "#ffffff",
                }
            )
            layers.append(
                {
                    "t": "txt",
                    "c": [b["center"][1], b["center"][0]],
                    "text": str(b["guideNumber"] or b["poiId"]),
                    "s": 13,
                    "bold": True,
                    "fill": "#111111",
                }
            )
        else:
            layers.append(
                {
                    "t": "pt",
                    "c": [b["center"][1], b["center"][0]],
                    "r": 7.0,
                    "fill": "#e11d48",
                    "stroke": "#ffffff",
                }
            )
            layers.append(
                {
                    "t": "txt",
                    "c": [b["center"][1], b["center"][0] + 0.00010],
                    "text": str(b["guideNumber"]),
                    "s": 13,
                    "bold": True,
                    "fill": "#b91c1c",
                }
            )

    board_spec = {
        "bbox": [39.6022, 24.4628, 39.6075, 24.4676],
        "width": 2600,
        "title": "أطلس مراجعة المنطقة 4 — الجنوب الغربي (302–396) · المرحلة 6 [2026-11-21]",
        "legend": [
            ["#2d7d46", "بصمة مفردة (19 MS + 4 OSM؛ بارتفاع عرض تقديري)"],
            ["#1d6fd8", "بصمة بارتفاع OSM موثّق (310 السعفة الذهبية + 332/334 — 12 طابقًا)"],
            ["#d97706", "بصمة مشتركة مقسّمة مبدئيًا (16 كتلة / 47 فندقًا)"],
            ["#e11d48", "فندق بلا بصمة (307 منازل الرحمة) — ودمج 373←735 (المناخة روتانا برج ١)"],
            ["#0ea5e9", "نقطة مدخل الفندق على الواجهة / الشارع"],
        ],
        "layers": layers,
    }
    BOARD_SPEC_PATH.parent.mkdir(parents=True, exist_ok=True)
    BOARD_SPEC_PATH.write_text(json.dumps(board_spec, ensure_ascii=False), encoding="utf-8")
    if RENDER_BIN.exists():
        subprocess.run([str(RENDER_BIN), str(BOARD_SPEC_PATH), str(BOARD_PNG_PATH)], check=True)
        print(f"Rendered review atlas board: {BOARD_PNG_PATH}")


if __name__ == "__main__":
    main()
