# v0 — Post-deploy verification prompt

Copy everything below the line into v0 after the new files are published.

---

The new version of **Prophet's Mosque Visitor Guide** has just been published to
`https://masjidalnabawi.vercel.app/`. Verify the deployment end to end, then report the results.
**Do not change any code unless a check fails.** If something fails, explain the cause, propose the
smallest fix, and keep every test passing. Read `V0-PROMPT.md` first for the project rules.

## 1. Deployment and repository
- [ ] Vercel project **Framework = Vite** (not Next.js). Build command `npm run build`, output `dist`
      (matches `vercel.json`).
- [ ] The build log shows `vite build`, then `PWA … precache ~35 entries`, with no errors or warnings about Next.js.
- [ ] The repository root has **no** `app/`, `components/`, `lib/`, `next.config.mjs`, `components.json`,
      `pnpm-lock.yaml`, `dist/` or `test-results/`.
- [ ] The deployed commit equals the latest commit on the main branch.

## 2. Automated checks (run in a clean checkout)
```bash
npm ci
npm test                         # expect 141 passed
npx playwright install chromium
npm run test:e2e                 # expect 32 passed
npm run build                    # expect no type errors
```
- [ ] All three succeed with the expected counts. Paste the summary lines.

## 3. Live URL checks
| URL | Expect |
|---|---|
| `/` | 200, Arabic landing page with the title «دليل زوار المسجد النبوي» visible before JS runs (view source) |
| `/map.html` | 200, map with header, filter pills (`الكل 280`) and the Rawdah card |
| `/map.html?poi=204` | opens the card for restrooms 204 with a gold pin on the map |
| `/manifest.webmanifest` | `lang: ar`, `dir: rtl`, `start_url: ./map.html`, icons 192 and 512 (with maskable) |
| `/sw.js` | 200; after one visit, the app shell loads offline (DevTools → Network → Offline → reload) |
| `/robots.txt` | 200 |

- [ ] Decode the QR code on the landing page: it must equal **`https://masjidalnabawi.vercel.app/`**, and the
      "direct link" field on the landing page must show the same URL.
- [ ] No errors in the browser console on `/`, `/map.html` or `/map.html?poi=204`.
- [ ] HTTPS only; no mixed-content warnings.

## 4. Functional checks (phone size 390×844, Arabic and English)
- [ ] Each filter pill shows its places. **Parking** appears only with its own pill or while searching.
- [ ] Search `٢١٥` (Arabic digits) finds 215, `1A` finds parking 1, and `Al Baik` works from the Turkish UI.
- [ ] The language menu switches all six languages. Arabic and Urdu are RTL, the rest LTR, and digits stay Latin.
- [ ] Dark/light toggle works on both pages and is remembered between them.
- [ ] Map rotation buttons work, and the compass needle points north and resets on tap.
- [ ] "Hide markers" hides everything except the selected place.
- [ ] `?admin=1`: elevator works on 215 close 216 together. The card for 215 explains why and suggests the nearest open alternative.
- [ ] The share button in a place card copies or shares `…/map.html?poi=ID`.

## 5. Live location (real phone at or near the mosque, HTTPS)
- [ ] «موقعي الآن»: a blue dot appears within about 1 s and **keeps moving while walking**, with no freezing.
- [ ] Route to any place:
  - the route is drawn,
  - the navigation bar shows minutes and metres,
  - remaining metres **decrease** walking towards it,
  - remaining metres **increase** and «أنت تبتعد عن الوجهة» appears when walking back.
- [ ] The direction cone follows the real walking direction (and the phone compass when standing; iPhone asks permission once).
- [ ] A tap on the map during a route does **not** end it. «إنهاء المسار» ends it.
- [ ] Note the phone model, the browser, and typical accuracy shown (±m) in the report.

## 6. Lighthouse (mobile, production URL)
| Page | Accessibility | Best practices | SEO | Performance |
|---|---|---|---|---|
| `/` | 100 | 100 | 100 | ≥ 85 |
| `/map.html` | 100 | ≥ 96 | 100 | ≥ 75 |

- [ ] Report the four scores for each page. Accessibility below 100 is a failure to fix.

## 7. Report format
Reply with:
1. A table of every check above: ✅ / ❌, with short evidence (numbers, screenshot, console line).
2. For each ❌: the cause, the file, and the proposed minimal fix. Do not apply it until the owner approves, unless it is a deployment setting.
3. The Lighthouse scores, the test summaries, and the phone used for the location test.
