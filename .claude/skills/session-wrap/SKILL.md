---
name: session-wrap
description: End-of-session routine — commit this session's coherent work (without bundling WIP or another session's files), run the verification gates, write a handoff doc + ready-to-paste kickoff prompt, and update cross-session memory so the next fresh agent resumes in one paste. Use when finishing a work session or when the user says "wrap up / prepare for next session / commit and hand off".
---

# session-wrap — clean session boundary + handoff

Goal: leave the repo and the next agent in a state where work resumes in **one
paste**. Follow in order; use judgment — this is not fully mechanical.

## 1. Assess the working tree — separate yours from everyone else's
- `git status --short` · `git branch --show-current`.
- Classify EVERY dirty/untracked path into one of:
  - **This session's work** → commit (step 3).
  - **Owner WIP** (e.g. `pixi.lock`, `pyproject.toml`, `scratch/`, `docs/log/idea/…`,
    unrelated `docs/`) → DO NOT touch.
  - **Another session's in-progress feature** — a coherent multi-file cluster you did
    NOT write → DO NOT commit; flag it in the handoff. Concurrent sessions share this
    one working tree (the `.claude/worktrees/*` entries and overlapping edits are the
    tell), so this is common here.
- `git diff <file>` anything ambiguous to confirm it's only your change before staging.
- If you reverted/disrupted a file that belongs to another session's feature, say so
  loudly in the handoff — don't bury it.

## 2. Verify (capture the state the handoff will quote)
- `pixi run frontend-test` · `pixi run bash -c "cd frontend && npx tsc -b"` ·
  `pixi run test` (only if backend changed).
- Record pass counts + tsc result. (Visual/canvas correctness is NOT covered — if a
  frontend view changed, note that `/verify-ui` is still owed.)

## 3. Commit your coherent units
- Stage **explicit paths only — NEVER `git add -A` / `git add .`** (don't sweep in WIP).
- One commit per coherent change; clear conventional-commit messages; end each body with
  the `Co-Authored-By:` trailer. Commit on the feature branch (not `main`); don't push
  unless asked.

## 4. Write the handoff — `docs/log/handoff-YYYYMMDD.md`
Use the previous handoff as the template. Required sections:
- **Branch + how to resume** (and whether a restart is needed to load new MCPs/tools).
- **What shipped this session** — commit list (newest first) + the test/tsc state.
- **⚠️ Uncommitted in the tree** — owner WIP (don't touch) and any other-session feature
  you flagged; be explicit about anything you reverted.
- **What's parked/broken** — with the *diagnosis* (how you know — e.g. "Playwright shows
  drawnPixels:0 with good data → lifecycle bug, not data"), not just "it's broken".
- **New tooling/capabilities** (MCPs, skills) + any restart needed.
- **Prioritized next steps.**
- **A ready-to-paste kickoff prompt** that names the handoff file + branch + first task.

## 5. Update cross-session memory
- Append a dated update to the relevant `…/memory/project_*.md` (current state + a pointer
  to the new handoff); keep the `MEMORY.md` index line current. This is what auto-loads
  into the next session.

## 6. Merge readiness
- State whether the branch is mergeable: ONLY if tests are green AND the visual /
  HUMAN-VALIDATE gates are done AND nothing broken/parked sits on it. Otherwise say
  "hold; merge after X" and name the target branch (usually the parent, not `main`).

## Done
Report: the commits made, the handoff path, that memory was updated, and the one-line
resume ("open a fresh session, confirm `/mcp`, paste the kickoff prompt").

Complements `workflow-advisor` (was the right MCP/tool used?) and `retro` (lessons
learned). This skill is about a clean boundary + handoff, not lessons.
