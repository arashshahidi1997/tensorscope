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

M1–M8 complete as of 2026-03-12.

Implemented:

### Core / server

- Tensor registry and validated selection model in the Python core
- Session-backed API state and tensor slice endpoints
- `ElectrodeLayoutDTO` + `ServerState.electrode_layout()` for spatial tensors
- `propagation_frame` view type: returns a single `(AP, ML)` frame at `frame_time`
- `psd_live` view type: on-the-fly multitaper PSD via `cogpy.core.spectral.psd.psd_multitaper`; returns `(freq, AP, ML)` or `(freq, channel)` from raw `(time, ...)` tensors
- Processing pipeline with server-side cache: full-tensor processing runs once, slices read from cache
- `ProcessingParamsDTO` has `enabled: bool` toggle to disable the pipeline
- Brainstate support: `GET /api/v1/brainstates` (meta) + `GET /api/v1/brainstates/intervals?t0=&t1=` (merged intervals)
- 9 FastAPI routers (state, tensors, selection, layout, events, processing, transforms, dag, brainstates)
- 126 backend tests passing

### Frontend foundation (M1)

- `useSelectionStore` — navigation store: `{ timeCursor, timeWindow, spatial, freq, event }`
- `useAppStore` — shell: `selectedTensor`, `activeViews`, `layoutDraft`, `theme`, `brainstateOverlay`, `showHypnogram`
- `useLayoutStore` — persistent layout state (sidebar/inspector/bottom panel widths, collapsed state) with Zustand `persist` middleware
- `toSelectionDTO` / `initFromDTO` — store ↔ wire-format bridge
- `useChartTools(chartRef)` + `ChartToolbar` — view-local tool state
- `useOverviewDetail()` / `useEventNavigation()` — navigation contracts
- 39 frontend unit tests: selectionStore (31) + useChartTools (8)

### Dynamic workspace layout (M7)

- `LayoutShell` with `ResizeHandle` (pointer-capture drag) for sidebar, inspector, bottom panel
- `SidebarTabBar` — 36px vertical icon strip with 5 tabs (Explore, Graph, Tensors, Events, Pipeline)
- `SidebarContent` — tab routing with display toggling for state preservation
- `ExploreTabContent` — Processing (expanded) + Selection (collapsed) in `CollapsibleSection` wrappers
- `DAGGraphView` — SVG-based DAG visualization in Graph tab; layered layout, click-to-select tensor
- `TensorBrowserTab` — tensor list with name/dims/shape/badge, expanded detail on active
- `EventsTabContent` — event table migrated from InspectorPanel
- `LayoutPresetPicker` — topbar dropdown with 4 presets (Signal Inspection, Spatial Exploration, Spectral Analysis, Overview)
- `useLayoutShortcuts` — Ctrl+B/Ctrl+Shift+B/Ctrl+J/Escape keyboard handlers
- Layout persistence via localStorage (Zustand persist)

### Stable slot-based view grid (M8)

- `DEFAULT_SLOT_LAYOUT` — fixed 3-row layout: signal (timeseries + spatial_map), PSD (heatmap + curve + spatial), spectrogram (spectrogram + propagation_frame)
- `ViewPanel` — 24px header chrome with label, maximize (⤢/⊡), close (×)
- `ViewGrid` — row-based flex layout; views toggle visibility in-place without reflowing neighbors

### Scientific views (M2 + M8)

- `timeseries` → uPlot multichannel, event markers via canvas hook, brainstate overlay bands, persistent time cursor, relative time labels, Y-zoom + amplitude gain modes
- `spatial_map` → Canvas heatmap (ChannelGridRenderer) with click-to-select, hover, aspect-ratio constraint
- `psd_average` → uPlot freq curve (mean over spatial)
- `psd_heatmap` → Canvas 2D (channels × freq), inferno colormap, log10 scaling
- `psd_curve` → Canvas 2D rotated (Y=freq, X=power), mean±std band
- `psd_spatial` → ChannelGridRenderer for AP×ML power at selected freq
- `spectrogram` → Canvas 2D heatmap, inferno-like colormap
- `navigator` → thin uPlot overview with drag-to-zoom, brainstate overlay bands
- `hypnogram` → Canvas 2D step chart for brainstate visualization
- `EventTableView` with prev/next navigation
- `TimeScaleBar` — horizontal preset pills (10ms–10s) below timeseries chart

### Spatial dynamics (M3)

- `ElectrodeLayout` / `ElectrodeCoord` / `buildElectrodeLayout` in types
- `SpatialRendererBackend` interface → `ChannelGridRenderer` (Canvas CPU impl)
- `PropagationView` — spatial heatmap with time overlay
- `AnimationController` — rAF loop driving `timeCursor`
- `SpatialEventView` — peri-event spatial heatmap

### Transforms / DAG (M4–M6)

- `TransformRegistry` + DAG executor in `core/`
- `useDagStore` — frontend DAG state
- Transform pipeline: CMR, bandpass, notch, z-score
- Server-side processing cache for full-tensor results

## Current milestone

**M8 complete. Ready for M9.**

Potential M9 goals: WebGL spatial renderer, multi-tensor workspace, cross-tensor views, export/annotation features.

## Inspect these files first

### Core and server

- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py) — `apply_slice_request`, `_VIEW_REGISTRY`, processing cache, brainstate helpers
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py) — DTOs including `psd_params`, `ProcessingParamsDTO.enabled`
- [src/tensorscope/server/routers/brainstates.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/brainstates.py)

### Frontend architecture anchors

- [frontend/src/types/index.ts](/storage2/arash/projects/tensorscope/frontend/src/types/index.ts) — canonical domain types barrel
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts) — navigation state (1s default window on first load)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts) — shell store + brainstate toggles
- [frontend/src/store/layoutStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/layoutStore.ts) — persistent layout state (Zustand persist)
- [frontend/src/api/queries.ts](/storage2/arash/projects/tensorscope/frontend/src/api/queries.ts) — useSliceQuery, makeDefaultSliceRequest, clampWindow
- [frontend/src/api/arrow.ts](/storage2/arash/projects/tensorscope/frontend/src/api/arrow.ts) — Arrow IPC decode + all extractors (including PSD heatmap/average/spatial)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts) — VIEW_DESCRIPTORS + getAvailableViews
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx) — view orchestration, PSD live expansion, brainstate wiring
- [frontend/src/components/views/ViewGrid.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewGrid.tsx) — slot-based row layout
- [frontend/src/components/views/viewGridLayout.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/viewGridLayout.ts) — DEFAULT_SLOT_LAYOUT constant
- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx) — Y-zoom/gain, relative time, persistent cursor
- [frontend/src/components/layout/SidebarTabBar.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/SidebarTabBar.tsx) — 5-tab navigation
- [frontend/src/components/layout/DAGGraphView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/DAGGraphView.tsx) — SVG DAG visualization
- [frontend/src/components/layout/TensorBrowserTab.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/TensorBrowserTab.tsx) — tensor list + detail

## Recent major changes (M7–M8, 2026-03-12)

- Resizable shell with pointer-capture `ResizeHandle` for sidebar, inspector, bottom panel
- Tabbed sidebar: 5 tabs replacing single NavRail (Explore, Graph, Tensors, Events, Pipeline)
- Slot-based view grid: fixed rows with named slots; views toggle in-place without reflowing
- `ViewPanel` chrome (24px header, maximize/close) wrapping every view
- Layout presets (4 built-in) + persistence via `useLayoutStore` + localStorage
- Keyboard shortcuts: Ctrl+B (sidebar), Ctrl+Shift+B (inspector), Ctrl+J (bottom), Escape (reset)
- `psd_live` server endpoint using `cogpy.core.spectral.psd.psd_multitaper`
- Three PSD sub-views (heatmap, curve, spatial) from single server round-trip
- `expandPSDLive()` bridges server's `psd_live` to frontend's 3 sub-view IDs
- Timeseries overhaul: Y-zoom lock, amplitude gain mode, relative time labels, persistent cursor, TimeScaleBar
- ResizeObserver skip for degenerate sizes (fixes blank-after-layout-change)
- Server-side processing cache: pipeline runs once on full recording, slices from cache
- `ProcessingParamsDTO.enabled` toggle to disable processing
- Sidebar cleanup: LayoutPanel removed, Processing (top, expanded) + Selection (bottom, collapsed)
- `CollapsibleSection` reusable component
- DAG Graph tab: SVG layered layout, click-to-select tensor
- Tensor Browser tab: tensor list with dims/shape, expanded detail on active
- Brainstate overlay on timeseries/navigator (toggleable color bands)
- Hypnogram view: Canvas 2D step chart
- Brainstate API: `/api/v1/brainstates` + `/api/v1/brainstates/intervals`
- Spatial map aspect-ratio constraint (`CSS aspect-ratio: nML/nAP`)
- Test baseline: 126 backend + 39 frontend tests, all green

## Open questions (M9 scope)

- WebGL spatial renderer: when to upgrade from Canvas CPU (`ChannelGridRenderer`) to WebGL for large electrode arrays?
- Multi-tensor workspace: view-to-tensor binding when multiple tensors are active (deferred since M2)
- Export/annotation: snapshotting views, annotating events, exporting selections
- Cross-tensor views: e.g., comparing PSD across two recordings

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
