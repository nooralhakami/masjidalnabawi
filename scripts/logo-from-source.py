"""Build the two transparent logo files from the owner's source image (white background).

    python3 scripts/logo-from-source.py docs/haramain-logo-source.jpg

Each pixel is read as a mix of white and one of the logo's two inks (navy, gold): its alpha is how
much ink it holds and its colour is that ink exactly — so edges stay smooth and colours stay clean on
any background. The dark-theme file paints the navy ink in a light tone and keeps the gold.
"""
import sys
import numpy as np
from PIL import Image

NAVY = np.array([40, 49, 59], float)
GOLD = np.array([179, 151, 110], float)
LIGHT = np.array([240, 236, 226], float)  # navy ink on dark backgrounds
WHITE = np.array([255, 255, 255], float)
WIDTH = 720  # 4x the largest display width (180 px), enough for sharp screens

src = Image.open(sys.argv[1]).convert('RGB')
src = src.resize((WIDTH, round(src.height * WIDTH / src.width)), Image.LANCZOS)
px = np.asarray(src).astype(float)


def mix(ink):
    d = WHITE - ink
    t = np.clip(((WHITE - px) @ d) / (d @ d), 0, 1)
    err = np.linalg.norm(WHITE - t[..., None] * d - px, axis=-1)
    return t, err


t_navy, e_navy = mix(NAVY)
t_gold, e_gold = mix(GOLD)
is_gold = e_gold < e_navy
alpha = np.where(is_gold, t_gold, t_navy)
alpha = np.where(alpha < 0.04, 0, alpha)  # jpeg noise in the background


def save(path, navy_as):
    rgb = np.where(is_gold[..., None], GOLD, navy_as)
    out = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    Image.fromarray(out).save(path, optimize=True)


save('public/haramain-logo.png', NAVY)
save('public/haramain-logo-dark.png', LIGHT)
print('saved', src.size)
