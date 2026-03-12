# TensorScope Architecture

Role: current system design and engineering guardrails.

Use this file for:

- what exists now
- the near-term target architecture
- boundaries that should remain stable while the repo evolves
- unresolved design questions that affect implementation choices

Related docs:

- [ADR index](../adr/index.md)
- [Architecture invariants](./invariants.md)
- [Transform DAG](./transform-dag.md)
- [Pipeline export](./pipeline-export.md)
- [UI layout concepts (exploratory)](../design/ui-layout-concepts.md)
- [Prompt usage guide](../prompts/README.md)
- [Context snapshot](../prompts/context_snapshot.md)
- [Stable prompt context](../prompts/tensorscope/00_context.md)
- [Human roadmap](../prompts/roadmap.md)

## System purpose

TensorScope is a tensor-centric scientific visualization workspace for neurophysiology data. It is not a generic plotting app. The product goal is linked exploration over shared tensor coordinates such as time, channel, frequency, AP, ML, and event identity.

## Core concepts

### Tensor

A tensor is a named, typed `xarray.DataArray` with stable dims, coords, and metadata. The current backend already uses `TensorNode` and `TensorRegistry` in [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py).

### Shared selection state

Selection is the cross-view coordination contract. It represents:

- navigation state: time cursor, time range/window, channel selection, AP/ML selection, frequency selection, selected event identity
- not view-local UI toggles
- not processing configuration

The frontend now has a dedicated navigation store in [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts) with a canonical `SelectionState` type: `{ timeCursor, timeWindow, spatial, freq, event }`. The app-shell store [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts) owns only shell-level state: `selectedTensor`, `activeViews`, `layoutDraft`.

`toSelectionDTO(s: SelectionState): SelectionDTO` converts store state to the server wire format. `initFromDTO` bootstraps the store from the first API response.

### View

A view renders a projection or summary of a tensor for a specific task. Views should coordinate through shared state and tensor metadata, not by calling each other directly.

### Registries

- `TensorRegistry` (backend): `TensorScopeState.tensors` in [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py) — named tensor nodes, list/add/get operations.
- `TransformRegistry` (planned M4): explicit transform definitions for derived-tensor creation. See [Transform DAG](./transform-dag.md).
- `ViewRegistry` (backend): `_VIEW_REGISTRY` in [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py) — maps dim tuples to available view types. `available_views(data)` and `tensor_meta()` expose this to the frontend via `TensorMetaDTO.available_views`.
- `ViewRegistry` (frontend): [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts) — now contains both `VIEW_DESCRIPTORS: ViewDescriptor[]` (schema-compatibility declarations, mirrors backend) and `viewRegistry` (component lookup). `getAvailableViews(schema)` filters by `requiredDims`.
- `ViewDescriptor` type in [frontend/src/types/view.ts](/storage2/arash/projects/tensorscope/frontend/src/types/view.ts): `{ id, label, requiredDims, canRender? }`.

## Later-stage architecture direction

From M4 onward, TensorScope should keep these layers distinct:

- M4: explicit transforms and derived tensors
- M5: visible workspace DAG for lineage and inspection
- M6: curated pipeline export and workflow cooking
- M7: dynamic workspace layout (resizable shell, tabbed sidebar, view grid, persistence)

See [Transform DAG](./transform-dag.md), [Pipeline export](./pipeline-export.md), and the [prompt roadmap](../prompts/roadmap.md) for the milestone split.

## Current architecture

The repository currently contains:

- a Python core state model and server API under `src/tensorscope/`
- a React/TypeScript frontend prototype under `frontend/`
- early linked-view behavior with timeseries, navigator, spatial map, PSD, spectrogram, and event table panels

### Architectural layers

### 1. Domain layer

- tensor schema normalization
- tensor metadata and lineage
- selection model
- event model
- layout descriptors

Current anchor files:

- [src/tensorscope/core/schema.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/schema.py)
- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/core/events/registry.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/events/registry.py)
- [src/tensorscope/core/layout.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/layout.py)

### 2. Server/API layer

- session-backed mutable state
- tensor metadata endpoints
- tensor slice endpoints
- selection and layout endpoints
- processing endpoints

Current anchor files:

- [src/tensorscope/server/app.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/app.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/routers/selection.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/selection.py)
- [src/tensorscope/server/routers/tensors.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/tensors.py)

### 3. Workspace shell layer

- top bar / session identity (`LayoutShell`)
- left nav/control rail (`NavRail`) — shared navigation controls and processing settings
- central linked workspace (`WorkspaceMain`) — all 5 view queries + tensor/overview
- right inspector rail (`InspectorPanel`) — tensor summary, selection summary, event table

Current anchor files:

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx) — bootstrap + selection mutation + event inspector assembly
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx) — `nav`, `inspector`, `children` slots
- [frontend/src/components/layout/NavRail.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/NavRail.tsx)
- [frontend/src/components/layout/InspectorPanel.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/InspectorPanel.tsx)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)

### 4. View/rendering layer

- timeseries
- navigator / overview
- spatial map
- spectrogram
- PSD
- event table / overlays

Current anchor files:

- [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/components/views/SpatialMapSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/SpatialMapSliceView.tsx)
- [frontend/src/components/views/SpectrogramView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/SpectrogramView.tsx) — Canvas 2D, inferno colormap, time-cursor overlay; wired in `WorkspaceMain`
- [frontend/src/components/views/PSDSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/PSDSliceView.tsx)

## M1 implementation (complete as of 2026-03-11)

The M1 milestone introduced the following architecture changes over the initial prototype:

**Implemented:**

- canonical `SelectionState` in [frontend/src/types/selection.ts](/storage2/arash/projects/tensorscope/frontend/src/types/selection.ts): `{ timeCursor, timeWindow, spatial, freq, event }`
- `useSelectionStore` (Zustand) as dedicated navigation store, replacing the mixed `appStore`
- `toSelectionDTO` / `initFromDTO` bridge between store and wire format
- `useChartTools(chartRef)` hook + `ChartToolbar` for view-local tool state
- `attachGestures` / `attachNavigatorGestures` as module-level functions outside React
- `useOverviewDetail()` hook — overview↔detail navigation contract
- `useEventNavigation()` hook — event identity in the store, separate from time cursor
- `NavRail` / `WorkspaceMain` / `InspectorPanel` components extracted from App.tsx
- `VIEW_DESCRIPTORS` + `getAvailableViews(schema)` in [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)
- 39 frontend unit tests (Vitest + jsdom) covering stores and hooks
- `InspectorPanel` with tensor summary, selection summary, event table

**Planned (M2 and beyond):**

- multi-tensor session orchestration with ViewRegistry-driven layout
- GPU-accelerated spectrogram rendering
- richer event-centric exploration (event segments, epoch views)

## State model

Keep these categories distinct.

### Navigation state

Shared, cross-view, serializable state:

- active tensor
- time cursor
- visible time range
- selected channel or channels
- selected AP/ML location
- selected frequency or band
- selected event or interval

This is the state views use to coordinate.

### View-local state

Private UI state owned by one view:

- active tool mode
- hover state
- temporary drag rectangle
- panel-local display toggles

This should not become the coordination layer for other views.

### Processing state

Explicit transform or preprocessing parameters:

- rereference mode
- filter settings
- aggregation/downsampling settings

Current processing params already exist server-side and are exposed separately from selection. Preserve that split.

## UI shell model

The target shell is a workspace, not a pile of independent panels.

Recommended structure:

- shell frame
- left navigation/control rail
- central linked workspace
- right inspector/details rail

Implemented in M1 via `nav`, `children`, and `inspector` slots in [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx). The inspector slot is now `InspectorPanel` showing tensor metadata, selection summary, and event table.

Guardrail: move view-specific controls out of the global sidebar when they start multiplying. Keep the shell centered on navigation, layout, and shared inspection.

## Rendering model

TensorScope is CPU-first by default.

- use `uPlot` for dense timeseries and overview timelines
- keep hot rendering paths outside React rerender loops
- treat React as orchestration and layout, not the per-frame renderer
- use direct imperative chart APIs for scale, cursor, and selection updates where needed
- consider GPU acceleration later only where CPU rendering or data transforms become the bottleneck

Current state:

- the navigator already uses `uPlot`
- the timeseries slice view already uses `uPlot`
- event markers are drawn through `uPlot` hooks
- the spatial map remains a separate CPU-rendered view rather than part of a unified renderer stack

This matches the intended direction, but the view lifecycle and tool architecture still need cleanup before it is stable enough for broader extension.

## Data flow

Nominal flow:

1. Tensor metadata and session state come from the server.
2. Shared navigation state determines slice requests.
3. Slice requests return tensor subsets or summaries.
4. Views render slices for the active shared selection.
5. User interaction updates shared state.
6. Other views react by fetching or re-rendering against the updated state.

Guardrail: a view should publish selection intent into shared state, not call another view directly.

### DataSource contract (M2, Prompt 12)

The step "shared navigation state → slice request → server response" is formalized
as a `DataSource` interface in [frontend/src/api/dataSource.ts](../../frontend/src/api/dataSource.ts).

```
SelectionState (store)
  → toSelectionDTO()
  → DataSource.slice(viewType, selection, options?)
      → makeDefaultSliceRequest()     [queries.ts]   ← per-view pixel-budget defaults
      → useSliceQuery(name, request)  [queries.ts]   ← React Query cache + dedup
      → api.getTensorSlice()          [client.ts]    ← HTTP POST
      → apply_slice_request()         [server/state.py] ← window + downsample + project
      → TensorSliceDTO (Arrow IPC)
```

Key types in `dataSource.ts`:

- `DataSource` — the interface views code against: `{ name, slice(viewType, selection, options?) }`
- `SliceOptions` — bounded access parameters: `{ timeRange, freqRange, maxPoints, downsample }`
- `createTensorDataSource(name, fetchFn)` — factory for the HTTP-backed implementation

`SliceOptions.maxPoints` is the pixel budget for the time axis, analogous to the `width`
argument in the old cogpy/datashader `rasterize(element, aggregator, width=N)` call —
it controls output resolution, not the data window. Prompt 13 (LOD pipeline) will wire
`maxPoints` to actual viewport pixel width. Prompt 14 (worker) will move Arrow decode
off the UI thread behind the same interface.

## Guardrails

The cross-milestone rules are collected in [invariants.md](./invariants.md). The list below is the short operational summary inside this architecture overview.

- Do not let views coordinate by directly mutating each other.
- Do not push hot pointer-move rendering through React state if an imperative chart API can handle it.
- Do not collapse navigation state, processing state, and view-local state into one untyped store.
- Do not make TensorScope depend on one concrete renderer abstraction too early.
- Do not describe planned architecture as already implemented.
- Prefer stable tensor dims and coords over view-specific ad hoc assumptions.
- Prefer linking to [docs/hand-off-2026-03-11.md](/storage2/arash/projects/tensorscope/docs/hand-off-2026-03-11.md) and [docs/frontend-phase3.md](/storage2/arash/projects/tensorscope/docs/frontend-phase3.md) for implementation history instead of copying that history into every new doc.

## Current milestone

M1 is complete. M2 is in progress as of 2026-03-11.

Implemented in M1:

- dedicated shared frontend `SelectionState` store (`useSelectionStore`)
- navigation state separated from shell state and view-local state
- `VIEW_DESCRIPTORS` + `getAvailableViews(schema)` frontend view registry
- workspace-shell with `NavRail`, `WorkspaceMain`, `InspectorPanel`
- timeseries zoom feedback loop closes via `setScale` hook → `setTimeWindow`
- event-centric navigation: event identity in store, decoupled from time cursor
- 39 unit tests across stores and hooks

Implemented in M2 so far (Prompt 12):

- `DataSource` interface + `SliceOptions` + `createTensorDataSource` factory
  in [frontend/src/api/dataSource.ts](../../frontend/src/api/dataSource.ts)

Next in M2: LOD pipeline (Prompt 13), worker-backed Arrow decode (Prompt 14),
spectrogram improvements (Prompt 15), channel grid (Prompt 16), linked crosshair
(Prompt 17), event browser (Prompt 18), peri-event views (Prompt 19).

## Open design questions (M2 scope)

- Should `getAvailableViews` on the frontend replace the server `available_views` call, or do both serve different purposes?
- Multi-tensor workspace: how do views bind to specific tensors when more than one is active?
- Event segments: should epoch/segment selection enter `SelectionState` or stay outside shared nav?

## Current known gaps

- The `InspectorPanel` selection summary shows only live store values; coord ranges (e.g., freq bounds) are not yet shown.
- `getAvailableViews` is implemented but not yet wired to the tensor chooser UI in `WorkspaceMain`.
- Existing notes such as [docs/frontend-phase3.md](/storage2/arash/projects/tensorscope/docs/frontend-phase3.md) contain stale statements about placeholder rendering; prefer direct code inspection for current view state.

When this document changes materially, also update [../prompts/context_snapshot.md](../prompts/context_snapshot.md) and the scoped prompts under [../prompts/tensorscope/](../prompts/tensorscope/).
