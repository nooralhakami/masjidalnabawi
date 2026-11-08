"""
The orange number boards of the outer gates (owner's photographs, 2026-11-08): a white strip with a
location pin on the left, the gate's number in Arabic digits above and Latin digits below, on the
Authority's orange. One cell per gate, 301-370, in rows of ten, for scripts/fence-model.mjs.

Needs Pillow (it draws the project's own Noto Kufi Arabic font); the board image is committed, so
building the fence model needs nothing more: python3 scripts/fence-signs.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'node_modules/@fontsource/noto-kufi-arabic/files'
OUT = ROOT / 'scripts/fence-signs.png'

CELL = 192
COLS = 10
GATES = list(range(301, 371))
ORANGE = (236, 138, 24)
LINE = (250, 196, 120)
WHITE = (250, 247, 240)

arabic = ImageFont.truetype(str(FONTS / 'noto-kufi-arabic-arabic-700-normal.woff2'), 62)
latin = ImageFont.truetype(str(FONTS / 'noto-kufi-arabic-latin-700-normal.woff2'), 58)
DIGITS = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')

rows = (len(GATES) + COLS - 1) // COLS
img = Image.new('RGB', (CELL * COLS, CELL * rows), ORANGE)
d = ImageDraw.Draw(img)
for i, n in enumerate(GATES):
    x0, y0 = (i % COLS) * CELL, (i // COLS) * CELL
    # The board: a thin light edge, the white strip on the left with the pin, a line across the middle.
    d.rectangle((x0 + 2, y0 + 2, x0 + CELL - 3, y0 + CELL - 3), outline=LINE, width=3)
    d.rectangle((x0 + 6, y0 + 6, x0 + 46, y0 + CELL - 7), fill=WHITE)
    cx, cy = x0 + 26, y0 + 58
    d.ellipse((cx - 13, cy - 13, cx + 13, cy + 13), fill=ORANGE)
    d.polygon([(cx - 11, cy + 6), (cx + 11, cy + 6), (cx, cy + 30)], fill=ORANGE)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=WHITE)
    d.ellipse((cx - 16, cy + 34, cx + 16, cy + 42), outline=ORANGE, width=3)
    d.line((x0 + 50, y0 + CELL // 2, x0 + CELL - 8, y0 + CELL // 2), fill=LINE, width=3)
    tx = x0 + 50 + (CELL - 58) / 2
    d.text((tx, y0 + CELL * 0.27), str(n).translate(DIGITS), font=arabic, fill=WHITE, anchor='mm')
    d.text((tx, y0 + CELL * 0.74), str(n), font=latin, fill=WHITE, anchor='mm')
img.save(OUT, optimize=True)
print(OUT, img.size)
