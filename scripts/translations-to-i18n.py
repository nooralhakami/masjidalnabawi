"""Builds the extra languages (Bengali, French, Persian, Russian, Malay, Hausa, Malayalam, Swahili, Pashto, Somali, Tamil, Hindi, Bosnian, German, Chinese, Amharic) into data/i18n.json.

Sources: docs/translations/<lang>.json — hand translations of the interface, gate names, landmark and
historic names and descriptions, plus sentence templates for the generated descriptions (hotels,
restaurants, shops), which are rebuilt here from the English ones so they follow every data rebuild.

Run it last, after the place scripts:

    python3 scripts/places-from-osm.py && python3 scripts/historic-from-osm.py && \
    python3 scripts/shops-from-osm.py && python3 scripts/translations-to-i18n.py

If a place or text was added since, the script stops and lists what still needs translating.
Names of generated places (hotels, restaurants, shops) stay as on the signs: English, or for
Persian and Pashto the same name Urdu uses (Arabic script).
"""
import json, re, sys

EXTRA = ('bn', 'fr', 'fa', 'ru', 'ms', 'ha', 'ml', 'sw', 'ps', 'so', 'ta', 'hi', 'bs', 'de', 'zh', 'am')
# English generated descriptions → template name and fields (see places-from-osm.py / shops-from-osm.py).
PATTERNS = [
    ('hotel_stars', r'^A (?P<stars>\d+)-star hotel in the (?P<district>.+?) district of the central area, about (?P<m>\d+) m from Gate (?P<gate>\d+)\.$'),
    ('hotel', r'^A hotel in the (?P<district>.+?) district of the central area, about (?P<m>\d+) m from Gate (?P<gate>\d+)\.$'),
    ('central', r'^In the (?P<district>.+?) district of the central area, about (?P<m>\d+) m from Gate (?P<gate>\d+)\.$'),
    ('far', r"^(?P<kind>.+?), about (?P<km>[\d.]+) km from the Prophet's Mosque\.$"),
]


def generated(src, en_text):
    """The translated sentence for a generated English description, or None."""
    for name, pat in PATTERNS:
        m = re.match(pat, en_text)
        if not m:
            continue
        f = m.groupdict()
        if 'district' in f:
            f['district'] = src['districts'].get(f['district'])
        if 'kind' in f:
            f['kind'] = src['kinds'].get(f['kind'])
        return None if None in f.values() else src['templates'][name].format(**f)
    return None


def main():
    i18n = json.load(open('data/i18n.json'))
    en, ar = i18n['en'], i18n['ar']
    missing = []
    for L in EXTRA:
        src = json.load(open(f'docs/translations/{L}.json'))
        pack = dict(src['pack'])
        if sorted(src['ui']) != sorted(ar['ui']):
            missing += [f'{L} ui.{k}' for k in sorted(set(ar['ui']) - set(src['ui']))]
        pack['ui'] = {k: src['ui'][k] for k in ar['ui'] if k in src['ui']}
        missing += [f'{L} gi.{k}' for k in en['gi'] if k not in src['gi']]
        pack['gi'] = {k: src['gi'][k] for k in en['gi'] if k in src['gi']}
        fallback = i18n[src.get('name_from', 'en')]['names']
        pack['names'] = {k: src['names'].get(k) or fallback[k] for k in en['names']}
        pack['descs'] = {}
        for k, v in en['descs'].items():
            d = src['descs'].get(k) or generated(src, v)
            if d:
                pack['descs'][k] = d
            else:
                missing.append(f'{L} descs: {k} — {v}')
        i18n[L] = pack
    if missing:
        print('Still to translate (add to docs/translations/<lang>.json):', *missing, sep='\n  ')
        sys.exit(1)
    json.dump(i18n, open('data/i18n.json', 'w'), ensure_ascii=False, indent=1)
    open('data/i18n.json', 'a').write('\n')
    print('languages:', ', '.join(i18n))


if __name__ == '__main__':
    main()
