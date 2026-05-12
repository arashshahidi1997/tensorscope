# Agent Activity Log

Recent agent session summaries for handoff context.

## 2026-04-23 02:26 | tensorscope | opus | 1 steps

CLAUDE.md and the task note have been updated with the new surface.

Session: `c305499b` | Task: `task-cogpy-compat-20260423-120000-000001.md`

## 2026-05-02 17:01 | tensorscope | opus | 1 steps

Highlights:
- **Landed**: spectrogram axis labels + heatmap gestures (pan/box/wheel/directional), spatial-map intentionally non-zoomable, slot-based row layout for side-by-side views, shift+wheel gain on timeseries, navigator as time slider.
- **Partial**: `ProcessingPanel` still uses `type="number"` + `parseFloat || default`, breaking both the `.95` and "0 default backspace" cases (DAG picker is fine); spatial maps share consistent AP/ML directional labels but render no numeric ticks; `TimeS...

Session: `e44c24f8` | Task: `task-march-issues-audit-20260502-120000-000001.md`

## 2026-05-02 17:10 | tensorscope | opus | 1 steps

Wrote the design proposal to `docs/design/probe-layout.md`. It commits to a single approach — `ProbeLayout` as a sidecar metadata object on `ServerState`, with `(time, channel)` as the canonical dim and grid AP/ML demoted to a derivable group geometry — and lays out the data model, schema integration, migration path (auto-derive layouts for legacy `(time, AP, ML)` data), per-surface impact list, NeuroScope2 alignment, out-of-scope list, risks, and 6 open questions for user input. Effort estim...

Session: `82b80c35` | Task: `task-probelayout-design-20260502-140000-001.md`

## 2026-05-02 17:13 | tensorscope | opus | 1 steps

**Smoke not run**: `pixi run test` / `pixi run frontend-test` couldn't be invoked from this session (sandbox denied `pixi`). Findings + before/after OpenAPI diff appended to the task note.

Session: `f84c5026` | Task: `task-paramspec-tristate-20260502-140000-003.md`

## 2026-05-02 17:14 | tensorscope | opus | 1 steps

Wrote `docs/design/pipeline-spec.md`. The design commits to a single path: a `pipeline.yaml` round-tripping with `WorkspaceDAG`, a `.tensorscope-cache/<cache_key>/` zarr+JSON layout that turns `TransformCache` into a write-through layer, mtime+size invalidation against source `.nc` fingerprints, stale badges via a new `cache_status` field on `DAGTensorNode` (plus a `/api/v1/cache/status` endpoint), CLI-based fan-out (`tensorscope batch run`) instead of server-side dispatch, stable IDs sourced...

Session: `42089c77` | Task: `task-pipeline-spec-design-20260502-140000-002.md`

## 2026-05-02 17:20 | tensorscope | opus | 1 steps

Files changed:
- `src/tensorscope/server/models.py` — `PsdParamsDTO.fmin` default 0.0 → 1.0
- `tests/test_psd_live.py` — new `test_psd_params_default_fmin_is_1hz`
- `frontend/src/api/types.ts` — added `fmin?` to `PSDParamsDTO`
- `frontend/src/components/views/AxisTicks.tsx` — new `makeLogTicks`, `logScale` prop
- `frontend/src/components/views/AxisTicks.test.ts` — new unit tests
- `frontend/src/components/views/PSDHeatmapView.tsx` — toolbar log toggle, log YTicks
- `frontend/src/components/vi...

Session: `afa800ea` | Task: `task-psd-fmin-log-freq-20260502-140000-004.md`

## 2026-05-02 17:24 | tensorscope | opus | 1 steps

**Smoke**: `pixi run pytest …` was blocked by the sandbox in this session, so the suite was not executed. The full audit (semantics of `triggered_snr`, what changed in `triggered_average`, files touched, smoke caveat) is appended to `docs/log/issue/task-triggered-baseline-20260502-140000-005.md`.

Session: `c2b25761` | Task: `task-triggered-baseline-20260502-140000-005.md`

## 2026-05-12 01:48 | tensorscope | opus | 1 steps

**G4 event-locked summary view shipped.** New `event_average` view type that stacks `(event, …, lag)` epochs via `cogpy.brainstates.intervals.perievent_epochs` and dispatches to `cogpy.triggered.{triggered_average, triggered_std, triggered_median, triggered_snr}` for the reduction. The frontend `EventAverageView` is a self-contained Canvas-2D component with inline controls (stream, pre/post, aggregator, `max_events`, pool); when `aggregate=mean` it fires a parallel `aggregate=std` fetch to pa...

Session: `80e9ca0a` | Task: `task-g4-event-summary-20260512-012738-149655.md`

## 2026-05-12 02:03 | tensorscope | opus | 1 steps

**To verify locally**
- `pixi run frontend-test src/api/coincidence.test.ts src/store/eventStreamsStore.test.ts` — fast subset.
- `pixi run frontend-test` — full vitest suite.
- `pixi run frontend-build` — typecheck + build.

Session: `3eb656e4` | Task: `task-g5-detector-overlay-20260512-012738-202424.md`

## 2026-05-12 02:13 | tensorscope | opus | 1 steps

**Could not run tests** in this session — the sandbox blocked every variant of `vitest`/`npm test` invocation. Code reviewed manually; the `fireEvent.click` on a radio input was deliberately avoided (jsdom doesn't auto-fire `change`), so the popover test seeds `initial.status = "accepted"` instead.

Session: `d9181efb` | Task: `task-g6-event-notes-tags-20260512-012738-254810.md`

## 2026-05-12 02:26 | tensorscope | opus | 1 steps

**Test execution:** The sandbox blocked `pytest` / `vitest`, so I couldn't run the tests in this session — they're written and tracked but unverified by execution. Static review of the source shows the wiring is correct and the renderer changes only add code paths behind `regionByFlatId && size > 0`.

Session: `73ea8f18` | Task: `task-g7-anatomy-labels-20260512-012738-307093.md`

## 2026-05-12 02:32 | tensorscope | opus | 1 steps

**Test execution:** the sandbox blocked `pixi run frontend-test` and `pixi run frontend-build` in this session, so the new tests and the typecheck are unverified by execution. The test cases are isolated to the new helper / new code path, and the existing `makePSDLiveRequest` tests use only the original 3- and 4-arg call shapes (the 5th arg is optional), so back-compat is preserved.

Session: `ccf74f28` | Task: `task-g8-psd-event-lock-20260512-012738-359121.md`

## 2026-05-12 02:43 | tensorscope | opus | 1 steps

**Test execution:** The sandbox blocks `pixi run pytest` / `pixi run frontend-test`, so the new tests are written but unverified by execution. Static syntax check on all touched Python files passes. The `event_review` router only reads `state.dataset_dir`, so existing test fixtures (which leave it `None`) continue to behave as before — `test_post_returns_403_without_dataset_dir` covers that path.

Session: `8c42821c` | Task: `task-g9-validation-export-20260512-012738-411054.md`
