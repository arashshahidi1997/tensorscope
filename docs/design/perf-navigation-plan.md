# Navigation-performance plan — ultracode session brief

**Status:** ready to execute (specs decided)
**Created:** 2026-06-04
**Baseline commit:** `ccd67ab` (contract-v2 N4–N6 + ADR-0009) on `refactor/ultracode-batch`
**Source surveys:** [`time-transport-survey.md`](../research/time-transport-survey.md),
[`time-transport.md`](time-transport.md), [`refactor-plan.md`](refactor-plan.md) (the N-series this continues),
ADR-[0007](../adr/0007-unified-time-transport.md)/[0008](../adr/0008-propagation-playback.md)/[0009](../adr/0009-navigation-ownership.md).

This doc is the **source of truth** for a budgeted, test-gated ultracode batch
that makes navigation smooth. Read it in full before editing, plus the
*Agent / automation gotchas* in `CLAUDE.md`. It exists because an autonomous
swarm needs decided, verifiable specs — every item below names exact insertion
points (file:line) and an acceptance gate.

## Why (the measured problem)

Live measurement on a real session (60 s ecog, 256 ch) via the headless
`/tmp/pwdbg` driver: initial load **~20–27 s**; a window change **~10–18 s**.
Per-view slice timings — `psd_live` median 3.2 s / **max 24.5 s**, `spectrogram_live`
~5–10 s, `raster` 4 MB / ~10 s, `timeseries`/`navigator` ~5–10 s — with
`timeseries`/`raster`/`spectrogram`/`navigator` **all topping out at the same
~9.9 s**: the signature of **single-process GIL serialization**. Closing the
PSD + spectrogram + raster panels dropped a window change from **17.7 s → 2.9 s**
(measured), confirming the heavy spectral views are the bottleneck.

Two root causes, both **scoped out** of the time-transport refactor (which fixed
navigation *state* — optimistic cursor, debounced window, ADR-0007 — but
deliberately deferred compute cost: *"No LOD pyramid… Navigator full-session
compute — separate backend fix"*):

1. **Per-window recompute with no result cache.** Multitaper PSD/spectrogram and
   the full-rate min/max downsample re-run from scratch on every window change.
   The only cache today (`_processed_cache`) holds full-tensor *preprocessing*,
   not per-view results.
2. **Single GIL-bound process.** `cli.py:253` `uvicorn.run(app)` is one worker;
   the slice routes are sync `def` in a threadpool, so CPU-bound numpy/cogpy work
   can't truly parallelize — heavy views block the cheap ones.

## The architecture this enacts (Neuroscope's lesson)

The Neuroscope family (Hazan/Buzsáki; NeuroScope2) is buttery because navigation
touches only **cheap, already-final data** — memmap the window, no recompute —
and uses a **2-level LOD baked into the file format** (`.dat` raw vs `.eeg`/`.lfp`
precomputed decimation). TensorScope traded that for a compute server (arbitrary
tensors, live transforms, multi-probe, remote) — which *is* the latency. The goal
is **not** to become Neuroscope; it is to **recover Tier-0 smoothness without
giving up Tier-2 power** by decoupling three view tiers that today ride one
navigation transaction on one process:

| Tier | Views | Cost | Target behavior |
|---|---|---|---|
| **0 — raw transport** | `timeseries`, `navigator`, `spatial_map`/`depth_map` | should be instant | LOD-decimated read, overscan + local pan, no recompute |
| **1 — cheap derived** | events, tracks, `trajectory`, `raster`, `psd_average`, `event_average` | fast (20–60 ms today) | unchanged; keep off the critical path |
| **2 — expensive derived** | `psd_live` (heatmap/curve/spatial), `spectrogram_live` | inherently slow | cached, process-pool-offloaded, async sidecar that never gates Tier 0/1 |

Reference patterns we copy (all vendored in `resources/`, cited in the survey):
mne-qt-browser's adaptive downsample (`5 samples/pixel`, min/max envelope —
`resources/mne-qt-browser/src/mne_qt_browser/_pg_figure.py:1353`,`:1386`);
HiGlass's LOD-level-from-zoom + optimistic-transform-then-debounced-fetch
(`resources/higlass/app/scripts/services/tile-proxy.js:374`,
`TiledPixiTrack.js:559`); Neuroglancer render-first/fetch-async. uPlot already
supports the client half: `setScale("x",{min,max})` pans/zooms **without touching
data**; `setData(data,false)` keeps the view — so "feed decimated data, pan
locally, refetch on buffer-escape" is native.

---

## Operating constraints (gamma2 is a shared box; tokens cost real money)

- **Branch first.** This batch runs on `refactor/ultracode-batch` (already
  checked out at `ccd67ab`). Do **not** merge to `main`, do **not** push.
- **Token budget.** Honor the `+<N>` budget at launch; stop when reached.
  Suggested: backend batch (P1–P4) at a smaller cap, frontend batch (P5–P8) larger.
- **Concurrency ≤ 10** (gamma2: 12 cores; workflow cap `min(16, cores-2)`). Serialize
  the verification step per item; don't run many full suites at once.
- **No worktree isolation for frontend work** — `frontend/node_modules` is
  gitignored, absent in a fresh worktree → `frontend-test` fails there.
- **Run ALL JS tooling via `pixi run`** — bare `node` is v12 (`ERR_UNKNOWN_BUILTIN_MODULE`).
- **Commit per item, staging EXPLICIT paths only — NEVER `git add -A`/`git add .`.**
- **Do NOT modify these in-flight WIP files** (uncommitted, human-owned):
  `pixi.lock`, `pyproject.toml`, `scratch/`, `baseline.png`, `docs/log/**`,
  `docs/research/{adversarial-critique,build-vs-buy-survey}.md`,
  `docs/design/{channel-viewport,contract-v2,detector-overlay,event-review,pipeline-spec}.md`,
  `.claude/worktrees/**`, and the propagation-playback files
  (`PropagationController.tsx`, `PropagationMoviePlayer.tsx`, `PropagationView.tsx`).
- **Permission allowlist** (`.claude/settings.json`) must cover unattended runs —
  `Bash(pixi:*)`, `Bash(git:*)`, `Edit`, `Write` — or a detached `-p` run FREEZES on a prompt.

## Verification gates (an item is "done" only when these are green)

```bash
pixi run frontend-test                                  # full vitest suite (372 baseline)
pixi run bash -c "cd frontend && npx tsc -b"            # typecheck, exit 0
pixi run test                                           # backend pytest (only if backend changed; 301 baseline)
```

**You cannot validate interactive/visual behavior** — the live launcher is
SIGTERM-killed under the harness and jsdom can't render canvas. **Every item that
changes returned bytes, rendering, or interaction timing is tagged HUMAN-VALIDATE:**
make the code + pure-logic test change, and **flag in the final report** that a
human must confirm (a) visual parity and (b) the latency win via the measurement
harness below. "Tests pass" ≠ "smooth."

### Measurement harness (how we prove the win — human/agent, post-batch)
Re-run the per-view latency probe from this session: launch a real session in a
detached `screen` on :8000 + Vite on :5173, drive `/tmp/pwdbg/measure.mjs`
(captures both `/api/v[12]/.../slice` paths, per-view median/max, payload KB).
Targets: **window-change p50 < 1 s for Tier-0**, **Tier-2 returns from cache in
< 100 ms on revisit**, **no view exceeds ~2 s on a warm cache**. (Pre-batch
baseline recorded in the handoff of 2026-06-04.)

---

## Tier 1 — backend, fully test-gated, no/minimal visual change (AUTOMATE)

### P1 · Per-view result cache (spectral + downsample)
- **Goal:** kill the recompute-on-revisit. Returning to a previously-seen window
  (scrub back, toggle a panel, re-open) must be near-instant.
- **Scope (`src/tensorscope/server/state.py`):** add `ServerState._view_result_cache`
  (an `OrderedDict`, LRU-bounded ~64 entries) initialized to `{}` in `__post_init__`
  (~`state.py:105`, beside `_processed_cache`) so per-session `deepcopy` isolation
  holds. Wrap `_prepare_slice` (`state.py:336`) — the single shared seam for v1
  (`tensor_slice`, `:533`) and v2 (`tensor_slice_v2_bytes`, `:570`). Cache the
  **post-compute sliced `xr.DataArray`** (before encode) keyed by a stable tuple:
  `(name, view_type, tuple(time_range), psd_params/spectrogram_live_params
  .model_dump_json(), bandpass, max_points, downsample, mask_hash,
  self._processed_params_hash)`. Invalidate by clearing the dict wherever
  `_processed_cache` is cleared — `set_processing` (`state.py:206`) and the mask
  setters. Cache hit must serve **both** encoders.
- **Acceptance:** backend test — monkeypatch the `psd_multitaper` / `gsp.mtm_spectrogram`
  call sites (`state.py:857`,`:1019`) with a call-counter; assert two identical
  slice requests trigger **one** compute and byte-identical payloads; assert a
  `set_processing` change invalidates (next call recomputes). Full backend suite green.
- **Tag:** AUTOMATE. No wire/visual change. **Highest immediate ROI — do first.**

### P2 · LOD decimation pyramid for Tier-0 time views
- **Goal:** zoomed-out `timeseries`/`navigator` must not min/max-envelope a
  150k×256 full-rate window every request. Precompute a few coarse levels; serve
  the nearest.
- **Scope (`src/tensorscope/server/state.py`):** add `ServerState._lod_cache:
  dict[tuple[str,int], xr.DataArray]` (init `{}` in `__post_init__`). Build levels
  **lazily** from the *processed* tensor (`_get_processed_tensor`, `:313`) so they
  key on `_processed_params_hash` (rebuild on processing change). Levels = a small
  fixed ladder of min/max-envelope decimations via the existing
  `downsample_time_axis` (`:1409`, `MINMAX`) at target point-counts
  (e.g. `[4_000, 16_000, 64_000]`, skip levels ≥ tensor length). In
  `apply_slice_request`, for `view_type in {"timeseries","navigator"}` only,
  between the time-window (`:834`) and the final `downsample_time_axis` (`:1248`):
  if the windowed full-rate sample count exceeds `~4× max_points`, pick the
  coarsest level whose in-window samples still ≥ `2× max_points`, slice the window
  from THAT level, then final-decimate to exact `max_points`. Zoomed-in (few
  samples) keeps the full-rate path unchanged.
- **Correctness note (decided):** envelope-of-envelope is acceptable for the
  overview (min/max is idempotent under nesting up to bucket-boundary error);
  the spec's tolerance test asserts the LOD path's per-channel min/max never
  *shrinks* the true window envelope (no clipped extrema → no hidden spikes).
- **Acceptance:** backend test on a synthetic ramp+spike tensor — a wide-window
  `timeseries`/`navigator` slice via the LOD path has min/max ≥/≤ the true window
  extrema (spike preserved) and returns ≤ `max_points`; a narrow window bypasses
  LOD (asserts full-rate path). Memory: levels are decimated (small) — assert
  level sizes. Full backend suite green.
- **Tag:** AUTOMATE-CODE + **HUMAN-VALIDATE** (visual parity of zoomed-out
  timeseries + navigator on the live app). Depends on nothing; pairs with P1.

### P3 · Take display z-score off the full-rate hot path
- **Goal:** `zscore_offset` (`state.py:1364`) runs on every `timeseries`
  navigation over the *full-rate* window before downsample (`:1230`). With P2 it
  should run on the LOD-selected (smaller) data, and its result should be cached.
- **Scope:** ensure the P1 cache key covers the timeseries z-score output (it does,
  via `view_type`+window+`max_points`+processing hash); apply `zscore_offset` to
  the LOD-selected array from P2 (per-channel stats computed on that array's
  window). Do **not** change the visual contract (per-channel z + stack offset).
  Leave the navigator exclusion intact (`:1226–1229`).
- **Acceptance:** backend test — timeseries slice still carries the
  `zscore_offset(scale=3.0)` display-transform tag and finite data; the cached
  second call does zero z-score recompute (call-counter). Full suite green.
- **Tag:** AUTOMATE-CODE + **HUMAN-VALIDATE** (timeseries amplitude/stacking parity).
  Do **after** P2 (shares the LOD-selected array).

---

## Tier 2 — backend concurrency + frontend (AUTOMATE-CODE + HUMAN-VALIDATE)

### P4 · Process-pool offload for the spectral compute
- **Goal:** move `psd_live` + `spectrogram_live` CPU work off the main process's
  GIL so the cheap Tier-0 views stay responsive while spectra compute.
- **Scope (`src/tensorscope/server/state.py`):** extract the **pure numpy cores**
  of `psd_live` (`:856–905`) and `spectrogram_live` (`:921–1103`) into
  **module-level, picklable** functions taking `(ndarray, fs, params_dict)` →
  `ndarray` (+ axes). Submit to a **single long-lived module-level**
  `ProcessPoolExecutor` (size `max(1, cpu_count-2)`), block on `.result()` inside
  the sync route (this releases the GIL while the subprocess computes →
  concurrent timeseries/navigator requests proceed). **Replace**, do not nest
  under, `spectrogram_live`'s existing per-request `ThreadPoolExecutor`
  (`:1030`). Never ship `ServerState` to the pool (holds non-picklable
  `_Subscriber` asyncio loops, `:97`) — ship only numpy + params. Warm the pool at
  import. Order P4 **after P1** so cache hits skip the pool entirely.
- **Acceptance:** backend test — the extracted core returns numerically identical
  output to the prior inline path (golden tolerance) for psd_live and
  spectrogram_live; assert the pool is a module-level singleton (not per-request).
  Full backend suite green. (True concurrency win is not unit-gatable.)
- **Tag:** AUTOMATE-CODE + **HUMAN-VALIDATE** (latency win via the measurement
  harness; numeric parity is unit-tested).

### P5 · Tier-2 fetch deprioritization (don't queue multitaper per scrub step)
- **Goal:** a scrub/pan must not enqueue a multitaper compute per intermediate
  window. Cheap views update at ~100 ms; expensive views trail.
- **Scope (`frontend/src/components/views/useTimeNavigation.ts` +
  `useWorkspaceData.ts`):** split the single debounced `safeWindow`
  (`useTimeNavigation.ts:72–76`, `WINDOW_FETCH_DEBOUNCE_MS=100`) into a
  cheap window (~100 ms, feeds Tier-0/1) and an **expensive window** (longer
  debounce ~350 ms *or* "enable only once the Tier-0 timeseries query is settled").
  Feed `useV2PSDLiveQuery` (`useWorkspaceData.ts:138`) and `useV2SpectrogramQuery`
  (`:155`) from the expensive window/gate. Keep ADR-0008 cursor-windowed views
  (`spatial_map`/`depth_map`/`psd_spatial`) as-is.
- **Acceptance:** vitest — under a sequence of rapid window changes, the expensive
  request window equals only the *final* window (not each intermediate), or the
  expensive query stays `enabled:false` until the timeseries query is not
  fetching. Full frontend suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Independent; safe to do early.

### P6 · LOD-aware timeseries request (viewport-derived point budget)
- **Goal:** request the right resolution for the viewport instead of a hardcoded
  `max_points: 2000`, and snap the window so small pans reuse the same key.
- **Scope (`frontend/src/api/queries.ts` + `useWorkspaceData.ts`):** in
  `makeDefaultSliceRequest("timeseries", …)` (`queries.ts:489`) derive
  `max_points` from viewport pixel width × `SAMPLES_PER_PX` (use mne's `5`, i.e.
  `width*2` for min/max envelope) instead of `2000`; thread the panel pixel width
  in from the renderer (or a sensible constant if width is unavailable at request
  time). **Snap** the requested `time_range` to LOD-tile boundaries so a sub-tile
  pan produces an identical request key (cache hit against P1/P2). Keep the
  pinned-`selection.time` window-bound behavior (`:495`).
- **Acceptance:** vitest — `max_points` scales with a passed pixel width; a small
  pan within a tile yields a byte-identical request key; a pan past the tile
  changes it. Response `meta.downsampling` (`types.ts:165`) reflects the budget.
  Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Depends on **P2** (server LOD levels).

### P7 · Overscan buffer + local pan (no refetch within buffer)
- **Goal:** small pans/zoom-ins within an already-loaded window are **local-only**
  (uPlot `setScale`), zero network — the Neuroscope/HiGlass feel.
- **Scope:** in `useTimeNavigation.ts` widen the fetch window to an **overscan
  buffer** (e.g. `1.5×–3×` visible, snapped to P6 tiles) and add an
  `isWithinLoadedBuffer(liveWindow)` predicate; while true, **suppress** the
  window→fetch edge (the publish at `TimeseriesSliceView.tsx:642` /
  `onTimeWindowChange`). The renderer is already overscan-ready
  (`setData(...,false)` + pan-via-`setScale`, `TimeseriesSliceView.tsx:874`/`:106`;
  decimation TODO at `:871`). Exclude cursor-windowed views (ADR-0008) — they keep
  refetching on cursor by design.
- **Acceptance:** vitest — a pan whose visible window stays inside the buffer does
  **not** change the fetch window/key; a pan beyond it refetches a new buffer.
  Buffer is tile-snapped (stable keys). Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE (live smooth pan). Do **after P6**.

### P8 · Move remaining main-thread Arrow decode into the worker
- **Goal:** stop the PSD-cube reshape and v1 extractors from blocking the render
  thread, so cheap views never wait on an expensive decode.
- **Scope:** add `psd_heatmap`/`psd_curve`/`psd_spatial` cases to `extractV2`
  (`frontend/src/api/v2-arrow.ts:839`) + `transferablesFor` (`:868`) so the PSD
  cube decodes in the worker pool; replace the three main-thread extractors in
  `WorkspaceMain.tsx` (`extractPSDAverageV2`/`extractHeatmapNDV2`/`extractPSDSpatialV2`,
  ~`:590–635`) with worker results. Migrate the still-v1 main-thread extractors
  (`extractSpectrogram` `arrow.ts:413`, `extractRaster` `:539`, `extractTrajectory`
  `:606`, `extractDepthProfile` `:295`) to the worker pool (or their v2 columnar
  equivalents) where a v2 path exists.
- **Acceptance:** existing parity tests for each moved extractor stay green against
  the worker path; add a test that the PSD subviews derive from the worker-decoded
  payload. Full suite + tsc green.
- **Tag:** AUTOMATE-CODE + HUMAN-VALIDATE. Independent of P5–P7; can parallelize.

---

## Tier 3 — DO NOT IMPLEMENT (blocked on human decisions)

The swarm must **not** touch these — settle in a conversation/ADR first.

- **D-NAV · Finish ADR-0009 (client-authoritative navigation).** Take the
  selection `PUT /api/v1/selection` off the navigation critical path entirely
  (pairing becomes a debounced publish). **Gated on the pairing-direction open
  question** (observe-only vs bidirectional) in ADR-0009 §"Open questions". The
  cursor leg (ADR-0007) + N5 are already done; the rest is a decision.
- **D-OVERVIEW (refactor-plan D3) · Navigator overview semantics.** What *should*
  a 256-channel overview show — RMS? representative channels? a thumbnail
  spectrogram? The current mean-of-min/max-envelope is incoherent, and the LOD
  ladder (P2) is built on it. Changing the semantic is a product decision that
  reshapes P2's reducer; keep them separate.
- **D-LOD-POLICY · LOD level policy.** Fixed point-ladder (this plan) vs
  continuous/power-of-2 vs a true precomputed pyramid persisted to disk (the
  Neuroscope `.eeg` analog). P2 picks the cheap in-RAM fixed ladder; a persisted
  pyramid for very long sessions is a follow-up decision (interacts with D-OVERVIEW
  and the "tensors are eager in RAM" assumption — see `cli.py:70` `.compute()`).
- **D-CACHE-BUDGET · Cache sizing / eviction.** P1's ~64-entry LRU and P2's level
  ladder are starting points; a memory-budgeted policy across sessions is a tuning
  decision, not swarm work.

---

## Phasing & dependencies

```
Batch A (backend, mostly test-gated):   P1 → P2 → P3 → P4
        P1 independent (do first; biggest ROI). P2 independent. P3 after P2. P4 after P1.
Batch B (frontend):                     P5 ‖ P8  →  P6 → P7
        P5 & P8 independent. P6 needs P2 (server LOD). P7 needs P6.
```

Run **Batch A first** at a smaller budget, run the measurement harness + visual
checks, then **Batch B**. Backend (P1–P4) carries the bulk of the latency win and
is the most test-gatable; frontend (P5–P8) layers smoothness on top.

## Kickoff prompts (paste at session start, or via the /ultra-batch skill)

**Batch A — backend perf:**
```
/effort ultracode
Read docs/design/perf-navigation-plan.md in full (source of truth) and the
"Agent / automation gotchas" in CLAUDE.md. You are on branch refactor/ultracode-batch
at ccd67ab — stay on it, do NOT branch/merge/push.

Execute ONLY Tier-1 + P4 in order: P1 → P2 → P3 → P4. Do NOT touch any Tier-3
(D-*) item. Honor every Operating-constraints rule:
- Token budget: +600000 (stop when reached).
- Run all JS tooling via `pixi run`; concurrency ≤ 10.
- Do NOT modify the listed WIP files; commit per item staging EXPLICIT paths only
  (never git add -A); do NOT merge or push.
- Verify each item with the gate commands (backend `pixi run test` + the new
  per-item test); an item is done only when green.
- You cannot run the live app or see canvas; for HUMAN-VALIDATE items make the
  change + pure tests and FLAG visual/latency confirmation in your report.
Final report: per item — what changed, tests added, green/red, HUMAN-VALIDATE flags.
```

**Batch B — frontend perf** (run after Batch A is reviewed):
```
/effort ultracode
Read docs/design/perf-navigation-plan.md (source of truth) + CLAUDE.md gotchas.
Branch refactor/ultracode-batch. Execute ONLY P5 → P8 → P6 → P7 (respect deps:
P6 needs P2 already landed; P7 needs P6). Do NOT touch Tier-3. Token budget:
+1200000. Same constraints: pixi for JS tooling, no worktree isolation for
frontend, explicit-path commits, no merge/push, HUMAN-VALIDATE flags for every
render/interaction change. Final per-item report.
```

Suggested via the **/ultra-batch** skill: it dispatches the above as a detached
`claude -p --model claude-opus-4-8 --effort xhigh --permission-mode acceptEdits
--max-budget-usd <N>` in `screen`, then independently verifies (gates + diff +
`/verify-ui`). Confirm the `.claude/settings.json` allowlist covers
`Bash(pixi:*)`/`Bash(git:*)`/`Edit`/`Write` first, or the detached run freezes.
