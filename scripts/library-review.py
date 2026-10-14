"""Write docs/library/review/<id>.md from data/library/companions.json: one page per companion for
the reviewer, every fact with its sources (links to the page) and what it still needs.

    python3 scripts/library-review.py
"""
import json, os

LABELS = [('full_name', 'الاسم والنسب'), ('titles', 'الألقاب'), ('born', 'المولد'), ('islam', 'متى أسلم'), ('islam_story', 'قصة إسلامه'),
          ('virtues', 'مناقبه (من صحيح البخاري وكتب التراجم)'), ('known_for', 'ما اشتهر به'), ('stories', 'قصص ومواقف'), ('death', 'وفاته'), ('burial', 'مدفنه')]

d = json.load(open('data/library/companions.json', encoding='utf-8'))
S = d['sources']
pois = {p['id']: p['name_ar'] for p in json.load(open('data/pois.json', encoding='utf-8'))}
os.makedirs('docs/library/review', exist_ok=True)


def src_line(src):
    out = []
    for s in src:
        key, where = s[0], s[1]
        url = s[2] if len(s) > 2 else S[key].get('u')
        name = S[key]['t'] + f' — {where}'
        out.append(f'[{name}]({url})' if url else name)
    return '؛ '.join(out)


def fact(f, title=None):
    lines = [f'**{title}**' if title else '', f['ar'], f'> المصادر: {src_line(f["src"])}']
    if f.get('place'):
        lines.append(f'> على الخريطة: {pois.get(f["place"], f["place"])}')
    if f.get('needs'):
        lines.append(f'> ⚠️ **ينقصه:** {f["needs"]}')
    return '\n\n'.join(l for l in lines if l)


for c in d['companions']:
    out = [f'# {c["name"]} — للمراجعة', '',
           f'- **الحالة:** {"مسودة (لم تُعتمد)" if c["review"] == "draft" else "معتمدة"}.',
           '- **على المراجع:** التأكد من صحة كل معلومة ومن مطابقتها للمصدر المذكور، ومن درجة كل خبر.',
           '- **للتصحيح:** اكتب الملاحظة تحت المعلومة نفسها.',
           '- **للاعتماد:** الاسم والتاريخ في آخر الصفحة.', '']
    for key, label in LABELS:
        v = c.get(key)
        if not v:
            continue
        out.append(f'## {label}')
        if isinstance(v, list):
            for i, f in enumerate(v, 1):
                out.append(fact(f, f.get('title') or f'{i}.'))
                out.append('')
        else:
            out.append(fact(v))
            out.append('')
    if c.get('places'):
        out.append('## مواضعه على الخريطة')
        out += [f'- {pois.get(p, p)}' for p in c['places']]
        out.append('')
    out += ['---', '**اعتماد المراجع:** الاسم: ________  التاريخ: ________  الملاحظات: ________', '']
    open(f'docs/library/review/{c["id"]}.md', 'w', encoding='utf-8').write('\n'.join(out))
    print('docs/library/review/' + c['id'] + '.md')
