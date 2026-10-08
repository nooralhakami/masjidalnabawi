"""Well-known restaurant chains, Al Baik's branches, and the big shopping places round Madinah.

Sources:
  - docs/places/osm/shops-2026-10-09.json — OpenStreetMap (© OpenStreetMap contributors, ODbL)
  - docs/places/albaik-branches-2026-10-09.json — Al Baik's own branch list (albaik.com/branches)
Only places inside the street data's area (Quba to Uhud) are kept, so every one gets a real route.

    python3 scripts/places-from-osm.py && python3 scripts/historic-from-osm.py && python3 scripts/shops-from-osm.py

Adds chain restaurants to "food" (after the central ones) and creates the "shopping" category
(malls, hypermarkets, the central vegetable market), ids 1001+.
"""
import json, math, re

OSM = 'docs/places/osm/shops-2026-10-09.json'
ALBAIK = 'docs/places/albaik-branches-2026-10-09.json'
AREA = (24.430, 39.565, 24.512, 39.640)  # = scripts/streets-from-osm.py BBOX
MOSQUE = (24.46858, 39.61109)
LANGS = ('ar', 'en', 'tr', 'ur', 'id', 'uz')

# Chains visitors look for: Arabic name, English name, search spellings, OSM name pattern.
CHAINS = [
    ('ماكدونالدز', "McDonald's", "McDonald's McDonalds ماكدونالدز", r"(?i)mcdonald|ماكدونالد"),
    ('كودو', 'Kudu', 'Kudu كودو', r'(?i)kudu|كودو'),
    ('برجر كنج', 'Burger King', 'Burger King برجر كنج', r'(?i)burger king|برجر كنج'),
    ('هرفي', 'Herfy', 'Herfy هرفي', r'(?i)herfy|هرفي'),
    ('صب واي', 'Subway', 'Subway صب واي', r'(?i)subway|صب واي'),
    ('دومينوز', "Domino's", "Domino's Dominos دومينوز", r"(?i)domino|دومينوز"),
    ('الطازج', 'Al Tazaj', 'Al Tazaj Tazaj الطازج', r'(?i)tazaj|الطازج'),
    ('هارديز', "Hardee's", "Hardee's Hardees هارديز", r"(?i)hardee|هارديز"),
    ('ستاربكس', 'Starbucks', 'Starbucks ستاربكس', r'(?i)starbucks|ستاربكس'),
    ('كنتاكي', 'KFC', 'KFC كنتاكي', r'(?i)\bkfc\b|كنتاكي'),
]

# Shopping: OSM element → (Arabic, English, kind). Kind: mall, hypermarket, market.
SHOPS = {
    'w390946856': ('النور مول', 'Al-Noor Mall', 'mall'),
    'w409337139': ('المنار مول', 'Al Manar Mall', 'mall'),
    'w67329857': ('سوق المدينة الدولي', 'Madinah International Market', 'mall'),
    'w347233390': ('مجمع الجزيرة للتسوق', 'Al Jazeera Shopping Complex', 'mall'),
    'w503771698': ('مزايا مول', 'Mazaia Mall', 'mall'),
    'w630521076': ('سبيس مول', 'Space Mall', 'mall'),
    'w757078380': ('مجمع القارات', 'Al Qarrat Mall', 'mall'),
    'n5086162176': ('حسان مول', 'Hassan Mall', 'mall'),
    'n8025707005': ('قربان مول', 'Qurban Mall', 'mall'),
    'w660268744': ('سوق بلال الجديد', 'New Bilal Market', 'mall'),
    'n4029851689': ('هايبر بنده', 'HyperPanda', 'hypermarket'),
    'n5086158636': ('بنده', 'Panda', 'hypermarket'),
    'n5086190522': ('بنده', 'Panda', 'hypermarket'),
    'n5077513027': ('أسواق بن داود', 'Bin Dawood', 'hypermarket'),
    'w66517412': ('سوق الخضار والفواكه والأسماك واللحوم', 'Fruit, Vegetables, Fish & Meat Market', 'market'),
}
KIND = {  # description in six languages
    'mall': ('مجمع تسوق', 'Shopping mall', 'Alışveriş merkezi', 'شاپنگ مال', 'Pusat perbelanjaan', 'Savdo markazi'),
    'hypermarket': ('هايبر ماركت ومواد غذائية', 'Hypermarket and groceries', 'Hipermarket ve market', 'ہائپر مارکیٹ اور گروسری', 'Hipermarket dan bahan makanan', 'Gipermarket va oziq-ovqat'),
    'market': ('السوق المركزي للخضار والفواكه والأسماك واللحوم', 'The central market for fruit, vegetables, fish and meat', 'Meyve, sebze, balık ve et için merkez pazar', 'پھلوں، سبزیوں، مچھلی اور گوشت کی مرکزی منڈی', 'Pasar pusat buah, sayur, ikan, dan daging', "Meva, sabzavot, baliq va go'sht markaziy bozori"),
    'food': ('مطعم', 'Restaurant', 'Restoran', 'ریستوران', 'Restoran', 'Restoran'),
}


ALBAIK_BRANCH = {  # official branch names → where they are
    'MADINAH TAIBA': ('برج طيبة', 'Taiba Tower'), 'TAIBA TOWER': ('برج طيبة', 'Taiba Tower'),
    'AL MANAR MALL': ('المنار مول', 'Al Manar Mall'), 'HASSAN MALL': ('حسان مول', 'Hassan Mall'), 'AL NOOR MALL': ('النور مول', 'Al-Noor Mall'),
}
SIDE = {'north': ('شمال الحرم', 'north of the Haram'), 'south': ('جنوب الحرم', 'south of the Haram'),
        'east': ('شرق الحرم', 'east of the Haram'), 'west': ('غرب الحرم', 'west of the Haram')}


def inside(lat, lng):
    return AREA[0] <= lat <= AREA[2] and AREA[1] <= lng <= AREA[3]


def m(a, b):
    return math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 101_330)


def direction(lat, lng):
    dy, dx = (lat - MOSQUE[0]) * 111_320, (lng - MOSQUE[1]) * 101_330
    return ('north' if dy > 0 else 'south') if abs(dy) >= abs(dx) else ('east' if dx > 0 else 'west')


def km(lat, lng):
    return m((lat, lng), MOSQUE) / 1000


def describe(kind, lat, lng):
    k = KIND[kind]
    d = km(lat, lng)
    dist = f'{d:.1f}'
    return (f'{k[0]}، على بعد نحو {dist} كم من المسجد النبوي.', f'{k[1]}, about {dist} km from the Prophet\'s Mosque.',
            f"{k[2]}; Mescid-i Nebevi'ye yaklaşık {dist} km.", f'{k[3]}، مسجد نبوی سے تقریباً {dist} کلومیٹر۔',
            f'{k[4]}, sekitar {dist} km dari Masjid Nabawi.', f'{k[5]}, Masjidi Nabaviydan taxminan {dist} km.')


def main():
    els = {e['type'][0] + str(e['id']): e for e in json.load(open(OSM))['elements']}
    pois = json.load(open('data/pois.json'))
    i18n = json.load(open('data/i18n.json'))
    used = {p['name_ar'] for p in pois}
    have_osm = {p.get('osm') for p in pois}
    food = [p for p in pois if p['category'] == 'food']
    next_food = max(p['id'] for p in food) + 1
    next_shop = 1001

    shops_at = [((els[o].get('center') or els[o])['lat'], (els[o].get('center') or els[o])['lon'], a, e) for o, (a, e, k) in SHOPS.items()]

    def area(lat, lng):
        """Where a branch is: the mall it is in or next to (within 350 m), else its side of the Haram and distance."""
        near = min(shops_at, key=lambda x: m((lat, lng), x[:2]))
        if m((lat, lng), near[:2]) < 350:
            return near[2], near[3]
        side = SIDE[direction(lat, lng)]
        d = f'{km(lat, lng):.1f}'
        return f'{side[0]} {d} كم', f'{side[1]}, {d} km'

    def place(cat, sub, ar_base, en, lat, lng, descs, osm=None, alias=None, source=None, where=None):
        nonlocal next_food, next_shop
        # Names are translation keys and must be unique: a chain's branch is named by where it is.
        ar = ar_base
        if where or ar in used:
            w = where or area(lat, lng)
            ar, en = f'{ar_base} – {w[0]}', f'{en} – {w[1]}'
        n = 2
        while ar in used:
            ar, en = f'{ar} ({n})', f'{en} ({n})'
            n += 1
        used.add(ar)
        if cat == 'food':
            pid, next_food = next_food, next_food + 1
            assert pid < 900, 'food ids would run into parking (901+)'
        else:
            pid, next_shop = next_shop, next_shop + 1
        p = {'id': pid, 'name_ar': ar, 'category': cat, 'subCategory': sub, 'lat': round(lat, 7), 'lng': round(lng, 7),
             'direction': direction(lat, lng), 'description_ar': descs[0]}
        if osm:
            p['osm'] = osm
        if source:
            p['source'] = source
        if alias:
            p['alias'] = alias
        pois.append(p)
        for L, d in zip(LANGS[1:], descs[1:]):
            i18n[L]['names'][ar] = en if L != 'ur' else ar
            i18n[L]['descs'][ar] = d

    # 1) Al Baik: the brand's own branch list (one entry per place; OSM's point for the same branch is dropped)
    existing = [p for p in food if 'albaik' in (p.get('alias', '') + p['name_ar']).lower() or 'البيك' in p['name_ar']]
    seen = []
    for b in sorted(json.load(open(ALBAIK))['branches'], key=lambda b: km(b['lat'], b['lng'])):
        lat, lng = b['lat'], b['lng']
        if not inside(lat, lng) or any(m((lat, lng), s) < 40 for s in seen):
            continue
        seen.append((lat, lng))
        if any(m((lat, lng), (p['lat'], p['lng'])) < 60 for p in existing):
            continue  # already on the map (the central branch: official and OSM points agree within 25 m)
        where = ALBAIK_BRANCH.get(b['name'].replace('ALBAIK-', ''))
        place('food', 'food', 'البيك', 'Albaik', lat, lng, describe('food', lat, lng), alias='Al Baik AlBaik البيك', source='albaik.com/branches', where=where)

    # 2) other chains, from OSM, anywhere in the area (one entry per branch)
    for e in sorted(els.values(), key=lambda e: km(*(lambda c: (c['lat'], c['lon']))(e.get('center') or e))):
        t = e.get('tags', {})
        if t.get('amenity') not in ('restaurant', 'fast_food', 'cafe'):
            continue
        oid = e['type'][0] + str(e['id'])
        if oid in have_osm:
            continue
        c = e.get('center') or {'lat': e['lat'], 'lon': e['lon']}
        lat, lng = c['lat'], c['lon']
        if not inside(lat, lng):
            continue
        name = f"{t.get('name', '')} {t.get('name:en', '')} {t.get('brand', '')}"
        chain = next((ch for ch in CHAINS if re.search(ch[3], name)), None)
        if not chain or 'albaik' in name.lower() or 'البيك' in name:
            continue
        if any(m((lat, lng), (p['lat'], p['lng'])) < 30 and chain[1].lower() in (p.get('alias', '') + ' ' + i18n['en']['names'].get(p['name_ar'], '')).lower() for p in pois if p['category'] == 'food'):
            continue
        place('food', 'food', chain[0], chain[1], lat, lng, describe('food', lat, lng), osm=oid, alias=chain[2], where=area(lat, lng))

    # 3) shopping
    for oid, (ar, en, kind) in SHOPS.items():
        e = els[oid]
        c = e.get('center') or {'lat': e['lat'], 'lon': e['lon']}
        place('shopping', kind, ar, en, c['lat'], c['lon'], describe(kind, c['lat'], c['lon']), osm=oid)

    json.dump(pois, open('data/pois.json', 'w'), ensure_ascii=False, indent=1)
    open('data/pois.json', 'a').write('\n')
    json.dump(i18n, open('data/i18n.json', 'w'), ensure_ascii=False, indent=1)
    open('data/i18n.json', 'a').write('\n')
    print('food:', len([p for p in pois if p['category'] == 'food']), '· shopping:', len([p for p in pois if p['category'] == 'shopping']))


if __name__ == '__main__':
    main()
