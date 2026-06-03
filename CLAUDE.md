# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation map (start here)

A fresh session should orient via these, in order:

- **[docs/index.md](docs/index.md)** — docs hub (Diátaxis: tutorials / how-to / reference / explanation).
- **[docs/architecture/tensorscope.md](docs/architecture/tensorscope.md)** + [invariants](docs/architecture/invariants.md) — system design & guardrails. (Written for the M1–M8 era; recent architectural work lives in the design docs + ADRs below.)
- **[docs/adr/index.md](docs/adr/index.md)** — architecture decisions; do not silently re-litigate these (e.g. ADR-0004 shared SelectionState, ADR-0007 unified time-transport).
- **In-flight work & current state:** the newest `docs/log/handoff-*.md`, plus [docs/design/refactor-plan.md](docs/design/refactor-plan.md). Recent big changes: [contract-v2](docs/design/contract-v2.md) (wire format), [time-transport](docs/design/time-transport.md) (navigation), [neuropixels-multiprobe](docs/design/neuropixels-multiprobe.md); surveys in `docs/research/`.
- This file is the canonical quick-reference for commands, gotchas, and conventions (below).

## Environment

- **Pixi env (project-local)** — prefix Python commands with `pixi run`. First run: `pixi install`.
- Demo dataset: `data/demo_lfp.nc` (generated via `pixi run demo-data`)

## Common Commands

```bash
# Backend
pixi run test                                   # full backend suite (pixi task)
pixi run pytest tests/test_foo.py -q            # single test file
pixi run pytest tests/test_foo.py::test_bar -q  # single test

# Frontend
pixi run frontend-test                          # full frontend suite (vitest)
pixi run bash -c "cd frontend && npx vitest run src/store/selectionStore.test.ts"  # single file (MUST go through pixi)
pixi run bash -c "cd frontend && npx tsc -b"    # typecheck only (no static-dir overwrite)
pixi run frontend-build                         # typecheck + build (overwrites src/tensorscope/static — see gotchas)

# Full stack dev
pixi run serve                                  # FastAPI backend (demo dataset)
pixi run frontend-dev                           # Vite dev server
# or: make dev-ui — runs both in screen sessions (uses `python` from current env)
```

## Agent / automation gotchas (read before autonomous / ultracode runs)

- **Bare `node` is v12 on this host** → `npx vitest`/`tsc` outside the env fail
  with `ERR_UNKNOWN_BUILTIN_MODULE`. ALWAYS run JS tooling via `pixi run` (env
  has node 22). This includes single-file test runs.
- **`src/tensorscope/static/` shadows `frontend/dist/`** when the backend serves
  on `:8000` — stale static silently masks a fresh build. Check the bundle hash
  before chasing frontend bugs. `pixi run frontend-build` overwrites `static/`;
  use `npx tsc -b` (via pixi) for a typecheck that doesn't touch it.
- **jsdom can't render canvas** (`getContext` unimplemented) → uPlot/Canvas views
  can't be visually verified in tests. "Tests pass" ≠ "renders correctly";
  extract pure logic for real coverage.
- **The live server launcher is SIGTERM-killed under the harness** (exit 144) —
  agents CANNOT run the live app for validation; a human must launch it. So
  interactive/visual correctness is not auto-verifiable.
- **git worktree isolation breaks frontend tests**: `frontend/node_modules`
  (gitignored) is absent in a fresh worktree → `frontend-test` fails. Don't use
  worktree isolation for frontend agents.
- **Backend tests need `PYTHONPATH=src`** (the `pixi run test` task sets it).
- See `docs/design/refactor-plan.md` for the scoped, budgeted ultracode brief.

## Architecture

TensorScope is a web viewer for multidimensional neuroscience tensors (xarray DataArrays). The backend slices/transforms data and serves it as Arrow IPC; the frontend renders interactive views.

### Backend (`src/tensorscope/`)

- **`cli.py`** — Entry point (`tensorscope serve <data.nc>`)
- **`server/app.py`** — `create_app(data, tensor_name, events_registry)` factory → FastAPI
- **`server/state.py`** — `ServerState`, `apply_slice_request` (tensor→Arrow IPC base64), `_VIEW_REGISTRY`, processing cache (`_processed_cache` / `_get_processed_tensor()`), brainstate helpers
- **`server/models.py`** — Pydantic DTOs: `TensorSliceRequestDTO` (with `psd_params`), `SelectionDTO`, `TensorMetaDTO`, `ProcessingParamsDTO` (with `enabled` toggle), `ApiErrorDTO`
- **`server/session.py`** — Cookie-based `SessionManager`
- **`server/routers/`** — 9 FastAPI routers (state, tensors, selection, layout, events, processing, transforms, dag, brainstates)
- **`core/`** — Pure Python, no server deps: `SelectionState`, `TensorRegistry`, `LayoutManager`, `EventRegistry`, `TransformRegistry` + DAG executor

Request flow: client sends `TensorSliceRequestDTO` → `apply_slice_request` gets processed tensor from cache → slices → serialises to Arrow IPC → returns base64-encoded response.

### Frontend (`frontend/src/`)

- **State**: Zustand stores — `useSelectionStore` (navigation: time, spatial, freq, event), `useAppStore` (shell: selectedTensor, activeViews, theme, brainstateOverlay, showHypnogram), `useLayoutStore` (persistent layout: sidebar/inspector/bottom panel, with `persist` middleware), `useDagStore` (transform DAG)
- **Data fetching**: `useSliceQuery` (TanStack Query) wraps `DataSource` interface (`api/dataSource.ts`); selection mutations go through single round-trip to `/api/v1/selection` then invalidate all queries
- **Views**: `registry/viewRegistry.ts` has `VIEW_DESCRIPTORS` + `getAvailableViews(schema)`; view components in `components/views/` — Timeseries/uPlot (Y-zoom + gain modes, relative time, persistent cursor, brainstate overlay), SpatialMap/Canvas (aspect-ratio constrained), Spectrogram/Canvas2D, Navigator/uPlot (brainstate overlay), PSD Heatmap/Canvas2D, PSD Curve/Canvas2D, PSD Spatial/Canvas, Hypnogram/Canvas2D, EventTable
- **Layout**: `LayoutShell` with `ResizeHandle` for resizable panels; `SidebarTabBar` (5 tabs: Explore, Graph, Tensors, Events, Pipeline) + `SidebarContent`; `ViewGrid` renders slot-based rows with `ViewPanel` chrome; `LayoutPresetPicker` in topbar
- **Hooks**: `useChartTools(chartRef)` for view-local tool state; `useOverviewDetail()` / `useEventNavigation()` for navigation contracts; `useLayoutShortcuts()` for keyboard shortcuts

### View grid layout

Fixed slot-based rows defined in `viewGridLayout.ts` (`DEFAULT_SLOT_LAYOUT`):
- **Signal row**: timeseries (65%) + spatial_map (35%)
- **PSD row**: psd_heatmap (40%) + psd_curve (25%) + psd_spatial (35%)
- **Spectrogram row**: spectrogram (65%) + propagation_frame (35%)

Views toggle visibility in-place without reflowing neighbors. `ViewPanel` provides maximize/close chrome.

### PSD live computation

Server's `psd_live` view type computes on-the-fly multitaper PSD using `cogpy.spectral.psd.psd_multitaper` (cogpy v0.2.0 flat layout). The frontend's `expandPSDLive()` maps the server's single `psd_live` to three sub-view IDs (`psd_heatmap`, `psd_curve`, `psd_spatial`), all populated from one server round-trip.

`psd_params` is a typed `PsdParamsDTO` mirroring cogpy kwargs: `NW`, `K`, `fmin`, `fmax`, `detrend`. Default `fmax` is `None` (Nyquist) — matches cogpy's default.

### cogpy-backed transforms

`TransformRegistry` includes cogpy wrappers alongside the scipy-backed transforms:

- Pre-processing (DAG-only): `cmr`, `notch`, `spatial_median`, `zscore`
- Spectral: `psd_multitaper`, `psd_welch`
- Intervals / epochs: `restrict_intervals`, `perievent_epochs`
- Triggered stats (consume `(event, ..., lag)` tensors): `triggered_average`, `triggered_std`, `triggered_median`, `triggered_snr`

Optional cogpy kwargs that accept `None` (e.g. `K`, `fmax`, `noverlap`) are carried through `ParamSpec` as sentinel defaults (`0` / `-1`) because `ParamSpec(default=None)` means "required".

### cogpy-backed event detectors

`core/events/detectors.py` registers wrappers for `cogpy.detect`:

- `cogpy_ripple` → `RippleDetector` (100–250 Hz bandpass + envelope + dual threshold)
- `cogpy_spindle` → `SpindleDetector` (11–16 Hz)
- `cogpy_burst` → `BurstDetector` (h-maxima on multitaper spectrogram)
- `cogpy_threshold` → `ThresholdDetector` (crossings with optional bandpass/envelope)

All four return `EventStream`s built from the cogpy `EventCatalog.df`.

### Data flow

1. User interaction updates `useSelectionStore` → triggers selection mutation to server
2. Server persists selection in session, returns updated state
3. React Query invalidation triggers `useSliceQuery` refetches per active view
4. Each view decodes Arrow IPC (`api/arrow.ts`) and renders

## Testing

- **Backend**: pytest, fixtures in `tests/conftest.py`. Run with `PYTHONPATH=src`. 139 tests.
- **Frontend**: vitest 4.x. Per-file environment override via `// @vitest-environment jsdom` comment (not `environmentMatchGlobs`). 106 tests across store, api, and view files.

## Key Conventions

- Server error mapping: `KeyError → 404`, `ValueError → 400` (structured `ApiErrorDTO`)
- PSD views: `time_range` is optional; timeseries/navigator/spectrogram require it
- `psd_live` requires `time` dimension; `psd_params` (NW, fmax) passed in request
- `create_server_state` accepts `dict[str, xr.DataArray]` for multi-tensor sessions
- Processing pipeline caches full-tensor results; slices read from cache (not re-processed per request)
- Vite config imports from `"vitest/config"` (not `"vite"`)
- Vite dev server proxies `/api` to `localhost:8000`
- All React hooks must precede any conditional `return null`; guards go last
- Never cast server fields with `as number`; use `parseFloat` + `Number.isFinite` guard
- For cursor-driven animations, use a sequential fetch queue of 1 (not React Query or AbortController)
- Slot-based layout: views have fixed home slots; toggling shows/hides in-place (no reflow)
- FastAPI routers: declare specific paths (e.g. `/events/detectors`) before parameterized ones (`/events/{name}`); FastAPI matches in declaration order
- cogpy detectors that bandpass (ripple/spindle/burst) require an `fs` attr on the input — `core/events/detectors.py` calls `_ensure_fs()` to infer it from the time coord before handing the array to cogpy
- Per-session `ServerState` is built via `deepcopy(template_state)` (see `server/session.py`). Anything used as an identity-checked sentinel (e.g. `_REQUIRED` in `core/transforms/registry.py`) must override `__deepcopy__` to return self — bare `object()` instances get cloned and break `is` checks across sessions
