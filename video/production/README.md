# إنتاج الفيديو (HyperFrames)

| المسار | الوظيفة |
|---|---|
| `src/official.html` | النسخة الرسمية 16:9 (80 ث): المشاهد والحركة والترجمة والأصوات |
| `src/guide.html` | النسخة الإرشادية 9:16 (40 ث) |
| `shared/kit.css` و`shared/kit.js` | الهوية (ألوان التطبيق وخطوطه)، وإطار الجوال، ومنطق الحركة الموحّد |
| `build.mjs` | يجهّز المشروعين: الخطوط، وGSAP، وأيقونات التطبيق، والباركود، واللقطات، والمؤثرات، والتعليق الصوتي |
| `make-srt.py` | يولّد ملفات الترجمة SRT (عربي وإنجليزي) من نفس توقيتات الترجمة المدمجة |
| `official/` و`guide/` | مشروعا HyperFrames (يُولَّد فيهما `index.html` و`assets/`) |
| `out/` | ملفات SRT والفيديوهات المصدّرة |

```bash
cd video/production && npm install          # GSAP
cd ../.. && npm install && npm run build    # خطوط التطبيق (@fontsource) وqrcode-generator
node video/production/build.mjs
cd video/production/official && npx hyperframes@0.8.134 lint
npx hyperframes@0.8.134 snapshot . --at 5,20,30
npx hyperframes@0.8.134 render --resolution 4k --fps 30 --quality high --output ../out/official-4k.mp4
npx hyperframes@0.8.134 render --variables '{"captions":false}' --output ../out/official-1080p-clean.mp4
python3 video/production/make-srt.py
```

التعليق الصوتي: ضع الملفات في `video/assets/audio/vo/official-ar/01.wav…` و`guide-ar/01.wav…` ثم أعد البناء.
