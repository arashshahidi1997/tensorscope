---
name: ultra-batch
description: Dispatch a budget-capped, autonomous "ultra" coding batch headlessly in a detached screen session (survives SSH disconnect) against a committed spec doc, then monitor and independently verify it. Use ONLY on explicit user opt-in to run a large, well-scoped, test-gated batch of work autonomously in the background (e.g. "kick off the refactor batch / an ultra session in the background"). It spends real budget — confirm before launching.
---

# ultra-batch — dispatch + monitor + verify a headless autonomous batch

Runs a large, pre-specified batch as a detached **`claude -p` (headless)** session
in `screen`, so it survives SSH disconnects and you reattach to monitor. This is
the "fire-and-forget autonomous batch on the remote box" pattern — distinct from
the in-session Workflow tool. **Launch only on explicit user opt-in; it spends real
budget.**

## 0. Prerequisites — do NOT launch without all three
- **A committed spec doc** the batch reads as its source of truth — e.g.
  [docs/design/refactor-plan.md](../../../docs/design/refactor-plan.md): tiered work
  items, each with goal / scope / **acceptance criteria** / a **do-not-touch list** /
  **verify gates** / operating constraints (budget, concurrency, the node-v12 +
  static-shadow gotchas). If none exists, write it first — it's the input.
- **A clean, committed baseline** (so the batch's branch diff is reviewable/revertible).
- **Permissions won't stall it:** `.claude/settings.json` allowlist must cover what it
  runs unattended — `Bash(pixi:*)`, `Bash(git:*)`, `Edit`/`Write`. A detached run
  FREEZES on any prompt it can't answer.

## 1. Launch (headless, detached, budget-capped)
```bash
screen -dmS ultra bash -lc 'cd /storage2/arash/projects/tensorscope && \
  claude -p "Read docs/design/refactor-plan.md and the Agent/automation gotchas in \
CLAUDE.md. Create and checkout branch refactor/ultracode-batch. Execute ONLY <tier/items>, \
honoring every Operating-constraints rule: pixi for all JS tooling; do NOT modify the listed \
WIP files; verify each item green before moving on; commit per item staging EXPLICIT paths \
only (never git add -A); do NOT merge or push. For HUMAN-VALIDATE items make the change and \
flag it. End with a concise per-item report." \
  --model claude-opus-4-8 --effort xhigh --permission-mode acceptEdits \
  --max-budget-usd 30 --output-format stream-json --verbose \
  > /tmp/ultra.log 2>&1; echo EXIT=$? >> /tmp/ultra.log'
screen -ls | grep ultra
```
Gotchas (learned the hard way):
- **Pin `--model claude-opus-4-8`** — bare `--model opus` resolved to 4-7 on this host.
- `--effort xhigh` is the headless equivalent of ultracode's reasoning level; the
  interactive `/effort ultracode` auto-workflow toggle is NOT a `-p` flag. For 3–6 small
  items, plain xhigh is the better fit anyway (less token blowup).
- `--max-budget-usd` is the hard cost ceiling (only works with `-p`). Start LOW — Tier-1
  of 3 small items ran ~$8. Re-run to continue rather than over-provision.
- This is a *child* `claude` you launch, so it is NOT SIGTERM-killed the way an
  agent-launched *server* is. `screen -dm` detaches it; it outlives your SSH session.
- Keep concurrency at/under cores-2 if the prompt fans out (gamma2: ≤10).

## 2. Monitor (no polling; reattach when you want)
- Progress: `git log --oneline <baseline>..refactor/ultracode-batch` — per-item commits land live.
- Done: `grep -a EXIT /tmp/ultra.log` appears, or `screen -ls` no longer lists `ultra`.
- Live: `tail -f /tmp/ultra.log` (JSONL). Stop early: `screen -S ultra -X quit`.
- The final result line carries `subtype:"success"`, `num_turns`, `total_cost_usd`.

## 3. Independently verify — do NOT trust the self-report
- Run the gates yourself: `pixi run frontend-test` · `pixi run bash -c "cd frontend && npx tsc -b"` · `pixi run test`.
- `git diff <baseline>..refactor/ultracode-batch` — read the diff.
- For any view/canvas change, run **`/verify-ui`** (tests can't see rendering).
- Decide merge readiness (usually: hold until visual gates pass; merge into the parent
  branch, not `main`). Hand off with **`/session-wrap`**.

## When NOT to use
- Architectural *decisions* (what to build) — the batch executes a spec, it must not
  invent one. Settle those in a conversation/ADR first.
- Trivial one-off edits — just do them inline.
- Anything lacking a committed spec + clean baseline + a non-stalling permission allowlist.
