"""Build the mountains of Madinah for the 3D view.

  python3 scripts/terrain-from-srtm.py

Writes, in the metres frame of the 3D models (east and south of the Mosque's anchor, see
src/data-next/alharamain-3d.ts):

  public/models/madinah-terrain.bin   little-endian: uint16 cols, uint16 rows, float32 x0, z0, step;
                                      then cols*rows uint16 heights in decimetres above the Haram's
                                      ground, row by row from the north-west corner going south.

Source: SRTM elevations through the AWS Terrain Tiles (Terrarium PNG, zoom 12, public domain). Only
ground standing over 25 m above the Haram is kept, so the city stays flat on the imagery and only
Uhud, Ayr and the other hills rise.

(The buildings round the Haram that this script once drew are gone: owner, 2026-11-04, until they
are added with exact positions.)
"""
import math, struct, urllib.request, zlib

ANCHOR = (39.611752, 24.466806)  # Venue 4: the origin of the models' frame (alharamain-3d.ts)
MOSQUE = (39.6107, 24.4683)

EARTH = 6378137.0


def merc(lng, lat):
    """Web Mercator metres at the equator (MapLibre's frame, before the latitude scale)."""
    return EARTH * math.radians(lng), EARTH * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


AX, AY = merc(*ANCHOR)
# MapLibre's meterInMercatorCoordinateUnits at the anchor: Mercator metres per real metre.
SCALE = 1 / math.cos(math.radians(ANCHOR[1]))


def lnglat(east, south):
    x = AX + east * SCALE
    y = AY - south * SCALE
    return math.degrees(x / EARTH), math.degrees(2 * math.atan(math.exp(y / EARTH)) - math.pi / 2)


# ---------- terrain ----------

TERRAIN_BOUNDS = (-11000, -12000, 11000, 12000)  # metres: west, north (negative south), east, south
STEP = 120
ZOOM = 12
KEEP_ABOVE = 25  # metres over the Haram's ground


def png_rgb(data):
    """Decode an 8-bit RGB/RGBA PNG (Terrarium tiles) without any library."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w = 8, b'', 0
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and ctype in (2, 6)
            bpp = 3 if ctype == 2 else 4
        elif kind == b'IDAT':
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([(line[x * bpp], line[x * bpp + 1], line[x * bpp + 2]) for x in range(w)])
        prev = line
    return rows


tiles = {}


def tile(tx, ty):
    if (tx, ty) not in tiles:
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{tx}/{ty}.png'
        req = urllib.request.Request(url, headers={'User-Agent': 'masjid-nabawi-visitor-guide/1.0 (terrain build script)'})
        with urllib.request.urlopen(req, timeout=60) as r:
            tiles[(tx, ty)] = png_rgb(r.read())
    return tiles[(tx, ty)]


def elevation(lng, lat):
    n = 2 ** ZOOM
    fx = (lng + 180) / 360 * n * 256
    fy = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n * 256

    def px(x, y):
        r, g, b = tile(x // 256, y // 256)[y % 256][x % 256]
        return r * 256 + g + b / 256 - 32768

    x0, y0 = int(fx), int(fy)
    tx, ty = fx - x0, fy - y0
    top = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx
    bottom = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx
    return top * (1 - ty) + bottom * ty


def terrain():
    base = elevation(*MOSQUE)
    west, north, east, south = TERRAIN_BOUNDS
    cols = (east - west) // STEP + 1
    rows = (south - north) // STEP + 1
    heights = []
    for r in range(rows):
        for c in range(cols):
            lng, lat = lnglat(west + c * STEP, north + r * STEP)
            h = elevation(lng, lat) - base - KEEP_ABOVE
            heights.append(max(0, min(65535, round(h * 10))) if h > 0 else 0)
    head = struct.pack('<HHfff', cols, rows, west, north, STEP)
    return head + struct.pack(f'<{len(heights)}H', *heights), base, max(heights) / 10 + KEEP_ABOVE


def main():
    data, base, top = terrain()
    with open('public/models/madinah-terrain.bin', 'wb') as f:
        f.write(data)
    print(f'terrain: Haram ground {base:.0f} m, highest {top:.0f} m above it, {len(data)} bytes')


if __name__ == '__main__':
    main()
