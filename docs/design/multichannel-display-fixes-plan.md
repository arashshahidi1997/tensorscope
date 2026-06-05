# Multichannel display-perf fixes — implementation plan

**Status:** plan / ready-for-sequencing
**Date:** 2026-06-05
**Author:** agent (with arash)
**Companion to:** [`../research/multichannel-timeseries-perf-prior-art.md`](../research/multichannel-timeseries-perf-prior-art.md) (the prior-art survey that motivates these), [`perf-navigation-plan.md`](perf-navigation-plan.md) (P1–P8 LOD + cache foundation these build on)

## Scope

Five fixes to the large-multichannel timeseries display path, ranked by impact in the
research survey. This doc turns each into a concrete change surface (files/functions),
a verification gate, a risk read, and a size estimate — then recommends a **sequence**
and a **land-and-verify-one-at-a-time** policy.

Numbering follows the survey's recommendations (Rec #1–#5 = A–E).

---

## Sequencing recommendation (TL;DR)

**Land them one at a time, each as its own commit with its own verification gate. Do not batch.**
This repo already has the cautionary tale: [`../research/adversarial-critique.md`](../research/adversarial-critique.md)
documents how a monolithic +12k-LoC commit bundling six features became unbisectable and
shipped "paper tests." These five fixes have *different verification modalities* (pure-unit
vs visual vs concurrency-timing) and *different risk levels* — bundling them would hide
regressions exactly where they're hardest to attribute (perf + concurrency).

**Recommended order:**

| Order | Fix | Why here |
|---|---|---|
| 1 | **#3 Vectorize `downsample_time_axis`** | Pure refactor, numerically verifiable against the current output, zero behavior change. Safe warm-up that de-risks the hot path everything else rides on. |
| 2 | **#2 Fix per-channel normalization** | Correctness fix for *what is drawn*. Do it before #1 so amplitude is already stable when we change *what is fetched*. Mostly pure logic → headless-testable. |
| 3 | **#1 Channel-windowed fetch** | Biggest user win; cheap now that the wire plumbing exists. Renders on top of #2's stable normalization. |
| 4 | **#4 Threadpool + request priority** | Highest risk (concurrency, GIL assumptions, per-session cache aliasing). Isolate it so a regression here can't be confused with #1–#3. |
| 5 | **#5 Image/carpet auto-switch** | Pure UX/representation change, independent of the rest. Ship last so it lands on a fast, correct base. |

#1 and #2 both touch the timeseries slice path and `zscore_offset`; keeping them adjacent
and in this order avoids rework (the global normalization in #2 must be computed on the
*full* channel set, which stays true regardless of #1's windowing).

---

## Fix #3 — Vectorize `downsample_time_axis` (DONE — premise was wrong; reverted to loop + honest docstring)

> **Outcome (measured 2026-06-05).** The premise below — "the Python loop is the dominant
> cost" — **did not survive measurement**. A fully `reduceat`-vectorized rewrite was built,
> proven bit-identical (`tests/test_downsample_vectorized.py`), and benchmarked against the
> loop:
>
> | case | loop | reduceat | |
> |---|---|---|---|
> | navigator (n=5k, 1 ch) | 9.0 ms | 1.2 ms | reduceat 7.7× faster |
> | per-request (n=5k, 256 ch) | 62 ms | 55 ms | ~even |
> | LOD build (n=20k, 256 ch) | 80 ms | 181 ms | **loop 2.3× faster** |
> | LOD build (n=200k, 256 ch) | 409 ms | 1211 ms | **loop 3× faster** |
>
> The loop is *already near-optimal* on multichannel data: `chunk.argmin(axis=0)` returns the
> extremum's value AND position in one C-level pass, whereas `reduceat` returns only values and
> needs extra full-array passes to recover the anchor positions. On a 4 GB tensor that memory
> bandwidth dominates; the Python loop overhead (~`max_points//2` light iterations) is ~2%.
> reduceat only wins for single-channel input (the navigator — already <10 ms, not worth it).
>
> **Action taken:** reverted the algorithm; fixed the genuinely-wrong part — the docstring that
> falsely claimed "no Python loop over buckets" — to record the measurement so this isn't
> re-attempted. Kept the equivalence test as a characterization guard. **No algorithm change ships.**
> A `n_feat==1` fast path (reduceat for the navigator) is a possible micro-opt but isn't worth
> the second code path for an already-<10 ms view.

**Problem (original premise — falsified).** [`state.py:1602`](../../src/tensorscope/server/state.py#L1602) has a
`for i in range(n_buckets)` Python loop despite a docstring claiming "fully vectorized via
numpy — no Python loop over buckets." *Hypothesis (wrong): for 256 ch × thousands of buckets
this is the dominant cost of every cold LOD build and every full-rate-window decimation.*

**Change surface.** `src/tensorscope/server/state.py::downsample_time_axis` only.

**Approach.** Replace the per-bucket loop with a vectorized reduction:
- Equal buckets: `arr[:n_full].reshape(n_buckets, bucket_len, n_feat)` → `.argmin(axis=1)` / `.argmax(axis=1)`, handle the ragged tail bucket separately.
- Or ragged-safe: `np.minimum.reduceat` / `np.maximum.reduceat` over the bucket-start edges for values; recover the real-extremum *index* (we need it for the source-time anchor — Audit-F5) via a companion `reduceat` on a packed `(value<<bits | local_index)` int, or argmin over each `reduceat` segment.
- **Preserve the real-source-time anchoring** (the part the survey says is *better* than textbook M4 — do not regress it).

**Verification (headless, strong).**
- New unit test: assert the vectorized output is **bit-identical** (or within float tolerance) to the current loop output on a few fixtures (random, monotone, single-spike, equal vs ragged bucket counts, single-sample buckets). Keep the old loop as a reference impl in the test.
- Microbenchmark in the test (or a scratch script): assert wall-clock drop on a 256 ch × 1e6-sample array.
- `pixi run test` green.

**Risk.** Low. Pure function, fully unit-testable, no wire/UX change.
**Size.** ~½ day. ~1 function + 1 test file.
**Decisions to confirm.** None.

---

## Fix #2 — Per-channel normalization computed once, not window-local (DONE — server tested; frontend visual-gate pending)

> **Outcome (2026-06-05).** Implemented server + frontend. **652 backend + 441 frontend tests
> pass, tsc clean.** The one verification I could not run autonomously is the live visual gate
> (amplitude visibly stable across pan) — jsdom can't render canvas and the foreground launcher
> is SIGTERM-killed under the harness; needs `/verify-ui` against a human-launched server.
>
> **Key discovery — the fix is server+frontend coupled (the plan under-stated this).** The
> server's *window-local* z-score currently forces each channel to std≈1 *per window*, which
> happens to keep the frontend's per-window auto-gain stable. Fixing only the server (global
> scale) would make each window's variance differ and the frontend's `computeAutoGain` would
> re-normalize per window — **defeating the fix**. So both had to change:
>
> - **Server** (`state.py`): new `compute_channel_scale()` derives a robust per-channel
>   `(center=median, scale=IQR/1.349)` ONCE over the full tensor (strided to ≤200k samples),
>   cached on `ServerState._channel_scale_cache` keyed `(tensor, processing)` and cleared with
>   the LOD ladder. `_get_channel_scale()` + a new `channel_scale` param threaded through
>   `apply_slice_request` → `zscore_offset` (which gained `center`/`scale` kwargs; window-local
>   mean/std remains the fallback). Tests: `tests/test_channel_scale.py` (robustness,
>   global-not-window, caching/invalidation, and the "amplitude stable across overlapping
>   windows" money test).
> - **Frontend** (`TimeseriesSliceView.tsx` + `useChartTools.ts`): the breathing came from the
>   gain effect re-firing on every `series` change. Fixed by making **"fit" a true one-shot**
>   (compute once, hold via a `gainFittedRef` latch; effect deps `[tools.yMode]` only) and
>   **defaulting to "fit"** (the toolbar already documents it as "scale once… then hold").
>   "auto" stays opt-in for per-window adaptive fill. Tests: `useChartTools.test.ts` updated.
>
> **Decision taken:** default normalization = global robust IQR/1.349 (works on the synthetic
> demo; no real units needed). Fixed-µV/division remains a future mode (couples to int16/D).

**Problem.** [`zscore_offset`](../../src/tensorscope/server/state.py#L1508) z-scores each
channel by `mean`/`std` over the **current window's time axis**, computed on the **decimated
envelope**. Amplitude is therefore non-comparable across channels and "breathes" as you
pan/zoom — the opposite of clinical EEG (fixed µV/division) and MNE (`scalings` computed once).

**Change surface.**
- `state.py::zscore_offset` (+ its caller around `state.py:1375`).
- A place to compute & cache per-channel scale stats (alongside the processed tensor / per `ServerState`).
- `frontend/.../TimeseriesSliceView.tsx` auto-gain IQR (~436) — demote to an explicit "fit to view" action, not the per-request default.

**Approach.**
- Compute a per-channel scale **once** from the full-rate, full-window tensor: robust std or a high percentile (MNE's `'auto'` = 99.5th pct), cached keyed by `(tensor, processing_hash)`. Apply that **constant** scale regardless of the current window/LOD level. The vertical stacking offset logic stays.
- Optional second mode: **fixed µV/division** (the clinical default) — only meaningful once we know real units (couples to #1/D int16+gain; can land as a follow-up toggle).
- Server change: `zscore_offset` no longer needs the windowed slice for its scale; it reads the cached per-channel scale and just applies + stacks.

**Verification.**
- Unit test on the normalization: same channel, two different windows → **identical scale factor** (the regression test for the bug). Test that a global-percentile scale is stable across LOD levels.
- Visual gate (`/verify-ui` or playwright on :5173): pan/zoom the timeseries and confirm trace amplitudes **don't rescale**; a large event stays visibly larger than background across windows.

**Risk.** Low–Medium. Behavior change users will see (that's the point); the math is simple but the "compute once + cache + invalidate on processing change" wiring must reuse the existing `_processed`/LOD invalidation hooks.
**Size.** ~1 day.
**Decisions to confirm.**
1. **Default scale method:** global robust-std / 99.5th-percentile-once (works on any tensor, incl. the synthetic demo) **[recommended default]** vs fixed µV/division (needs real units). Recommend: ship global-once now, add µV/division as a mode after #1/D.
2. Keep window-local auto-gain available as an explicit one-shot button? Recommend yes.

---

## Fix #1 — Channel-windowed fetch (biggest win; plumbing already exists)

**Problem.** The server already honors `request.channels` / `ap_range` / `ml_range`
([`state.py:1256-1262`](../../src/tensorscope/server/state.py#L1256)) and the frontend type
already declares them ([`types.ts:120-122`](../../frontend/src/api/types.ts#L120)). But the
**timeseries request builder never populates them**, so the server ships all 384 channels and
[`TimeseriesSliceView.tsx:360`](../../frontend/src/components/views/TimeseriesSliceView.tsx#L360)
discards ~94% via `raw.series.slice(start, start+N_VISIBLE)`.

**Change surface.**
- `frontend/src/api/queries.ts::makeDefaultSliceRequest` (timeseries branch) — populate `channels` (channel-dim tensors) or `ap_range`/`ml_range` (grid tensors) from `tsFirstChannel` + `N_VISIBLE` + a **channel overscan**.
- Whatever calls the builder needs `tsFirstChannel`, total channel count, and the schema (channel vs AP/ML) — thread these in (they already live in `useAppStore` / schema).
- `TimeseriesSliceView.tsx` — stop the post-hoc `.slice()` (or slice only within the overscan margin).
- **Verify the server applies the channel `.isel` early enough** to also cut *decimation* cost, not just serialization (currently at `state.py:1256`, after the LOD-level swap — confirm/move so decimation runs on the windowed set).

**The two real subtleties (call out in review):**
1. **Grid `(time, AP, ML)` tensors.** "Channel window of 16" maps cleanly to a `channel` dim but to a *flattened AP×ML range* only if the flatten order is contiguous. Decide: send `channels` (flattened ids) the same way the mask does (`ap_idx*n_ml+ml_idx`), or `ap_range`/`ml_range` for a rectangular sub-block. Recommend flattened `channels` to match the existing mask convention and the frontend's current flatten.
2. **Channel scroll → refetch.** Today `[`/`]` scrolling is instant (slices the already-fetched full set). Windowing the fetch means a scroll past the overscan triggers a refetch. Mitigate with a **channel overscan** (e.g. fetch `N_VISIBLE + 2·margin`, draw the middle `N_VISIBLE`) mirroring the time-axis overscan philosophy, so small scrolls stay local. Accept that large jumps refetch — that's the correct trade for ~16× payload reduction.

**Keep the scrollbar honest (follow-up, optional in this PR):** a cheap per-channel RMS
"overview" lane (one value per channel per coarse bin) so the channel scrollbar still
reflects all 384. Can reuse the coarsest `_LOD_LEVELS` tier. Flag as a fast-follow, not a blocker.

**Verification.**
- Network gate: inspect the slice request — `channels` present; response payload bytes drop ~16× (measure in devtools / playwright `browser_network_requests`).
- Visual gate: the correct channel window renders; `[`/`]` still scrolls (refetch within budget); masked channels still behave.
- Tests: a backend test asserting `channels`-bounded request returns only those channels (the `.isel` path likely already has coverage — extend it); a frontend test asserting the timeseries builder emits `channels` from `tsFirstChannel`/`N_VISIBLE`.

**Risk.** Medium. Wire-contract *usage* change (backward compatible — field is optional), plus the grid-tensor mapping and the scroll-refetch UX. The biggest payoff, but touches the most-trafficked view.
**Size.** ~1–1.5 days incl. overscan + grid handling.
**Decisions to confirm.**
1. Grid tensors: flattened `channels` (recommended) vs rectangular `ap_range`/`ml_range`.
2. Channel overscan margin (recommend ~½·N_VISIBLE each side).
3. Build the RMS overview lane now or as a fast-follow (recommend fast-follow).

---

## Fix #4 — Threadpool + request prioritization (highest risk; isolate)

**Problem.** A selection change fan-outs ~6 simultaneous heavy slice requests on one
synchronous Python GIL; a cheap timeseries queues behind a multi-second multitaper PSD
(head-of-line blocking).

**Change surface.** `server/routers/*` slice endpoints + the call into `apply_slice_request`;
possibly a small shared executor/semaphore module.

**Approach (validated by the survey — NumPy/FFT release the GIL, so threads parallelize).**
- Wrap the CPU-bound slice/PSD compute in `run_in_threadpool` (Starlette) / `asyncio.to_thread` so the fan-out runs in parallel.
- Add a **bounded semaphore for the expensive views** (`psd_live`, `spectrogram_live`) so they can't occupy all workers and starve Tier-0 (`timeseries`/`navigator`). Cheap and expensive views draw from separate lanes.
- **Do NOT** use `ProcessPoolExecutor` (array-serialization cost ≈ the compute we're parallelizing) or depend on the free-threaded 3.13 build (not default; 5–10% single-thread tax).

**Concurrency-safety audit (the risk):**
- The per-session `_view_result_cache` / `_lod_cache` / `_processed_cache` are mutated after compute. Under threads, concurrent requests in the *same session* could race on these dicts. Confirm each cache write is either per-key-idempotent or guarded by a lock; the "each worker owns its array, read-after-compute" pattern must hold. The per-session `deepcopy` isolates *across* sessions but **not across concurrent requests within one session** — that's the fan-out case, exactly what we're parallelizing.
- Verify no shared-array in-place mutation across the parallel handlers.

**Verification.**
- Timing harness: issue a PSD request + a timeseries request concurrently; assert the timeseries p50 latency is ~unchanged vs PSD-absent (no head-of-line block). Measure before/after.
- Stress test: fire the full 6-view fan-out N times; assert no cache corruption (results match the serial baseline) and no exceptions.
- `pixi run test` green under the new threaded path.

**Risk.** **High** — concurrency bugs are the hardest to attribute, which is exactly why this lands alone, after the cheap wins.
**Size.** ~1.5–2 days incl. the cache-safety audit.
**Decisions to confirm.** Pool sizes / semaphore count for the expensive lane (start: cheap-lane = #cores, expensive-lane semaphore = 1–2).

---

## Fix #5 — Image / carpet auto-switch above a channel threshold (ship last)

**Problem.** Line traces don't scale past ~100–200 series (uPlot ceiling); the field switches
to a channel(or depth)×time **image** for dense probes. TensorScope already has the primitive
(`depth_map`) — it just isn't the automatic representation at high channel counts.

**Change surface.** `viewGridLayout.ts` / `registry/viewRegistry.ts` / the timeseries view
host — choose representation by `n_channels`.

**Approach.** When the active tensor's channel count exceeds a threshold (~64–128), default the
"signal" slot to a `depth_map`-style channel×time heatmap instead of stacked lines; keep an
explicit toggle back to lines (windowed via #1). Reuse the existing `depth_map` renderer.

**Verification.** Visual gate on a real 384-ch multiprobe (`tensorscope_multiprobe.py` launcher):
confirm the image renders and is legible where 384 lines were not; confirm the toggle works.

**Risk.** Medium (UX/representation default — must not surprise users on small tensors).
**Size.** ~1 day.
**Decisions to confirm.** Threshold value; whether auto-switch overrides an explicit user choice (recommend: auto only sets the *initial* representation; respect explicit toggles).

---

## Cross-cutting policy

- **One commit per fix**, each green on `pixi run test` + `pixi run frontend-test` + `npx tsc -b`, with the fix-specific verification gate above. No bundling (per the repo's own `adversarial-critique.md` lesson).
- **Headless-first:** #3 and #2 (logic) and the #1 builder are unit-testable; #2/#1/#5 visual aspects need `/verify-ui` on :5173 (never :8000 — static shadow); #4 needs a timing harness. "Tests pass" ≠ "renders correctly" for the canvas/uPlot parts.
- **No wire-contract break:** #1 only *uses* already-optional fields; #2/#3/#4 are server-internal; #5 is frontend-only. Nothing here needs an ADR, but #2's normalization change and #5's default are user-visible behavior changes worth a line in the handoff.
