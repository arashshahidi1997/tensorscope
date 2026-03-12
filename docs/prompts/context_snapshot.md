# TensorScope Context Snapshot

Role: concise agent handoff file.

Use this file at the start of an agent session to understand:

- what the repo currently contains
- what to inspect first
- what milestone the project is actually in
- what questions are still open

Related docs:

- [Prompt usage guide](./README.md)
- [Architecture](../architecture/tensorscope.md)
- [Stable prompt context](./tensorscope/00_context.md)
- [Human roadmap](./roadmap.md)

## Current repo context

TensorScope currently has two main implementation surfaces:

- Python core and FastAPI server in `src/tensorscope/`
- React/Vite/TypeScript frontend in `frontend/`

The repo also contains design studies, hand-off notes, and reference-study material in `docs/` and `resources/`.

## Current TensorScope status

M1, M2, M3 complete as of 2026-03-12.

Implemented:

### Core / server
- tensor registry and validated selection model in the Python core
- session-backed API state and tensor slice endpoints
- `ElectrodeLayoutDTO` + `ServerState.electrode_layout()` for spatial tensors
- `propagation_frame` view type: returns a single `(AP, ML)` frame at `frame_time`
- 40 backend tests passing

### Frontend foundation (M1)
- `useSelectionStore` — dedicated navigation store: `{ timeCursor, timeWindow, spatial, freq, event }`; app-shell state in `useAppStore`
- `SpatialSelection` now carries `hoveredId: number | null` and `selectedIds: number[]`
- new store setters: `setHoveredElectrode`, `setSelectedElectrodes`, `toggleElectrodeSelection`, `setSpatialBrush`
- `toSelectionDTO` / `initFromDTO` — store ↔ wire-format bridge (hoveredId/selectedIds not serialized to server)
- `useChartTools(chartRef)` + `ChartToolbar` — view-local tool state outside shared store
- `useOverviewDetail()` — navigator drag and timeseries zoom both call `setTimeWindow`
- `useEventNavigation()` — event identity in store, decoupled from timeCursor
- `NavRail` / `WorkspaceMain` / `InspectorPanel` — workspace shell extracted; App.tsx is ~100 lines
- `VIEW_DESCRIPTORS` + `getAvailableViews(schema)` — frontend view registry mirrors backend `_VIEW_REGISTRY`
- `InspectorPanel` — tensor summary + selection summary + event table in right rail
- 39 frontend unit tests: selectionStore (31) + useChartTools (8)

### Scientific views (M2)
- `DataSource` interface + `SliceOptions` + `createTensorDataSource` factory in `frontend/src/api/dataSource.ts`
- `useSliceQuery` / `makeDefaultSliceRequest` / `clampWindow` in `frontend/src/api/queries.ts`
- Arrow IPC decode + `extractTimeseriesColumnar`, `extractSpatialCells`, `extractFreqCurve`, `extractSpectrogram` in `frontend/src/api/arrow.ts`
- `timeseries` → uPlot multichannel, event markers via canvas hook
- `spatial_map` → Canvas heatmap (ChannelGridRenderer) with click-to-select and hover
- `psd_average` → uPlot freq curve (mean over spatial)
- `spectrogram` → Canvas 2D heatmap, inferno-like colormap
- `navigator` → thin uPlot overview with drag-to-zoom → updates timeWindow
- `EventTableView` with prev/next navigation

### Spatial dynamics (M3)
- `ElectrodeLayout` / `ElectrodeCoord` / `buildElectrodeLayout` in `frontend/src/types/spatialLayout.ts`
- `SpatialRendererBackend` interface in `frontend/src/components/views/SpatialRenderer.ts`
- `ChannelGridRenderer` (Canvas CPU impl) in `frontend/src/components/views/ChannelGridRenderer.ts` — sequential + cyclical colormaps, 1px-gap grid, hit-testing, hover/select borders
- `SpatialMapSliceView` rewritten to use `ChannelGridRenderer` + `ResizeObserver`; wires `onHoverElectrode`
- `PropagationView` — spatial heatmap with time overlay (`t = N.NNNs`), same renderer stack
- `AnimationController` — rAF loop driving `timeCursor` via `getState()`, play/pause/step/speed controls
- `SpatialEventView` — peri-event spatial heatmap driven by selected event + timeCursor
- `propagation_frame` registered in `VIEW_DESCRIPTORS` and `viewRegistry`
- `WorkspaceMain` wired: hover → `setHoveredElectrode`, propagation panel with `AnimationController`, spatial event view

## Current milestone

**M3 complete. Ready for M4.**

M4 goal: transform registry, derived tensors, explicit analysis outputs (spectrogram,
PSD, band power, coherence, event-aligned tensors), worker-based computation, transform cache.

## Inspect these files first

### Core and server

- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)

### Frontend architecture anchors

- [frontend/src/types/index.ts](/storage2/arash/projects/tensorscope/frontend/src/types/index.ts) — canonical domain types barrel
- [frontend/src/types/selection.ts](/storage2/arash/projects/tensorscope/frontend/src/types/selection.ts) — SelectionState, SpatialSelection (with hoveredId/selectedIds)
- [frontend/src/types/spatialLayout.ts](/storage2/arash/projects/tensorscope/frontend/src/types/spatialLayout.ts) — ElectrodeLayout, ElectrodeCoord, buildElectrodeLayout (M3)
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts) — navigation state + spatial setters
- [frontend/src/api/queries.ts](/storage2/arash/projects/tensorscope/frontend/src/api/queries.ts) — useSliceQuery, makeDefaultSliceRequest, clampWindow
- [frontend/src/api/arrow.ts](/storage2/arash/projects/tensorscope/frontend/src/api/arrow.ts) — Arrow IPC decode + all extractors
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts) — VIEW_DESCRIPTORS + getAvailableViews
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)
- [frontend/src/components/views/SpatialRenderer.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/SpatialRenderer.ts) — SpatialRendererBackend interface (M3)
- [frontend/src/components/views/ChannelGridRenderer.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/ChannelGridRenderer.ts) — Canvas CPU renderer (M3)
- [frontend/src/components/views/PropagationView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/PropagationView.tsx) — propagation frame view (M3)
- [frontend/src/components/controls/AnimationController.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/controls/AnimationController.tsx) — rAF animation controller (M3)

## Recent major changes (M3, 2026-03-12)

- `SpatialSelection` extended with `hoveredId` (transient, not serialized to server) and `selectedIds` (multi-electrode committed selection).
- `ElectrodeLayout` / `ElectrodeCoord` / `buildElectrodeLayout` added to types barrel.
- `SpatialRendererBackend` interface: `init`, `render`, `hitTest`, `dispose` — CPU/WebGL abstraction.
- `ChannelGridRenderer` Canvas implementation: sequential + cyclical colormaps, ResizeObserver, O(n) hit-test.
- `SpatialMapSliceView` rewritten to use `ChannelGridRenderer`; adds `onHoverElectrode` prop.
- `PropagationView`: same renderer stack, adds `t = N.NNNs` canvas overlay from `slice.meta.selected_time`.
- `AnimationController`: rAF loop, drives `timeCursor` via `getState().setTimeCursor` — no React re-render during animation.
- `SpatialEventView`: peri-event spatial heatmap; gates on `event.eventId !== null`.
- Backend: `ElectrodeLayoutDTO`, `ServerState.electrode_layout()`, `propagation_frame` view type with `frame_time` field.
- `WorkspaceMain` wired: hover → `setHoveredElectrode`, propagation panel + animation controller, spatial event view at bottom.
- Test baseline: 40 backend + 39 frontend tests, all green.

## Open questions (M4 scope)

- Worker isolation: should transform workers share a single `SharedArrayBuffer` pool or use per-transform `MessageChannel` pairs?
- Transform cache invalidation: `OptionalUpdate<T>` partial DTO semantics vs. full-param cache key hashing — pick one before caching is implemented.
- Multi-tensor workspace: view-to-tensor binding when multiple tensors are active (deferred from M2, still open).

## Update instructions for future agents

Update this file after major architectural work, not after every small patch.

Always refresh these sections when the answer materially changes:

- current TensorScope status
- important files/modules
- recent architectural direction
- open questions

Rules:

- document current reality first
- distinguish implemented from planned
- add concrete file references when new architecture anchors appear
- keep this file concise enough to paste into a future coding session
- if a task changes milestone status, update the `Current milestone` section explicitly

If you change the stable assumptions, also update:

- [docs/architecture/tensorscope.md](/storage2/arash/projects/tensorscope/docs/architecture/tensorscope.md)
- [docs/prompts/tensorscope/00_context.md](/storage2/arash/projects/tensorscope/docs/prompts/tensorscope/00_context.md)
