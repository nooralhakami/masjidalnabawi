"""Fetches the app's own satellite base map (Esri World Imagery, the URL in data/rules.json) for the area
around the Prophet's Mosque and stitches it into map-z18.jpg, with its bounds in map-z18.json.
Credit shown on screen wherever it appears: Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics."""
import io, json, math, os, sys, time, urllib.request
from PIL import Image
Z = 18
URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
S, N, W, E = 24.4600, 24.4770, 39.6020, 39.6200
def tile(lat, lng):
    n = 2 ** Z
    return (lng + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = map(int, tile(N, W)); x1, y1 = map(int, tile(S, E))
cache = os.path.join(os.path.dirname(__file__), 'tiles')
img = Image.new('RGB', ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
for x in range(x0, x1 + 1):
    for y in range(y0, y1 + 1):
        f = os.path.join(cache, f'{Z}-{x}-{y}.jpg')
        if not os.path.exists(f):
            for k in range(4):
                try:
                    data = urllib.request.urlopen(URL.format(z=Z, x=x, y=y), timeout=30).read(); break
                except Exception as e:
                    time.sleep(2 ** k)
            open(f, 'wb').write(data)
        img.paste(Image.open(f).convert('RGB'), ((x - x0) * 256, (y - y0) * 256))
out = os.path.join(os.path.dirname(__file__), 'map-z18.jpg')
img.save(out, quality=88)
json.dump({'z': Z, 'x0': x0, 'y0': y0, 'w': img.width, 'h': img.height}, open(out.replace('.jpg', '.json'), 'w'))
print(out, img.size, (x1 - x0 + 1) * (y1 - y0 + 1), 'tiles')
