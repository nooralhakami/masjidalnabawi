# المرحلة 2: البحث واختيار أداة الإنتاج

**تاريخ البحث:** 5 أكتوبر 2026.

**ملاحظة منهجية:** شبكة بيئة العمل تحجب القراءة المباشرة لبعض مواقع التوثيق (remotion.dev وgsap.com وhyperframes.heygen.com وdev.to). لذلك اعتمدت على:
- نتائج محرّك البحث.
- مستودعات GitHub.
- سجل npm للتحقق من أرقام الإصدارات وتواريخها.
- **تجربة عملية داخل البيئة نفسها** (القسم 4).

---

## 1. الخلاصة في سطر

**الأداة المختارة: HyperFrames من HeyGen، مع GSAP للتحريك.**

السبب في جملة واحدة: تطبيقنا مبنيّ بـ HTML وCSS وTypeScript دون React، وHyperFrames تصنع الفيديو من HTML مباشرة، وترخيصها مفتوح بالكامل (Apache‑2.0)، **وقد جرّبتها فعلاً هنا فأخرجت فيديو 1080p بحروف عربية سليمة واتصال صحيح**.

---

## 2. الأدوات التي فحصتها

### 2.1 HyperFrames (HeyGen)
- **الفكرة:** كل مشهد صفحة HTML/CSS/JS. التوقيت يُحدَّد بخصائص `data-start` و`data-duration`، والتحريك بخط زمني GSAP قابل للتقديم والتأخير (seekable). يُصيَّر المشهد في Chrome بلا واجهة، ثم يُرمَّز بـ FFmpeg بنتيجة حتمية: «نفس المدخلات = نفس الإطارات».
- **الإصدار:** `hyperframes@0.8.134` على npm، محدَّث في 5 أكتوبر 2026. الترخيص **Apache‑2.0**: لا رسوم على أي تصيير، ولا حدود للاستخدام التجاري.
- **التثبيت (من المستودع الرسمي):**
  - `npx hyperframes init my-video` لإنشاء مشروع.
  - `npx skills add heygen-com/hyperframes` لمهارات الوكلاء.
  - أو `claude plugin marketplace add heygen-com/hyperframes`.
  - المتطلبات: Node 22+ وFFmpeg وChrome Headless Shell (`npx hyperframes browser ensure`).
- **المهارات:** 21 مهارة، منها:
  - `product-launch-video` و`motion-graphics` و`embedded-captions`.
  - `hyperframes-animation` و`hyperframes-keyframes` و`hyperframes-audio` و`media-use` (تحويل نص إلى كلام، وتفريغ صوتي، وتأثيرات صوت).
- **التصيير:**
  - `--fps 24|30|60`.
  - `--resolution` بقيم منها `landscape` (1920×1080) و`portrait` (1080×1920) و`landscape-4k` و`portrait-4k`. في دقة 4K يصيّر Chrome بكثافة بكسل 2x.
  - `--format mp4|webm|mov|png-sequence`.
  - `--quality draft|standard|high`.
- **أدوات الجودة المدمجة (مهمة لمعايير التسليم):**
  - `snapshot`: لقطات ثابتة عند ثوانٍ محددة.
  - `check` و`lint` و`validate`: أخطاء JavaScript، والأصول المفقودة، والتباين.
  - `inspect`: تخطيط العناصر عبر الخط الزمني.
  - `normalize-audio`: معايرة مستوى الصوت (LUFS).
- **المخاطر:** المشروع أحدث وأقل نضجاً من Remotion (إصدار 0.x، ومعاينة أبسط من Remotion Studio). العلاج: تثبيت رقم الإصدار في المشروع.

### 2.2 Remotion
- **الفكرة:** الفيديو مكوّنات React. يأتي مع Studio قوي (خط زمني ومعاينة)، ونظام بيئي واسع، وتصيير سحابي عبر Lambda.
- **الإصدار:** `remotion@4.0.533` على npm، محدَّث في 5 أكتوبر 2026. الإصدار 5.0 قادم بتغيير في الترخيص.
- **مهارات الوكلاء** (أُطلقت في يناير 2026):
  - التثبيت: `npx skills add remotion-dev/skills`.
  - أو `claude plugin marketplace add remotion-dev/claude-code-plugin` ثم `claude plugin install remotion@remotion`.
  - المهارات: `remotion-best-practices` و`remotion-create` و`remotion-markup` و`remotion-captions` و`remotion-render` و`remotion-maps` وغيرها.
- **الترخيص:** مجاني للأفراد والمنظمات غير الربحية والجهات التي لا يزيد موظفوها على 3. **الجهات الأكبر تحتاج رخصة شركة مدفوعة.** هذه نقطة حساسة: الجهة التي ستتبنى التطبيق جهة كبيرة، وقد تعيد تصيير الفيديو أو تعدّله لاحقاً.
- **ملاءمة مشروعنا:** يتطلب إعادة كتابة كل شيء بـ React، بينما تطبيقنا لا يستخدم React إطلاقاً.

### 2.3 Motion Canvas وفرعه Revideo
- **الفكرة:** محرّك TypeScript للرسوم المتجهة على Canvas، مع محرر معاينة.
- **Motion Canvas:** `@motion-canvas/core@3.17.2`، **آخر نشر في فبراير 2025**. المستودع راكد، وتقارير مجتمعية تشير إلى توقف موقعه.
- **Revideo:** فرع نشط (`@revideo/core@0.11.0`، يوليو 2026) أصبح جزءاً من Midrender.
- **ملاءمة مشروعنا:** ضعيفة. الرسم على Canvas يعني إعادة بناء واجهتنا بدل استخدام HTML الحقيقي، ومجتمعه أصغر، ولا مهارات وكلاء رسمية له.

### 2.4 GSAP
- **الدور:** محرّك التحريك (الخط الزمني، والتسارع، والتتابع)، لا أداة تصيير. يعمل داخل HyperFrames مباشرة.
- **الترخيص:** **مجاني بالكامل حتى للاستخدام التجاري منذ أبريل 2025** بعد استحواذ Webflow، بما فيه SplitText وMorphSVG وDrawSVG. الإصدار `gsap@3.15.0`.
- **تحذير للعربية:** SplitText لم يُصمَّم للغات التي تُكتب من اليمين لليسار، وتقسيم الكلمة إلى حروف يكسر اتصالها. GSAP نفسها توفّر دالة مساعدة `splitArabicText` لهذا الغرض (القسم 3).

### 2.5 Lottie
- **الدور:** تشغيل رسوم متحركة مصدّرة من After Effects بصيغة JSON.
- **الترخيص:** `lottie-web` برخصة MIT.
- **مشكلة موثّقة مع العربية:** في `lottie-web` (Issue #3097)، النص العربي لا يُحاذى بشكل صحيح ولا يظهر بالترتيب المتوقع.
- **القرار:** لا نستخدم Lottie لأي نص عربي. يمكن استخدامه لعناصر زخرفية بلا نص، ولن نحتاجه غالباً لأن أيقونات التطبيق SVG أصلاً.

---

## 3. تحديات النص العربي في الفيديو والحلول

| التحدي | ما وجدته | الحل المعتمد |
|---|---|---|
| **اتصال الحروف عند التحريك حرفاً حرفاً** | وضع كل حرف في عنصر مستقل يجعل محرّك الخط يعامله كحرف منفصل، فتنقطع الكلمة. **ثبت ذلك في تجربتي** (السطر الثاني في الصورة). | **الحل الأول (الافتراضي):** نحرّك **كلمات كاملة** لا حروفاً، فلا يرى محرّك الخط إلا كلمات تامة.<br>**الحل الثاني (عند الحاجة لتأثير حرفي):** نضيف «الرابط الصفري» ZWJ (`U+200D`) قبل الحرف وبعده حيث يتصل، وهي فكرة `splitArabicText` نفسها. **ثبت أنه يعمل في Chrome** (السطر الثالث). |
| **الحروف التي لا تتصل بما بعدها** (ا د ذ ر ز و ة ء) | إضافة ZWJ بعدها يشوّه شكلها. | قائمة استثناء في دالة التقسيم (مطبّقة في ملف التجربة). |
| **الاتجاه من اليمين لليسار** | الحركة «القادمة من البداية» في العربية تأتي من اليمين. | `dir="rtl"` على الجذر، وخصائص CSS المنطقية (`inset-inline-start`) كما يفعل التطبيق نفسه. اتجاه الحركة الأفقية يُقلب عند العربية. |
| **الأرقام** | التطبيق يعرض الأرقام لاتينية في كل اللغات (17، 112، 980 م). | نلتزم بالأرقام اللاتينية في الفيديو لتطابق الواجهة. |
| **الخطوط المرخّصة** | خطوط التطبيق: Noto Kufi Arabic وIBM Plex Sans Arabic وNoto Naskh Arabic، وكلها برخصة SIL Open Font License التي تسمح بالاستخدام في الفيديو التجاري. | نستخدم **خطوط التطبيق نفسها** من حزمة `@fontsource` للتطابق التام مع الهوية: Kufi 700 للعناوين، وPlex 400/600/700 للنص. |
| **الترجمة المدمجة (burn‑in)** | مرشّح `subtitles` في FFmpeg يستخدم «تشكيلاً بسيطاً» يُفسد العربية (مربعات وحروف منفصلة)، والحل في FFmpeg هو مرشّح `ass` مع `shaping=complex` (HarfBuzz). | **نرسم الترجمة داخل مشهد HTML نفسه**، فتُشكَّل بمحرّك Chrome السليم. نصدّر ملف SRT منفصلاً من النصوص والتوقيتات نفسها. |
| **سرعة القراءة** | دليل Netflix للترجمة العربية: حد أقصى **42 حرفاً للسطر**، و**20 حرفاً في الثانية** للبالغين. | نلتزم بذلك في الترجمة والنصوص الظاهرة، مع هامش أبطأ لأن الأسلوب وقور. |
| **علامات ﷺ والتشكيل** | تحتاج خطاً يدعمها. | تُختبر في لقطات المراجعة. نتجنّب التشكيل الكامل في العناوين المتحركة. |

---

## 4. التجربة العملية داخل البيئة (دليل حاسم)

**الملفات:**
- `video/research/arabic-shaping-test.html`: المشهد.
- `video/research/arabic-shaping-test-t0.4s.png`: أثناء الحركة.
- `video/research/arabic-shaping-test-t2.8s.png`: بعد اكتمالها.

**ماذا فعلت:**
1. ثبّت HyperFrames 0.8.134 وChrome Headless Shell داخل البيئة: نجح، وفحص `hyperframes doctor` سليم.
2. كتبت مشهداً بدقة 1920×1080، فيه خطوط التطبيق الحقيقية ولقطة حقيقية لباب 17 داخل إطار جوال، وثلاثة أسطر:
   - **السطر 1:** تحريك كلمة كلمة ← **سليم تماماً**.
   - **السطر 2:** تقسيم ساذج حرفاً حرفاً ← **مكسور**: «دلـيل» و«الـنـبوي» بحروف منفصلة.
   - **السطر 3:** تقسيم حرفي مع ZWJ ← **متصل وسليم أثناء الحركة وبعدها**.
3. صيّرت فيديو 3 ثوانٍ بدقة 1080p و30fps في **7 ثوانٍ فقط**.

**ملاحظتان تقنيتان:**
- شبكة البيئة تحجب `cdn.jsdelivr.net`، لذلك نضع GSAP والخطوط محلياً داخل المشروع. هذا أفضل أصلاً، لأن الفيديو يصبح قابلاً لإعادة الإنتاج بلا إنترنت.
- Remotion يستخدم محرّك Chrome نفسه للعرض، فالنتيجة العربية ستكون مماثلة نظرياً، لكني **لم أجرّبه هنا**.

---

## 5. جدول المقارنة

التقييم من 5 (5 = الأفضل).

| المعيار | **HyperFrames + GSAP** | Remotion | Motion Canvas / Revideo | Lottie |
|---|---|---|---|---|
| **جودة المخرج** (حدّة، 4K، 60fps) | 5: حتى 4K و60fps، وتصيير حتمي | 5: حتى 4K و60fps، ونضج أعلى | 4: رسوم متجهة ممتازة | 4: يعتمد على After Effects |
| **التحكم** (توقيت، تسارع، طبقات) | 5: GSAP + HTML/CSS كاملة | 5: React + spring/interpolate | 4 | 2: تحكم محدود بعد التصدير |
| **دعم العربية** | 5: شكّلته تجربتياً مع حلّ ZWJ | 4: المحرّك نفسه، لكن لم يُجرَّب هنا | 3: Canvas، والنص يُبنى يدوياً | 1: مشكلة RTL موثّقة |
| **إعادة استخدام كود التطبيق وهويته** | 5: HTML وCSS والـ tokens وSVG كما هي | 3: تحويل إلى React | 2: إعادة رسم | 1 |
| **سهولة التنفيذ عبري في هذه البيئة** | 5: مثبّت ومجرّب ويعمل | 4: متوقع أن يعمل، ويحتاج إعداد React | 3 | 2: يحتاج After Effects |
| **أدوات المراجعة** (لقطات ثابتة، فحص) | 5: `snapshot` و`check` و`inspect` | 4: Studio و`still` | 3 | 2 |
| **الترخيص للجهة المتبنّية** | 5: Apache‑2.0 بلا شروط | 2: رخصة شركة للجهات الكبيرة | 5: MIT | 5: MIT |
| **النضج والمجتمع** | 3: جديد (2026)، إصدار 0.x | 5: سنوات، ومجتمع كبير | 2: Motion Canvas راكد | 4 |
| **المجموع** | **38/40** | 32/40 | 26/40 | 21/40 |

---

## 6. القرار والتبرير

**HyperFrames 0.8.134 (بإصدار مثبّت) + GSAP 3.15 + خطوط التطبيق محلياً + لقطات التطبيق الحقيقية داخل إطار جوال مبني بـ CSS.**

1. **التطابق مع التطبيق:** نستورد `tokens.css` والأيقونات والخطوط من التطبيق كما هي، فالفيديو امتداد بصري حقيقي للتطبيق لا تقليد له.
2. **العربية:** الحل مُثبت بالتجربة لا بالافتراض.
3. **الترخيص:** لا قيد على الجهة المتبنّية إن أرادت التعديل أو إعادة التصيير.
4. **المراجعة:** أدوات اللقطات الثابتة والفحص تخدم «معايير الجودة قبل التسليم» مباشرة.
5. **منحنيات الحركة:** نترجم منحنيات التطبيق نفسها إلى GSAP:
   - `--ease` = `cubic-bezier(0.2, 0.7, 0.2, 1)`، وأقرب مكافئ له `power3.out`، أو نستخدم `CustomEase` بالقيم نفسها.
   - `--spring` = `cubic-bezier(0.22, 1.15, 0.36, 1)`.

**ما لن نستخدمه:** Lottie للنص، والتقسيم الحرفي العادي، ومرشّح `subtitles` في FFmpeg للعربية.

---

## 7. أفضل الممارسات المعتمدة للمراحل التالية

### 7.1 من تجارب المطوّرين على X
- **الأصول الحقيقية فقط:** «استخدم لقطات الشاشة الحقيقية والشعار والألوان والخطوط الحقيقية… لا تُعِد رسم واجهة المنتج من الخيال؛ اقتطع الواجهة الحقيقية وحرّكها». (من أدلة «فيديوهات الإطلاق» المنشورة على X، روابطها في القسم 8)
- **بنية المشاهد:** كل مقطع 2–4 ثوانٍ: افتتاحية، ثم ظهور المنتج، ثم ثلاث ميزات كلحظات واجهة، ثم دليل، ثم الشعار والدعوة للتصرف.
- **التعديل التدريجي:** «لا تصف 10 أشياء دفعة واحدة… غيّر شيئاً واحداً، تحقّق منه، ثم انتقل». هذا يناسب مراجعتنا باللقطات الثابتة.
- **ما يتقنه الوكيل:** لقطات الشاشة التي تتكبّر وتنتقل بين الحالات، والنصوص والأرقام التي تعدّ تصاعدياً. أي كل ما له حواف نظيفة وحركة متوقعة.
- **إعادة بناء المكونات بدقة:** Claire Vo جعلت الوكيل يعيد بناء مكونات التطبيق «بكسلاً بكسل» قبل كتابة القصة المصوّرة.

### 7.2 إيقاع الفيديو وإطار الجوال
- **الافتتاح:** الثواني الثلاث الأولى تحسم بقاء المشاهد، فلا نبدأ بالشعار.
- **إيقاع هادئ:** «منتج هادئ لا يُقدَّم بقطعات محمومة». هذا يتوافق مع قدسية المكان.
- **وقت القراءة:** كل شاشة تحتاج وقتاً كافياً لتُقرأ. نحرّك الإطار في لحظات التوقف أو للتكبير على تفصيل فقط.
- **الجوال وسيلة لا موضوع:** الحركة تُبرز ما يفعله التطبيق، ولا تحوّل الجوال إلى زخرفة ثلاثية الأبعاد.
- **نسبة الواجهة:** نحو 80% من مدة الفيديو للواجهة نفسها.
- **بناء الإطار:** جسم مستدير، وشاشة داخلية بزوايا مستديرة و`overflow:hidden`، والصورة `object-fit: cover`. **نحرّك الإطار لا الصورة التي بداخله.**

### 7.3 الصوت
- **المستوى النهائي:** −14 LUFS، والذروة الحقيقية ≤ −1 dBTP.
- **التوازن:** الصوت البشري بين −6 و−12 dB، والخلفية أقل منه بـ 15–20 dB مع خفضها آلياً أثناء الكلام.
- **المؤثرات:** نقرات الواجهة حول −18 إلى −14 LUFS. مؤثرات «الهواء» (whoosh) بحذر شديد، لأن الإفراط فيها مُتعب، ومع قدسية المكان نكاد نستغني عنها.
- **ترتيب المزج:** الصوت البشري أولاً، ثم المؤثرات، ثم الخلفية.

### 7.4 الصوت العربي بالذكاء الاصطناعي (لاستخدامه في المرحلة 4)
- **ElevenLabs** (نموذج Eleven v3 أو Multilingual v2): الفصحى فيه جيدة وطبيعية، وفيه أصوات فصحى رجالية ونسائية. الاستخدام التجاري يتطلب خطة مدفوعة (من خطة Starter).
- **Azure AI Speech** (أصوات ar‑SA العصبية): بديل أقل طبيعية في المقارنات، لكنه مستقر.
- **بدائل عربية متخصصة**، مثل Munsit Faseeh وHakim: تُذكر للمقارنة وتُختبر عند الحاجة.
- **مؤثرات ElevenLabs** (SFX v2 بجودة 48kHz): مسموحة تجارياً على الخطط المدفوعة. **Eleven Music** مُدرَّب على بيانات مرخّصة، ومسموح للتسويق على الخطط الذاتية.

### 7.5 الترجمة
- 42 حرفاً كحد أقصى للسطر، وسطران كحد أقصى، و≤ 20 حرفاً في الثانية.
- نصدّر نسختين: ملف SRT منفصل، ونسخة بترجمة مرسومة داخل المشهد (Chromium) لا عبر FFmpeg.

### 7.6 ترخيص صور الخريطة في الفيديو
- **صور Esri الفضائية:** تخضع لاتفاقية Esri الرئيسية. صفحة شروط الإعلام تمنع استخدام لقطات الشاشة «للإعلان أو الأعمال». **قبل استخدامها في فيديو ترويجي يُفضَّل الحصول على موافقة**؛ الجهة المتبنّية قد تملك ترخيص ArcGIS مؤسسياً.
- **خريطة OpenStreetMap:** مسموحة في الفيديو مع ذكر «© OpenStreetMap contributors»، وهو ظاهر أصلاً في زاوية الخريطة.
- **اقتراح:** النسخة الأساسية للفيديو بالخريطة الفاتحة (OSM). وتُضاف لقطات الصور الفضائية فقط إن أكّدت الجهة حقها في استخدامها.

### 7.7 لقطات المسجد الحقيقية (إن احتجنا)
- لا نولّد صوراً للمسجد أو القبة أو المآذن إطلاقاً.
- إن احتجنا لقطة حقيقية، فالمصادر المرخّصة: Getty Images (224 لقطة لـ «Prophet's Mosque») وShutterstock (أكثر من 2000 لقطة للمدينة المنورة) وiStock. الأفضل لقطات الجهة نفسها الرسمية، ويوفّرها المالك.

---

## 8. المصادر

### التوثيق الرسمي والمستودعات
- HyperFrames، المستودع الرسمي: https://github.com/heygen-com/hyperframes
- HyperFrames، المقدمة: https://hyperframes.heygen.com/introduction
- HyperFrames، التصيير بدقة 4K: https://hyperframes.heygen.com/guides/4k-rendering
- HyperFrames، أوامر CLI: https://hyperframes.heygen.com/packages/cli
- HyperFrames على HeyGen: https://www.heygen.com/hyperframes
- HyperFrames، توثيق المطورين: https://developers.heygen.com/hyperframes-overview
- Remotion، مهارات الوكلاء: https://www.remotion.dev/docs/ai/skills
- Remotion، إضافة Claude Code: https://www.remotion.dev/docs/ai/claude-code-plugin
- Remotion، مستودع المهارات: https://github.com/remotion-dev/skills
- Remotion، الترخيص: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
- Remotion، الإصدارات: https://github.com/remotion-dev/remotion/releases
- Remotion على npm: https://www.npmjs.com/package/remotion
- Motion Canvas: https://motioncanvas.io/docs/
- Revideo وMidrender: https://midrender.com/revideo
- نقاش حول توقف Motion Canvas: https://news.ycombinator.com/item?id=47121188
- GSAP 3.13 (المجانية الكاملة): https://gsap.com/blog/3-13/
- GSAP، الترخيص القياسي: https://gsap.com/community/standard-license/
- GSAP، دالة splitArabicText: https://gsap.com/docs/v3/HelperFunctions/helpers/splitArabicText/
- GSAP، SplitText: https://gsap.com/docs/v3/Plugins/SplitText/
- منتدى GSAP عن دعم RTL في SplitText: https://gsap.com/community/forums/topic/24953-gsap-3-splittext-right-to-left-language-support/
- CSS‑Tricks، «GSAP مجاني بالكامل»: https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/
- Lottie، مشكلة RTL (Issue #3097): https://github.com/airbnb/lottie-web/issues/3097

### تحريك النص العربي والترجمة
- «Arabic letters stop joining the moment you split the word»: https://dev.to/esatturan/arabic-letters-stop-joining-the-moment-you-split-the-word-404c
- مكتبة split-arabic-text: https://github.com/MohamedAladel/split-arabic-text
- CSSWG، الفاصل الصفري والتشكيل العربي: https://github.com/w3c/csswg-drafts/issues/3861
- Microsoft، تطوير خطوط OpenType للعربية: https://learn.microsoft.com/en-us/typography/script-development/arabic
- libass، تشكيل العربية في FFmpeg: https://github.com/libass/libass/issues/682
- مثال إصلاح التشكيل المعقّد: https://github.com/EngDawood/video-caption/pull/13
- Netflix، دليل الترجمة العربية: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215517947-Arabic-Timed-Text-Style-Guide
- Netflix، الحد الأقصى للحروف في السطر: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215274938-What-is-the-maximum-number-of-characters-per-line-allowed-in-Timed-Text-assets

### المقارنات والأدلة
- HyperFrames vs Remotion (Voyager): https://voyager.so/blog/hyperframes-vs-remotion
- HyperFrames vs Remotion (ArceApps): https://arceapps.com/blog/hyperframes-vs-remotion-2026/
- HyperFrames vs Remotion (cookiesforai): https://cookiesforai.app/compare/hyperframes-vs-remotion
- Remotion vs Motion Canvas vs Revideo: https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026
- مهارة فيديوهات الإطلاق (Remotion): https://github.com/memex-lab/product-launch-video-skill
- مهارة الفيديو الترويجي من مرجع: https://github.com/aariz51/promo-video-skill
- إطار iPhone في Remotion: https://snapcn.dev/remotion-iphone-mockup
- Tella، Remotion مع Claude Code: https://www.tella.com/blog/how-to-use-remotion-agent-skills-with-claude-code
- إطارات الأجهزة وأفضل الممارسات: https://screenhance.com/device-mockups
- أمثلة فيديوهات التطبيقات 2026: https://advids.co/blog/app-promotional-video
- فيديوهات معاينة التطبيقات (ASO): https://appfollow.io/blog/aso-video-strategies
- مستويات صوت يوتيوب: https://pureaudioinsight.com/blogs/content-production/perfect-youtube-audio-levels-creators-technical-guide
- الصوت في الفيديو: https://mytasker.com/blog/the-complete-guide-to-sound-design-for-video-creators

### الصوت العربي
- ElevenLabs، العربية: https://elevenlabs.io/text-to-speech/arabic
- ElevenLabs، Eleven v3: https://elevenlabs.io/blog/eleven-v3
- ElevenLabs، المؤثرات الصوتية: https://elevenlabs.io/sound-effects
- ElevenLabs، شروط Eleven Music: https://elevenlabs.io/eleven-music-model-specific-terms
- مقارنة Hakim وElevenLabs للعربية: https://tryhakim.ai/en/alternatives/elevenlabs
- بدائل ElevenLabs للعربية (Munsit): https://munsit.com/blog/elevenlabs-alternatives

### الخرائط ولقطات المسجد
- Esri World Imagery: https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
- شروط إعلام Esri: https://www.esri.com/en-us/legal/terms/media
- مجتمع Esri، الاستخدام التجاري للخرائط الأساسية: https://community.esri.com/t5/arcgis-living-atlas-questions/use-of-basemaps-for-commercial-purposes/td-p/1344183
- OSM، الأسئلة القانونية: https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ
- Getty Images، المسجد النبوي: https://www.gettyimages.com/videos/prophets-mosque
- Shutterstock، المدينة المنورة: https://www.shutterstock.com/video/search/madinah

### منشورات X
- Remotion، إعلان مهارات الوكلاء («أنشئ فيديوهات بـ Claude Code فقط»): https://x.com/Remotion/status/2013626968386765291
- Jonny Burger (مؤسس Remotion)، دليل المبتدئين لـ Remotion والمهارات: https://x.com/JNYBGR/status/2015708193167479209
- Claire Vo، سير العمل: تثبيت المهارات، ثم إعادة بناء مكونات التطبيق بكسلاً بكسلاً، ثم القصة المصوّرة: https://x.com/clairevo/status/2014819359244615890
- Riley Brown، تجربة وكيل يصنع فيديوهات متحركة: https://x.com/rileybrown/status/2013868186807242855
- elvis (omarsar0)، Remotion مع Claude in Chrome: https://x.com/omarsar0/status/2021222728393687217
- مجتمع Claude Code، نصيحة استخدام Remotion وManim: https://x.com/claude_code/status/1947866828904272059
- Ole Lehmann، دليل لغير المبرمجين: https://x.com/itsolelehmann/article/2014740993208188959
- Muhammad Ayan، دليل فيديوهات الإطلاق: https://x.com/socialwithaayan/article/2104519430814482644
- 0xMovez، بناء استوديو موشن: https://x.com/0xMovez/article/2104216919033192746
- HeyGen، إعلان HyperFrames: https://x.com/HeyGen/status/2044827454460871072
- HeyGen، رابط المستودع الكامل: https://x.com/HeyGen/status/2048882212599390501
- HeyGen، مكوّنات واجهة جاهزة (`npx hyperframes add code`): https://x.com/HeyGen/status/2061848040823193758
- Rohan Paul، شرح HyperFrames: https://x.com/rohanpaul_ai/status/2044851401118138572
- Wesley، «فيديو الإطلاق نفسه صُنع 100% عبر Claude Code»: https://x.com/Ambani_Wessley/status/2044836037801755041
- Alex Prompter، «الكل يبني تطبيقاً، والقليل يصنع فيديو إطلاقه»: https://x.com/alex_prompter/status/2080339745922572745
