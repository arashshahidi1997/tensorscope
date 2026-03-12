# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- **Conda env: `cogpy`** — always prefix Python commands with `conda run -n cogpy`
- Demo dataset: `data/demo_lfp.nc` (generated via `make demo-data`)

## Common Commands

```bash
# Backend
conda run -n cogpy python -m pytest tests/ -q              # run all backend tests
conda run -n cogpy python -m pytest tests/test_foo.py -q   # single test file
conda run -n cogpy python -m pytest tests/test_foo.py::test_bar -q  # single test

# Frontend
cd frontend && npm run test                     # run all frontend tests (vitest)
cd frontend && npx vitest run src/store/selectionStore.test.ts  # single test file
cd frontend && npm run build                    # typecheck + build

# Full stack dev
make dev-ui                                     # FastAPI backend + Vite dev server together
```

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

Server's `psd_live` view type computes on-the-fly multitaper PSD using `cogpy.core.spectral.psd.psd_multitaper`. The frontend's `expandPSDLive()` maps the server's single `psd_live` to three sub-view IDs (`psd_heatmap`, `psd_curve`, `psd_spatial`), all populated from one server round-trip.

### Data flow

1. User interaction updates `useSelectionStore` → triggers selection mutation to server
2. Server persists selection in session, returns updated state
3. React Query invalidation triggers `useSliceQuery` refetches per active view
4. Each view decodes Arrow IPC (`api/arrow.ts`) and renders

## Testing

- **Backend**: pytest, fixtures in `tests/conftest.py`. Run with `PYTHONPATH=src`. 126 tests.
- **Frontend**: vitest 4.x. Per-file environment override via `// @vitest-environment jsdom` comment (not `environmentMatchGlobs`). 39 tests across store and view files.

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
