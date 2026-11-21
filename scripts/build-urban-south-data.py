"""
Build Stage 6 Zone 1 (South 401-475 + 735) verified & tagged urban data from:
  - Stage 1 extracted Authority 2026 hotel index & Google Maps links (`hotels-joined.json`, `hotels-2026.geojson`)
  - Extracted OSM buildings (`osm-buildings-2026-10-08.json`) for real `building:levels`
  - Repository `data/urban-approved.json`, `data/pois.json`, `data/haram-fence.json`, `data/streets.json`

Outputs:
  - Updates `data/urban-approved.json` to schema `haram-urban-approved-v2` (57 South approved hotels: 52 footprinted + 5 pin-only `#441-#445`, expanded South OSM street corridors, parking portals, streetlamps, date palms)
  - Updates `data/pois.json` to reveal all 57 South hotels cleanly (preserving existing `711, 713, 722, 724, 725, 728, 735` IDs and adding 50 Authority South hotels `2402..2475`)
  - Generates the Zone 1 South Review Atlas board in `الملفات المؤقتة/لوحة-مراجعة-الجنوب-المرحلة-6.png`

Usage:
  python3 scripts/build-urban-south-data.py
"""

from __future__ import annotations

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
BOARD_SPEC_PATH = Path("/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/zone-south-stage6-board.json")
BOARD_PNG_PATH = Path("/Users/nooraddeen/نورالدين AI/الملفات المؤقتة/لوحة-مراجعة-الجنوب-المرحلة-6.png")

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_RADIUS_M = 6_371_008.8
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M
MODEL_METRE_UNITS = (1.0 / EARTH_CIRCUMFERENCE_M) * (1.0 / math.cos(math.radians(ORIGIN_LAT)))

# Walk/geodesic scale matching `src/domain/frames.ts` (toWalkMetres / fromWalkMetres)
COS_ORIGIN = math.cos(math.radians(ORIGIN_LAT))
M_PER_LAT = (math.pi / 180.0) * EARTH_RADIUS_M
M_PER_LNG = (math.pi / 180.0) * EARTH_RADIUS_M * COS_ORIGIN

# Existing Stage 5 approved POIs mapped to their Authority 2026 guide numbers (`735` kept separately).
EXISTING_GUIDE_BY_POI = {
    728: 401,
    711: 410,
    722: 429,
    724: 433,
    725: 435,
    713: 436,
}
EXISTING_POI_BY_GUIDE = {v: k for k, v in EXISTING_GUIDE_BY_POI.items()}

EXISTING_BUILDING_IDS = {
    711: "S014",
    713: "S037",
    722: "S008",
    724: "S004",
    725: "S038",
    728: "S016",
    735: "S017",
}

# Clean English hotel names for the 50 Authority South hotels across the 22 LTR locales (`ur`/`fa`/`ps` keep Arabic name).
EN_HOTEL_NAMES = {
    "ميسان رحاب المسك": "Maysan Rehab Al-Misk Hotel",
    "كاسيل": "Castle Hotel",
    "حياة الواحة": "Hayat Al-Waha Hotel",
    "المحراب طيبة": "Al-Mihrab Taiba Hotel",
    "سبال الماسي": "Sebal Al-Masi Hotel",
    "نسك الإيمان": "Nusk Al-Iman Hotel",
    "ون إن": "One Inn Hotel",
    "مسك البلد روافد": "Misk Al-Balad Rawafid Hotel",
    "المدينة الذهبي": "Al-Madinah Golden Hotel",
    "منازلي المدينة - زوار": "Manazili Al-Madinah Zowar Hotel",
    "رؤى الأندلس البلاتيني": "Roaa Al-Andalus Platinum Hotel",
    "نسك الهجرة": "Nusk Al-Hijrah Hotel",
    "منازل الصافية - زوار": "Manazel Al-Safiyah Zowar Hotel",
    "حياة بلازا": "Hayat Plaza Hotel",
    "براء طيبة": "Baraa Taiba Hotel",
    "هدى طيبة": "Huda Taiba Hotel",
    "منار المنورة": "Manar Al-Munawwarah Hotel",
    "نسك المدينة": "Nusk Al-Madinah Hotel",
    "جوار المدينة": "Jewar Al-Madinah Hotel",
    "صفا طيبة": "Safa Taiba Hotel",
    "منازل الأسواف": "Manazel Al-Aswaf Hotel",
    "راما المدينة": "Rama Al-Madinah Hotel",
    "جوار الأندلس": "Gewar Al-Andalus Hotel",
    "فيو المدينة": "View Al-Madinah Hotel",
    "فندا المدينة": "Fenda Al-Madinah Hotel",
    "فالي المدينة": "Valley Al-Madinah Hotel",
    "معين طيبة": "Moeen Taiba Hotel",
    "انكيرا من كونتننت": "Ancyra Madinah Hotel",
    "تاج ورد": "Taj Ward Hotel",
    "نقاط ثلاثة الكوثر": "Triple Three Al-Kawthar Hotel",
    "نقاط ثلاثة الرضا": "Triple Three Al-Rida Hotel",
    "نقاط ثلاثة الأمين": "Triple Three Al-Ameen Hotel",
    "جايدن": "Jayden Hotel",
    "سرايا هارموني (A)": "Saraya Harmony A Hotel",
    "سكاي فيو": "Sky View Hotel",
    "سرايا هارموني (B)": "Saraya Harmony B Hotel",
    "سرايا هارموني (C)": "Saraya Harmony C Hotel",
    "رؤى الماسي": "Rua Al-Masi Hotel",
    "ميسان التقوى": "Maysan Al-Taqwa Hotel",
    "ديار الحبيب": "Diyar Al-Habib Hotel",
    "درة طابة": "Durrat Tabah Hotel",
    "ديار طيبة": "Diyar Taiba Hotel",
    "جلنار طيبة": "Jelnar Taiba Hotel",
    "روز هوليداي i3": "Rose Holiday i3 Hotel",
    "ماسة البستان": "Masat Al-Bustan Hotel",
    "المختارة بلازا": "Al-Mukhtara Plaza Hotel",
    "الأندلس الماسي": "Al-Andalus Al-Masi Hotel",
    "مراج طيبة": "Miraj Taiba Hotel",
    "ديوان الهجرة": "Diwan Al-Hijrah Hotel",
    "مجمع الجزيرة": "Al-Jazeera Complex",
}

SOUTH_BBOX = {"min_lat": 24.4628, "max_lat": 24.46595, "min_lng": 39.6062, "max_lng": 39.6174}


def _mercator_x(lng: float) -> float:
    return (180.0 + lng) / 360.0


def _mercator_y(lat: float) -> float:
    return (180.0 - (180.0 / math.pi) * math.log(math.tan(math.pi / 4.0 + (lat * math.pi) / 360.0))) / 360.0


ORIGIN_MX = _mercator_x(ORIGIN_LNG)
ORIGIN_MY = _mercator_y(ORIGIN_LAT)


def to_xy(lng: float, lat: float) -> tuple[float, float]:
    """Local metric coordinates matching `toWalkMetres([lat, lng])` in TypeScript (`+x east, +y north`)."""
    return (lng - ORIGIN_LNG) * M_PER_LNG, (lat - ORIGIN_LAT) * M_PER_LAT


def from_xy(x: float, y: float) -> tuple[float, float]:
    """Return `(lng, lat)` from local metres."""
    return ORIGIN_LNG + x / M_PER_LNG, ORIGIN_LAT + y / M_PER_LAT


def poly_area(pts: list[tuple[float, float]]) -> float:
    s = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return 0.5 * s


def ensure_ccw(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return pts if poly_area(pts) >= 0 else list(reversed(pts))


def centroid_xy(pts: list[tuple[float, float]]) -> tuple[float, float]:
    a = poly_area(pts)
    if abs(a) < 1e-6:
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


def dist_pt_seg(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> tuple[float, tuple[float, float]]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 < 1e-12:
        return math.hypot(p[0] - a[0], p[1] - a[1]), a
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    proj = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(p[0] - proj[0], p[1] - proj[1]), proj


def dist_pt_poly_edges(p: tuple[float, float], poly: list[tuple[float, float]]) -> float:
    best = float("inf")
    n = len(poly)
    for i in range(n):
        d, _ = dist_pt_seg(p, poly[i], poly[(i + 1) % n])
        if d < best:
            best = d
    return best


def clip_halfplane(
    poly: list[tuple[float, float]],
    origin: tuple[float, float],
    normal: tuple[float, float],
    offset: float = 0.0,
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
    """Find weighted angle of longest polygon edges for orthogonal parcel slicing."""
    bins = defaultdict(float)
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy)
        if l < 1.0:
            continue
        ang = math.atan2(dy, dx) % (math.pi / 2.0)
        bins[round(ang, 2)] += l
    return max(bins.items(), key=lambda kv: kv[1])[0] if bins else 0.0


def split_shared_polygon(
    open_poly: list[tuple[float, float]],
    members: list[dict],
) -> dict[int, list[tuple[float, float]]]:
    """
    Provisional geometric partition of a shared Microsoft footprint (`k >= 2` hotels).
    Sorts members along the block's dominant split axis (the orthogonal axis with stronger
    pin separation) and cuts clean orthogonal architectural parcels separated by a 0.45 m
    gap (`±0.45 m` setback from each dividing line) so towers never fuse or overlap.
    """
    base = ensure_ccw(open_poly)
    k = len(members)
    theta = dominant_edge_angle(base)
    ux, uy = math.cos(theta), math.sin(theta)
    vx, vy = -uy, ux

    # Project polygon & pins onto both orthogonal axes (u, v)
    us = [p[0] * ux + p[1] * uy for p in base]
    vs = [p[0] * vx + p[1] * vy for p in base]
    span_u = max(us) - min(us)
    span_v = max(vs) - min(vs)

    pin_u = [(m["xy"][0] * ux + m["xy"][1] * uy) for m in members]
    pin_v = [(m["xy"][0] * vx + m["xy"][1] * vy) for m in members]
    spread_u = (max(pin_u) - min(pin_u)) / max(span_u, 1.0)
    spread_v = (max(pin_v) - min(pin_v)) / max(span_v, 1.0)

    # Prefer cutting perpendicular to the axis with clearer pin separation; break ties by longest span
    if spread_u >= spread_v * 1.05 or (abs(spread_u - spread_v) < 0.08 and span_u >= span_v):
        ax, ay = ux, uy
        lo, hi = min(us), max(us)
        ordered = sorted(members, key=lambda m: (m["xy"][0] * ux + m["xy"][1] * uy, m["number"]))
    else:
        ax, ay = vx, vy
        lo, hi = min(vs), max(vs)
        ordered = sorted(members, key=lambda m: (m["xy"][0] * vx + m["xy"][1] * vy, m["number"]))

    span = hi - lo
    projs = [m["xy"][0] * ax + m["xy"][1] * ay for m in ordered]

    # Build clean cut thresholds between sorted pins, ensuring every strip keeps >= max(12 m, 0.55 * avg_strip)
    min_slice = min(max(11.0, 0.52 * (span / k)), (span / k) * 0.85)
    cuts: list[float] = [lo]
    for i in range(k - 1):
        mid = 0.5 * (projs[i] + projs[i + 1])
        min_pos = cuts[-1] + min_slice
        max_pos = hi - (k - 1 - i) * min_slice
        c = max(min_pos, min(max_pos, mid))
        cuts.append(c)
    cuts.append(hi)

    result: dict[int, list[tuple[float, float]]] = {}
    gap_half = 0.45
    for i, m in enumerate(ordered):
        cell = list(base)
        if i > 0:
            # keep dot(p, (ax, ay)) >= cuts[i] + gap_half  =>  dot(p, (-ax, -ay)) <= -(cuts[i] + gap_half)
            cut_in = cuts[i] + gap_half
            cell = clip_halfplane(cell, (cut_in * ax, cut_in * ay), (-ax, -ay), 0.0)
        if i < k - 1:
            cut_out = cuts[i + 1] - gap_half
            cell = clip_halfplane(cell, (cut_out * ax, cut_out * ay), (ax, ay), 0.0)
        if len(cell) < 3 or abs(poly_area(cell)) < 85.0:
            raise RuntimeError(f"Split sliver generated for #{m['number']} (area={abs(poly_area(cell)):.1f}m2)")
        result[m["number"]] = ensure_ccw(cell)
    return result


def clean_ring_xy(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Remove duplicate consecutive vertices cleanly while keeping real corners."""
    out: list[tuple[float, float]] = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.25:
            out.append(p)
    if len(out) >= 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 0.25:
        out.pop()
    return ensure_ccw(out)


def build_haram_fence_polygon(fence_data: dict) -> list[tuple[float, float]]:
    """Trace closed outer perimeter polygon of the Haram courtyard from sorted fence segments."""
    pts: list[tuple[float, float]] = []
    for run in fence_data["runs"]:
        for lng, lat in run["path"]:
            xy = to_xy(lng, lat)
            if not pts or math.hypot(xy[0] - pts[-1][0], xy[1] - pts[-1][1]) > 0.2:
                pts.append(xy)
    return pts


def seeded_unit(poi_id: int, salt: int = 1) -> float:
    x = math.sin(poi_id * 12.9898 + salt * 78.233) * 43758.5453
    return x - math.floor(x)


def entrance_side_from_normal(nx: float, ny: float) -> str:
    if abs(nx) >= abs(ny):
        return "east" if nx > 0 else "west"
    return "north" if ny > 0 else "south"


def main() -> None:
    joined = json.loads((STAGE1 / "hotels/hotels-joined.json").read_text("utf-8"))
    hotels_geo = json.loads((STAGE1 / "hotels/hotels-2026.geojson").read_text("utf-8"))
    osm_data = json.loads((STAGE1 / "hotels/footprints/osm-buildings-2026-10-08.json").read_text("utf-8"))

    existing_urban = json.loads((ROOT / "data/urban-approved.json").read_text("utf-8"))
    pois = json.loads((ROOT / "data/pois.json").read_text("utf-8"))
    haram_fence = json.loads((ROOT / "data/haram-fence.json").read_text("utf-8"))
    streets = json.loads((ROOT / "data/streets.json").read_text("utf-8"))

    existing_by_poi = {b["poiId"]: b for b in existing_urban["buildings"]}
    haram_poly = build_haram_fence_polygon(haram_fence)

    # Also build simplified safe Haram bounding box check for all courtyard southern edges
    haram_lats = [lat for run in haram_fence["runs"] for _, lat in run["path"]]
    haram_min_lat = min(haram_lats)
    print(f"Haram fence min_lat={haram_min_lat:.6f} ({len(haram_poly)} perimeter verts)")

    # Extract OSM buildings with building:levels in South
    osm_levels_buildings: list[dict] = []
    for e in osm_data.get("elements", []):
        tags = e.get("tags") or {}
        if "building:levels" not in tags or not e.get("geometry"):
            continue
        try:
            lvl = int(round(float(str(tags["building:levels"]).split(";")[0].strip())))
        except ValueError:
            continue
        ring = [to_xy(g["lon"], g["lat"]) for g in e["geometry"]]
        if len(ring) < 3:
            continue
        clat = sum(g["lat"] for g in e["geometry"]) / len(e["geometry"])
        clng = sum(g["lon"] for g in e["geometry"]) / len(e["geometry"])
        if clat < 24.4660:
            osm_levels_buildings.append(
                {
                    "osm": f"w{e['id']}",
                    "name": tags.get("name", ""),
                    "levels": lvl,
                    "center_xy": to_xy(clng, clat),
                    "ring_xy": ring,
                }
            )
    print(f"OSM buildings with building:levels in South: {len(osm_levels_buildings)}")

    # Extract surface street polylines in South for dropoff & urban street corridor geometry
    s_nodes = streets["nodes"]
    surface_drivable_segs: list[tuple[tuple[float, float], tuple[float, float], int, int]] = []
    surface_all_segs: list[tuple[tuple[float, float], tuple[float, float], int]] = []
    south_corridors: list[dict] = []

    for way_idx, w in enumerate(streets["ways"]):
        mode, oneway, *nids = w
        if mode & 4:  # Skip underground tunnel lanes
            continue
        coords_latlng = [s_nodes[i] for i in nids]
        # Skip ways completely inside Haram courtyard polygon
        if not any(
            SOUTH_BBOX["min_lat"] <= lat <= SOUTH_BBOX["max_lat"]
            and SOUTH_BBOX["min_lng"] <= lng <= SOUTH_BBOX["max_lng"]
            for lat, lng in coords_latlng
        ):
            continue
        # Clip segments that cross inside the Haram fence or are north of 24.46598 inside fence span
        filtered_coords: list[list[float]] = []
        pts_xy = [to_xy(lng, lat) for lat, lng in coords_latlng]
        inside_fence = [point_in_poly(xy, haram_poly) or (lat >= 24.46602 and 39.6078 <= lng <= 39.6144) for xy, (lat, lng) in zip(pts_xy, coords_latlng)]
        for i in range(len(coords_latlng) - 1):
            if inside_fence[i] and inside_fence[i + 1]:
                continue
            lat0, lng0 = coords_latlng[i]
            lat1, lng1 = coords_latlng[i + 1]
            p0, p1 = pts_xy[i], pts_xy[i + 1]
            mid = (0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1]))
            if point_in_poly(mid, haram_poly):
                continue
            surface_all_segs.append((p0, p1, mode))
            if mode & 1:
                surface_drivable_segs.append((p0, p1, mode, way_idx))
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

        south_corridors.append(
            {
                "wayIndex": way_idx,
                "kind": kind,
                "road": bool(mode & 1),
                "widthM": width_m,
                "oneway": oneway,
                "coords": filtered_coords,
            }
        )

    print(f"South surface OSM corridors: {len(south_corridors)}, drivable segs: {len(surface_drivable_segs)}")

    # Load all 56 South hotels & footprints from Stage 1
    s_joined = {h["number"]: h for h in joined if h["zone"] == "S"}
    s_fp_by_num = {
        f["properties"]["number"]: f
        for f in hotels_geo["features"]
        if f["properties"]["zone"] == "S" and f["properties"]["role"] == "footprint"
    }

    # Group South hotels by shared footprint polygon
    groups: dict[tuple, list[dict]] = defaultdict(list)
    no_footprint_nums: list[int] = []
    for num, h in sorted(s_joined.items()):
        fp = s_fp_by_num.get(num)
        xy = to_xy(h["lng"], h["lat"])
        entry = {"number": num, "hotel": h, "xy": xy, "fp": fp}
        if not fp:
            no_footprint_nums.append(num)
        else:
            ring = fp["geometry"]["coordinates"][0]
            key = tuple(tuple(round(c, 6) for c in pt) for pt in ring)
            groups[key].append(entry)

    # Resolve each South footprint (single vs provisional split)
    resolved_polys: dict[int, tuple[list[tuple[float, float]], str]] = {}
    for _key, members in groups.items():
        raw_ring = members[0]["fp"]["geometry"]["coordinates"][0]
        raw_xy = clean_ring_xy([to_xy(c[0], c[1]) for c in raw_ring[:-1]])
        if len(members) == 1:
            resolved_polys[members[0]["number"]] = (raw_xy, "single")
        else:
            parts = split_shared_polygon(raw_xy, members)
            for num, cell in parts.items():
                resolved_polys[num] = (clean_ring_xy(cell), "provisional_pin_partition")

    # Add Stage 5-only hotel #735 (Manakha Rotana Tower 1, single footprint)
    b735_existing = existing_by_poi[735]
    poly735_xy = clean_ring_xy([to_xy(c[0], c[1]) for c in b735_existing["polygon"][:-1]])

    # Build ordered list of all 57 building records (first preserve 7 original in same order, then sorted guide numbers)
    records_spec: list[dict] = []
    for b in existing_urban["buildings"]:
        pid = b["poiId"]
        if pid not in EXISTING_BUILDING_IDS:
            continue
        gnum = EXISTING_GUIDE_BY_POI.get(pid)
        records_spec.append({"poiId": pid, "guideNumber": gnum, "existing": b})
    for num in sorted(s_joined):
        if num in EXISTING_POI_BY_GUIDE:
            continue
        records_spec.append({"poiId": 2000 + num, "guideNumber": num, "existing": None})

    # Pre-check polygon list of all 52 footprinted buildings for zero self/sibling intersections on entrances
    all_building_polys_xy: dict[int, list[tuple[float, float]]] = {}
    for rec in records_spec:
        pid = rec["poiId"]
        gnum = rec["guideNumber"]
        if pid == 735:
            all_building_polys_xy[pid] = poly735_xy
        elif gnum in resolved_polys:
            all_building_polys_xy[pid] = resolved_polys[gnum][0]

    # Safety assertion: ZERO building vertices inside or < 5 m from Haram fence
    for pid, poly_xy in all_building_polys_xy.items():
        for pt in poly_xy:
            assert not point_in_poly(pt, haram_poly), f"Building POI {pid} intrudes into Haram fence!"
            d_fence = dist_pt_poly_edges(pt, haram_poly)
            assert d_fence >= 5.0, f"Building POI {pid} too close to Haram fence: {d_fence:.2f}m"

    def outside_all_polys(pt_xy: tuple[float, float], min_clear: float = 0.25) -> bool:
        for poly_xy in all_building_polys_xy.values():
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
            if not outside_all_polys(proj, 0.2):
                continue
            if d < best_d:
                best_d = d
                best_pt = proj
        lng, lat = from_xy(*best_pt)
        return round(lat, 7), round(lng, 7)

    buildings_out: list[dict] = []
    poi_by_id = {p["id"]: p for p in pois}

    for rec in records_spec:
        pid = rec["poiId"]
        gnum = rec["guideNumber"]
        ex = rec["existing"]

        if pid == 735:
            poly_xy = poly735_xy
            fp_split = "single"
            has_fp = True
            name_ar = ex["name_ar"]
            google_name = name_ar
            osm_id = ex["osm"]
            center_latlng = ex["center"]
        else:
            h = s_joined[gnum]
            name_ar = ex["name_ar"] if ex else h["name_ar"]
            google_name = h.get("google_name") or name_ar
            osm_id = ex["osm"] if ex else None
            if gnum in resolved_polys:
                poly_xy, fp_split = resolved_polys[gnum]
                has_fp = True
                cx_xy, cy_xy = centroid_xy(poly_xy)
                clng, clat = from_xy(cx_xy, cy_xy)
                center_latlng = [round(clat, 7), round(clng, 7)]
            else:
                poly_xy = []
                fp_split = "none"
                has_fp = False
                center_latlng = [round(h["lat"], 7), round(h["lng"], 7)]

        if has_fp:
            area_m2 = round(abs(poly_area(poly_xy)), 1)
            ring_lnglat = [[round(from_xy(x, y)[0], 7), round(from_xy(x, y)[1], 7)] for (x, y) in poly_xy]
            ring_lnglat.append(ring_lnglat[0])

            # Compute entrance & dropoff
            keep_existing_entrance = False
            if ex is not None:
                ex_ent_xy = to_xy(ex["entrance"][1], ex["entrance"][0])
                ex_drp_xy = to_xy(ex["dropoff"][1], ex["dropoff"][0])
                # Keep original western entrance only if it sits adjacent (<= 2.5m) to this POI's polygon AND outside all polygons
                if (
                    outside_all_polys(ex_ent_xy, 0.05)
                    and outside_all_polys(ex_drp_xy, 0.05)
                    and dist_pt_poly_edges(ex_ent_xy, poly_xy) <= 2.5
                ):
                    keep_existing_entrance = True
                    entrance_side = ex["entranceSide"]
                    entrance_ll = ex["entrance"]
                    dropoff_ll = ex["dropoff"]

            if not keep_existing_entrance:
                # For existing western-approved 722/728 whose split boundary shifted the block edge:
                # prefer west edge of the split cell; otherwise choose edge midpoint closest to a surface street
                c_xy = centroid_xy(poly_xy)
                best_score = float("inf")
                best_cand: tuple[tuple[float, float], str, tuple[float, float]] | None = None
                n = len(poly_xy)
                pin_xy = to_xy(s_joined[gnum]["lng"], s_joined[gnum]["lat"]) if gnum else c_xy
                for i in range(n):
                    a, b = poly_xy[i], poly_xy[(i + 1) % n]
                    ex_dx, ex_dy = b[0] - a[0], b[1] - a[1]
                    elen = math.hypot(ex_dx, ex_dy)
                    if elen < 2.0:
                        continue
                    # CCW polygon => outward normal is (ex_dy, -ex_dx) / elen
                    nx, ny = ex_dy / elen, -ex_dx / elen
                    side = entrance_side_from_normal(nx, ny)
                    for u in (0.5, 0.35, 0.65):
                        mx = a[0] + ex_dx * u
                        my = a[1] + ex_dy * u
                        for push in (0.9, 1.4, 2.2):
                            cand_xy = (mx + nx * push, my + ny * push)
                            if not outside_all_polys(cand_xy, 0.15):
                                continue
                            # Distance to nearest surface street segment
                            d_st = min(dist_pt_seg(cand_xy, sp0, sp1)[0] for sp0, sp1, _m in surface_all_segs)
                            d_pin = math.hypot(cand_xy[0] - pin_xy[0], cand_xy[1] - pin_xy[1])
                            west_bonus = -80.0 if (ex is not None and side == "west") else 0.0
                            score = d_st * 2.0 + 0.12 * d_pin + push * 0.5 + west_bonus
                            if score < best_score:
                                best_score = score
                                best_cand = (cand_xy, side, (mx, my))
                if best_cand is None:
                    raise RuntimeError(f"Could not find safe exterior entrance for POI {pid} (#{gnum})")
                ent_xy, entrance_side, _ = best_cand
                elng, elat = from_xy(*ent_xy)
                entrance_ll = [round(elat, 7), round(elng, 7)]
                drp_lat, drp_lng = nearest_drivable_dropoff(ent_xy)
                dropoff_ll = [drp_lat, drp_lng]

            # Height provenance: check OSM building:levels first
            matched_osm_lvl = None
            c_xy = centroid_xy(poly_xy)
            pin_xy_h = to_xy(s_joined[gnum]["lng"], s_joined[gnum]["lat"]) if gnum else c_xy
            best_osm_d = 28.0
            for ob in osm_levels_buildings:
                if (
                    point_in_poly(ob["center_xy"], poly_xy)
                    or point_in_poly(c_xy, ob["ring_xy"])
                    or point_in_poly(pin_xy_h, ob["ring_xy"])
                ):
                    matched_osm_lvl = ob["levels"]
                    if not osm_id:
                        osm_id = ob["osm"]
                    break
                d_osm = min(
                    math.hypot(ob["center_xy"][0] - c_xy[0], ob["center_xy"][1] - c_xy[1]),
                    math.hypot(ob["center_xy"][0] - pin_xy_h[0], ob["center_xy"][1] - pin_xy_h[1]),
                )
                if d_osm < best_osm_d:
                    best_osm_d = d_osm
                    matched_osm_lvl = ob["levels"]
                    if not osm_id:
                        osm_id = ob["osm"]

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
                clat = center_latlng[0]
                is_front_row = clat >= 24.46465 and area_m2 >= 900.0
                if is_front_row:
                    display_floors = 12 + int(r_floor * 3.0)  # 12..14 floors front row
                elif area_m2 >= 1100.0:
                    display_floors = 11 + int(r_floor * 3.0)  # 11..13 floors large blocks
                else:
                    display_floors = 10 + int(r_floor * 3.0)  # 10..12 floors inner blocks
                height_source = "estimated_display_only"
                confidence = "display_only"

            height_m = round(8.8 + max(display_floors - 2, 2) * 3.15 + 2.2, 1)
            style_id = int(r_style * 3.0) % 3
            seed = round(r_seed, 4)
            tint = round((r_tint - 0.5) * 0.11, 4)
        else:
            area_m2 = 0.0
            ring_lnglat = []
            entrance_side = "south"
            entrance_ll = [round(center_latlng[0], 7), round(center_latlng[1], 7)]
            ent_xy = to_xy(entrance_ll[1], entrance_ll[0])
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

        building_id = EXISTING_BUILDING_IDS.get(pid) or f"S{gnum}"
        buildings_out.append(
            {
                "buildingId": building_id,
                "poiId": pid,
                "guideNumber": gnum,
                "zone": "south",
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

        # Update or add POI in data/pois.json
        if pid in poi_by_id:
            p = poi_by_id[pid]
            if gnum is not None:
                p["guideNumber"] = gnum
                tokens = (p.get("alias") or "").split()
                if str(gnum) not in tokens:
                    tokens.append(str(gnum))
                if google_name and google_name not in p["name_ar"] and google_name not in (p.get("alias") or ""):
                    tokens.append(google_name)
                p["alias"] = " ".join(tokens).strip()
        else:
            existing_names = {x["name_ar"] for x in pois}
            final_name = name_ar if name_ar not in existing_names else f"{name_ar} ({gnum})"
            alias_parts = [str(gnum)]
            if google_name and google_name != final_name:
                alias_parts.append(google_name)
            pois.append(
                {
                    "id": pid,
                    "name_ar": final_name,
                    "category": "hotels",
                    "subCategory": "hotel",
                    "lat": round(s_joined[gnum]["lat"], 7),
                    "lng": round(s_joined[gnum]["lng"], 7),
                    "direction": "south",
                    "description_ar": f"فندق في المنطقة الجنوبية (دليل الهيئة 2026 — رقم {gnum}).",
                    "alias": " ".join(alias_parts),
                    "source": "pm-central-guide-ar-2026",
                    "guideNumber": gnum,
                }
            )
            poi_by_id[pid] = pois[-1]

    # Generate Urban Props (parkingPortals, streetLamps, palms) strictly outside buildings & Haram fence
    def near_building_edge(pt_xy: tuple[float, float], clearance: float) -> bool:
        for poly_xy in all_building_polys_xy.values():
            if point_in_poly(pt_xy, poly_xy) or dist_pt_poly_edges(pt_xy, poly_xy) < clearance:
                return True
        return False

    road_segs_xy = []
    for c in south_corridors:
        if not c["road"]:
            continue
        pts = [to_xy(lng, lat) for lng, lat in c["coords"]]
        for i in range(len(pts) - 1):
            road_segs_xy.append((pts[i], pts[i + 1], c["widthM"], c["kind"]))

    def near_road_asphalt(pt_xy: tuple[float, float], pad_m: float = 0.4) -> bool:
        for a, b, w, _ in road_segs_xy:
            if dist_pt_seg(pt_xy, a, b)[0] < w * 0.5 + pad_m:
                return True
        return False

    # Parking portals: omar, quba, qurban with street tangent heading
    portal_seeds = [
        ("omar", 24.46572, 39.60657, "مدخل عمر بن الخطاب"),
        ("quba", 24.465375, 39.607755, "مدخل قباء"),
        ("qurban", 24.464994, 39.612841, "مدخل قربان"),
    ]
    parking_portals: list[dict] = []
    for pid_name, plat, plng, label_ar in portal_seeds:
        pxy = to_xy(plng, plat)
        best_seg = min(
            ((a, b, w) for a, b, w, kind in road_segs_xy if kind in ("ramp", "arterial", "boulevard", "local")),
            key=lambda s: dist_pt_seg(pxy, s[0], s[1])[0],
        )
        dx, dy = best_seg[1][0] - best_seg[0][0], best_seg[1][1] - best_seg[0][1]
        heading_rad = round(math.atan2(dy, dx), 4)
        parking_portals.append(
            {
                "id": pid_name,
                "label_ar": label_ar,
                "lat": plat,
                "lng": plng,
                "headingRad": heading_rad,
            }
        )

    # Streetlamps along arterial & boulevard sidewalks
    street_lamps: list[dict] = []
    seen_lamps: list[tuple[float, float]] = []
    seen_corridors_edges = set()
    for c in south_corridors:
        if c["kind"] not in ("arterial", "boulevard"):
            continue
        pts = [to_xy(lng, lat) for lng, lat in c["coords"]]
        half_w = c["widthM"] * 0.5 + 0.9
        acc = 12.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            slen = math.hypot(dx, dy)
            if slen < 4.0:
                continue
            ek = (round((a[0] + b[0]) * 0.1), round((a[1] + b[1]) * 0.1))
            if ek in seen_corridors_edges:
                continue
            seen_corridors_edges.add(ek)
            ux, uy = dx / slen, dy / slen
            nx, ny = -uy, ux
            s = acc % 28.0
            while s <= slen - 4.0:
                bx, by = a[0] + ux * s, a[1] + uy * s
                for sign in (1.0, -1.0):
                    cand = (bx + nx * half_w * sign, by + ny * half_w * sign)
                    if point_in_poly(cand, haram_poly) or dist_pt_poly_edges(cand, haram_poly) < 3.0:
                        continue
                    if near_building_edge(cand, 1.4):
                        continue
                    if near_road_asphalt(cand, 0.1):
                        continue
                    if any(math.hypot(cand[0] - lx, cand[1] - ly) < 16.0 for lx, ly in seen_lamps):
                        continue
                    seen_lamps.append(cand)
                    llng, llat = from_xy(*cand)
                    street_lamps.append(
                        {
                            "lat": round(llat, 7),
                            "lng": round(llng, 7),
                            "angleRad": round(math.atan2(uy, ux), 3),
                        }
                    )
                s += 28.0

    # Date palms along medians & southern plaza boulevards
    palms: list[dict] = []
    seen_palms: list[tuple[float, float]] = []
    for c in south_corridors:
        if c["kind"] not in ("arterial", "boulevard", "promenade"):
            continue
        pts = [to_xy(lng, lat) for lng, lat in c["coords"]]
        side_offset = c["widthM"] * 0.5 + 2.1 if c["kind"] != "promenade" else 3.2
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            slen = math.hypot(dx, dy)
            if slen < 8.0:
                continue
            ux, uy = dx / slen, dy / slen
            nx, ny = -uy, ux
            s = 8.0
            while s <= slen - 5.0:
                cand = (a[0] + ux * s + nx * side_offset, a[1] + uy * s + ny * side_offset)
                if point_in_poly(cand, haram_poly) or dist_pt_poly_edges(cand, haram_poly) < 5.0:
                    s += 22.0
                    continue
                if near_building_edge(cand, 2.2) or near_road_asphalt(cand, 0.8):
                    s += 22.0
                    continue
                if any(math.hypot(cand[0] - px, cand[1] - py) < 13.5 for px, py in seen_palms):
                    s += 22.0
                    continue
                if any(math.hypot(cand[0] - lx, cand[1] - ly) < 4.5 for lx, ly in seen_lamps):
                    s += 22.0
                    continue
                seen_palms.append(cand)
                plng, plat = from_xy(*cand)
                palms.append(
                    {
                        "lat": round(plat, 7),
                        "lng": round(plng, 7),
                        "scale": round(0.88 + seeded_unit(len(palms) + 77, 9) * 0.28, 3),
                        "rotRad": round(seeded_unit(len(palms) + 99, 5) * math.tau, 3),
                    }
                )
                s += 22.0

    # Write updated data/urban-approved.json and data/pois.json
    urban_out = {
        "schema": "haram-urban-approved-v2",
        "stage": "stage-6-zone-south",
        "tier": "verified",
        "approvedBy": "owner",
        "approvedAt": "2026-11-21",
        "footprintSource": "microsoft-building-footprints-audit+authority-2026-guide",
        "streetSource": "data/streets.json (osm-verified)",
        "heightMode": "verified_and_estimated_display_only",
        "zonesApproved": ["south"],
        "buildings": buildings_out,
        "streetCorridors": south_corridors,
        "urbanProps": {
            "parkingPortals": parking_portals,
            "streetLamps": street_lamps[:110],
            "palms": palms[:90],
        },
    }

    (ROOT / "data/urban-approved.json").write_text(
        json.dumps(urban_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "data/pois.json").write_text(
        json.dumps(pois, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # Update data/i18n.json with non-Arabic hotel names so all 26 language packs cover every new POI
    i18n_path = ROOT / "data/i18n.json"
    i18n_data = json.loads(i18n_path.read_text("utf-8"))
    for p in pois:
        if p["id"] >= 2000 and p["name_ar"] in EN_HOTEL_NAMES:
            ar_name = p["name_ar"]
            en_name = EN_HOTEL_NAMES[ar_name]
            for lang, pack in i18n_data.items():
                if lang == "ar":
                    continue
                names_map = pack.setdefault("names", {})
                names_map[ar_name] = ar_name if lang in ("ur", "fa", "ps") else en_name
    i18n_path.write_text(json.dumps(i18n_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Stats check
    n_fp = sum(1 for b in buildings_out if b["hasFootprint"])
    n_osm = sum(1 for b in buildings_out if b["heightSource"] == "osm_levels")
    n_est = sum(1 for b in buildings_out if b["heightSource"] == "estimated_display_only")
    n_split = sum(1 for b in buildings_out if b["footprintSplit"] == "provisional_pin_partition")
    print(
        f"Saved data/urban-approved.json: {len(buildings_out)} hotels ({n_fp} footprinted, {n_split} provisional-split, {len(buildings_out)-n_fp} pin-only), "
        f"heights=(osm:{n_osm}, est:{n_est}), corridors={len(south_corridors)}, lamps={len(urban_out['urbanProps']['streetLamps'])}, palms={len(urban_out['urbanProps']['palms'])}"
    )
    print(f"Saved data/pois.json: {len(pois)} POIs (hotels: {sum(1 for p in pois if p['subCategory']=='hotel')})")

    # Generate Zone 1 South Review Atlas Board using Stage 1 native renderer
    layers: list[dict] = []
    # Haram South Courtyard outline reference
    layers.append({"t": "poly", "c": [[lng, lat] for lng, lat in [from_xy(x, y) for x, y in haram_poly]], "fill": "#e4dccb88", "stroke": "#9d8b6c", "lw": 1.5})
    for c in south_corridors:
        col = "#4a515d" if c["road"] else "#bfa985"
        lw = 3.0 if c["kind"] in ("arterial", "boulevard") else (2.0 if c["road"] else 1.2)
        layers.append({"t": "line", "c": c["coords"], "stroke": col, "lw": lw})
    for b in buildings_out:
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
            layers.append({"t": "pt", "c": [b["entrance"][1], b["entrance"][0]], "r": 3.2, "fill": "#0ea5e9", "stroke": "#ffffff"})
            lbl = str(b["guideNumber"] or b["poiId"])
            layers.append({"t": "txt", "c": [b["center"][1], b["center"][0]], "text": lbl, "s": 13, "bold": True, "fill": "#111111"})
        else:
            layers.append({"t": "pt", "c": [b["center"][1], b["center"][0]], "r": 7.0, "fill": "#e11d48", "stroke": "#ffffff"})
            layers.append({"t": "txt", "c": [b["center"][1], b["center"][0] + 0.00010], "text": str(b["guideNumber"]), "s": 13, "bold": True, "fill": "#b91c1c"})
    for pp in parking_portals:
        layers.append({"t": "pt", "c": [pp["lng"], pp["lat"]], "r": 6.0, "fill": "#7c3aed", "stroke": "#ffffff"})
        layers.append({"t": "txt", "c": [pp["lng"], pp["lat"] - 0.00012], "text": pp["id"].upper(), "s": 11, "bold": True, "fill": "#4c1d95"})

    board_spec = {
        "bbox": [39.6061, 24.4627, 39.6173, 24.4663],
        "width": 2600,
        "title": "أطلس مراجعة المنطقة 1 — الجنوب (401–475 + 735) · المرحلة 6 [2026-11-21]",
        "legend": [
            ["#2d7d46", "بصمة مفردة (ارتفاع تقديري للعرض فقط)"],
            ["#1d6fd8", "بصمة بأدوار OSM الحقيقية"],
            ["#d97706", "بصمة مشتركة مقسّمة مبدئيًا (14 كتلة)"],
            ["#e11d48", "فندق بلا بصمة (441–445)"],
            ["#7c3aed", "مداخل المواقف (عمر / قباء / قربان)"],
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
