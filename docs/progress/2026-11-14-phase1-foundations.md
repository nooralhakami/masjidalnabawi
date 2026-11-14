# المرحلة 1 — الفرع النظيف وإعادة بناء الأساسات (A1–A5)

التاريخ: [2026-11-14] — الفرع `rebuild/from-main` (متفرّع من `main` عند `90ede90`).

## ما يراه الزائر والمراجع
- تبقى المصليات خضراء (`#6a7a2c`) وأفقية بمحاذاة المظلات (`1°`) بالنقش الحالي دون أي تحول للأحمر أو إمالة.
- بوصلة الخريطة تشير بعلامة الكعبة نحو القبلة في المدينة (`176.24°`، أي دوران `-3.76°` عن الجنوب).
- لا تغيير على أطوال المسارات أو توزيع الأماكن أو واجهة المستخدم؛ التغييرات هيكلية لحماية دقة الإحداثيات ومصادر البيانات.

## حالة `main` (`90ede90`) التي بدأنا منها
- **لون المصليات:** `#6a7a2c` (سجاد 5م × 1.2م، صفوف مجمّعة من 3).
- **زاوية السجاد:** `1°` (`ALHARAMAIN_MODELS[1].rotation`).
- **مبدّل طوابق المسجد:** غير موجود (يوجد فقط `FloorSwitch` لمستويي موقف السيارات `A`/`B` في وضع القيادة).
- **الموجودات الأساسية:** `src/map/rug-layer.ts`، `src/routing/walk.ts`، `src/map/crowd-sim.ts`، `src/routing/streets.ts`، `src/routing/garage.ts`، `data/streets.json`، `src/data-next/alharamain-prayers.ts` (55 مضلعًا من `navQ` + 2 مضافان)، `docs/PERF.md`، `docs/DECISIONS.md`، و`public/models/haram-service-a.glb` و`haram-service-b.glb`.

## الإيداعات المنجزة على `rebuild/from-main`
1. **`1fbe872` — A1 + A4 (محاذاة السجاد والقبلة):**
   - تصدير `RUG_TURN_DEG = ALHARAMAIN_MODELS[1].rotation` في `src/map/rug-layout.ts` واستيراده في `src/map/rug-layer.ts` مع `RUG_GREEN_HEX = '#6a7a2c'`.
   - تصدير `QIBLA_BEARING_DEG = 176.24` في `src/domain/geo.ts` وتطبيق `rotate(-3.76 12 12)` على `.kaaba` في `src/presentation/icons.ts`.
   - اختباران جديدان في `tests/unit/prayer-rectangles.test.ts`.
2. **`24252fb` — A2 (توحيد الإطارين المتريين):**
   - إنشاء `src/domain/frames.ts` لإطار المشي (`toWalkMetres`/`fromWalkMetres`) وإطار المجسمات (`toModelMetres`/`fromModelMetres`) والجسرين (`modelToWalkMetres`/`walkToModelMetres`) بصيغة Web Mercator المطابقة لـMapLibre.
   - تحديث `src/routing/walk.ts` (بما فيها `restroomBlocks()`) و`src/map/glb-layer.ts` للاعتماد على `src/domain/frames.ts`.
   - 4 اختبارات جديدة في `tests/unit/frames.test.ts` تؤكد دقة التحويل `< 1e-6` م.
3. **`3b67f00` — A3 (سجل مصادر البيانات وحراس التوجيه):**
   - إنشاء `src/data/provenance.ts` بالرتب الثلاث (`verified`، `candidate`، `simulation`) ومنع غير `verified` من التوجيه (`assertRoutingSourcesVerified`).
   - تفعيل الحارس عند بناء شبكات `src/routing/walk.ts` و`src/routing/streets.ts` و`src/routing/garage.ts`.
   - 3 اختبارات جديدة في `tests/unit/provenance.test.ts` مع فحص استيرادات `src/routing/*.ts`.
4. **`ee8864e` — A5 + المراجع البصرية:**
   - استعادة الوثائق الأربع حرفيًا من `origin/legacy-v1-leaflet`: `docs/routes/GARAGE.md`، `docs/routes/NETWORK.md`، `docs/VISIT-PHOTOS.md`، `docs/PLAN-ISLAMIC-LIBRARY.md`.
   - حفظ المراجع الثلاثة في `docs/references/` (`apple-maps-overview.jpg`، `apple-maps-closeup.jpg`، `pm-central-guide-ar-2026.pdf`).

## التحقق
- **خط الأساس على `main` (`90ede90`):** `npx tsc --noEmit` ناجح، `npm run lint` بلا أخطاء (تحذير واحد مسبق في `scripts/fence-model.mjs:395`)، `npm test`: **36 ملفًا، 1086 ناجحًا + 3 متوقع فشلها (1089)**، `npm run build` ناجح (`check-build` سليم، 72 عنصرًا، `5805.42 KiB`).
- **بعد A1–A5 على `rebuild/from-main` (`ee8864e`):** `npx tsc --noEmit` ناجح، `npm run lint` بلا أخطاء (تحذير مسبق واحد)، `npm test`: **38 ملفًا، 1095 ناجحًا + 3 متوقع فشلها (1098)**، `npm run build` ناجح (`check-build` سليم، 72 عنصرًا، `5808.79 KiB`).
- **التكافؤ والمعمار:** `tests/unit/parity.test.ts` (19 اختبارًا) و`tests/unit/architecture.test.ts` (10 اختبارات) ناجحة بالكامل دون أي تغيّر في أطوال المسارات.

## المرحلة 1-ب — اعتماد `#465319` وإعادة تشكيل المصليات
- **اختيار المالك:** اعتمد المالك **عينة 3 (`#465319`)** للأخضر الداكن لسجاد المصليات.
- **التغييرات المنفذة:**
  - `src/map/rug-layer.ts`: تحديث `RUG_GREEN_HEX = '#465319'` وبكسل الاحتياط `[70, 83, 25, 255]`.
  - `src/data/provenance.ts`: توثيق صورتي Apple Maps (`apple-maps-rug-ref` و`apple-maps-rug-closeup-ref`) بالرتبة `candidate` كـ«مرجع بصري من المالك للتوزيع فقط».
  - `src/map/rug-layout.ts`: محاذاة بداية الصفوف عند الحافة الشمالية (بمدى `1.2 م`) واستخراج كل مستطيل بشبكة وحواجز مستقلة دون إسقاط المجموعة الثلاثية التالية عبر الفجوة `0.8 م`، مما رفع العدد من `9,013` إلى `9,569` سجادة (`+556`: الشمال `2,168→2,348`، الغرب `1,179→1,233`، الشرق `489→510`، الجنوب `555→578`، الساحة الغربية الخارجية `4,622→4,900`، والحواجز `3,018`).
- **التعارضات المعروضة على المالك دون حسم منفرد:**
  1. الساحة الغربية الخارجية: `12` مصلى موثقًا في `navQ` (`FF5/FF6`) مقابل `5` فقط في `apple-maps-overview.jpg`.
  2. الشمال الشرقي (`#28` و`#29`): موثق في `FF88` ومفروش في الصورة مقابل إخلاءات المالك الصفراء في `2026-11-07`.
  3. الرخام الأبيض الملاصق لجدار المسجد مباشرة: يظهر فيه سجاد في `apple-maps-closeup.jpg` خارج حدود `FF88` وفي موضع `walkway_ring`.
- **المخرج البصري:** لوحة مقارنة «قبل / بعد / المرجع» للساحات الأربع محفوظة للمالك في `الملفات المؤقتة/لوحة-قبل-بعد-المصليات-المرحلة-1ب.png`.
- **المؤجل التالي:** انتظار قرار المالك في التعارضات الثلاثة وموافقته على لوحة المرحلة 1-ب قبل الانتقال إلى المرحلة 2 (والبند A6 لحواجز باب 41 ما زال بانتظار الصورتين).
