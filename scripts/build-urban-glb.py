"""
Build the Stage 5 Southern Plaza verified 3D GLB slice (`public/models/urban-south-stage5.glb`)
strictly from owner-approved footprints and street corridors in `data/urban-approved.json`.

Coordinate frame matches `src/domain/frames.ts` & `src/map/glb-layer.ts`:
  - Blender world: X = east (m), Y = -south / north (m), Z = up (m) relative to MODEL_ORIGIN_LNGLAT
  - glTF (export_yup=True): X = east, Y = up, Z = south

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-urban-glb.py
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent.parent
INPUT_JSON = ROOT / "data" / "urban-approved.json"
OUTPUT_GLB = ROOT / "public" / "models" / "urban-south-stage5.glb"

ORIGIN_LNG = 39.611752
ORIGIN_LAT = 24.466806
EARTH_RADIUS_M = 6_371_008.8
EARTH_CIRCUMFERENCE_M = 2.0 * math.pi * EARTH_RADIUS_M


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


def make_material(name: str, rgba: tuple[float, float, float, float], roughness: float = 0.8) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def create_footprint_pad(
    name: str,
    ring_lng_lat: list[list[float]],
    height_m: float,
    mat: bpy.types.Material,
    extras: dict,
) -> bpy.types.Object:
    """Create a grounded prism mesh for a building footprint without any synthetic tower height."""
    pts = [to_blender_xy(c[0], c[1]) for c in ring_lng_lat[:-1]]
    bm = bmesh.new()
    n = len(pts)
    base_v = [bm.verts.new((x, y, 0.02)) for (x, y) in pts]
    roof_v = [bm.verts.new((x, y, height_m)) for (x, y) in pts]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((base_v[i], base_v[j], roof_v[j], roof_v[i]))
    bm.faces.new(roof_v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for k, v in extras.items():
        if v is not None:
            obj[k] = v
    return obj


def create_door_marker(name: str, entrance_lat_lng: list[float], mat: bpy.types.Material, extras: dict) -> bpy.types.Object:
    """Small western facade entrance threshold marker at `entrance` `[lat, lng]`."""
    cx, cy = to_blender_xy(entrance_lat_lng[1], entrance_lat_lng[0])
    hx, hy, hz_top = 0.75, 1.8, 0.42
    pts = [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]
    bm = bmesh.new()
    bv = [bm.verts.new((x, y, 0.04)) for (x, y) in pts]
    tv = [bm.verts.new((x, y, hz_top)) for (x, y) in pts]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((bv[i], bv[j], tv[j], tv[i]))
    bm.faces.new(tv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for k, v in extras.items():
        obj[k] = v
    return obj


def create_street_ribbons(
    name: str,
    corridors: list[dict],
    half_width_m: float,
    height_m: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    """Merge verified OSM street corridor polylines into one flat ribbon mesh."""
    bm = bmesh.new()
    for c in corridors:
        coords = c["coords"]
        pts = [to_blender_xy(lng, lat) for (lng, lat) in coords]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]
            x1, y1 = pts[i + 1]
            dx, dy = x1 - x0, y1 - y0
            seg_len = math.hypot(dx, dy)
            if seg_len < 0.2:
                continue
            nx = (-dy / seg_len) * half_width_m
            ny = (dx / seg_len) * half_width_m
            v0 = bm.verts.new((x0 - nx, y0 - ny, height_m))
            v1 = bm.verts.new((x1 - nx, y1 - ny, height_m))
            v2 = bm.verts.new((x1 + nx, y1 + ny, height_m))
            v3 = bm.verts.new((x0 + nx, y0 + ny, height_m))
            try:
                bm.faces.new((v0, v1, v2, v3))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj["streetCorridorGroup"] = True
    return obj


def inject_asset_extras(glb_path: Path, asset_extras: dict) -> None:
    """Embed top-level provenance extras inside glTF `asset.extras` while keeping binary chunk intact."""
    data = glb_path.read_bytes()
    magic, version, total_len = struct.unpack_from("<3I", data, 0)
    assert magic == 0x46546C67 and version == 2
    json_len, json_type = struct.unpack_from("<2I", data, 12)
    assert json_type == 0x4E4F534A
    json_bytes = data[20 : 20 + json_len]
    gltf = json.loads(json_bytes.decode("utf-8").rstrip("\x00 "))
    gltf.setdefault("asset", {})["extras"] = asset_extras
    rest = data[20 + json_len :]
    new_json = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    pad = (4 - (len(new_json) % 4)) % 4
    new_json_padded = new_json + b" " * pad
    new_total = 12 + 8 + len(new_json_padded) + len(rest)
    out = struct.pack("<3I", magic, version, new_total) + struct.pack("<2I", len(new_json_padded), json_type) + new_json_padded + rest
    glb_path.write_bytes(out)


def main() -> None:
    data = json.loads(INPUT_JSON.read_text("utf-8"))
    if data.get("tier") != "verified" or data.get("approvedBy") != "owner":
        raise RuntimeError("Refusing build: data/urban-approved.json failed A7 approval check")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    mat_pad = make_material("urban_hotel_pad_mat", (0.76, 0.70, 0.58, 1.0), 0.78)
    mat_door = make_material("urban_west_door_mat", (0.04, 0.36, 0.20, 1.0), 0.55)
    mat_road = make_material("urban_south_road_mat", (0.20, 0.22, 0.26, 1.0), 0.90)
    mat_footway = make_material("urban_south_footway_mat", (0.64, 0.59, 0.49, 1.0), 0.85)

    buildings = data["buildings"]
    for b in buildings:
        if b.get("heightSource") != "flat_pending_owner_floors" or b.get("heightM") != 0:
            raise RuntimeError(f"Non-flat synthetic height rejected for {b['buildingId']}")
        create_footprint_pad(
            name=f"urban-hotel-{b['poiId']}-{b['buildingId']}",
            ring_lng_lat=b["polygon"],
            height_m=0.35,
            mat=mat_pad,
            extras={
                "poiId": int(b["poiId"]),
                "buildingId": b["buildingId"],
                "heightM": 0,
                "heightSource": b["heightSource"],
                "entranceSide": b["entranceSide"],
            },
        )
        create_door_marker(
            name=f"urban-door-{b['poiId']}",
            entrance_lat_lng=b["entrance"],
            mat=mat_door,
            extras={"poiId": int(b["poiId"]), "buildingId": b["buildingId"], "entranceSide": "west"},
        )

    roads = [c for c in data["streetCorridors"] if c.get("kind") == "road"]
    footways = [c for c in data["streetCorridors"] if c.get("kind") != "road"]
    create_street_ribbons("urban-street-south-roads", roads, 2.4, 0.04, mat_road)
    create_street_ribbons("urban-street-south-footways", footways, 1.1, 0.07, mat_footway)

    scene = bpy.context.scene
    scene["schema"] = data["schema"]
    scene["tier"] = data["tier"]
    scene["approvedBy"] = data["approvedBy"]
    scene["approvedAt"] = data["approvedAt"]
    scene["heightMode"] = data["heightMode"]

    OUTPUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_GLB),
        export_format="GLB",
        export_yup=True,
        export_extras=True,
        export_apply=True,
        export_draco_mesh_compression_enable=False,
    )

    inject_asset_extras(
        OUTPUT_GLB,
        {
            "schema": data["schema"],
            "stage": data["stage"],
            "tier": data["tier"],
            "approvedBy": data["approvedBy"],
            "approvedAt": data["approvedAt"],
            "heightMode": data["heightMode"],
            "approvedPoiIds": [int(b["poiId"]) for b in buildings],
            "buildingIds": [b["buildingId"] for b in buildings],
        },
    )
    print(f"Exported {OUTPUT_GLB} ({OUTPUT_GLB.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
