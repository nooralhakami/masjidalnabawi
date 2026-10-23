---
name: safe-deploy-gate
description: Mandatory gate before ANY git push or deploy in this repo. Runs the full test suite, allows at most 3 root-cause fix attempts, shows the diff summary, and waits for the owner to type «اعتمد النشر» before pushing the working branch. Never pushes to the default branch (main). Use whenever the owner says publish, push, deploy, نشر, ارفع, or when a task is done and about to be pushed.
---

# safe-deploy-gate

Goal: nothing reaches GitHub/Vercel with a red test, and nothing is pushed without the owner's exact phrase.

## 0. Preflight
- `git branch --show-current`. If it is the default branch (`main`): STOP, create a session branch first.
- Never push to the default branch, from this skill or any other. The owner merges.

## 1. Run (generous timeouts; `npm test` takes ~2 min)
1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run test:e2e` (Chromium: pass `executablePath` from CLAUDE.md; never `playwright install`)
5. Only if map / layers / CSS over the map changed: `npm run perf`, log before/after in `docs/PERF.md`.
6. Only if UI changed: `npm run design:audit`.
Keep only the summary lines (pass/fail counts). Never paste full logs.

## 2. Fix loop: 100% required, max 3 attempts
Pass means every test green. 311/313 is a FAIL.
Per attempt: read the tail of the failing output, find the root cause in source, fix source, rerun the failing test, then the full suite.

Forbidden, always:
- `skip`, `only`, `todo`, `xit`, `--passWithNoTests`, deleting a test
- loosening an assertion, changing an expected value, or updating a snapshot/parity baseline just to pass
- ignoring or hiding a failure
If a test looks wrong, stop and ask the owner; do not edit it.

If failures existed before your change, say so, but the gate still stays closed until the owner decides.

After attempt 3 still red: STOP. Write test names, error summary and what was tried under العوائق in `CHECKPOINT.md`. Report in Arabic. No push.

## 3. Show
- `git status --short`
- `git diff --stat origin/<default-branch>...HEAD`
- Test/build/e2e summary lines.

## 4. Wait
Ask once in Arabic: «اكتب "اعتمد النشر" لأدفع الفرع <name>». Only the exact phrase «اعتمد النشر» opens the gate. Anything else: no push. Approval covers this one push only.

## 5. Push (after the phrase)
- `git fetch origin <default-branch>`; rebase if needed; rerun tests if the rebase changed anything.
- `git push -u origin <current-branch>`. On network error only, retry up to 4 times (2s, 4s, 8s, 16s).
- No PR unless the owner explicitly asks. No Vercel deploy unless the owner says «انشر» (next project rule).
- Final reply in Arabic: branch name, commit hash, what the visitor will see.
