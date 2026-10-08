"""Hotels, restaurants and landmarks of the central area round the Prophet's Mosque, from OpenStreetMap.

Source: docs/places/osm/places-2026-10-09.json (© OpenStreetMap contributors, ODbL), cross-checked with
the official signage map of the central area (districts, hotel numbering, 14 landmarks).

    python3 scripts/places-from-osm.py

Replaces every hotel (7xx) and food place (8xx) in data/pois.json — the old ones were placed by hand
and not where the places are — and moves/adds landmarks to their mapped positions. Names come from
OSM (Arabic name, English name:en); descriptions are generated in six languages.
"""
import json, math

SRC = 'docs/places/osm/places-2026-10-09.json'
LAT0, LNG0 = 24.4673, 39.6111
KY = 111_320
KX = KY * math.cos(math.radians(LAT0))
MOSQUE = (24.46858, 39.61109)

# Selection: 4–5 star hotels, and international chains whatever their rating.
CHAINS = ('hilton', 'hampton', 'tapestry', 'intercontinental', 'mövenpick', 'movenpick', 'pullman', 'crowne plaza', 'kempinski',
          'four seasons', 'sheraton', 'novotel', 'sofitel', 'rotana', 'oberoi', 'biltmore', 'golden tulip', 'dallah', 'rove')
# Restaurants and cafés: the well-known brands, and named restaurants within the central area.
BRANDS = ('البيك', 'albaik', 'كودو', 'kudu', 'starbucks', 'ستاربكس', "hardee", 'هارديز', 'kfc', "domino")
FOOD_RADIUS_M = 750
# Other spellings visitors search for (kept in the place's alias).
ALIASES = {'albaik': 'Al Baik AlBaik البيك', 'البيك': 'Al Baik AlBaik', 'kudu': 'Kudu كودو', 'كودو': 'Kudu', 'starbucks': 'Starbucks ستاربكس',
           'ستاربكس': 'Starbucks', "hardee": "Hardee's Hardees هارديز", 'هارديز': "Hardee's Hardees", 'kfc': 'KFC كنتاكي', "domino": "Domino's Dominos دومينوز"}

# Landmarks (official list, plus notable mosques/museums mapped in OSM). id → (OSM element, Arabic name, English name, Arabic description)
LANDMARKS = {
    508: ('n5124269757', 'معرض عمارة المسجد النبوي', "Prophet's Mosque Architecture Exhibition", 'معرض يعرض تاريخ عمارة المسجد النبوي وتوسعاته.'),
    516: ('w369055309', 'مسجد الغمامة', 'Al-Ghamamah Mosque', 'مسجد تاريخي يُعرف أيضاً بمسجد المصلى، صلى فيه النبي ﷺ صلاة العيد.'),
    517: ('w369085848', 'مسجد أبو بكر الصديق', 'Abu Bakr al-Siddiq Mosque', 'مسجد تاريخي غرب المسجد النبوي.'),
    518: ('w444235531', 'مسجد علي بن أبي طالب', 'Ali ibn Abi Talib Mosque', 'مسجد تاريخي غرب المسجد النبوي.'),
    520: ('w369085870', 'متحف السلام', 'As-Salam Museum', 'متحف عن السيرة النبوية والحضارة الإسلامية غرب المسجد النبوي.'),
    531: ('w65541621', 'مقبرة بقيع الغرقد', "Al-Baqi' Cemetery", 'المقبرة الرئيسية لأهل المدينة منذ عهد النبي ﷺ، شرق المسجد النبوي.'),
    532: ('w457214777', 'مسجد عمر بن الخطاب', 'Umar ibn al-Khattab Mosque', 'مسجد تاريخي جنوب غرب المسجد النبوي.'),
    533: ('w1357107466', 'متحف وبستان الصافية', "As-Safiyyah Museum & Park", 'متحف وحديقة جنوب المسجد النبوي.'),
    534: ('w369461998', 'مجمع المحاكم الشرعية', 'Sharia Courts Complex', 'مجمع المحاكم جنوب المسجد النبوي.'),
    535: ('n4417050108', 'معرض القرآن الكريم', 'The Holy Quran Exhibition', 'معرض عن القرآن الكريم جنوب المسجد النبوي.'),
    536: ('w369464177', 'سوق التمور المركزي', 'Central Dates Market', 'سوق التمور جنوب غرب المسجد النبوي.'),
    537: ('w112566263', 'متحف سكة حديد الحجاز', 'Hejaz Railway Museum', 'متحف في محطة سكة حديد الحجاز التاريخية.'),
    538: ('w346500332', 'مسجد الإجابة', 'Al-Ijabah Mosque', 'مسجد تاريخي شمال شرق المسجد النبوي.'),
    539: ('w161522244', 'مسجد أبي ذر الغفاري', 'Abu Dharr al-Ghifari Mosque', 'مسجد شمال المسجد النبوي.'),
    540: ('w65542091', 'مسجد بلال بن رباح', 'Bilal ibn Rabah Mosque', 'مسجد جنوب المسجد النبوي.'),
    541: ('w161521149', 'مسجد السقيا', 'Al-Suqya Mosque', 'مسجد تاريخي عند محطة سكة حديد الحجاز.'),
}

DISTRICTS = {  # official district names (signage map)
    'north': ('بضاعة', 'Buddaah', 'Budaa', 'بضاعہ', 'Budaah', 'Budaa'),
    'west': ('المناخة', 'Al-Manakhah', 'Menaha', 'المناخہ', 'Al-Manakhah', 'Manoxa'),
    'southwest': ('النقا', 'Al-Naqa', 'Naka', 'النقا', 'An-Naqa', 'Naqa'),
    'south': ('بني خدرة', 'Bani Khedrah', 'Beni Hudre', 'بنی خدرہ', 'Bani Khudrah', 'Bani Xudra'),
    'east': ('بني النجار', 'Bani Al-Najjar', 'Beni Neccar', 'بنی النجار', 'Bani An-Najjar', 'Bani Najjor'),
}
LANGS = ('ar', 'en', 'tr', 'ur', 'id', 'uz')


def xy(lat, lng):
    return ((lng - LNG0) * KX, (lat - LAT0) * KY)


def district(lat, lng):
    if lat > 24.4703:
        return 'north'
    if lng > 39.6135:
        return 'east'
    if lng < 39.6075:
        return 'west' if lat > 24.4655 else 'southwest'
    return 'south'


def direction(lat, lng):
    dy = (lat - MOSQUE[0]) * KY
    dx = (lng - MOSQUE[1]) * KX
    return ('north' if dy > 0 else 'south') if abs(dy) >= abs(dx) else ('east' if dx > 0 else 'west')


def centre(e):
    c = e.get('center') or {'lat': e['lat'], 'lon': e['lon']}
    return round(c['lat'], 7), round(c['lon'], 7)


def is_latin(s):
    return s and not any('؀' <= ch <= 'ۿ' for ch in s)


def names(t):
    """(Arabic, English) from OSM tags; either falls back to the other."""
    n, nar, nen = t.get('name', ''), t.get('name:ar', ''), t.get('name:en', '')
    # The main name first: name:ar is sometimes another place's name (seen on the Sofitel).
    ar = n if n and not is_latin(n) else (nar if nar and not is_latin(nar) else '')
    en = nen or (n if is_latin(n) else '') or (nar if is_latin(nar) else '')
    ar, en = (ar or en).split(';')[0].strip(), (en or ar).split(';')[0].strip()
    return ar, en


# Landmark descriptions in the five other languages (same order as LANDMARKS' Arabic text).
LANDMARK_DESCS = {
    508: ("An exhibition on the history of the Prophet's Mosque's architecture and expansions.", "Mescid-i Nebevi'nin mimarisi ve genişlemelerinin tarihini anlatan sergi.", 'مسجد نبوی کی تعمیر اور توسیعات کی تاریخ پر نمائش۔', 'Pameran tentang sejarah arsitektur dan perluasan Masjid Nabawi.', "Masjidi Nabaviy me'morchiligi va kengaytirilishi tarixi haqidagi ko'rgazma."),
    516: ('A historic mosque, also known as al-Musalla, where the Prophet ﷺ led the Eid prayer.', "Musalla Mescidi olarak da bilinen tarihi mescit; Peygamber ﷺ burada bayram namazı kıldırmıştır.", 'تاریخی مسجد، جسے مسجد المصلّیٰ بھی کہا جاتا ہے، جہاں نبی ﷺ نے عید کی نماز پڑھائی۔', 'Masjid bersejarah, dikenal juga sebagai Masjid al-Mushalla, tempat Nabi ﷺ salat Id.', "Musallo masjidi nomi bilan ham tanilgan tarixiy masjid; Payg'ambar ﷺ shu yerda hayit namozini o'qigan."),
    517: ("A historic mosque west of the Prophet's Mosque.", "Mescid-i Nebevi'nin batısında tarihi bir mescit.", 'مسجد نبوی کے مغرب میں ایک تاریخی مسجد۔', 'Masjid bersejarah di sebelah barat Masjid Nabawi.', "Masjidi Nabaviyning g'arbidagi tarixiy masjid."),
    518: ("A historic mosque west of the Prophet's Mosque.", "Mescid-i Nebevi'nin batısında tarihi bir mescit.", 'مسجد نبوی کے مغرب میں ایک تاریخی مسجد۔', 'Masjid bersejarah di sebelah barat Masjid Nabawi.', "Masjidi Nabaviyning g'arbidagi tarixiy masjid."),
    520: ("A museum of the Prophet's biography and Islamic civilisation, west of the Prophet's Mosque.", "Mescid-i Nebevi'nin batısında, siyer ve İslam medeniyeti müzesi.", 'مسجد نبوی کے مغرب میں سیرت نبوی اور اسلامی تہذیب کا عجائب گھر۔', 'Museum sirah Nabi dan peradaban Islam, di sebelah barat Masjid Nabawi.', "Masjidi Nabaviy g'arbidagi siyrat va islom sivilizatsiyasi muzeyi."),
    531: ("The main cemetery of Madinah since the time of the Prophet ﷺ, east of the Prophet's Mosque.", "Peygamber ﷺ döneminden beri Medine'nin ana mezarlığı; Mescid-i Nebevi'nin doğusunda.", 'نبی ﷺ کے زمانے سے مدینہ کا مرکزی قبرستان، مسجد نبوی کے مشرق میں۔', 'Pemakaman utama Madinah sejak masa Nabi ﷺ, di sebelah timur Masjid Nabawi.', "Payg'ambar ﷺ davridan beri Madinaning asosiy qabristoni, Masjidi Nabaviyning sharqida."),
    532: ("A historic mosque south-west of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneybatısında tarihi bir mescit.", 'مسجد نبوی کے جنوب مغرب میں ایک تاریخی مسجد۔', 'Masjid bersejarah di sebelah barat daya Masjid Nabawi.', "Masjidi Nabaviyning janubi-g'arbidagi tarixiy masjid."),
    533: ("A museum and garden south of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneyinde müze ve bahçe.", 'مسجد نبوی کے جنوب میں عجائب گھر اور باغ۔', 'Museum dan taman di sebelah selatan Masjid Nabawi.', 'Masjidi Nabaviyning janubidagi muzey va bog‘.'),
    534: ("The courts complex south of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneyindeki mahkemeler kompleksi.", 'مسجد نبوی کے جنوب میں عدالتوں کا کمپلیکس۔', 'Kompleks pengadilan di sebelah selatan Masjid Nabawi.', 'Masjidi Nabaviyning janubidagi sudlar majmuasi.'),
    535: ("An exhibition about the Holy Quran, south of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneyinde Kur'an-ı Kerim sergisi.", 'مسجد نبوی کے جنوب میں قرآن کریم کی نمائش۔', "Pameran tentang Al-Qur'an, di sebelah selatan Masjid Nabawi.", "Masjidi Nabaviyning janubidagi Qur'oni Karim ko'rgazmasi."),
    536: ("The dates market south-west of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneybatısında hurma pazarı.", 'مسجد نبوی کے جنوب مغرب میں کھجوروں کا بازار۔', 'Pasar kurma di sebelah barat daya Masjid Nabawi.', "Masjidi Nabaviyning janubi-g'arbidagi xurmo bozori."),
    537: ('A museum in the historic Hejaz Railway station.', 'Tarihi Hicaz Demiryolu istasyonundaki müze.', 'حجاز ریلوے کے تاریخی اسٹیشن میں عجائب گھر۔', 'Museum di stasiun bersejarah Kereta Api Hijaz.', 'Tarixiy Hijoz temir yo‘li bekatidagi muzey.'),
    538: ("A historic mosque north-east of the Prophet's Mosque.", "Mescid-i Nebevi'nin kuzeydoğusunda tarihi bir mescit.", 'مسجد نبوی کے شمال مشرق میں ایک تاریخی مسجد۔', 'Masjid bersejarah di sebelah timur laut Masjid Nabawi.', 'Masjidi Nabaviyning shimoli-sharqidagi tarixiy masjid.'),
    539: ("A mosque north of the Prophet's Mosque.", "Mescid-i Nebevi'nin kuzeyinde bir mescit.", 'مسجد نبوی کے شمال میں ایک مسجد۔', 'Masjid di sebelah utara Masjid Nabawi.', 'Masjidi Nabaviyning shimolidagi masjid.'),
    540: ("A mosque south of the Prophet's Mosque.", "Mescid-i Nebevi'nin güneyinde bir mescit.", 'مسجد نبوی کے جنوب میں ایک مسجد۔', 'Masjid di sebelah selatan Masjid Nabawi.', 'Masjidi Nabaviyning janubidagi masjid.'),
    541: ('A historic mosque by the Hejaz Railway station.', 'Hicaz Demiryolu istasyonunun yanında tarihi bir mescit.', 'حجاز ریلوے اسٹیشن کے پاس ایک تاریخی مسجد۔', 'Masjid bersejarah di dekat stasiun Kereta Api Hijaz.', 'Hijoz temir yo‘li bekati yonidagi tarixiy masjid.'),
}


def main():
    els = json.load(open(SRC))['elements']
    byid = {e['type'][0] + str(e['id']): e for e in els}
    pois = json.load(open('data/pois.json'))
    i18n = json.load(open('data/i18n.json'))
    gates = [p for p in pois if p['subCategory'] == 'gate_outer']

    def nearest_gate(lat, lng):
        g = min(gates, key=lambda g: math.dist(xy(lat, lng), xy(g['lat'], g['lng'])))
        return g['id'], math.dist(xy(lat, lng), xy(g['lat'], g['lng']))

    # 1) remove the old hand-placed hotels and food places (and their translations)
    old = [p for p in pois if p['category'] in ('hotels', 'food')]
    for p in old:
        for L in LANGS[1:]:
            i18n[L]['names'].pop(p['name_ar'], None)
            i18n[L]['descs'].pop(p['name_ar'], None)
    pois = [p for p in pois if p['category'] not in ('hotels', 'food')]

    # 2) hotels
    hotels, seen = [], set()
    for e in els:
        t = e.get('tags', {})
        if t.get('tourism') != 'hotel':
            continue
        ar, en = names(t)
        blob = ' '.join([ar, en, t.get('brand', ''), t.get('operator', '')]).lower()
        try:
            stars = float(t.get('stars', '0'))
        except ValueError:
            stars = 0
        chain = any(c in blob for c in CHAINS)
        if not (stars >= 4 or chain) or not ar:
            continue
        # one entry per hotel: towers of the same hotel and duplicate nodes collapse
        key = en.lower().split(' - ')[0].split(' (')[0].replace('hotel', '').replace('فندق', '').strip()
        lat, lng = centre(e)
        # The same hotel mapped twice (a point and a building, or one per tower) is one entry.
        if key in seen or any(math.dist(xy(lat, lng), xy(h[2], h[3])) < 40 for h in hotels):
            continue
        seen.add(key)
        hotels.append((ar, en, lat, lng, int(stars) if stars else 0, e))
    hotels.sort(key=lambda h: math.dist(xy(h[2], h[3]), xy(*MOSQUE)))

    # 3) restaurants and cafés
    food, seenf = [], set()
    for e in els:
        t = e.get('tags', {})
        if t.get('amenity') not in ('restaurant', 'fast_food', 'cafe') or not t.get('name'):
            continue
        ar, en = names(t)
        lat, lng = centre(e)
        blob = ' '.join([ar, en, t.get('brand', '')]).lower()
        brand = any(b in blob for b in BRANDS)
        near = math.dist(xy(lat, lng), xy(*MOSQUE)) < FOOD_RADIUS_M
        generic = en.lower() in ('hamburger', 'fish', 'restaurant', 'cafe')
        if generic or not (brand or near) or (ar, round(lat, 4), round(lng, 4)) in seenf:
            continue
        seenf.add((ar, round(lat, 4), round(lng, 4)))
        food.append((ar, en, lat, lng, t.get('amenity'), t.get('cuisine', ''), e))
    food.sort(key=lambda f: math.dist(xy(f[2], f[3]), xy(*MOSQUE)))

    added = []
    # Hotel and food names are unique keys for translations: add the district when a name repeats.
    used = {p['name_ar'] for p in pois}

    def unique(name, lat, lng):
        if name not in used:
            used.add(name)
            return name
        n = f'{name} ({DISTRICTS[district(lat, lng)][0]})'
        used.add(n)
        return n

    def describe(kind, lat, lng, stars=0):
        d = DISTRICTS[district(lat, lng)]
        g, m = nearest_gate(lat, lng)
        m = int(round(m / 10) * 10)
        st = {'ar': f'{stars} نجوم ', 'en': f'{stars}-star ', 'tr': f'{stars} yıldızlı ', 'ur': f'{stars} ستارہ ', 'id': f'bintang {stars}, ', 'uz': f'{stars} yulduzli '} if stars else {L: '' for L in LANGS}
        if kind == 'hotel':
            return {
                'ar': f'فندق {st["ar"]}في حي {d[0]} بالمنطقة المركزية، على بعد نحو {m} م من بوابة {g}.',
                'en': f'A {st["en"]}hotel in the {d[1]} district of the central area, about {m} m from Gate {g}.',
                'tr': f'Merkezi bölgedeki {d[2]} semtinde {st["tr"]}otel; {g}. kapıya yaklaşık {m} m.',
                'ur': f'مرکزی علاقے کے محلہ {d[3]} میں {st["ur"]}ہوٹل، دروازہ {g} سے تقریباً {m} میٹر۔',
                'id': f'Hotel {st["id"]}di distrik {d[4]}, kawasan pusat, sekitar {m} m dari Pintu {g}.',
                'uz': f'Markaziy hududdagi {d[5]} mahallasida {st["uz"]}mehmonxona, {g}-darvozadan taxminan {m} m.',
            }
        return {
            'ar': f'في حي {d[0]} بالمنطقة المركزية، على بعد نحو {m} م من بوابة {g}.',
            'en': f'In the {d[1]} district of the central area, about {m} m from Gate {g}.',
            'tr': f'Merkezi bölgedeki {d[2]} semtinde; {g}. kapıya yaklaşık {m} m.',
            'ur': f'مرکزی علاقے کے محلہ {d[3]} میں، دروازہ {g} سے تقریباً {m} میٹر۔',
            'id': f'Di distrik {d[4]}, kawasan pusat, sekitar {m} m dari Pintu {g}.',
            'uz': f'Markaziy hududdagi {d[5]} mahallasida, {g}-darvozadan taxminan {m} m.',
        }

    def add(pid, cat, sub, ar, en, lat, lng, descs, osm):
        ar = unique(ar, lat, lng)
        p = {'id': pid, 'name_ar': ar, 'category': cat, 'subCategory': sub, 'lat': lat, 'lng': lng,
             'direction': direction(lat, lng), 'description_ar': descs['ar'], 'osm': osm}
        blob = f'{ar} {en}'.lower()
        alias = ' '.join(dict.fromkeys(a for k, a in ALIASES.items() if k in blob))
        if alias:
            p['alias'] = alias
        pois.append(p)
        for L in LANGS[1:]:
            i18n[L]['names'][ar] = en if L != 'ur' else (ar if not is_latin(ar) else en)
            i18n[L]['descs'][ar] = descs[L]
        added.append((pid, ar))

    for i, (ar, en, lat, lng, stars, e) in enumerate(hotels):
        add(701 + i, 'hotels', 'hotel', ar, en, lat, lng, describe('hotel', lat, lng, stars), e['type'][0] + str(e['id']))
    for i, (ar, en, lat, lng, kind, cuisine, e) in enumerate(food):
        add(801 + i, 'food', 'food', ar, en, lat, lng, describe('food', lat, lng), e['type'][0] + str(e['id']))

    # 4) landmarks: move to their mapped position, or add
    byp = {p['id']: p for p in pois}
    for pid, (oid, ar, en, desc) in LANDMARKS.items():
        e = byid[oid]
        lat, lng = centre(e)
        if pid in byp:
            p = byp[pid]
            if p['name_ar'] != ar:  # renamed: move its translations to the new key
                for L in LANGS[1:]:
                    i18n[L]['names'].pop(p['name_ar'], None)
                    i18n[L]['descs'].pop(p['name_ar'], None)
                p['name_ar'] = ar
                p['description_ar'] = desc
            p.update(lat=lat, lng=lng, direction=direction(lat, lng), osm=oid)
            for L, d in zip(LANGS[1:], LANDMARK_DESCS[pid]):
                i18n[L]['names'][ar] = en if L != 'ur' else ar
                i18n[L]['descs'][ar] = d
        else:
            pois.append({'id': pid, 'name_ar': ar, 'category': 'landmarks', 'subCategory': 'landmark', 'lat': lat, 'lng': lng,
                         'direction': direction(lat, lng), 'description_ar': desc, 'osm': oid})
            for L, d in zip(LANGS[1:], LANDMARK_DESCS[pid]):
                i18n[L]['names'][ar] = en if L != 'ur' else ar
                i18n[L]['descs'][ar] = d
            added.append((pid, ar))

    json.dump(pois, open('data/pois.json', 'w'), ensure_ascii=False, indent=1)
    open('data/pois.json', 'a').write('\n')
    json.dump(i18n, open('data/i18n.json', 'w'), ensure_ascii=False, indent=1)
    open('data/i18n.json', 'a').write('\n')
    print(f'removed {len(old)} old hotels/food; hotels {len(hotels)}, food {len(food)}; landmarks {len(LANDMARKS)}')
    print('food:', ' | '.join(f[0] for f in food))


if __name__ == '__main__':
    main()
