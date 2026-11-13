# بصمات المباني — Microsoft Global ML Building Footprints

آخر تحديث: [2026-11-11]

مصدر بديل أدق لمضلعات المباني حول الحرم، يُستخدم في تدقيق الحلقة الأولى (0–250 م) بدل مضلعات OSM الخشنة التي لاحظ المالك عدم دقتها مقابل صور القمر الصناعي.

## المصدر والترخيص

- المصدر: [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints).
- الترخيص: **CDLA-Permissive-2.0** (يسمح بإعادة النشر مع النسب).
- الاشتقاق: صور أقمار Microsoft/Bing (Maxar/Airbus/IGN) عبر تجزئة دلالية ثم تحويل إلى مضلعات. **ليس Google وليس نظام الهيئة navQ.**
- الإصدار المستخدم: `2026-08-13`، المنطقة `KingdomofSaudiArabia`، التربيع `quadkey=122133200` (المستوى 9).

## الملف

`haram-bbox-2026-11-11.json`: قصاصة_bbox حول الحرم (غرب 39.600، شرق 39.622، جنوب 24.458، شمال 24.478) من بلاطة التربيع أعلاه، بصيغة GeoJSON FeatureCollection مع بيانات المصدر في الأعلى. عدد المعالم 1670.

## الارتفاعات والثقة

بصمات السعودية تحمل `height=-1` و`confidence=-1` (لا تقدير ارتفاع منشور لهذه المنطقة). لذلك **لا تُستنتج الارتفاعات ولا المداخل**؛ تبقى `pending_owner` / `not_supplied` في التدقيق. الشكل فقط هو المستفاد من Microsoft.

## إعادة التوليد

```sh
# 1) تنزيل جدول الروابط واختيار رابط التربيع 122133200
curl -sL "https://bfppub.blob.core.windows.net/%24web/2026-08-13/dataset-links.csv" -o /tmp/links.csv
grep ",122133200," /tmp/links.csv
# 2) تنزيل البلاطة (csv.gz محتواه GeoJSONL) وفكها وقصّها إلى الـbbox أعلاه
#    ثم حفظها بهذا الملف مع ترويسة المصدر.
```

الاختيار النهائي للحلقة (خارج السور، ≤250 م، استبعاد عابر السور) يتم في `scripts/audit-urban-ring1-ms.mjs` وليس في هذا الملف.

## الاستهلاك والضوابط

- يستهلكه `scripts/audit-urban-ring1-ms.mjs` لإنتاج أطلس التدقيق المرقّمة (مرشح للمراجعة، **غير معتمد**).
- الاسم/النوع يُربط من OSM (تطابق ≥ 0.5) أو من نقاط الفنادق/المطاعم في `data/pois.json`، وكل ربط غير موثق.
- لا يُكتب أي مبنى إلى `data/urban-approved.json` ولا إلى `public/models/` من هذا المصدر؛ بوابة الاعتماد تبقى مغلقة حتى اعتماد المالك البصري.
- النسب عند العرض: Footprints © Microsoft CDLA-Permissive-2.0 · Names © OpenStreetMap ODbL · Tiles © Esri.