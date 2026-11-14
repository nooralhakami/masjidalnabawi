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

## عينات اللون الأخضر للمرحلة 1-ب
- تم التقاط مقارنة بصرية ثلاثية الأبعاد على الساحة الغربية + شريط `drawRug()` للحالي (`#6a7a2c`) وثلاث درجات أغمق: `#5c6b24` و`#51601e` و`#465319` (دون تعديل `#6a7a2c` في الكود)، وحُفظت في البيئة المركزية للمالك للاختيار.

## التالي المؤجل
- اختيار المالك لإحدى درجات الأخضر الثلاث ثم بدء المرحلة 1-ب (إعادة تشكيل توزيع المصليات على الساحات مقابل لقطتي Apple Maps).
- A6 (حواجز الشريط عند باب 41) مؤجل حتى إعادة إرفاق صورتي باب 41.
