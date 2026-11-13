# عارض البيئة متعدد الفئات في Blender (أرضية/شوارع/مسارات/أشجار/مباني/إضاءة)

- **المشروع**: خريطة المسجد النبوي (دليل زوار المسجد النبوي) — `masjidalnabawi`
- **التاريخ**: [2026-11-11]
- **الفرع**: `feat/urban-3d-surroundings`
- **الحالة**: أداة جاهزة ومُتحقَّق منها على مشهد اصطناعي musمّى؛ **لا يُشحن أي شيء اصطناعي للخريطة**. تغذيتها بالبيانات المعتمدة لاحقًا.
- **قرار المالك [2026-11-11]**: «وسّع أنبوب Blender لكل الفئات» — أدوات للشوارع/المسارات/الأشجار/الإضاءة/الأرضية تُختبر على مشهد اصطناعي musمّى بوضوح أنه ليس جغرافيا حقيقية ولا يُشحن، ثم يُغذّى بالبيانات المعتمدة.

---

## 1. ما أُضيف

`scripts/build-environment-glb.py` — عارض Blender (bpy) headless يحوّل وصف مشهد JSON إلى GLB مجمّع واحد، بفئات:

| الفئة | الإدخال | الهندسة الناتجة |
|---|---|---|
| `ground` | `{sizeM, color?}` | مستوٍ أرضي عند y=0 |
| `streets` | `[{id,widthM,path:[[lng,lat]…]}]` | خطوط → أشرطة إسفلت مسطحة |
| `paths` | `[{id,widthM,path:[…]}]` | خطوط → أشرطة مشاة أفتح |
| `trees` | `[{id,pos:[lng,lat],heightM?,canopyM?}]` | نقاط → أشجار low-poly (جذع+تاج) **مشتركة mesh واحد** (instancing) |
| `buildings` | `[{id,kind,heightM,footprint:[…],approved?}]` | مضلعات → منشورات (prisms) بلوحة Kind |
| `lighting` | `{preset:"day"\|"night"}` | يلون الأرضية ويقود معاينات Blender |

- الإطار يطابق كل glTF ترسمه الخريطة (`glb-layer.ts`): X=شرق، Y=أعلى، Z=جنوب، أمتار Web-Mercator حول مرساة المسجد، `export_yup=False`.
- اللوحة نفس `KIND_BASE` في `src/map/urban-layer.ts` (بيج/جرانيت دافئ)، وألوان أرضية نهار/ليل مستمدة من `src/map/scene-light.ts`.
- الأشرطة مرفوعة قليلًا فوق الأرضية ومتدرجة الارتفاع حسب الترتيب لمنع depth-fighting عند التقاطعات بمقياس المدينة.
- الإضاءة هنا للمعاينة فقط؛ الخريطة الحية تُضيء نماذجها عبر `scene-light.ts`.

## 2. Zero Guessing وحاجز الشحن

- **المباني**: تُرسم فقط إذا كان المشهد `meta.synthetic=true` (عرض musمّى) أو كل سجل `approved:true` مع `heightM` رقمي >0. السجلات غير المعتمدة تُسقط ولا تُخمَّن.
- **حاجز الشحن**: أي مشهد `synthetic` يُرفض كتابته تحت `public/models/` (مجلد الشحن). المخرج الافتراضي بلا وسائط هو `/tmp/environment-demo.glb`. تحقّق فعلي: محاولة كتابة مشهد اصطناعي إلى `public/models/environment.glb` طُبعت `ENV_GLB refused … Nothing written`.
- `data/urban-approved.json` ما زال غائبًا و`public/models/urban-3d.json` فارغًا؛ لا `urban-3d.glb` ولا `environment.glb` مشحون.
- الأشجار في العرض الاصطناعي زخرفية تجريبية، **ليست مواقع حقيقية**؛ لا يوجد مصدر بيانات أشجار موثّق بعد.

## 3. التشغيل

```bash
npm run build:env:glb -- [scene.json] [output.glb]
# أو مباشرة:
Blender --background --python scripts/build-environment-glb.py -- scene.json out.glb
```
مثال musمّى جاهز: `scripts/environment-scene.example.json` (شبكة تجريدية، `meta.synthetic=true`).

## 4. التحقق [2026-11-11]

- headless على المثال: `ENV_GLB ok [SYNTHETIC DEMO]: buildings=4, ground=1, paths=1, streets=2, trees=6`.
- بنية GLB: 8 meshes (4 kinds + ground + path + street + tree)، 9 materials بألوان اللوحة الصحيحة، 13 nodes؛ **الأشجار الستة تشترك mesh واحد** (mesh#7 → 6 nodes) = instancing سليم.
- معاينات Workbench (CPU) نهار/ليل `/tmp/env-demo-day.png` و`/tmp/env-demo-night.png`: مبانٍ بألوان اللوحة، شوارع متصالبة نظيفة، مسار مشاة، أشجار، أرضية رملية نهارًا/كحلية ليلًا.
- `tsc --noEmit` نظيف؛ biome نظيف؛ كامل_UNIT: **1111 passed + 3 expected fail** (39 ملفًا)، gồm حارس الشحن الجديد.
- حارس شحن vitest (نقي JS، بلا Blender، آمن لـ CI): لا `environment.glb` مشحون، والمثال `meta.synthetic=true` وموسوم SYNTHETIC.

## 5. ما لم يُفعل / التالي

- لا commit/PR/دمج/نشر. لا مكتبات جديدة (bpy خارجي موجود).
- لم تُربط بالبيانات الحقيقية بعد: الشوارع/المسارات يمكن تغذيتها من `data/streets.json`/`routing.json` (OSM موثّق)، والمباني/الفنادق من بوابة الاعتماد بعد تدقيق OSM+navQ واعتماد المالك البصري (الخطة [2026-11-10]). الأشجار تحتاج مصدرًا موثّقًا أو قرار مالك.
- الخطوة التالية المقترحة: تغذية العارض بالشوارع/المسارات الموثّقة كطبقة معاينة، وإبقاء المباني خلف البوابة.