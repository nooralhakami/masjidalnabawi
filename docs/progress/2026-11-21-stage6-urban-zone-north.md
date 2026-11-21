# المرحلة 6 — المنطقة 3 (الشمال 101–181): المحيط العمراني الشمالي ثلاثي الأبعاد (`2026-11-21`)

> **التاريخ:** `[2026-11-21]` · **الفرع:** `feat/sliding-domes`

---

## 1. ملخص ما تغيّر للزائر
- **ظهور 61 فندقًا معتمدًا في المنطقة الشمالية (`101–181`):**
  - استُكمل دمج جميع فنادق المنطقة الشمالية المطابقة في دليل الهيئة 2026 (`32` فندقًا جديدًا `2104..2180` + إعادة استخدام `29` معلمًا موجودًا `701..737` شاملًا إنقاذ `#169 أركان المنار` عبر `POI 732` + دمج المكرر `#171 شيراتون` في `alias` للمعلم `734` `#140` + استبعاد `#166` و`#167` لغياب إحداثياتهما)، ليصل إجمالي الفنادق المعتمدة الظاهرة إلى **`157` فندقًا** (`57` جنوبًا + `39` غربًا + `61` شمالًا)، وإجمالي المعالم في `data/pois.json` إلى **`464`** (`394` مرئيًا في «الكل»، و`407` في إحصائية صفحة الهبوط)، مع إبقاء `5` فنادق غير معتمدة والمطاعم ومناطق الكراسي مخفية.
  - تغطي البصمات **`59` فندقًا شماليًا** (`34` MS مفردة + `19` مقسّمة مبدئيًا عبر `9` كتل مشتركة + `6` OSM غير متداخلة `#101, #127, #140, #151, #165, #169`)، بينما يبقى `#113` (`POI 710`) و`#148` (`POI 720`) نقطتين بلا بصمة، مع تقليم الصف الأمامي الشمالي شمال خط العرض `24.471075` لضمان بُعد `>= 3.5 م` عن السور الشمالي وتفادي أي تداخل مع مجسمات الحرم.
- **نقر ثلاثي الأبعاد وتخفيت العائق المستقل (`A8`):**
  - تعمل عتامة العائق (`A8`: `0.28–0.32`) للمباني الشمالية عند النظر جنوبًا (`180°`) نحو القبة الخضراء بشكل مستقل مع بقاء مباني الجنوب (`0°`) والغرب (`90°`) معتمة ما لم تدخل زاوية النظر.
  - تفعيل النقر المباشر على مجسمات الـ`59` فندقًا شماليًا (`hotelAt` + `pickApprovedBuildingRay`) لفتح `PlaceCard` فورًا عند لمس واجهة أي فندق أو سطحه في 3D.
  - تصفية المباني الرمادية المتداخلة من `saqifah-3d.ts` (`25 ← 17` مبنى محيطًا غير متداخل) بعد تغطية `#165 إعمار إيليت` (`w261731120`) وبقية فنادق الشمال بمجسمات Blender المكسوّة.

---

## 2. الملفات المضافة والمحدّثة
- `scripts/build-urban-north-data.py` ← تحديث `data/urban-approved.json` (`stage-6-zones-south-west-north`, `157` فندقًا، `355` ممر شارع وممشى، `urbanPropsByZone.north`: `85` عمود إنارة + `65` نخلة) و`data/pois.json` (`464` معلمًا، `162` فندقًا) و`data/i18n.json` (26 لغة) ولوحة المراجعة `الملفات المؤقتة/لوحة-مراجعة-الشمال-المرحلة-6.png`.
- `scripts/build-urban-glb.py` (`--zone south|west|north|all`) ← تصدير `public/models/urban-north-stage6.glb` (`683,132 B` خام / **`200,766 B` (`196.1 KiB`) مضغوطًا gzip**، `59` مبنى) بجانب `urban-south-stage6.glb` (`237.0 KiB` gzip، `52` مبنى) و`urban-west-stage6.glb` (`184.4 KiB` gzip، `38` مبنى).
- `src/domain/urban-approval.ts` (`UrbanZone`, دعم `'north'` في `urbanOpacityForCamera` عند `180°`), `src/map/urban-3d.ts` (`URBAN_NORTH_GLB_URL`, `URBAN_ZONES = [south, west, north]`), `src/data/provenance.ts`.
- الاختبارات: `tests/unit/urban-stage5.test.ts`, `tests/unit/data.test.ts`, `tests/unit/domain.test.ts`, `tests/unit/parity.test.ts`, `tests/unit/interior-and-shortcuts.test.ts`, `tests/unit/streets.test.ts`, `tests/e2e/landing.spec.ts`, `tests/e2e/main-screen.spec.ts`, `tests/e2e/extras.spec.ts`.

---

## 3. نتائج التحقق النهائية (بعد آخر تعديل فعلي)
- **`npx tsc --noEmit`**: `0` أخطاء.
- **`npx biome check`**: `0` أخطاء عبر `274` ملفًا (تحذير قديم وحيد في `scripts/fence-model.mjs:395`).
- **`npx vitest run --maxWorkers=1`**: **51 / 51 ملفًا، 1335 ناجحًا | 3 متوقع فشلها (1338)** في `202.36s`.
- **`npm run build` + `check-build.mjs`**: ناجح (`✓ built in 1.63s`، `74 entries / 6495.37 KiB`، جزء `urban-3d` الكسول `6.85 KiB gzip`، و`SW mentions urban GLBs: false`).
- **Chrome Metal (`1280×800`, عبر `verify_stage6_north.mjs`):**
  - `2D check`: `{"errors":[],"leaked2d":[]}`.
  - `Loaded Stage 6 GLBs`: `['urban-north-stage6.glb', 'urban-south-stage6.glb', 'urban-west-stage6.glb']`.
  - `Day 3D frame timing`: `p50=16.7 ms, p95=16.7 ms`.
  - **النقر المباشر 3D (`فندق دار التقوى 701` عند `(640, 326)`، `poiHitsCount = 0`)**: فتح بطاقته مباشرة؛ ومراجعة اللقطات الخمس (`stage6-north-{aerial-day,closeup-day,a8-fade,night,3d-building-click}.png`) ولوحة `الملفات المؤقتة/لوحة-مراجعة-الشمال-المرحلة-6.png`.
- **اختبارات Playwright E2E المتأثرة** (`landing.spec.ts`, `main-screen.spec.ts`, `extras.spec.ts`, `--workers=1 --retries=1`): **49 / 49 ناجحًا** (`41 passed + 8 flaky` نجحت في الإعادة الأولى بسبب إعادة ضبط SwiftShader GPU في headless Chrome؛ لم تُشغّل بقية الملفات الـ13 أو القياس على `vivo V2250`).
