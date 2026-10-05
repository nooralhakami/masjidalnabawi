# المرحلة 4: قائمة الأصول الخارجية والبرومبتات الجاهزة

> **هنا نتوقف.** لا يبدأ التنفيذ حتى توافق وتضع الأصول في أماكنها.
> كل برومبت داخل صندوق جاهز للنسخ كما هو.

---

## 0. ما أصنعه بالكود وحدي، وما يحتاج أصولاً خارجية

### ✅ بالكود وحدي (لا تحتاج تقديم شيء)
- **الخلفيات:** الليل الأخضر، والنقش الثماني الذهبي وحركة رسمه.
- **أيقونة التطبيق** ورسم خطوطها، و**العناوين المتحركة** والنص كلمة بكلمة.
- **الإحصاءات والعدّادات:** 112، 70، 42، 33، 22، 6.
- **عناصر الواجهة المضافة:** الشارات الزجاجية، والإطار الذهبي حول التفاصيل، ودوائر اللمس.
- **إطار الجوال** والتكبير داخله، والانتقالات.
- **الباركود** مولَّداً من `https://masjidalnabawi.vercel.app`.
- **عرض اسم الباب بست لغات** (من بيانات التطبيق).
- **الترجمة:** المدمجة، وملفات SRT بالعربية والإنجليزية.
- **مزج الصوت ومعايرته:** −14 LUFS، والذروة −1 dBTP.
- **التصيير:** 4K و1080p.

### 📦 أصول خارجية (هذا الملف)
| # | الأصل | النوع | الأداة | إلزامي؟ |
|---|---|---|---|---|
| A | تعليق صوتي عربي للنسخة الرسمية | صوت | ElevenLabs | ✅ |
| B | تعليق صوتي إنجليزي للنسخة الرسمية | صوت | ElevenLabs | ✅ (مسار بديل) |
| C | تعليق صوتي عربي للنسخة الإرشادية | صوت | ElevenLabs | ✅ |
| D | تعليق صوتي إنجليزي للنسخة الإرشادية | صوت | ElevenLabs | اختياري |
| E | مؤثرات صوتية ناعمة (الخيار أ) | مؤثرات | ElevenLabs Sound Effects | حسب قرارك |
| F | خلفية صوتية هادئة (الخيار ب) | موسيقى | ElevenLabs Music | حسب قرارك |
| G | لقطات جوال إضافية بالصور الفضائية | صور أو تسجيل شاشة | جوالك | ✅ (8 لقطات) |
| H | لقطة جوية حقيقية للمسجد النبوي | فيديو | مرخّصة: مركز إعلام الجهة، أو Getty أو Shutterstock | اختياري |
| I | شعار الهيئة بصيغة متجهة SVG | صورة | من الجهة | اختياري (لدينا PNG بعرض 1024) |

**لماذا ElevenLabs؟** بحث المرحلة 2 وجد أنها الأعلى طبيعية في الفصحى، مع أصوات فصحى رجالية ونسائية، وتجمع الصوت والمؤثرات والموسيقى في مكان واحد، وكلها مسموحة تجارياً على **الخطة المدفوعة** (من خطة Starter).
- **تنبيه:** الخطة المجانية لا تسمح بالاستخدام التجاري.
- **بديل للصوت العربي:** Azure AI Speech، أو منصات عربية مثل Munsit وHakim. ويبقى المعلّق البشري المحترف الخيار الأرقى إن توفّرت الميزانية.

---

## A. التعليق الصوتي العربي: النسخة الرسمية

| المواصفة | القيمة |
|---|---|
| الأداة | ElevenLabs › Text to Speech |
| النموذج | **Eleven Multilingual v2** (الأثبت في السرد الطويل). البديل Eleven v3 للتعبير الأدق، مع وسوم المزاج |
| الصوت | من مكتبة الأصوات (Voice Library): ابحث بـ `Arabic narrator calm male` واختر صوتاً **فصيحاً** بنبرة هادئة رخيمة، أو صمّمه بالبرومبت أدناه |
| الإعدادات (Multilingual v2) | الثبات (Stability) 60%، والتشابه (Similarity) 75%، والأسلوب (Style) 5%، ومعزّز المتحدث (Speaker boost) مفعّل، والسرعة (Speed) 0.90 |
| الصيغة | **WAV بتردد 48kHz وعمق 24-bit**، أحادي (mono). إن لم يتوفر فـ MP3 بتردد 44.1kHz و192kbps |
| السرعة والنبرة | 125–135 كلمة في الدقيقة، ونبرة دافئة وقورة **بلا حماس إعلاني**، ووقفة نصف ثانية بين الجمل |
| التقسيم | **ملف لكل جملة** (11 ملفاً) لتسهيل المزامنة، أو ملف واحد إن كان أسهل عليك، وأقسّمه أنا |
| المكان | `video/assets/audio/vo/official-ar/01.wav` … `11.wav`، أو `video/assets/audio/vo/official-ar.wav` |

### A.1 برومبت تصميم الصوت (ElevenLabs › Voices › Voice Design)، إن لم تجد صوتاً مناسباً
```text
A calm, warm, mature Arabic male narrator in his 40s speaking Modern Standard Arabic (Fusha) with precise classical pronunciation and clear articulation of every letter. Deep, soft, reassuring timbre; unhurried, reverent and dignified delivery suitable for a respectful public-service film about the Prophet's Mosque in Madinah. Studio-quality, close-mic, no reverb, no background noise, no dramatic or advertising energy.
```
**نص المعاينة** الذي تطلبه الأداة:
```text
حَوْلَ المَسْجِدِ النَّبَوِيِّ مِئَةٌ وَاثْنَتَا عَشْرَةَ بَوَّابَةً وَبَاباً، وَكُلُّ زَائِرٍ يَبْحَثُ عَنْ طَرِيقِهِ إِلَيْهَا بِطُمَأْنِينَة.
```

### A.2 النص المشكول للتوليد (انسخ كل سطر في توليد مستقل)
التشكيل يمنع أخطاء النطق في الفصحى. الأرقام مكتوبة بالحروف عمداً.

```text
01  حَوْلَ المَسْجِدِ النَّبَوِيِّ مِئَةٌ وَاثْنَتَا عَشْرَةَ بَوَّابَةً وَبَاباً،
02  وَكُلُّ زَائِرٍ يَبْحَثُ عَنْ طَرِيقِهِ إِلَيْهَا بِطُمَأْنِينَة.
03  دَلِيلُ زُوَّارِ المَسْجِدِ النَّبَوِيّ: خَرِيطَةٌ تَفَاعُلِيَّةٌ تَجْمَعُ البَوَّابَاتِ وَالأَبْوَابَ وَالخَدَمَاتِ فِي مَكَانٍ وَاحِد.
04  سَبْعُونَ بَوَّابَةً خَارِجِيَّةً، وَاثْنَانِ وَأَرْبَعُونَ بَاباً لِلْمَسْجِد، مُرَتَّبَةً بِأَلْوَانِ جِهَاتِهَا الأَرْبَع.
05  اُكْتُبْ رَقْمَ البَابِ أَوِ اسْمَهُ، فَتَظْهَرُ جِهَتُهُ، وَأَقْرَبُ بَوَّابَةٍ خَارِجِيَّةٍ إِلَيْهِ، وَأَقْرَبُ شَارِع.
06  وَلِأَبْوَابٍ كَثِيرَةٍ قِصَّةٌ فِي اسْمِهَا، يَرْوِيهَا الدَّلِيلُ بِإِيجَاز.
07  وَلِلزَّائِرَاتِ تَصْنِيفٌ خَاصّ: أَبْوَابُ القِسْمِ النِّسَائِيّ، وَدَوْرَاتُ المِيَاه، وَالمُصَلَّيَات... فِي لَمْسَةٍ وَاحِدَة.
08  وَعِنْدَ البَابِ رَقْمِ سَبْعَةٍ وَثَلَاثِين، يُظْهِرُ الدَّلِيلُ لِمَنِ الوَقْتُ الآنَ فِي الرَّوْضَةِ الشَّرِيفَة، وَمَتَى يَتَبَدَّل.
09  وَمِنْ مَوْقِعِكَ، يَرْسُمُ مَسَارَ مَشْيٍ عَبْرَ مَمَرَّاتِ السَّاحَات، بِالمَسَافَةِ وَالوَقْت، وَيُحَدِّثُ مَا تَبَقَّى وَأَنْتَ تَمْشِي.
10  بِسِتِّ لُغَات، وَمِنَ المُتَصَفِّحِ مُبَاشَرَةً، دُونَ تَنْزِيلٍ مِنَ المَتْجَر، وَدُونَ أَيِّ إِذْنٍ لِيَعْمَل.
11  دَلِيلُ زُوَّارِ المَسْجِدِ النَّبَوِيّ... لِتَصِلَ بِيُسْر، وَتَتَفَرَّغَ لِزِيَارَتِك.
```

**إن استخدمت Eleven v3:** أضف في بداية كل سطر وسماً واحداً هادئاً:
```text
[calm, warm, reverent narration]
```
لا تستخدم وسوم الحماس أو الضحك.

**فحص قبل التسليم:** استمع إلى المواضع التالية تحديداً:
- «النَّبَوِيّ» (الياء المشددة)
- «اثْنَتَا عَشْرَةَ»
- «المُصَلَّيَات»
- «الرَّوْضَةِ الشَّرِيفَة»
- «مُطْمَئِنّاً» (في النسخة الإرشادية)

أعد توليد أي جملة فيها خطأ نطق.

---

## B. التعليق الصوتي الإنجليزي: النسخة الرسمية

| المواصفة | القيمة |
|---|---|
| النموذج | Eleven Multilingual v2 (أو Eleven v3) |
| الصوت | `calm documentary narrator`، بلكنة بريطانية أو أمريكية محايدة، رجالي ليوافق النسخة العربية |
| الإعدادات | الثبات 55%، والتشابه 75%، والأسلوب 5%، والسرعة 0.92 |
| الصيغة | WAV بتردد 48kHz وعمق 24-bit، أحادي |
| المكان | `video/assets/audio/vo/official-en/01.wav` … `11.wav` |

```text
01  Around the Prophet's Mosque stand one hundred and twelve gates and doors —
02  and every visitor wants to find their way with peace of mind.
03  The Prophet's Mosque Visitor Guide: one interactive map for every gate, door and service.
04  Seventy outer gates and forty-two mosque doors, colour-coded by their four sides.
05  Type a door's number or name, and see its side, the nearest outer gate, and the nearest street.
06  Many doors carry a story in their name — the guide tells it in brief.
07  For women visitors, a dedicated view: the women's section doors, restrooms and prayer areas — in one tap.
08  At Gate thirty-seven, the guide shows whose turn it is now at the Noble Rawdah, and when it changes.
09  From where you stand, it draws a walking route through the plaza walkways, with distance and time — and updates what's left as you walk.
10  Six languages. Straight from the browser — no app-store download, no permissions needed to run.
11  The Prophet's Mosque Visitor Guide — so you arrive with ease, and give your visit your whole heart.
```

**ملاحظة نطق:** «Rawdah» تُنطق «RAW-dah». إن أخطأ فيها الصوت، اكتبها مؤقتاً `Row-dah` في التوليد.

---

## C. التعليق الصوتي العربي: النسخة الإرشادية

| المواصفة | القيمة |
|---|---|
| الصوت | **نسائي** فصيح، هادئ وودود. ابحث في المكتبة بـ `Arabic female narrator calm MSA`، أو صمّمه بالبرومبت أدناه |
| الإعدادات | الثبات 55%، والتشابه 75%، والأسلوب 10%، والسرعة 0.95 (أسرع قليلاً من الرسمية، وما زالت هادئة) |
| الصيغة | WAV بتردد 48kHz وعمق 24-bit، أحادي |
| المكان | `video/assets/audio/vo/guide-ar/01.wav` … `07.wav` |

**برومبت تصميم الصوت:**
```text
A warm, gentle and clear Arabic female narrator in her 30s speaking Modern Standard Arabic (Fusha) with careful, correct pronunciation. Friendly, calm and reassuring — like a kind guide helping a visitor at the Prophet's Mosque. Unhurried pace, soft smile in the voice, no advertising energy. Studio-quality, close-mic, no reverb, no background noise.
```

**النص المشكول:**
```text
01  تَبْحَثُ عَنْ بَابِك... أَوْ عَنْ أَقْرَبِ مَرْفِقٍ لِلزَّائِرَات؟
02  اِمْسَحِ الرَّمْزَ، أَوِ افْتَحِ الرَّابِط... مِنَ المُتَصَفِّحِ مُبَاشَرَة.
03  اُكْتُبْ رَقْمَ البَوَّابَةِ أَوِ اسْمَهَا، فَتَرَى جِهَتَهَا، وَأَقْرَبَ بَوَّابَةٍ خَارِجِيَّةٍ إِلَيْهَا.
04  وَلِلزَّائِرَات: الخَدَمَاتُ النِّسَائِيَّة... أَبْوَابُ القِسْمِ النِّسَائِيّ، وَدَوْرَاتُ المِيَاه، وَالمُصَلَّيَات.
05  ثُمَّ: رَسْمُ المَسَارِ مِنْ مَوْقِعِي... وَامْشِ مُطْمَئِنّاً.
06  وَبِطَاقَةُ الرَّوْضَةِ تُخْبِرُكَ لِمَنِ الوَقْتُ الآن... بِسِتِّ لُغَات.
07  دَلِيلُ زُوَّارِ المَسْجِدِ النَّبَوِيّ... ثَبِّتْهُ عَلَى جَوَّالِك.
```

## D. التعليق الصوتي الإنجليزي: النسخة الإرشادية (اختياري)
الإعدادات نفسها مع صوت نسائي إنجليزي هادئ. المكان: `video/assets/audio/vo/guide-en/01.wav` … `07.wav`.

```text
01  Looking for your gate — or the nearest women's facility?
02  Scan the code or open the link — right in your browser.
03  Type a gate's number or name to see its side and the nearest outer gate.
04  For women visitors: "Women's Services" — women's section doors, restrooms and prayer areas.
05  Then: "Draw route from my location" — and walk with peace of mind.
06  The Rawdah card shows whose turn it is now — in six languages.
07  The Prophet's Mosque Visitor Guide — add it to your home screen.
```

---

## E. المؤثرات الصوتية الناعمة: الخيار (أ) بلا موسيقى

| المواصفة | القيمة |
|---|---|
| الأداة | ElevenLabs › Sound Effects (نموذج SFX v2، بجودة 48kHz) |
| قوة الالتزام بالبرومبت (Prompt influence) | 60% |
| الصيغة | WAV بتردد 48kHz وعمق 24-bit، ستيريو |
| العدد | ولّد **3 نسخ** لكل مؤثر، وضعها كلها بأسماء `-a` و`-b` و`-c`، وأختار أنا الأنسب |
| المكان | `video/assets/audio/sfx/` |

| الملف | المدة | البرومبت (انسخه كما هو) |
|---|---|---|
| `sfx-roomtone.wav` | 22 ث (تكرار سلس) | `Very quiet, warm ambient room tone of a vast serene marble hall at night, soft gentle air, faint distant hush, no voices, no footsteps, no music, no birds, seamless loop` |
| `sfx-tap.wav` | 0.4 ث | `A single very soft, muted, warm tap on a smartphone glass screen, short and clean, gentle low click, no reverb tail` |
| `sfx-sheet.wav` | 0.6 ث | `A soft, smooth, short paper-like slide of a card panel gliding up on a premium app interface, gentle, airy, no whoosh` |
| `sfx-type.wav` | 0.6 ث | `Two soft muted smartphone keyboard taps in quick succession, gentle and quiet, no mechanical clicks` |
| `sfx-route.wav` | 1.6 ث | `A subtle, soft, rising airy shimmer like a thin line of light being drawn, calm and delicate, low volume, no whoosh, no riser` |
| `sfx-chime.wav` | 3.0 ث | `A single gentle, warm, low bell-like shimmer with a slow soft decay, meditative and reverent, no melody, no rhythm` |
| `sfx-count.wav` | 0.8 ث | `Very soft, delicate ticking of small numbers counting up, almost inaudible, warm and minimal` |

---

## F. الخلفية الصوتية الهادئة: الخيار (ب)

| المواصفة | القيمة |
|---|---|
| الأداة | ElevenLabs › Music (Eleven Music). مدرَّب على بيانات مرخّصة، ومسموح للتسويق على الخطط المدفوعة |
| الصيغة | WAV بتردد 48kHz وعمق 24-bit، ستيريو |
| المدد | **82 ثانية** للرسمية، و**42 ثانية** للإرشادية (أطول بثانيتين للتلاشي) |
| المكان | `video/assets/audio/music/official-bed.wav` و`video/assets/audio/music/guide-bed.wav` |

**البرومبت (للنسختين، مع تغيير المدة فقط):**
```text
Instrumental only. A reverent, contemplative ambient pad for a respectful public-service film about the Prophet's Mosque in Madinah. Warm, soft, slowly evolving sustained tones, gentle airy texture, deep and calm, like early-morning stillness. No percussion, no drums, no beat, no rhythm, no melody line, no vocals, no choir, no strings section, no piano motifs, no risers, no impacts, no drops. Constant low dynamics, very sparse, spacious. Soft fade-in over the first 4 seconds and soft fade-out over the last 4 seconds. Duration: 82 seconds.
```
(للنسخة الإرشادية اكتب `Duration: 42 seconds`.)

**بعد التوليد:** استمع وتأكد من:
- خلوّها من أي إيقاع أو لحن واضح أو صوت بشري.
- أنها لا تشبه موسيقى ترفيهية.

إن لم ترضك النتيجة، فالخيار (أ) هو الأسلم.

---

## G. لقطات جوال إضافية (مطلوبة لتكتمل القصة بالصور الفضائية)

لقطاتك الحالية ممتازة، لكنها لا تغطي التفاعل. أحتاج **8 لقطات** بالطريقة نفسها: الوضع الليلي، والصور الفضائية، والعربية.

| الملف | ماذا تفعل قبل الالتقاط |
|---|---|
| `N-01-search-17.jpg` | افتح الخريطة، واكتب **17** في البحث، والتقط **وقائمة النتائج ظاهرة** (قبل اختيار أي نتيجة) |
| `N-02-gate17-sheet.jpg` | اختر «باب عمر بن الخطاب - رقم 17». البطاقة في **وضعها الأول (نصف الشاشة)** دون سحبها، ويظهر الدبوس الذهبي عليه رقم 17 |
| `N-03-gate39-sheet.jpg` | ابحث **39** واختر «باب النساء - رقم 39»، والبطاقة نصف الشاشة |
| `N-04-gate1-sheet.jpg` | ابحث **1** واختر «باب السلام - رقم 1»، والبطاقة نصف الشاشة |
| `N-05-gate37-schedule.jpg` | اضغط بطاقة الروضة في الأسفل، فتفتح بطاقة باب 37. اسحبها للأعلى قليلاً حتى يظهر **جدول الروضة** كاملاً |
| `N-06-route-nav.jpg` | ⚠️ **فقط إن كنت عند الحرم** (التطبيق لا يرسم المسار إن كنت أبعد من 3 كم): اختر باباً، ثم «رسم المسار من موقعي»، وانتظر ظهور المسار وشريط الملاحة (الدقائق والأمتار)، ثم التقط |
| `N-07-lang-menu.jpg` | اضغط زر **AR** في الأعلى، والتقط وقائمة اللغات الست مفتوحة |
| `N-08-gate17-en.jpg` | اختر English ثم افتح الباب 17 مرة أخرى، والتقط البطاقة بالإنجليزية |

**المواصفات:**
- **الدقة:** دقة جوالك الأصلية (1260×2800 ممتازة)، بصيغة PNG أو JPG.
- **قبل الالتقاط:** فعّل وضع «عدم الإزعاج» حتى لا تظهر إشعارات. أقصّ أنا شريطي الحالة والتنقّل.
- **الإضاءة:** لا تهمّ (لقطة شاشة لا تصوير).
- **المكان:** أرسلها هنا في المحادثة، وأضعها أنا في `video/assets/phone/new/`.

**(أفضل وأقوى، واختياري): تسجيل شاشة بالفيديو** لنفس الخطوات (10–20 ثانية لكل خطوة)، بدقة 1080p أو أعلى، و60fps إن أمكن، بالاتجاه العمودي، وبصيغة MP4. التسجيل يعطي حركة حقيقية للخريطة (التكبير وانزلاق البطاقة) بدل محاكاتها.

**إن لم تكن عند الحرم:** نستخدم لقطة المسار التي التقطتُها بموقع محاكى، بخلفية رملية. أو نعرض المسار في مشهد واحد فقط بإطار مقصوص.

---

## H. لقطة جوية حقيقية للمسجد النبوي (اختيارية، للنسخة الرسمية فقط)

**لا تُولَّد بالذكاء الاصطناعي إطلاقاً.** المصادر حسب الأفضلية:
1. **المركز الإعلامي للهيئة أو الجهة نفسها:** الأفضل والأسلم ترخيصاً.
2. **Getty Images:** ابحث بـ `Prophet's Mosque aerial` أو `Al-Masjid an-Nabawi drone` (فيها 224 لقطة لـ «Prophet's Mosque»).
3. **Shutterstock:** ابحث بـ `Madinah Prophet's Mosque aerial 4K`.

| المواصفة | القيمة |
|---|---|
| المحتوى | لقطة جوية واسعة للمسجد والساحات، بحركة كاميرا **بطيئة جداً** (اقتراب أو دوران خفيف)، نهاراً أو في الساعة الزرقاء. **بلا وجوه قريبة للمصلين** |
| الدقة | 4K (3840×2160) أو أعلى |
| المدة | 8–12 ثانية (نستخدم 5–6 منها) |
| معدل الإطارات | 25 أو 30 أو 60 fps (لا 24 إن أمكن) |
| الصيغة | MP4 (H.264/H.265) أو ProRes |
| الترخيص | ترخيص تجاري يشمل الإعلان والنشر الرقمي، **واحفظ إثبات الشراء** |
| المكان | `video/assets/footage/aerial-masjid-nabawi.mp4` |

**إن لم تتوفر:** تبدأ النسخة الرسمية بالصور الفضائية داخل التطبيق (لقطتك `P-14`)، كما في السيناريو.

---

## I. شعار الهيئة بصيغة متجهة (اختياري)
لدينا `haramain-logo-hires.png` بدقة 1024×568، وهو كافٍ لدقة 1080p. للخاتمة بدقة 4K يُفضَّل **SVG** أو PNG بعرض 3000px بخلفية شفافة.

**المكان:** `video/assets/brand/haramain-logo.svg`

---

## J. قائمة الاستلام (أراجعها قبل التنفيذ)

```
video/assets/
├── audio/
│   ├── vo/official-ar/01…11.wav     (A) ✅ إلزامي
│   ├── vo/official-en/01…11.wav     (B) ✅
│   ├── vo/guide-ar/01…07.wav        (C) ✅
│   ├── vo/guide-en/01…07.wav        (D) اختياري
│   ├── sfx/*.wav                    (E) إن اخترت (أ)
│   └── music/official-bed.wav, guide-bed.wav   (F) إن اخترت (ب)
├── phone/new/N-01…N-08              (G) ✅ ترسلها هنا وأضعها أنا
├── footage/aerial-masjid-nabawi.mp4 (H) اختياري
└── brand/haramain-logo.svg          (I) اختياري
```

**ملفات الصوت والفيديو** لا تُرفع عبر المحادثة عادةً. ضعها في أي فرع من المستودع، أو في مجلد مشترك (Google Drive مثلاً) وأرسل الرابط، وأتولى نقلها.

---

## K. قرارات مطلوبة قبل التنفيذ (من `03-creative-brief.md`)
1. **الصوت الخلفي:** (أ) مؤثرات بلا موسيقى، أم (ب) خلفية هادئة، أم (أ) للرسمية و(ب) للإرشادية؟
2. **الأصوات:** رجالي للرسمية ونسائي للإرشادية؟
3. **الافتتاحية الرسمية:** من الصور الفضائية في التطبيق، أم لقطة جوية مرخّصة؟
4. **صور Esri الفضائية:** نقبل استخدامها مع إبقاء نسبة المصدر ظاهرة، أم تتأكد الجهة من الترخيص أولاً؟
