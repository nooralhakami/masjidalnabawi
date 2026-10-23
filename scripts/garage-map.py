"""Draw the whole underground car park from data/garage.json, one number per road, for the owner to
draw corrections on (owner, 2026-10-15). North is up; black arrows show each road's direction.
Writes docs/routes/garage-map.png and docs/routes/garage-map-legend.md. Run after every rebuild of
data/garage.json:
    python3 scripts/garage-map.py
"""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

LAT0, LNG0 = 24.4673, 39.6111
KY = 111_320
KX = KY * math.cos(math.radians(LAT0))
m = lambda la, lo: ((lo - LNG0) * KX, (la - LAT0) * KY)

g = json.load(open('data/garage.json'))
pois = {x['id']: x for x in json.load(open('data/pois.json'))}
ov = json.load(open('data/overrides.json'))
routing = json.load(open('data/routing.json'))

X0, X1, Y0, Y1, S = -520, 360, -330, 440, 3.2
W, H = int((X1 - X0) * S), int((Y1 - Y0) * S)
im = Image.new('RGB', (W, H), '#f3efe6')
d = ImageDraw.Draw(im)
P = lambda x, y: ((x - X0) * S, (Y1 - y) * S)
FONT = next(f for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf') if os.path.exists(f))
f, fs = ImageFont.truetype(FONT, 22), ImageFont.truetype(FONT, 17)

# The mosque.
mq = [m(*c) for c in routing['obstacles']['mosque_building']]
xs, ys = [a for a, _ in mq], [b for _, b in mq]
d.rectangle([P(min(xs), max(ys)), P(max(xs), min(ys))], fill='#e7dccd', outline='#b8a58a', width=3)
d.text(P((min(xs) + max(xs)) / 2 - 30, (min(ys) + max(ys)) / 2), 'MOSQUE', fill='#8a7556', font=f)

# Facilities 201-236 (with the position nudges) and the lots (dark red: subscribers).
for fid in range(201, 237):
    p = pois[fid]
    o = ov.get(str(fid), {})
    x, y = P(*m(p['lat'] + o.get('north', 0) / KY, p['lng'] + o.get('east', 0) / KX))
    d.rectangle([x - 19, y - 19, x + 19, y + 19], fill='#cdb99c')
    d.text((x - 17, y - 9), str(fid), fill='#3a2f22', font=fs)
for lot in g['lots']:
    q = pois[lot['id']]
    x, y = P(*m(q['lat'], q['lng']))
    d.rounded_rectangle([x - 32, y - 16, x + 32, y + 16], radius=8, fill='#9f1239' if q.get('access') == 'subscribers' else '#1f64a8')
    d.text((x - 24, y - 11), f"P{lot['id'] - 900}", fill='white', font=f)

# The roads: blue in, red out, orange either way, cyan links, green down, yellow up, purple level A only.
COL = {'entry': '#1e6fd9', 'exit': '#d62828', 'shared': '#f08c00', 'link': '#00a5c8', 'ramp_up': '#d9b400', 'ramp_down': '#2b8a3e'}
colour = lambda l: '#9b5de5' if l.get('levels') == ['A'] else COL[l['kind']]
DRAFT = 'docs/routes/garage-qurban-draft-2026-10-23.json'
draft_ids = {l['id'] for l in json.load(open(DRAFT))['lanes']} if os.path.exists(DRAFT) else set()
data_lane = {l['id']: l for l in g['lanes']}
lanes = [(l, [P(*m(a, b)) for a, b in l['path']]) for l in g['lanes'] if l['id'] not in draft_ids]
for l, pts in lanes:
    d.line(pts, fill=colour(l), width=7)
for n, (l, pts) in enumerate(lanes, 1):
    i = max(range(1, len(pts)), key=lambda k: math.dist(pts[k - 1], pts[k]))
    a, b = pts[i - 1], pts[i]
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    if l.get('oneway', True):
        for t in (0.25, 0.75):
            ax, ay, s = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 13
            d.polygon([(ax + s * math.cos(ang + k), ay + s * math.sin(ang + k)) for k in (0, 2.5, -2.5)], fill='black')
    cx, cy = (a[0] + b[0]) / 2 - 20 * math.sin(ang), (a[1] + b[1]) / 2 + 20 * math.cos(ang)
    d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill='white', outline=colour(l), width=3)
    d.text((cx - (7 if n < 10 else 13), cy - 12), str(n), fill='black', font=f)
# Draft roads still to be confirmed (owner, 2026-10-23): drawn dashed, numbered after the confirmed ones.
# They are NOT in data/garage.json, so the route planner never uses them.
DRAFT = 'docs/routes/garage-qurban-draft-2026-10-23.json'
drafts = []
if os.path.exists(DRAFT):
    dr = json.load(open(DRAFT))
    cp = dr['control_points']
    ax = np.array([c['px'][0] for c in cp]); ay = np.array([c['px'][1] for c in cp])
    lng_fit = np.polyfit(ax, [pois[c['id']]['lng'] for c in cp], 1)
    lat_fit = np.polyfit(ay, [pois[c['id']]['lat'] for c in cp], 1)
    # The owner's second round was drawn on a crop of this very map: its pixels go straight to metres,
    # calibrated on facilities 201-204 (their positions, with the nudges).
    cc = dr.get('crop_control_points', [])
    if cc:
        fm = {}
        for c in cc:
            q = pois[c['id']]; o = ov.get(str(c['id']), {})
            fm[c['id']] = m(q['lat'] + o.get('north', 0) / KY, q['lng'] + o.get('east', 0) / KX)
        cfx = np.polyfit([c['px'][0] for c in cc], [fm[c['id']][0] for c in cc], 1)
        cfy = np.polyfit([c['px'][1] for c in cc], [fm[c['id']][1] for c in cc], 1)
    for l in dr['lanes']:
        if l['id'] in data_lane:  # already in the route planner: its path as the planner has it
            l['integrated'] = True
            drafts.append((l, [P(*m(a, b)) for a, b in data_lane[l['id']]['path']]))
            continue
        if l.get('space') == 'crop':
            drafts.append((l, [P(float(np.polyval(cfx, x)), float(np.polyval(cfy, y))) for x, y in l['px']]))
            continue
        path = [(float(np.polyval(lat_fit, y)), float(np.polyval(lng_fit, x))) for x, y in l['px']]
        drafts.append((l, [P(*m(a, b)) for a, b in path]))
DCOL = {'entry': '#1e6fd9', 'exit': '#d62828', 'shared': '#f08c00', 'link': '#00a5c8', 'ramp_up': '#d9b400', 'ramp_down': '#2b8a3e'}
dcolour = lambda l: '#9b5de5' if l.get('unconfirmed') else '#d62828' if l.get('levels') == ['A'] and l['kind'] != 'link' else DCOL[l['kind']]
for l, pts in drafts:
    if l.get('merged_into'):
        continue
    c = '#9b5de5' if l.get('unconfirmed') else '#d62828' if l.get('levels') == ['A'] else dcolour(l)
    if l.get('integrated'):
        d.line(pts, fill=c, width=7)
        continue_dash = False
    else:
        continue_dash = True
    for a, b in (zip(pts, pts[1:]) if continue_dash else []):
        L = math.dist(a, b)
        for k in range(0, int(L // 18) + 1):
            t0, t1 = k * 18 / L, min(1, (k * 18 + 10) / L)
            d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=c, width=7)
FIXED_LABEL = {
    'qurban-road-in-A': ((40, 0), 0.5), 'qurban-road-out-A': ((-40, 0), 0.5),
    'a-qurban-west-stub': ((-42, -12), 0.5), 'a-qurban-west-east': ((0, -34), 0.45),
    'a-qurban-exit-curve': ((46, 8), 0.55), 'a-qurban-to-east-up': ((34, -30), 0.6),
    'a-qurban-east-up': ((40, 0), 0.35), 'a-qurban-arc': ((0, 30), 0.5),
}
for n, (l, pts) in enumerate(drafts, len(lanes) + 1):
    if l.get('merged_into'):
        continue
    i = max(range(1, len(pts)), key=lambda k: math.dist(pts[k - 1], pts[k]))
    a, b = pts[i - 1], pts[i]
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    for t in (0.3, 0.7):
        ax_, ay_, s_ = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 13
        d.polygon([(ax_ + s_ * math.cos(ang + k), ay_ + s_ * math.sin(ang + k)) for k in (0, 2.5, -2.5)], fill='black')
    side = 1 if n % 2 else -1
    tl = {'qurban-road-in-A': 0.1, 'qurban-road-out-A': 0.9}.get(l['id'], 0.3 if n % 2 else 0.7)
    cx, cy = a[0] + (b[0] - a[0]) * tl - 34 * side * math.sin(ang), a[1] + (b[1] - a[1]) * tl + 34 * side * math.cos(ang)
    if l['id'] in FIXED_LABEL:  # the two red curves run side by side: one label each side, whatever their direction
        (dx, dy), t_ = FIXED_LABEL[l['id']]
        cx, cy = a[0] + (b[0] - a[0]) * t_ + dx, a[1] + (b[1] - a[1]) * t_ + dy
    d.rounded_rectangle([cx - 20, cy - 16, cx + 20, cy + 16], radius=8, fill='white', outline=dcolour(l) if l.get('levels') != ['A'] or l.get('unconfirmed') else '#d62828', width=3)
    d.text((cx - 13, cy - 12), str(n), fill='black', font=f)
for e in g['entrances']:
    x, y = P(*m(*e['street']))
    d.text((x - 40, y - 40), 'IN ' + e['id'].upper(), fill='#1e6fd9', font=f)
for e in g['exits']:
    x, y = P(*m(*e['mouth']))
    d.text((x + 8, y + 8), 'OUT ' + e['id'].upper(), fill='#d62828', font=f)
d.text((15, 15), 'N ^', fill='black', font=f)
im.save('docs/routes/garage-map.png')

KIND = {'entry': 'دخول (أزرق)', 'exit': 'خروج (أحمر)', 'shared': 'ممر في الاتجاهين (برتقالي)', 'link': 'وصلة', 'ramp_up': 'صعود إلى A (أصفر)', 'ramp_down': 'نزول إلى B (أخضر)'}
rows = [f"| {n} | `{l['id']}` | {KIND[l['kind']]}{' · الدور A فقط (بنفسجي)' if l.get('levels') == ['A'] else ' · B فقط' if l.get('levels') == ['B'] else ''} |" for n, (l, _) in enumerate(lanes, 1)]
drows = [f"| {n} | `{l['id']}` | مدموج في `{l['merged_into']}` (قرار المالك) · مسودة |" if l.get('merged_into') else f"| {n} | `{l['id']}` | {KIND[l['kind']]}{' · الدور A فقط (أحمر)' if l.get('levels') == ['A'] else ''}{' · غير مؤكد (بنفسجي)' if l.get('unconfirmed') else ''} · {'في حساب المسارات' if l.get('integrated') else 'مسودة'} |" for n, (l, _) in enumerate(drafts, len(lanes) + 1)]
open('docs/routes/garage-map-legend.md', 'w').write(
    '# أرقام طرق المواقف في `garage-map.png`\n\n'
    'تُولَّد مع الصورة من `data/garage.json` بالأمر `python3 scripts/garage-map.py`، فتتغير الأرقام إذا أُضيف طريق.\n\n'
    '| الرقم | الطريق في البيانات | نوعه |\n|---|---|---|\n' + '\n'.join(rows) + '\n'
    + ('\n## مدخل قربان (أرقام المسودة نفسها): الخط المتصل في حساب المسارات، والمنقط مسودة لم تدخل بعد\n\n| الرقم | الطريق في المسودة | نوعه |\n|---|---|---|\n' + '\n'.join(drows) + '\n' if drows else '')
)
print(f'{len(lanes)} roads + {len(drafts)} drafts → docs/routes/garage-map.png ({W}×{H}) and docs/routes/garage-map-legend.md')
