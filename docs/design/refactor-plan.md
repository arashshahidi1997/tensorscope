# Refactor plan — ultracode session brief

**Status:** ready to execute
**Created:** 2026-06-02
**Baseline commit:** `02eaad0` (time-transport Phases A–D) on `refactor/contract-v2-phase1`
**Source surveys:** [`time-transport.md`](time-transport.md), [`time-transport-survey.md`](../research/time-transport-survey.md)

This doc is the **source of truth** for an ultracode (xhigh + dynamic-workflow)
session. It exists because an autonomous swarm needs decided, verifiable specs —
not open questions. Read it in full before editing. Read `CLAUDE.md` too,
especially the *Agent / automation gotchas* section.

## Operating constraints (gamma2 is a shared box; tokens cost real money)

- **Branch first.** Before any edit: `git checkout -b refactor/ultracode-batch`.
  Do **not** merge to `main` and do **not** push. Leave everything on the branch
  for human review.
- **Token budget.** Honor the `+<N>` budget given at launch. Stop when reached.
- **Concurrency ≤ 10.** gamma2 has 12 cores (workflow cap is `min(16, cores-2)`
  = 10). Keep fan-out at/under that. RAM is ample (251 GB); CPU is the shared
  resource — don't run many full test suites simultaneously, gate verification
  to a single serialized step per item.
- **No worktree isolation for frontend work.** `frontend/node_modules` (105 MB)
  is gitignored → absent in a fresh worktree → `frontend-test` fails there.
- **Run JS tooling via `pixi run` only.** Bare `node` on this box is v12 and
  fails with `ERR_UNKNOWN_BUILTIN_MODULE`. The pixi env has node 22.
- **Do NOT modify these in-flight WIP files** (uncommitted, owned by the human):
  `pixi.lock`, `pyproject.toml`, `scratch/`, `docs/log/**`,
  `docs/research/{adversarial-critique,build-vs-buy-survey}.md`,
  `docs/design/{channel-viewport,contract-v2,detector-overlay,event-review,pipeline-spec}.md`,
  `.claude/worktrees/**`.

## Verification gates (an item is "done" only when these are green)

```bash
pixi run frontend-test                                  # full vitest suite (311 baseline)
pixi run bash -c "cd frontend && npx tsc -b"            # typecheck, exit 0
pixi run test                                           # backend pytest (only if backend changed)
```

**You cannot validate interactive/visual behavior.** The live server launcher is
SIGTERM-killed under the harness, and jsdom can't render canvas (`getContext`
unimplemented) — so uPlot/Canvas views can't be seen. "Tests pass" ≠ "renders
correctly." For items tagged **HUMAN-VALIDATE**, make the code+test change and
**flag in your final report** that visual parity needs human confirmation before
merge. Commit per item with a clear message.

---

## Tier 1 — safe, fully test-gated (automate)

### N1 · Navigator: kill the full-session compute + v2 double-fetch
- **Goal:** the navigator's 5+ s first-load lag and its double fetch in v2 mode.
- **Scope:**
  - `src/tensorscope/server/state.py` (~L1178): the `zscore_offset` branch runs
    on the navigator's *full-session, full-rate* slice before downsampling. Drop
    `"navigator"` from `request.view_type in ("timeseries", "navigator")` so the
    navigator goes straight to the min/max downsample. (The frontend collapses
    channels to a mean; the per-channel z-score+offset is computed then averaged
    away — pure waste.)
  - `frontend/.../WorkspaceMain.tsx`: gate the v1 `navigatorSliceQuery` with
    `&& !v2Enabled` so v2 mode doesn't also fetch the full session via v1.
- **Acceptance:** `pixi run test` green; add a backend test asserting the
  navigator slice does **not** carry the `zscore_offset` display transform and
  returns finite data. `pixi run frontend-test` green.
- **Tag:** AUTOMATE. **Out of scope here:** the navigator's *overview semantics*
  (mean-of-min/max-envelope is incoherent) — that's a product decision (D3). Only
  the pipeline perf/correctness fix here.

### N2 · Honest staleness/error surfacing
- **Goal:** a scientific tool must never silently show the wrong window's data.
  Today `keepPreviousData` + `retry:false` leaves stale data on screen on error
  with no signal.
- **Scope:** `WorkspaceMain.tsx` (build `erroredByView` / `staleByView` from
  `query.isError` / `query.isPlaceholderData`, alongside the existing
  `fetchingByView`); `ViewPanel`/`ViewGrid` render an error/stale badge; styles.
- **Acceptance:** new tests for the derivation; full suite + tsc green.
- **Tag:** AUTOMATE (badge placement is cosmetic; the logic is testable).

### N3 · Make the rendering layer verifiable (prereq for Tier 2)
- **Goal:** extract correctness-critical logic into pure functions with
  golden-value tests, so later refactors have a real gate (today the canvas
  views are untestable in jsdom).
- **Scope (extract + test, no behavior change):** arrow extractor edge cases
  (`frontend/src/api/arrow.ts`), colormap mapping, the timeseries bandpass
  re-stack math; extend backend `downsample_time_axis` envelope coverage.
- **Acceptance:** new pure-function unit tests with golden values; full suite + tsc.
- **Tag:** AUTOMATE.

---

## Tier 2 — test-backed but large diffs (automate code, human-review before merge)

### N4 · Finish the v1→v2 contract cutover, delete v1
- **Goal:** end the half-migration. Today every view carries a v1 *and* a v2
  query behind `localStorage["tensorscope:v2"]`, with duplicated sticky-ref
  fallbacks — double the code and, in places, double the fetches.
- **Scope:** wire the remaining views to v2 (`psd_average`, `psd_curve`,
  `psd_spatial`, `spatial_map`, `propagation_movie` per
  `contract-v2.md` §"Not yet wired"); remove the `isV2Enabled` gating so v2 is
  the only path; delete superseded v1 `useSliceQuery` usages, v1 extractors, and
  the dual-path/sticky-ref duplication in `WorkspaceMain.tsx`.
- **Acceptance:** `v2-arrow.test.ts` parity tests pass; full suite + tsc green;
  the per-view wire-size logs still emit. **HUMAN-VALIDATE:** visual parity of
  every cutover view on the live app.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Best ultracode fan-out target. Do
  **after** N3.

### N5 · Decouple the cursor from window-bound query keys
- **Goal:** a pure cursor move must not re-key (and refetch) timeseries /
  spectrogram — their data depends only on window + params. (Optimistic render
  hides it today, but it's wasteful cogpy compute.)
- **Scope:** `queries.ts` request shape — drop `selection.time` from the request
  bodies of views that don't consume it; keep it for cursor-dependent views
  (PSD-lock, etc.).
- **Acceptance:** a test asserting the timeseries request body is invariant under
  a cursor-only change; full suite green.
- **Tag:** AUTOMATE.

### N6 · Decompose WorkspaceMain (~950-line god component)
- **Goal:** extract per-view query hooks + a `useTimeNavigation` controller; this
  is where most traced bugs cluster.
- **Scope:** `WorkspaceMain.tsx` → `useTimeseriesData`, `useNavigatorData`, … and
  a navigation hook. Behavior-preserving.
- **Acceptance:** full suite + tsc green (pure refactor). Big diff → human review.
- **Tag:** AUTOMATE-CODE + HUMAN-REVIEW. Do **after** N4 (less churn).

---

## Tier 3 — DO NOT IMPLEMENT (blocked on human decisions)

These are architectural/product decisions, cheap in tokens (a conversation + a
design doc) and expensive to get wrong. The swarm must **not** touch them.

- **D1 · Navigation ownership.** Should selection/cursor stay server-authoritative
  (in the session, in every slice request body) or move client-side for a
  single-user RAM-resident app? Root cause of the round-trip family of issues.
- **D2 · Generic-tensor vs neuro-specific selection** (`contract-v2.md` Phase 2).
  `SelectionDTO` is hardcoded `{time,freq,ap,ml,channel}`; real DataArrays are
  arbitrary-rank. Is this a generic tensor viewer or an LFP viewer?
- **D3 · Navigator overview semantics.** What *should* a 256-channel overview
  show? (RMS? thumbnail spectrogram? representative channels?)
- **D4 · Overview/LOD cache.** A cheap precomputed coarse decimation for the
  overview strip. Depends on D1/D3.

---

## Kickoff prompt (paste at session start)

```
/effort ultracode

Read docs/design/refactor-plan.md in full — it is your source of truth — and the
"Agent / automation gotchas" section of CLAUDE.md.

Baseline: commit 02eaad0 on refactor/contract-v2-phase1. Before any edit:
git checkout -b refactor/ultracode-batch

Execute ONLY Tier 1 then Tier 2 items, in order N1→N6. Do NOT touch any Tier 3
item. Honor every constraint in the "Operating constraints" section:
- Token budget: +1500000 (stop when reached).
- Workflow concurrency ≤ 10; no worktree isolation for frontend work.
- Run all JS tooling via `pixi run` (bare node is v12).
- Do NOT modify the listed in-flight WIP files.
- Verify each item with the gate commands; an item is done only when green.
- Commit per item, staging EXPLICIT paths only — NEVER `git add -A` / `git add .`
  (uncommitted WIP — pixi.lock, pyproject.toml, scratch/ — must stay untouched).
  Do NOT merge or push — leave it on refactor/ultracode-batch.
- You cannot run the live app or see canvas output; for HUMAN-VALIDATE items,
  make the change and flag it for human visual confirmation in your report.

Final report: per item — what changed, tests added, green/red, HUMAN-VALIDATE flags.
```

Suggested staging: run **Tier 1 only first** (change the prompt to "items N1→N3")
at a smaller budget (`+300000`), review the diff, then run Tier 2 separately
(`+1500000`). Cheaper, and you confirm the swarm's judgment before the big diffs.
