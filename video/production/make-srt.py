"""Writes Arabic and English SRT files for both films from the caption cues in src/*.html."""
import json, pathlib, re

HERE = pathlib.Path(__file__).parent
EN = {
    'official': [
        "Around the Prophet's Mosque stand 112 gates and doors —",
        "and every visitor wants to find their way with peace of mind.",
        "Prophet's Mosque Visitor Guide: one map for every gate, door and service.",
        "Seventy outer gates and forty-two mosque doors, colour-coded by their four sides.",
        "Type a door's number or name: see its side, nearest outer gate and street.",
        "Many doors carry a story in their name — the guide tells it in brief.",
        "For women: women's section doors, restrooms and prayer areas — in one tap.",
        "At Gate 37: whose turn it is now at the Noble Rawdah, and when it changes.",
        "From where you stand, it draws a walking route through the plaza walkways,",
        "with distance and time — and updates what's left as you walk.",
        "Six languages.",
        "Right from the browser — no app-store download, no permissions to run.",
        "Prophet's Mosque Visitor Guide — arrive with ease, and give your visit your heart.",
    ],
    'guide': [
        "Looking for your gate — or the nearest women's facility?",
        "Scan the code or open the link — right in your browser.",
        "Type a gate's number or name to see its side and the nearest outer gate.",
        "For women: \"Women's Services\" — women's doors, restrooms and prayer areas.",
        "Then: \"Draw route from my location\" — and walk with peace of mind.",
        "The Rawdah card shows whose turn it is now — in six languages.",
        "The Prophet's Mosque Visitor Guide — add it to your home screen.",
    ],
}

def ts(t):
    ms = round(t * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

def cues(name):
    src = (HERE / 'src' / f'{name}.html').read_text(encoding='utf-8')
    block = src[src.index("captions(tl, $('#cap'), [") :]
    block = block[block.index('[') : block.index(']);') + 1]
    return [(float(a), float(b), t) for a, b, t in re.findall(r"\[([\d.]+),\s*([\d.]+),\s*'([^']*)'\]", block)]

def wrap(text, width=42):
    """Splits a long cue into two balanced lines at the space nearest the middle."""
    if len(text) <= width:
        return [text]
    spaces = [i for i, ch in enumerate(text) if ch == ' ']
    cut = min(spaces, key=lambda i: abs(i - len(text) / 2))
    return [text[:cut], text[cut + 1 :]]

out = HERE / 'out'
out.mkdir(exist_ok=True)
for name in ('official', 'guide'):
    cs = cues(name)
    assert len(cs) == len(EN[name]), name
    for lang, texts in (('ar', [c[2] for c in cs]), ('en', EN[name])):
        lines = []
        for i, ((a, b, _), text) in enumerate(zip(cs, texts), 1):
            rows = wrap(text)
            if lang == 'ar':
                rows = ['\u202b' + r + '\u202c' for r in rows]
            lines += [str(i), f'{ts(a)} --> {ts(b)}', *rows, '']
        (out / f'{name}-{lang}.srt').write_text('\n'.join(lines), encoding='utf-8')
        print('wrote', f'{name}-{lang}.srt', len(cs), 'cues')
