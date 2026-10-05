# المرحلة 5: البرومبت الرئيسي للإنتاج (Master Production Prompt)

> هذا البرومبت يكفي وحده لإعادة إنتاج الفيديوهين من الصفر بوكيل برمجي (مثل Claude Code) داخل هذا المستودع.
> مكتوب بالإنجليزية لأن الأدوات تعمل بها أفضل، والمحتوى عربي.

---

```text
ROLE
You are a senior motion designer and creative technologist. Produce two respectful, premium promo films for
"دليل زوار المسجد النبوي" (Prophet's Mosque Visitor Guide), a Vite + TypeScript PWA in this repository.

NON-NEGOTIABLES
1. Truth: every on-screen claim and voice-over line must exist in the app's code. Allowed claims and their
   sources are listed in video/docs/03-creative-brief.md §6. Forbidden: facility status / maintenance /
   alternatives, the admin simulator, "works fully offline", "free", voice guidance, Rawdah permit booking.
2. Sanctity: calm, reverent, dignified. No shakes, no whip pans, no 3D device spins, no whoosh stacks,
   no cut shorter than 2 s. Never generate or redraw images of the Prophet's Mosque, its dome or minarets.
   The mosque appears only inside real satellite imagery from the app (owner's phone screenshots).
3. Real UI only: use real screenshots of the app inside a CSS phone frame — never redraw the interface.
   Owner phone shots: video/assets/phone/clean/P-*.jpg (dark mode, Esri satellite).
   Interaction shots: video/assets/screens-dark/D-*.png (dark mode, captured from the built app;
   the duplicated gate description is hidden in captures — owner's decision; app code untouched).
   When the owner's extra shots N-01…N-08 exist in video/assets/phone/new/, prefer them.
4. Attribution: whenever Esri satellite imagery is visible, keep "Imagery © Esri, Maxar, Earthstar
   Geographics" visible (owner's decision).
5. Arabic text: animate WHOLE WORDS (never naive per-letter splitting). Per-letter only with zero-width
   joiners (kit.js splitArabicChars). Direction RTL on elements, NOT on <html> (blank-render bug).
   Latin digits everywhere, as in the app.
6. Brand: the app's tokens (src/styles/tokens.css, dark theme), fonts Noto Kufi Arabic 700 (display),
   IBM Plex Sans Arabic 400/600/700 (text), Noto Naskh Arabic (Urdu) — self-hosted from @fontsource.
   App icon = the gold eight-point star on #0E4D3A. Authority logo (permission granted) on a cream plate
   (#FBF9F4) — only in the official film's title and end card.
7. URL on screen and in the QR: https://masjidalnabawi.vercel.app (generate the QR; do not show the app's
   own QR panel, which still encodes almasjidalnabawi.vercel.app).

TOOLING (pinned)
- HyperFrames 0.8.134 (Apache-2.0) + GSAP 3.15 with CustomEase; render in headless Chrome + FFmpeg.
- Projects: video/production/official (1920×1080, 80 s) and video/production/guide (1080×1920, 40 s).
- Sources: video/production/src/{official,guide}.html + shared/kit.css + shared/kit.js.
  Build with `node video/production/build.mjs` (copies fonts, GSAP, icons, QR, screenshots, procedural SFX,
  voice-over takes) → `<project>/index.html`.
- Gates: `npx hyperframes lint` = 0 errors; `npx hyperframes snapshot --at …` stills reviewed per scene.

MOTION SYSTEM (single language, from the app)
- hfEase = cubic-bezier(.2,.7,.2,1) for entrances/exits/camera; hfSpring = cubic-bezier(.22,1.15,.36,1)
  for cards, chips, pins (≤15% overshoot). Durations 200–900 ms; drawing 0.9–1.6 s.
- Words rise 24 px + fade, 80–120 ms stagger. Scene changes: crossfade 400–700 ms (+ ≤24 px slide).
- Taps: gold 1.5–3 px ring at the real touch point, 450 ms. Zoom inside the screen (transform-origin on the
  detail), then a gold frame around the detail; reset zoom before zooming elsewhere.
- Every screen holds ≥ 1.8 s after its motion settles. Slow camera push on the phone (scale 1 → 1.03).

AUDIO
- Option A (owner's choice): soft effects, no music — room tone, soft taps, a card-slide whisper, a low bell
  shimmer on the logo moments, a light shimmer when the route appears.
- Voice-over: one calm MALE Modern Standard Arabic voice for both films (owner's choice), scripts with full
  diacritics in video/docs/04-asset-prompts.md (A: 11 lines, C: 7 lines). English track optional.
- Mix: VO −6 to −12 dB, effects 18–20 dB under VO; master −14 LUFS integrated, true peak ≤ −1 dBTP.

STORY — OFFICIAL (16:9, 80 s; message: "every gate, every door, every women's facility — one tap away,
in the visitor's language")
 0–6   gold star drawn → real satellite of the Haram with the 112-gate ring; "112 بوابة وباباً حول المسجد النبوي"
 6–11  four side chips (الشمالية/الجنوبية/الغربية/الشرقية) in the app's direction colours
 11–17 authority logo plate + app icon drawn + title «دليل زوار المسجد النبوي»
 17–24 phone enters (P-13 → tap «بوابات الحرم» → P-14); panel: 70 / 42 / 4 count-ups
 24–33 search «17» → Gate 17 (Umar ibn al-Khattab, women's section); frame: side chip, nearest gate, street
 33–39 a named gate (Bab al-Salam 1) «سبب التسمية»; panel: «22 باباً لها اسم وقصة» + gate-name chips
 39–46 tap «الخدمات النسائية» → P-15 → P-16; panel: 16 doors · 15 restroom complexes · 2 prayer areas (purple)
 46–54 Rawdah card → Gate 37 schedule; «لمن الوقت الآن… ومتى يتبدّل» + «الآن: وقت النساء»
 54–63 «رسم المسار من موقعي» → route + live navigation bar; panel: walkways · avoids mosque & Baqi · distance/time
 63–70 Gate 17's name in the six app languages (from data/i18n.json), building a calm list
 70–75 three badges: from the browser · no app-store download · no permissions to run
 75–80 logo plate · icon + title · QR + URL · «لتصل بيُسر… وتتفرّغ لزيارتك»

STORY — GUIDE (9:16, 40 s; message: "your gate in four steps: open · search · choose · walk")
 0–4  «تبحث عن بابك؟» over the real satellite women's view
 4–10 ① scan the QR or open the link → phone: landing → «ابدأ استخدام الخريطة» → map
 10–18 ② type «17» → result → Gate 17 card (side, nearest outer gate)
 18–26 ③ «الخدمات النسائية» (P-15, P-16) then «بوابات الحرم» (P-14)
 26–33 ④ «رسم المسار من موقعي» → route + navigation bar
 33–37 Rawdah card (who's turn now) + language menu (six languages)
 37–40 icon + title + QR + URL + «ثبّتها على جوالك كتطبيق»

CAPTIONS
- Burned-in (rendered inside the HTML scene, Chrome shaping) + separate SRT (ar, en) from the same cues
  (`python3 video/production/make-srt.py`). ≤ 42 chars/line, ≤ 2 lines, ≤ 17 chars/s.
- Variable `captions` (boolean) renders the clean master with `--variables '{"captions":false}'`.

DELIVERABLES
- official: 3840×2160 (`--resolution 4k`) and 1920×1080, 30 fps, with and without captions; SRT ar/en.
- guide: 1080×1920, 30 fps, with and without captions; SRT ar/en.

QA BEFORE DELIVERY (stills from the exported files, every scene)
- Arabic letters joined, RTL correct; no clipped/overlapping text; captions inside safe areas.
- Audio in sync with the cuts/taps; loudness −14 LUFS / −1 dBTP.
- Phone screens readable; nothing claimed that the app doesn't do; Esri credit visible with satellite imagery.
```

---

## حالة التنفيذ الحالية
انظر `06-qa-report.md`.
