# Motion brief: 9:16 UI teaser for «دليل زوار المسجد النبوي»

- **Concept:** one blue location dot (the site's `#0288D1`) travels through a single world and links every move: search field → result → place card → map route → car park → feature cards → arrival → story → back to the field (seamless loop).
- **Format:** 1080×1920, 60 fps, 1178 frames = 19.633 s = 36 beats at 110.02 BPM (beat = 0.5454 s, chosen so the loop lands on a whole frame).
- **Build:** one HTML file (`src.html` → `index.html` via `build.mjs`), every style computed in `window.seek(t)`; one camera transform (log-space zoom); closed-form springs; route draw, dot position and distance counter share one progress value (`pathLength="1"`). Rendered with Playwright frame by frame (`render.mjs`, no sub-frame blending, so text stays sharp during camera moves).
- **Facts (from the site's own code, main):** «مجمع دورات النساء 215», west side, nearest gate «بوابة 321 · 86 م», nearest street «طريق السلام»; 11 filters with real counts; Quba story text and «اللهم صل وسلم على نبينا محمد» / «صلِّ على النبي ﷺ» verbatim; ramp yellow `#F5D90A`. Facility status omitted (owner's rule). Offline card reads «يفتح دون إنترنت · بعد أول زيارة» (accurate). Map, car park and corridors are stylised, not mapped.
- **Fonts:** IBM Plex Sans Arabic, Noto Kufi Arabic, Noto Naskh Arabic (ﷺ) — SIL OFL, self-hosted.
- **Audio:** `audio.py` synthesizes the bed (warm chords, a soft note per beat, low pulse every two beats, light shaker) and a UI sound on every contact; rendered twice and the second pass kept so tails wrap; −14 LUFS, −1.5 dBTP. No licensed material.

## Beat map
| Beats | Time (s) | Event |
|---|---|---|
| 0–1 | 0–0.55 | fingertip hovers, taps the field |
| 1–3 | 0.55–1.6 | dot springs out of the field, camera follows |
| 4 · 5 · 6 | 2.2 · 2.7 · 3.3 | «2», «21», «215» typed; dot lands at the caret on each key; 11 pills glide (4–9) |
| 7 · 8 | 3.8 · 4.4 | dot on first result; place card slides up |
| 10 | 5.5 | dot presses «رسم المسار من موقعي», drops onto the map |
| 10.6–16 | 5.8–8.7 | route draws itself; dot walks it; lit ahead / faint behind; counter 420 → 0 م |
| 17 | 9.3 | walk/car switch flips |
| 18–20.3 | 9.8–11.1 | car-park ring along the one-way arrows, up the yellow ramp |
| 21 · 23 · 25 | 11.5 · 12.5 · 13.6 | cards: 26 لغة (scripts scroll, RTL/LTR) · يفتح دون إنترنت (signal fades, map stays) · وقت الروضة · مباشر (ring ticks) |
| 28 | 15.3 | arrival: card turns to «وصلتَ» + masjidalnabawi.vercel.app, haptic pulse |
| 30–33 | 16.4–18.0 | stories star → Quba story → «صلِّ على النبي ﷺ» |
| 33–36 | 18.0–19.63 | pull back to the whole world; dot returns home; frame 1177 ≈ frame 0 (SSIM 0.998) |

## QA
- ffprobe: h264 High, 1080×1920, yuv420p, 60/1, 1178 frames, AAC 48 kHz stereo; −14.1 LUFS, peak −1.5 dB.
- Per-beat stills and fast-move sheets reviewed. The first render blended sub-frames and doubled text on fast moves; the final render is sharp frame by frame.
- freezedetect flags 6.65–8.85 s: the dot walking the route moves slowly (with the counter ticking); intended.
