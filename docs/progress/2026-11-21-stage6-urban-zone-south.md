# المرحلة 6 — المنطقة 1 (الجنوب 401–475 + 735): عُدّة الواجهات المعمارية بـ Blender والمحيط العمراني ثلاثي الأبعاد (`2026-11-21`)

> **التاريخ:** `[2026-11-21]` · **الفرع:** `feat/sliding-domes`

---

## 1. ملخص ما تغيّر للزائر
- **ظهور 57 فندقًا معتمدًا في المنطقة الجنوبية (`401–475` + `735`):**
  - استُكمل دمج جميع فنادق المنطقة الجنوبية من فهرس دليل الهيئة 2026 المعتمدة (`50` فندقًا جديدًا `2402..2475` إلى جانب الفنادق السبعة المعتمدة سابقًا `711, 713, 722, 724, 725, 728, 735`) في الخريطة والبحث والتوجيه؛ ليرتفع إجمالي المعالم في `data/pois.json` من `345` إلى `395` (`294` مرئيًا في «الكل»، و`57` فندقًا ظاهرًا، و`307` في إحصائية صفحة الهبوط)، مع إبقاء الفنادق الـ36 غير المعتمدة والمطاعم ومناطق الكراسي مخفية.
  - تعرض بطاقة الفندق (`PlaceCard`) رقم الدليل الرسمي (مثل `رقم 402`) وشارة `موثق`، وتظهر شارة «المدخل من الواجهة الغربية على الشارع» للمداخل الغربية فقط، مع إزالة شارة «عدد الأدوار قيد الاعتماد (مسطّح مؤقتًا)» وعدم عرض أي عدد أدوار تقديري كمعلومة.
- **محيط عمراني معماري ثلاثي الأبعاد في Blender + WebGL2 (`public/models/urban-south-stage6.glb`):**
  - تحويل الفنادق الـ52 ذات البصمات (`29` منها مقسّمة مبدئيًا بفواصل معمارية عبر `14` بصمة مشتركة + `4` بارتفاعات `building:levels` حقيقية من OSM + `48` بارتفاعات عرض 3D موسومة `10–14` دورًا، وبقاء `#441–#445` بنقاط فقط دون بصمة) إلى أبراج ثلاثية الأبعاد بثلاث طبقات معمارية: قاعدة تجارية بأروقة وأقواس مضاءة ليلًا (`0–8.8 م`) مع مظلة مدخل، وجسم متكرر بثلاثة طرز مدينية (حجر كريمي، واجهات زجاجية عمودية، وترافرتين بنوافذ شريطية)، وتاج إسلامي علوي ولوحة اسم مضاءة.
  - **انعاكسات فرينل وإضاءة ليلية واقعية:** زجاج يعكس السماء والشمس نهارًا وبساعة الغروب الذهبية، ونوافذ غرف فندقية مضاءة عشوائيًا ليلًا عبر كل طابق، مع توهج المحلات الأرضية والمظلات والتيجان العلوية.
  - **الشوارع والأرصفة ومرافق الطريق:** `171` ممر شارع وممشى سطحي من OSM بعرضه الحقيقي، وأرصفة وجزر وسطية مقصوصة خارج المباني وحرم الساحة، و`3` مداخل مواقف (`عمر` و`قباء` و`قربان`)، و`110` أعمدة إنارة مزدوجة بهالات ضوء أرضية ليلًا، و`90` نخلة مدينية.
  - استمرار شفافية العائق (`A8`: `0.28–0.32`) عند النظر شمالًا نحو القبة الخضراء، والتحميل الكسول في 3D فقط دون أي أثر على وضع 2D.

---

## 2. الملفات المضافة والمحدّثة
- `scripts/build-urban-south-data.py` ← `data/urban-approved.json` (`haram-urban-approved-v2`) و`data/pois.json` (`395` معلمًا) و`data/i18n.json` (26 لغة) ولوحة المراجعة `الملفات المؤقتة/لوحة-مراجعة-الجنوب-المرحلة-6.png`.
- `scripts/build-urban-facade-atlas.py` ← `scripts/urban-facade-atlas.jpg` (`48,683 B`) و`scripts/urban-facade-mask.jpg` (`46,424 B`).
- `scripts/build-urban-glb.py` ← `public/models/urban-south-stage6.glb` (`790,664 B` خام / **`241,173 B` (`235.5 KiB`) مضغوطًا gzip** ضمن سقف `250 KB`).
- `src/data/types.ts` (`guideNumber?: number`), `src/data/provenance.ts`, `src/domain/urban-approval.ts` (`APPROVED_FOOTPRINT_BUILDINGS`), `src/ui/sheet/PlaceCard.tsx`.
- `src/map/urban-3d.ts` (`URBAN_LAYER_ID = 'urban-south-3d'`, حارس `validateUrbanGlb` v2, فك تشفير نسيجي GLB, شادر Fresnel + إضاءة ليلية عشوائية + هالات إنارة), `src/map/engine.ts`.
- الاختبارات: `tests/unit/urban-stage5.test.ts`, `tests/unit/data.test.ts`, `tests/unit/domain.test.ts`, `tests/unit/parity.test.ts`, `tests/e2e/landing.spec.ts`, `tests/e2e/main-screen.spec.ts`, `tests/e2e/extras.spec.ts`.

---

## 3. نتائج التحقق النهائية (بعد آخر تعديل)
- **`npx tsc --noEmit`**: `0` أخطاء.
- **`npx biome check`**: `0` أخطاء عبر `274` ملفًا (تحذير قديم وحيد في `scripts/fence-model.mjs:395`).
- **`npx vitest run --maxWorkers=1`**: **51 / 51 ملفًا، 1263 ناجحًا | 3 متوقع فشلها (1266)** (شاملًا اختبارات `urban-stage5.test.ts`، `data.test.ts`، `domain.test.ts`، `parity.test.ts`، `route-safety-audit.test.ts`، `streets.test.ts`).
- **`npm run build` + `check-build.mjs`**: ناجح (`✓ built in 1.50s`، `74 entries / 6285.89 KiB`، جزء `urban-3d` الكسول `5.75 KiB gzip`، و`urban-south-stage6.glb` خارج التخزين المسبق، و`check-build: every chunk dependency exists`).
- **التحقق البصري في Chrome (Metal، `1280×800`):**
  - `2D check`: `{ errors: [], leaked: [] }`.
  - `Day 3D`: `{ errors: [], loadedGlb: 1, perfStats: { p50: 16.7, p95: 16.8 } }`.
  - `PlaceCard (#2402)` + A8 Fade: `{ errors: [], hasVerified: true, hasGuide402: true, hasFloorsPending: false }`.
  - اللقطات المفحوصة في `الملفات المؤقتة/`: `stage6-south-aerial-day.png`، `stage6-south-closeup-day.png`، `stage6-south-golden.png`، `stage6-south-night.png`، `stage6-south-fade-and-card.png`، إضافة إلى `لوحة-مراجعة-الجنوب-المرحلة-6.png`.
- **اختبارات Playwright E2E المتأثرة** (`landing.spec.ts`, `main-screen.spec.ts`, `extras.spec.ts`, `--workers=1`): `45 passed` في التشغيل الأول + اجتياز الـ4 اختبارات المتأثرة بتعطل SwiftShader عند إعادة التشغيل (`3 passed` + `1 flaky` نجح في المحاولة الثانية؛ لم تُشغّل باقي الملفات الـ13 أو القياس على `vivo V2250`).
