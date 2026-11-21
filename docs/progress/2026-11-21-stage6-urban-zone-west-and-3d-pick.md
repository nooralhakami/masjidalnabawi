# المرحلة 6 — المنطقة 2 (الغرب 203–256) والنقر المباشر على المباني ثلاثية الأبعاد (`2026-11-21`)

> **التاريخ:** `[2026-11-21]` · **الفرع:** `feat/sliding-domes`

---

## 1. ملخص ما تغيّر للزائر
- **ظهور 39 فندقًا معتمدًا في المنطقة الغربية (`203–256`):**
  - استُكمل دمج جميع فنادق المنطقة الغربية المطابقة في فهرس دليل الهيئة 2026 (`37` فندقًا جديدًا `2203..2256` + إعادة استخدام المعلمين الموجودين `738` `#220` و`743` `#255`؛ مع إبقاء `#244 وورث ثروات` مستبعدًا لغياب إحداثياته) ليصل إجمالي الفنادق المعتمدة الظاهرة في الجنوب والغرب معًا إلى **`96` فندقًا** (`57` جنوبًا + `39` غربًا)، وإجمالي المعالم في `data/pois.json` إلى **`432`** (`333` مرئيًا في «الكل»، و`346` في إحصائية صفحة الهبوط)، مع إبقاء الـ`34` فندقًا غير المعتمدة والمطاعم ومناطق الكراسي مخفية.
  - تغطي البصمات **`38` فندقًا غربيًا** (`9` بصمات مفردة MS + `24` مقسّمة مبدئيًا بفواصل معمارية عبر `12` كتلة مشتركة + `5` بصمات OSM غير متداخلة `#218، #219، #220، #237، #255`)، بينما يبقى `#206` (`إعمار مكتان`) نقطة بدون بصمة، وتحمل جميع مباني الغرب ارتفاعات عرض 3D موسومة (`estimated_display_only`, `levels: null`، `10–14` دورًا دون عرضها كحقائق في `PlaceCard`).
- **النقر المباشر على مجسم الفندق ثلاثي الأبعاد لفتح بطاقته (`hotelAt` + `pickApprovedBuildingRay`):**
  - أصبح بمقدور الزائر في الوضع ثلاثي الأبعاد النقر أو اللمس مباشرةً على أي واجهة أو سقف لأي فندق معتمد (`90` مبنى في الجنوب والغرب) لفتح بطاقته (`PlaceCard`) فورًا، بدل الاقتصار على نقطة الدبوس العائمة أسفله.
  - يتم التقاط النقر بأشعة رياضية نقية (`pickApprovedBuildingRay` في `src/domain/urban-approval.ts`) عبر عكس مصفوفة المنظور المحفوظة (`lastMvp`) في `src/map/urban-3d.ts` مع أولوية الأقرب للكاميرا وحجب المباني الخلفية، ودون قراءة أي بكسلات GPU، بعد أسبقية النقرات الخاصة بالقباب والمظلات والأبواب.
- **إزالة التداخل مع الصناديق الرمادية (`saqifah-3d.ts`) وعزل شفافية المنطقة (`A8`):**
  - تصفية المباني الرمادية من `SURROUNDING_OSM_BUILDINGS` التي تتداخل مع بصمات المرحلة 6 المعتمدة (تخفيضها من `45` إلى `25` مبنى محيطًا غير متداخل) لمنع تداخل الأوجه (Z-fighting) مع أبراج الغرب المكسوّة في Blender.
  - دعم عتامة العائق (`A8`) لكل منطقة بشكل مستقل: تخفت مباني الغرب (`0.28–0.32`) عند النظر شرقًا (`90°`) نحو الحرم مع بقاء مباني الجنوب معتمة (`1.0`)، والعكس للجنوب عند النظر شمالًا (`0°`).

---

## 2. الملفات المضافة والمحدّثة
- `scripts/build-urban-west-data.py` ← تحديث `data/urban-approved.json` (`stage-6-zones-south-west`, `96` فندقًا، `265` ممر شارع وممشى، `urbanPropsByZone.west`: `85` عمود إنارة + `70` نخلة) و`data/pois.json` (`432` معلمًا) و`data/i18n.json` (26 لغة) ولوحة المراجعة `الملفات المؤقتة/لوحة-مراجعة-الغرب-المرحلة-6.png`.
- `scripts/build-urban-glb.py` (`--zone south|west|all`) ← تصدير `public/models/urban-west-stage6.glb` (`567,612 B` خام / **`188,846 B` (`184.4 KiB`) مضغوطًا gzip**، `38` مبنى) و`public/models/urban-south-stage6.glb` (`790,672 B` خام / **`242,667 B` (`237.0 KiB`) gzip**، `52` مبنى).
- `src/domain/urban-approval.ts` (`approvedFootprintBuildingsForZone`, `pickApprovedBuildingRay`, `urbanOpacityForCamera(..., zone)`).
- `src/map/urban-3d.ts` (`URBAN_ZONES = [south, west]`, `validateUrbanGlb(gltf, expectedZone)`, مشاركة نسيجي الأطلس والقناع بين المناطق، و`hotelAt(x, y)`), `src/map/engine.ts`, `src/map/saqifah-3d.ts`, `src/routing/plan.ts`, `src/data/provenance.ts`.
- الاختبارات: `tests/unit/urban-stage5.test.ts`, `tests/unit/data.test.ts`, `tests/unit/domain.test.ts`, `tests/unit/parity.test.ts`, `tests/unit/interior-and-shortcuts.test.ts`, `tests/unit/search-view.test.ts`, `tests/unit/routing.test.ts`, `tests/unit/route-safety-audit.test.ts`, `tests/e2e/landing.spec.ts`, `tests/e2e/main-screen.spec.ts`, `tests/e2e/extras.spec.ts`.

---

## 3. نتائج التحقق النهائية (بعد آخر تعديل)
- **`npx tsc --noEmit`**: `0` أخطاء.
- **`npx biome check`**: `0` أخطاء عبر `274` ملفًا (تحذير قديم وحيد في `scripts/fence-model.mjs:395`).
- **`npx vitest run --maxWorkers=1`**: **51 / 51 ملفًا، 1302 ناجحًا | 3 متوقع فشلها (1305)** (شاملًا `urban-stage5.test.ts`, `data.test.ts`, `domain.test.ts`, `parity.test.ts`, `interior-and-shortcuts.test.ts`, `search-view.test.ts`, `routing.test.ts`, `route-safety-audit.test.ts`, `streets.test.ts`, `i18n.test.ts`, `data-integrity.test.ts`).
- **`npm run build` + `check-build.mjs`**: ناجح (`✓ built in 1.64s`، `74 entries / 6390.33 KiB`، جزء `urban-3d` الكسول `6.83 KiB gzip`، و`SW mentions urban GLBs: false`، و`check-build: every chunk dependency exists`).
- **التحقق البصري والنقر الحي في Chrome (Metal، `1280×800`):**
  - `2D check`: `{"errors":[],"leaked2d":[]}`.
  - `Loaded Stage 6 GLBs`: `['urban-south-stage6.glb', 'urban-west-stage6.glb']`.
  - `Day 3D frame timing`: `p50=16.7 ms, p95=16.7 ms`.
  - **النقر المباشر على الفندق 3D (`وقف الصافي #224` عند `y = 346`، `poiHitsCount = 0`)**: فتح بطاقة `وقف الصافي` فورًا (`Stage 6 West Click verified`).
  - اللقطات المفحوصة: `stage6-west-aerial-day.png`, `stage6-west-closeup-day.png`, `stage6-west-a8-fade.png`, `stage6-west-night.png`, `stage6-west-3d-building-click.png`، ولوحة `الملفات المؤقتة/لوحة-مراجعة-الغرب-المرحلة-6.png`.
- **اختبارات Playwright E2E المتأثرة** (`landing.spec.ts`, `main-screen.spec.ts`, `extras.spec.ts`, `--workers=1 --retries=1`): **49 / 49 ناجحًا** (`43 passed + 6 flaky` نجحت في الإعادة الأولى بسبب إعادة ضبط SwiftShader GPU في Headless Chrome؛ لم تُشغّل بقية الـ13 ملفًا أو القياس على `vivo V2250`).
