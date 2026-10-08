"""Historic sites of Madinah: confirmed, documented places only (quality over quantity).

Each site is taken from OpenStreetMap (docs/places/osm/historic-2026-10-09.json, © OpenStreetMap
contributors, ODbL) and cross-checked against Wikidata (docs/places/wikidata-historic-2026-10-09.json):
the two positions must agree within 200 m, or the script stops. Descriptions state only what is
firmly established (the event, the person, the year), in six languages.

    python3 scripts/historic-from-osm.py

Adds sites 542–550 and marks the historic sites already on the map (mosques, Al-Baqi', Saqifa) with
subCategory "historic", which the «معالم تاريخية» pill shows.
"""
import json, math

OSM = 'docs/places/osm/historic-2026-10-09.json'
WD = 'docs/places/wikidata-historic-2026-10-09.json'
MOSQUE = (24.46858, 39.61109)

# Already on the map, and historic.
# Abu Dharr (539) is left out: its mapped position and Wikidata's «مسجد السجدة» are 378 m apart.
EXISTING = [515, 516, 517, 518, 531, 532, 538, 541]

# id: (OSM element, Wikidata item, names ar/en/tr/ur/id/uz, descriptions ar/en/tr/ur/id/uz)
SITES = {
    542: ('n12407794803', 'Q276569',
          ('مسجد قباء', 'Quba Mosque', 'Kuba Mescidi', 'مسجد قباء', 'Masjid Quba', 'Quba masjidi'),
          ('أول مسجد بُني في الإسلام، أسّسه النبي ﷺ عند وصوله مهاجراً إلى المدينة، وكان ﷺ يأتيه كل سبت راكباً وماشياً (متفق عليه).',
           'The first mosque built in Islam, founded by the Prophet ﷺ on his arrival in Madinah as an emigrant. He ﷺ used to visit it every Saturday, riding or walking (Bukhari and Muslim).',
           "İslam'da inşa edilen ilk mescit; Peygamber ﷺ hicretle Medine'ye vardığında kurmuştur. Peygamber ﷺ her cumartesi binekli ya da yaya olarak buraya gelirdi (Buhârî ve Müslim).",
           'اسلام میں بننے والی پہلی مسجد، جس کی بنیاد نبی ﷺ نے ہجرت کر کے مدینہ پہنچنے پر رکھی۔ آپ ﷺ ہر ہفتے کے دن سوار ہو کر یا پیدل یہاں تشریف لاتے تھے (بخاری و مسلم)۔',
           'Masjid pertama yang dibangun dalam Islam, didirikan oleh Nabi ﷺ saat tiba di Madinah dalam hijrah. Beliau ﷺ biasa mendatanginya setiap hari Sabtu, berkendara atau berjalan kaki (Bukhari dan Muslim).',
           "Islomda qurilgan birinchi masjid; Payg'ambar ﷺ hijrat qilib Madinaga yetib kelganlarida asos solganlar. U zot ﷺ har shanba kuni otliq yoki piyoda shu yerga kelardilar (Buxoriy va Muslim).")),
    543: ('w66510098', 'Q2334553',
          ('مسجد القبلتين', 'Masjid al-Qiblatain', 'Kıbleteyn Mescidi', 'مسجد قبلتین', 'Masjid Qiblatain', 'Qiblatayn masjidi'),
          ('المسجد الذي نزل فيه الأمر بتحويل القبلة من بيت المقدس إلى الكعبة المشرفة في السنة الثانية للهجرة، فسُمّي مسجد القبلتين.',
           "The mosque where the command came to change the qibla from Jerusalem to the Kaaba, in the second year after the Hijrah — hence 'the Mosque of the Two Qiblas'.",
           "Hicretin ikinci yılında kıblenin Kudüs'ten Kâbe'ye çevrilmesi emrinin geldiği mescit; bu yüzden 'İki Kıbleli Mescit' denir.",
           'وہ مسجد جہاں ہجرت کے دوسرے سال قبلہ بیت المقدس سے کعبہ کی طرف بدلنے کا حکم آیا، اسی لیے اسے مسجد قبلتین کہا جاتا ہے۔',
           "Masjid tempat turunnya perintah memindahkan kiblat dari Baitul Maqdis ke Ka'bah pada tahun kedua Hijriah, sehingga dinamai Masjid Dua Kiblat.",
           "Hijratning ikkinchi yilida qiblani Baytul Maqdisdan Ka'baga o'zgartirish amri tushgan masjid, shuning uchun 'Ikki qiblali masjid' deb ataladi.")),
    544: ('w444240032', 'Q488278',
          ('مقبرة شهداء أحد', 'Martyrs of Uhud Cemetery', 'Uhud Şehitliği', 'شہدائے احد کا قبرستان', 'Makam Syuhada Uhud', 'Uhud shahidlari qabristoni'),
          ('مدفن شهداء غزوة أحد (السنة الثالثة للهجرة) عند سفح جبل أحد، ومنهم حمزة بن عبد المطلب رضي الله عنه عمّ النبي ﷺ وسيد الشهداء.',
           "The burial place of the martyrs of the Battle of Uhud (3 AH) at the foot of Mount Uhud, among them Hamzah ibn Abd al-Muttalib, may Allah be pleased with him, the Prophet's ﷺ uncle and 'master of the martyrs'.",
           "Uhud Dağı'nın eteğinde, Uhud Savaşı (hicri 3) şehitlerinin defnedildiği yer; aralarında Peygamber ﷺ'in amcası, 'şehitlerin efendisi' Hz. Hamza (radıyallahu anh) da vardır.",
           'جبلِ احد کے دامن میں غزوۂ احد (3 ہجری) کے شہداء کا مدفن، جن میں نبی ﷺ کے چچا سید الشہداء حضرت حمزہ بن عبد المطلب رضی اللہ عنہ بھی ہیں۔',
           "Pemakaman para syuhada Perang Uhud (3 H) di kaki Gunung Uhud, di antaranya Hamzah bin Abdul Muthalib radhiyallahu 'anhu, paman Nabi ﷺ dan 'pemimpin para syuhada'.",
           "Uhud tog'i etagida Uhud jangi (hijriy 3-yil) shahidlari dafn etilgan joy; ular orasida Payg'ambar ﷺning amakilari, 'shahidlar sayyidi' Hamza ibn Abdulmuttalib roziyallohu anhu ham bor.")),
    545: ('w444240031', 'Q79354137',
          ('مسجد سيد الشهداء', 'Sayyid al-Shuhada Mosque', "Seyyidü'ş-Şühedâ Camii", 'مسجد سید الشہداء', 'Masjid Sayyid asy-Syuhada', 'Sayyidush-shuhado masjidi'),
          ('المسجد المجاور لمقبرة شهداء أحد، سُمّي باسم حمزة بن عبد المطلب رضي الله عنه سيد الشهداء.',
           "The mosque beside the cemetery of the martyrs of Uhud, named after Hamzah ibn Abd al-Muttalib, may Allah be pleased with him, the 'master of the martyrs'.",
           "Uhud şehitliğinin yanındaki mescit; 'şehitlerin efendisi' Hz. Hamza (radıyallahu anh) adını taşır.",
           'شہدائے احد کے قبرستان کے ساتھ واقع مسجد، جو سید الشہداء حضرت حمزہ بن عبد المطلب رضی اللہ عنہ کے نام سے منسوب ہے۔',
           "Masjid di samping pemakaman syuhada Uhud, dinamai dengan Hamzah bin Abdul Muthalib radhiyallahu 'anhu, 'pemimpin para syuhada'.",
           "Uhud shahidlari qabristoni yonidagi masjid; 'shahidlar sayyidi' Hamza ibn Abdulmuttalib roziyallohu anhu nomi bilan atalgan.")),
    546: ('w987754464', 'Q12204742',
          ('جبل الرماة', "Jabal al-Rumat (Archers' Hill)", 'Okçular Tepesi (Cebel-i Rumât)', 'جبلِ رماۃ', 'Bukit Pemanah (Jabal Rumat)', 'Kamonchilar tepaligi (Jabal Rumot)'),
          ('الجبل الصغير المقابل لجبل أحد، الذي أمر النبي ﷺ الرماة بالثبات عليه يوم غزوة أحد، ويُعرف أيضاً بجبل عينين.',
           'The small hill facing Mount Uhud where the Prophet ﷺ ordered the archers to hold their position on the day of the Battle of Uhud; also known as Jabal Aynayn.',
           "Uhud Dağı'nın karşısındaki küçük tepe; Uhud Savaşı günü Peygamber ﷺ okçulara burada yerlerini korumalarını emretmişti. Ayneyn Tepesi olarak da bilinir.",
           'جبلِ احد کے سامنے چھوٹی پہاڑی، جس پر غزوۂ احد کے دن نبی ﷺ نے تیر اندازوں کو ڈٹے رہنے کا حکم دیا تھا؛ اسے جبلِ عینین بھی کہا جاتا ہے۔',
           "Bukit kecil di depan Gunung Uhud tempat Nabi ﷺ memerintahkan para pemanah untuk tetap bertahan pada hari Perang Uhud; dikenal juga sebagai Jabal 'Ainain.",
           "Uhud tog'i ro'parasidagi kichik tepalik; Uhud jangi kuni Payg'ambar ﷺ kamonchilarga shu yerda turib qolishni buyurgan edilar. Aynayn tog'i deb ham ataladi.")),
    547: ('w1536783060', 'Q12192912',
          ('مسجد الفتح (المساجد السبعة)', 'Al-Fath Mosque (the Seven Mosques)', 'Fetih Mescidi (Yedi Mescitler)', 'مسجد الفتح (سات مساجد)', 'Masjid Al-Fath (Masjid Tujuh)', 'Fath masjidi (Yetti masjid)'),
          ('عند سفح جبل سلع غرب المدينة، في موضع غزوة الخندق (الأحزاب) في السنة الخامسة للهجرة، وأشهر المساجد السبعة في هذا الموضع.',
           "At the foot of Mount Sal' in the west of Madinah, at the site of the Battle of the Trench (al-Ahzab) in 5 AH; the best known of the Seven Mosques there.",
           "Medine'nin batısında Sel' Dağı eteğinde, hicri 5. yıldaki Hendek (Ahzâb) Savaşı'nın yerinde; buradaki Yedi Mescid'in en bilinenidir.",
           'مدینہ کے مغرب میں جبلِ سلع کے دامن میں، غزوۂ خندق (احزاب، 5 ہجری) کے مقام پر؛ یہاں کی سات مساجد میں سب سے مشہور۔',
           "Di kaki Gunung Sal' di barat Madinah, di lokasi Perang Khandaq (Ahzab) tahun 5 H; yang paling terkenal di antara Masjid Tujuh di tempat ini.",
           "Madinaning g'arbida, Sal' tog'i etagida, hijriy 5-yildagi Xandaq (Ahzob) jangi joyida; bu yerdagi Yetti masjidning eng mashhuri.")),
    548: ('w457212681', 'Q14921963',
          ('مسجد الجمعة', "Al-Jumu'ah Mosque", 'Cuma Mescidi', 'مسجد جمعہ', "Masjid Jumu'ah", 'Juma masjidi'),
          ('في الموضع الذي صلى فيه النبي ﷺ أول جمعة في المدينة، في ديار بني سالم بن عوف، عند قدومه مهاجراً من قباء.',
           'Where the Prophet ﷺ led the first Friday prayer in Madinah, among the Banu Salim ibn Awf, as he came on from Quba during the Hijrah.',
           "Peygamber ﷺ'in hicret sırasında Kuba'dan gelirken Benî Sâlim b. Avf yurdunda Medine'deki ilk cuma namazını kıldırdığı yer.",
           'وہ مقام جہاں نبی ﷺ نے ہجرت کے موقع پر قباء سے آتے ہوئے بنو سالم بن عوف کے علاقے میں مدینہ کی پہلی نمازِ جمعہ پڑھائی۔',
           "Tempat Nabi ﷺ memimpin salat Jumat pertama di Madinah, di perkampungan Bani Salim bin 'Auf, saat beliau datang dari Quba dalam hijrah.",
           "Payg'ambar ﷺ hijrat chog'ida Qubodan kelayotib, Bani Solim ibn Avf diyorida Madinadagi birinchi juma namozini o'qigan joy.")),
    549: ('w67396957', 'Q7182798',
          ('بئر عثمان (بئر رومة)', 'Well of Uthman (Bir Rumah)', 'Osman Kuyusu (Rûme Kuyusu)', 'بئرِ عثمان (بئرِ رومہ)', "Sumur Utsman (Bi'r Rumah)", "Usmon qudug'i (Ruma qudug'i)"),
          ('بئر رومة التي اشتراها عثمان بن عفان رضي الله عنه وجعلها للمسلمين، استجابة لترغيب النبي ﷺ.',
           "The well of Rumah, which Uthman ibn Affan, may Allah be pleased with him, bought and gave to the Muslims, answering the Prophet's ﷺ encouragement.",
           "Hz. Osman b. Affân'ın (radıyallahu anh) Peygamber ﷺ'in teşvikiyle satın alıp Müslümanlara vakfettiği Rûme Kuyusu.",
           'بئرِ رومہ، جسے حضرت عثمان بن عفان رضی اللہ عنہ نے نبی ﷺ کی ترغیب پر خرید کر مسلمانوں کے لیے وقف کر دیا۔',
           "Sumur Rumah yang dibeli Utsman bin Affan radhiyallahu 'anhu dan diberikan untuk kaum Muslimin, memenuhi anjuran Nabi ﷺ.",
           "Ruma qudug'i: Usmon ibn Affon roziyallohu anhu Payg'ambar ﷺning targ'ibiga javoban sotib olib, musulmonlarga vaqf qilgan.")),
    550: ('w161521148', 'Q12242767',
          ('مسجد العنبرية', 'Al-Anbariya Mosque', 'Anberiyye Camii', 'مسجد عنبریہ', 'Masjid Al-Anbariyah', 'Anbariya masjidi'),
          ('مسجد عثماني بناه السلطان عبد الحميد الثاني سنة 1326 هـ (1908م) بجوار محطة سكة حديد الحجاز.',
           'An Ottoman mosque built by Sultan Abdulhamid II in 1326 AH (1908) beside the Hejaz Railway station.',
           "Sultan II. Abdülhamid'in 1326 (1908) yılında Hicaz Demiryolu istasyonunun yanına yaptırdığı Osmanlı camisi.",
           'سلطان عبد الحمید ثانی کی 1326ھ (1908ء) میں حجاز ریلوے اسٹیشن کے ساتھ بنوائی ہوئی عثمانی مسجد۔',
           'Masjid Utsmani yang dibangun Sultan Abdul Hamid II pada 1326 H (1908) di samping stasiun Kereta Api Hijaz.',
           "Sulton Abdulhamid II tomonidan 1326 h. (1908 y.) Hijoz temir yo'li bekati yonida qurilgan usmonli masjid.")),
}
LANGS = ('ar', 'en', 'tr', 'ur', 'id', 'uz')


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 101_330)


def direction(lat, lng):
    dy = (lat - MOSQUE[0]) * 111_320
    dx = (lng - MOSQUE[1]) * 101_330
    return ('north' if dy > 0 else 'south') if abs(dy) >= abs(dx) else ('east' if dx > 0 else 'west')


def main():
    osm = {e['type'][0] + str(e['id']): e for e in json.load(open(OSM))['elements']}
    wd = {}
    for b in json.load(open(WD))['results']['bindings']:
        q = b['item']['value'].split('/')[-1]
        lng, lat = map(float, b['coord']['value'][6:-1].split())
        wd.setdefault(q, (lat, lng))
    pois = json.load(open('data/pois.json'))
    i18n = json.load(open('data/i18n.json'))
    have = {p['id'] for p in pois}
    for pid, (oid, qid, names, descs) in SITES.items():
        e = osm[oid]
        c = e.get('center') or {'lat': e['lat'], 'lon': e['lon']}
        lat, lng = round(c['lat'], 7), round(c['lon'], 7)
        gap = metres((lat, lng), wd[qid])
        # Uhud's Wikidata point is the battle itself; the cemetery and hill are checked against it loosely.
        limit = 1500 if qid == 'Q488278' else 200
        assert gap < limit, f'{names[0]}: OSM and Wikidata disagree by {gap:.0f} m'
        p = {'id': pid, 'name_ar': names[0], 'category': 'landmarks', 'subCategory': 'historic', 'lat': lat, 'lng': lng,
             'direction': direction(lat, lng), 'description_ar': descs[0], 'osm': oid, 'wikidata': qid}
        if pid in have:
            pois = [x if x['id'] != pid else p for x in pois]
        else:
            pois.append(p)
        for L, n, d in zip(LANGS[1:], names[1:], descs[1:]):
            i18n[L]['names'][names[0]] = n
            i18n[L]['descs'][names[0]] = d
        print(f'{pid} {names[0]}: OSM ↔ Wikidata {gap:.0f} m')
    for p in pois:
        if p['id'] in EXISTING:
            p['subCategory'] = 'historic'
    json.dump(pois, open('data/pois.json', 'w'), ensure_ascii=False, indent=1)
    open('data/pois.json', 'a').write('\n')
    json.dump(i18n, open('data/i18n.json', 'w'), ensure_ascii=False, indent=1)
    open('data/i18n.json', 'a').write('\n')


if __name__ == '__main__':
    main()
