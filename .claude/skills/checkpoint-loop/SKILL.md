---
name: checkpoint-loop
description: Split any task of more than ~10 steps into small phases tracked in CHECKPOINT.md, run exactly one phase per session, then stop and hand off to a fresh session. Use at the start of any large task, when a session nears 25 tool calls, when the owner says "continue" / "تابع" / "اكمل", or when resuming from an existing CHECKPOINT.md.
---

# checkpoint-loop

Goal: no more 400k-token sessions and no "continue" chains. One phase per session, state lives in `CHECKPOINT.md`, never in chat history.

## Start of session
1. If `CHECKPOINT.md` exists at repo root: read ONLY it, plus the files listed under "التالي". Do not re-read the project.
2. If it does not exist and the task is large (>10 steps): write a plan of 3-5 phases, wait for owner approval, then create it.
3. Count tool calls from the first one. Write the running count to `الخطوات المستخدمة`.

## Phase design
- One phase = one verifiable outcome, at most ~15 steps (e.g. "library page lists all companions", not "finish library").
- Phase 1 is always the smallest slice that proves the approach.

## The loop (one phase per session)
1. **Execute** the current phase only.
2. **Verify** with the cheapest check that proves it (targeted test, build, one screenshot). Run the full suite only via `safe-deploy-gate`.
3. **Update** `CHECKPOINT.md` (format below).
4. **Stop.** Reply in Arabic: what changed for the visitor first, then details; then give the resume prompt.

## Hard stops
- At 22 tool calls: finish the current step, update the file, stop. Cap is 25, never exceed it.
- On "continue" in the same session after the phase is done: do NOT start the next phase. Re-send the resume prompt.
- Same failure twice (e.g. 403, failing test): write it under العوائق and stop. Do not loop.

## CHECKPOINT.md format (keys fixed so Hermes can parse and summarize to Telegram; Arabic headings)
```
# CHECKPOINT
المهمة: <one line>
المرحلة الحالية: <n>/<m>
الخطوات المستخدمة: <count this session>
آخر تحديث: <YYYY-MM-DD>

## المنجز
- <short bullets, what the visitor sees first>

## التالي
- <files to open + exact next action>

## العوائق
- <blocker, host/test name, attempts made> (or "لا يوجد")

## المراحل
- [x] 1 <name>
- [ ] 2 <name>
```

## Resume prompt (give verbatim at stop)
`استأنف من CHECKPOINT.md، المرحلة <n>. لا تقرأ غيره قبل البدء.`

## Rules
- Never paste whole files or long logs in chat; show `git diff --stat` or a 5-line summary.
- Commit CHECKPOINT.md on the working branch only; mention it so the owner can drop it before merging to the default branch.
- Chat and the CHECKPOINT.md headings are Arabic; everything else English.
