# المرحلة 3 (واستكمال تطوير الأبواب): أبواب المسجد النبوي الحقيقية ثلاثية الأبعاد والدخول عبر الفتحات المفتوحة (`2026-11-21`)

> **التاريخ:** `[2026-11-21]` · **الفرع:** `feat/sliding-domes`

---

## 1. ملخص ما تغيّر للزائر
- **أبواب المسجد الـ42 (83 فتحة منفصلة) بتفصيل معماري مطابق للصور المرجعية:**
  - درفات خشبية/نحاسية سميكة بنقش معين بزاوية `45°`، وبراشيم بارزة، وقوس سفلي مبرشم، وميدالية وسطية بارزة 3D تحمل **«محمد رسول الله»**، وخرطوشتين علويتين **«الله»**، وقمرة من 6 عقود منحوتة بأقواس حدوة الفرس وزجاجها المعشّق، ولوحة حجرية عليا تحمل **«ادخلوها بسلام آمنين»** بخط الثلث مع وردتين جانبيتين، وفانوس نحاسي مفرّغ بـ4 مصابيح متوهجة ليلًا — وكل ذلك بنِسَب مصححة 1:1 وخطوط عربية مقروءة من الخارج ومن الداخل.
  - **مفتوحة عبر الجدار دون سدّ:** حُذف الجدار الخلفي داخل عُدة الباب ليرى الزائر سجاد المسجد وأعمدته وفوانيسه مباشرة من خلال الفتحات المفتوحة.
- **موضع نقشة الرخام النجمية (توجيه المالك `[2026-11-21]`):** تقتصر النجمة الرخامية الثمانية (`DoorStarFloor`) على الأبواب الغائرة في مداخل حجرية عميقة مثل باب `7` و`9` (`16` بوابة في `RECESSED_PORCH_GATES`)، بينما تقف بقية البوابات (مثل `8` و`2` و`4`) على رخام كريمي سادة هادئ.
- **تعدّد الفتحات والفتح الجزئي الواقعي (`[2026-11-20]`):**
  - `7` بوابات بـ`5` فتحات (`8, 13, 17, 21, 25, 29, 34` ← **2 مفتوحة**).
  - `3` بوابات بـ`3` فتحات (`2, 5, 37` ← **2 مفتوحة**).
  - `7` بوابات بـ`2` فتحات (`3, 4, 10, 11, 32, 38, 39` ← **1 مفتوحة**، و`32` مغلقة دائمًا).
  - `25` بوابة بفتحة واحدة (تفتح افتراضيًا عدا المغلقة دائمًا `18, 23, 26, 31`).
- **لا فتحة في السقف + الدخول عبر الباب المفتوح فقط (`[2026-11-20]`):**
  - النقر على أي باب يفتح درفتيه للداخل (`0° ← 95°` في 7 ثوانٍ) **دون قص فتحة في سقف المسجد** أبدًا.
  - لا تستطيع الكاميرا اختراق السقف أو الجدران المصمتة أو الفتحات المغلقة؛ والعبور للداخل متاح حصريًا عبر فتحات الأبواب المفتوحة مع تنبيه إرشادي بـ26 لغة.

---

## 2. الملفات المضافة والمحدّثة
- `scripts/build-door-textures.mjs` ← `scripts/door-atlas.jpg`: أطلس `1024×1024` بخط `Diwan Thuluth` ونِسَب 1:1 مصححة.
- `scripts/build-door-kit-glb.py` ← `public/models/haram-doors-kit.glb` (`340,884` بايت خام / `200,839` بايتًا gzip، تحميل كسول في 3D فقط؛ 5 شبكات: `DoorLeafLeft`, `DoorLeafRight`, `DoorPortalFrame`, `DoorStarFloor`, `DoorThresholdGlow`).
- `scripts/build-mosque-doors-data.py` ← `data/mosque-doors-3d.json` (`15,418` بايت، `42` بوابة / `83` فتحة، فصل `>= 2.5 م`).
- `src/domain/mosque-doors.ts` (`RECESSED_PORCH_GATES`, `starFloors`, `toggleGateBay`, `buildDoorKitMatrices`, `buildDoorCutBoxes`).
- `src/domain/mosque-entry.ts` (`isInsideMosqueWall`, `guardMosqueCameraEntry`).
- `src/domain/interior-reveal.ts` (إلغاء ثقوب السقف عند اختيار الباب `discs = []`).
- `src/data/provenance.ts`، `src/map/scene-light.ts`، `src/map/glb-layer.ts` (`doorOpenFraction`, `doorBayAt`, `u_doorCutTex`، إظهار props عند التقريب `zoom >= 18.2`)، `src/map/engine.ts` (`MAX_ZOOM_3D = 23.2`, `enforceMosqueEntry`, `isInsideMosque`)، `src/app/map-main.tsx`، وجميع ملفات الترجمة الـ26 (`door_entry_closed`, `door_entry_open_only`).
- `tests/unit/mosque-doors-3d.test.ts`، `tests/unit/mosque-entry.test.ts`، `tests/unit/interior-reveal.test.ts`، `tests/unit/prayer-session-and-doors.test.ts`.

---

## 3. نتائج التحقق النهائية (بعد آخر تعديل برمجي)
- **`npx tsc --noEmit`**: `0` أخطاء.
- **`npx biome check`**: نظيف (`0` أخطاء).
- **`npx vitest run --maxWorkers=1`**: **50 / 50 ملفًا، 1205 ناجحًا | 3 متوقع فشلها (1208)** (منها `mosque-doors-3d.test.ts` `6/6`, `mosque-entry.test.ts` `6/6`, `interior-reveal.test.ts` `5/5`, `prayer-session-and-doors.test.ts` `16/16`, `i18n.test.ts` `16/16`, `architecture.test.ts` `10/10`, `parity.test.ts` `19/19`, `provenance.test.ts` `3/3`).
- **`npm run build`**: ناجح (`vite build` + `check-build: every chunk dependency exists`، `74` مدخلة تخزين مسبق بحجم `6138.99 KiB`، ودون زيادة في حزمة 2D الأولية).
- **التحقق البصري والتفاعلي في Chrome (`headless`):**
  - فحص اللقطات الـ5: `لقطة-باب-8-تفاصيل-قريبة.jpg` (دوائر ونقوش مضبوطة، رخام سادة، رؤية للداخل)، `لقطة-باب-7-نقشة-الرخام.jpg` (النجمة الثمانية الرخامية في مدخل باب 7)، `لقطة-دخول-من-الباب-المفتوح.jpg` (الدخول الفعلي عبر فتحة 1 لباب 8 بظهور التنبيه والسقف السليم)، `لقطة-الأبواب-التفصيلية-ليلًا.jpg`، `لقطة-باب-2-و4-بعد-التحسين.jpg`.
  - نتائج اختبار الحماية المباشر: `roofBlocked: { inside: false, zoom: 18.4 }`، `closedBayBlocked: { inside: false }`، `enteredInside: { inside: true }`، `errors: []`.
