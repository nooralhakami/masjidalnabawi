---
name: lean-motion-video
description: Low-cost pipeline for motion graphics and videos (ads, explainers, reels, intro films): storyboard first, then one scene per round saved under scenes/, then one assemble script. Use together with motion-design-plus for any code-rendered video, and never reload earlier scenes into context.
---

# lean-motion-video

Goal: cut video-session cost (past sessions: 88$ and 135$ with 400k+ token contexts). Context stays small because each scene is a self-contained file and later rounds never re-read earlier ones.

Layout: `video/<slug>/` with `storyboard.md`, `scenes/_shared/`, `scenes/NN-name/`, `scripts/assemble.*`.
Do not commit rendered binaries (mp4/wav); add them to `.gitignore` unless the owner asks.

## Phase 0: Storyboard (no animation code)
1. Write `storyboard.md`: per scene `id`, start/duration, FINAL Arabic text, visual, sfx/music cue, assets.
2. Create `scenes/_shared/tokens` once: palette, fonts, easing, timing grid (beats), RTL rules.
3. Owner approves. Only then start Phase 1.

## Scene rounds (exactly one scene per round)
1. Read only: that scene's storyboard row + `_shared/tokens`. Not other scenes.
2. Build `scenes/NN-name/` as a self-contained unit with `meta.json` `{start, duration, assets, steps}`.
3. Preview cheaply: render 3 timestamps (start, mid, end) at low resolution. Check text correctness, RTL order, overlap, safe margins.
4. Fix, max 2 passes. Then mark done.
5. Append to `CHECKPOINT.md` table: `| scene | steps used | notes |`. This is the measurement for the 80% reduction goal.

## Assemble (once)
`scripts/assemble.*` reads every `meta.json`, orders by `start`, composes the timeline, renders full resolution one time, mixes audio. Then one QA pass: text, rhythm, audio sync, duration. Deliver the file; do not re-render for cosmetic tweaks without owner request.

## Budget
- No cap on tool calls. Use `checkpoint-loop` to hand off if a session gets long.
- Reuse assets by path from `_shared/`; never paste base64 or whole scene code into chat.
- Report in Arabic: what the viewer sees, scene by scene, plus steps used.
