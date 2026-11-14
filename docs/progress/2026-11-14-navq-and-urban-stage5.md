# إدخال بيانات navQ + المرحلة 5: شريحة المحيط العمراني 3D (الساحة الجنوبية)

التاريخ: `[2026-11-14]` | الفرع: `rebuild/from-main`

## أ. حزمة إدخال بيانات `navQ` (المهمة أ)
1. **دورات المياه (`216`، `251–254`):** تحريك `251–254` إلى مراكز مجسمات الهيئة الغربية (`b-north`) وتصحيح الجنس (`216, 253, 254` للنساء `toilet_women`؛ `251, 252` للرجال `toilet_men`) مع ربط `restroomDoor` بين `251↔252` و`253↔254` في `data/overrides.json` و`src/data-next/alharamain-3d.ts` و`data/pois.json`.
2. **الأبواب الخارجية للتوسعة الثالثة (`1401–1420` ← `401–420`):** إدراج 20 بوابة خارجية (`gate_outer`) في `data/pois.json` (`345` معلمًا إجماليًا، `132` بوابة)، مع تنسيق أرقام العرض (`outerGateNumber`) في `src/presentation/markers.ts` و`src/domain/near.ts` و`src/domain/search.ts` و`src/map/zoom.ts` و`src/map/images.ts`.
3. **المصليات والمعالم الداخلية وأقسام المواقف:**
   - إنشاء `data/navq-interior.json` (`112` عنصرًا: `41` مصلى طابق أرضي + `57` مصلى سطح + `14` معلمًا داخليًا) وتغذية البحث وعرض `?interior=1` (`navq-interior-dots`).
   - إنشاء `data/navq-parking-sections.json` (`24` قسمًا: `1A–11A` و`1B–13B`) ودمجه في `src/domain/parking.ts` و`src/domain/visible.ts` و`data/i18n.json` وجميع الـ26 ملف لغة في `src/i18n/locales/*.json`.

## ب. المرحلة 5 — شريحة المحيط العمراني 3D (الساحة الجنوبية)
1. **النطاق المعتمد (`data/urban-approved.json` و`src/domain/urban-approval.ts`):**
   - استخلاص **7 فنادق معتمدة** فقط جنوب الحرم (`S014/711`, `S037/713`, `S008/722`, `S004/724`, `S038/725`, `S016/728`, `S017/735`) بحارس `A7` (`tier: 'verified' && approvedBy: 'owner'`).
   - ضبط `heightM: 0` و`heightSource: 'flat_pending_owner_floors'` (صفر ارتفاعات تخمينية؛ عدد الأدوار مؤجل بقرار المالك).
   - تثبيت باب الدخول ونقطة نزول السيارة على **الواجهة الغربية على الشارع** (`entrance` على بعد 0.5 م خارج الحد الغربي و`dropoff` على شارع OSM المجاور؛ تم التحقق أن النقطتين والمقطع بينهما لا يقعون داخل أي مضلع مبنى) + `154` ممر شارع/مشاة من OSM للساحة الجنوبية (`85` طريقًا + `69` ممر مشاة).
   - تسجيل `'urban-approved'` كـ `verified` في `src/data/provenance.ts`، وإلغاء حجب هذه الفنادق السبعة فقط في `src/domain/filters.ts` و`vite.config.ts` (`244` مكانًا + `13` موقفًا = `257`) مع إبقاء الفنادق الـ36 المتبقية و`food` و`wheelchair_zone` مخفية.
   - إضافة شارات بطاقة المكان في `src/ui/sheet/PlaceCard.tsx` (`موثق`، `المدخل من الواجهة الغربية على الشارع`، `عدد الأدوار قيد الاعتماد (مسطّح مؤقتًا)`).
   - توجيه المشي والقيادة في `src/routing/plan.ts` و`src/routing/walk.ts` إلى `entrance` و`dropoff` على الواجهة الغربية مع التفاف خارجي (`clearApprovedBuildings`) يمنع تقاطع أي مسار مع المباني المعتمدة.
2. **مجسم Blender GLB والحمولة الكسولة (`scripts/build-urban-glb.py`، `public/models/urban-south-stage5.glb`، `src/map/urban-3d.ts`):**
   - بناء `public/models/urban-south-stage5.glb` عبر Blender 5.3.0 بإسقاط `Web Mercator` المطابق تمامًا لثوابت `src/domain/frames.ts`: `16` عقدة مسماة (`urban-hotel-<poiId>-<buildingId>` مسطّحة عند `maxY=0.35m`، `urban-door-<poiId>` عند `maxY=0.42m`، `urban-street-south-footways` عند `0.07m`، `urban-street-south-roads` عند `0.04m`).
   - الحجم الفعلي لـ `urban-south-stage5.glb`: `74,368` بايتًا خام (`23,984` بايتًا gzipped — أقل كثيرًا من سقف `250 KB gzip`)، وحجم حزمة `urban-3d` الكسولة بعد البناء: `7.31 kB` (`3.04 kB gzip`).
   - تطبيق حارس `A9` (`validateUrbanGlb`) في `src/map/urban-3d.ts` لمنع أي عقدة غير معتمدة أو ارتفاع `>= 1.0 م` أو إزاحة تفوق `0.5 م`، وتطبيق `A8` (`urbanOpacityForCamera`: شفافية `0.28`/`0.32` ضمن `[0.25, 0.35]` عند زاوية الميل والنظر نحو المواجهة)، والتحميل الكسول عبر `import('./urban-3d')` فقط عند تفعيل 3D في `src/map/engine.ts` (`0` تحميلات في 2D).

## ج. التحقق
- `npx tsc --noEmit`: 0 أخطاء.
- `npx biome check` (الملفات الـ9 الأساسية للمرحلة 5 و`main-screen.spec.ts`): 0 أخطاء؛ `npx biome lint` على الـ33 ملفًا المعدل/الجديد: 0 أخطاء (ملاحظات تنسيق مسبقة في أسطر قديمة ضمن 5 ملفات).
- `npm run build` + `check-build.mjs`: ناجح (`73` عنصرًا مسبق التخزين `6026.97 KiB`؛ حزمة `urban-3d` كسولة منفصلة).
- `npx vitest run --maxWorkers=2`: **`40` ملفًا ناجحًا / `2` فاشلان سابقان (`route-view.test.ts` و`streets.test.ts`)**، **`1154 passed | 2 failed | 2 expected fail (1158)`** (بما فيها `urban-stage5.test.ts` `5/5` و`route-safety-audit.test.ts` `2/2` و`domain.test.ts` `30/30` و`parity.test.ts` `19/19`).
- التحقق البصري بـ Playwright في Chrome 157 (Metal): صفر أخطاء طرفية، `lazy2DLeaked: []`، وجود الطبقات `urban-south-stage5-3d` و`urban-south-streets-line` و`navq-interior-dots`، ومطابقة لقطات بطاقة 711 ومسارها البري وبوابة 401 ودورة 253 ووضع `?interior=1`.
- اختبارات `playwright` e2e (`landing.spec.ts` + `main-screen.spec.ts` مع `CHROME=... --workers=1`): `landing.spec.ts` اجتاز `11/11` و`key services` (بعد تحديث مؤشر الشارة `8 ← 9` لإدراج شارة الفنادق) اجتاز مباشرة؛ وتُغلق أحيانًا 2–3 جلسات WebGL أثناء تشغيل SwiftShader الطويل في macOS Chrome 157 كما في السجل السابق، لكن إعادة تشغيل تلك الاختبارات منفردة (`every filter pill`, `key services`, `searching while a card is open`) اجتازت كلها `3/3`.
