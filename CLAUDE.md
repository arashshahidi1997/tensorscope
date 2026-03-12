# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- **Conda env: `cogpy`** — always prefix Python commands with `conda run -n cogpy`
- Demo dataset: `data/demo_lfp.nc` (generated via `make demo-data`)

## Common Commands

```bash
# Backend
conda run -n cogpy make test                    # run all backend tests
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
- **`server/state.py`** — `ServerState`, `apply_slice_request` (tensor→Arrow IPC base64), `_VIEW_REGISTRY` maps dimension tuples to view types
- **`server/models.py`** — Pydantic DTOs: `TensorSliceRequestDTO`, `SelectionDTO`, `TensorMetaDTO`, `ApiErrorDTO`
- **`server/session.py`** — Cookie-based `SessionManager`
- **`server/routers/`** — 8 FastAPI routers (state, tensors, selection, layout, events, processing, transforms, dag)
- **`core/`** — Pure Python, no server deps: `SelectionState`, `TensorRegistry`, `LayoutManager`, `EventRegistry`, `TransformRegistry` + DAG executor

Request flow: client sends `TensorSliceRequestDTO` → `apply_slice_request` slices the xarray tensor → serialises to Arrow IPC → returns base64-encoded response.

### Frontend (`frontend/src/`)

- **State**: Zustand stores — `useSelectionStore` (navigation: time, spatial, freq, event), `useAppStore` (shell: selectedTensor, layout, theme), `useDagStore` (transform DAG)
- **Data fetching**: `useSliceQuery` (TanStack Query) wraps `DataSource` interface (`api/dataSource.ts`); selection mutations go through single round-trip to `/api/v1/selection` then invalidate all queries
- **Views**: `registry/viewRegistry.ts` has `VIEW_DESCRIPTORS` + `getAvailableViews(schema)`; view components in `components/views/` (Timeseries/uPlot, SpatialMap/CSS-grid, Spectrogram/Canvas2D, Navigator/uPlot, PSD/uPlot, EventTable)
- **Layout**: `LayoutShell` + `NavRail` + `InspectorPanel`; `WorkspaceMain` renders active views
- **Hooks**: `useChartTools(chartRef)` for view-local tool state; `useOverviewDetail()` / `useEventNavigation()` for navigation contracts

### Data flow

1. User interaction updates `useSelectionStore` → triggers selection mutation to server
2. Server persists selection in session, returns updated state
3. React Query invalidation triggers `useSliceQuery` refetches per active view
4. Each view decodes Arrow IPC (`api/arrow.ts`) and renders

## Testing

- **Backend**: pytest, fixtures in `tests/conftest.py`. Run with `PYTHONPATH=src`.
- **Frontend**: vitest 4.x. Per-file environment override via `// @vitest-environment jsdom` comment (not `environmentMatchGlobs`). 39 tests across store and view files.

## Key Conventions

- Server error mapping: `KeyError → 404`, `ValueError → 400` (structured `ApiErrorDTO`)
- PSD views: `time_range` is optional; timeseries/navigator/spectrogram require it
- `create_server_state` accepts `dict[str, xr.DataArray]` for multi-tensor sessions
- Vite config imports from `"vitest/config"` (not `"vite"`)
- Vite dev server proxies `/api` to `localhost:8000`
- All React hooks must precede any conditional `return null`; guards go last
- Never cast server fields with `as number`; use `parseFloat` + `Number.isFinite` guard
- For cursor-driven animations, use a sequential fetch queue of 1 (not React Query or AbortController)
