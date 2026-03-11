# TensorScope Architecture

Role: current system design and engineering guardrails.

Use this file for:

- what exists now
- the near-term target architecture
- boundaries that should remain stable while the repo evolves
- unresolved design questions that affect implementation choices

Related docs:

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

Selection is the cross-view coordination contract. It should eventually represent:

- navigation state: time cursor, time range/window, channel selection, AP/ML selection, frequency selection, selected event
- not view-local UI toggles
- not processing configuration

Current backend selection is a single validated object with `time`, `freq`, `ap`, `ml`, and optional `channel`. The frontend does not yet have a dedicated shared navigation store; [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts) still mixes app-shell state and navigation state.

### View

A view renders a projection or summary of a tensor for a specific task. Views should coordinate through shared state and tensor metadata, not by calling each other directly.

### Registries

Near-term planned abstractions:

- `TensorRegistry`: what tensors exist and what schema they follow
- `ViewRegistry`: what views can render which tensor schemas

The repo already has backend view mapping logic in [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py) and a frontend component registry in [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts), but these are still thin lookups rather than the full target abstraction.

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

- top bar / session identity
- navigation controls
- main linked views
- detail panel slot

Current anchor files:

- [frontend/src/App.tsx](/storage2/arash/projects/tensorscope/frontend/src/App.tsx)
- [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx)

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

## Near-term target architecture

The near-term goal is not a new product architecture from scratch. It is a cleanup pass that makes the current prototype safer to extend.

Expected near-term changes:

- introduce a dedicated shared frontend navigation store
- keep view-local tool state outside that shared store
- keep processing settings separate from navigation state
- formalize lightweight tensor and view registry contracts
- preserve the current workspace-shell layout while clarifying panel responsibilities

Planned, not yet implemented:

- canonical frontend `SelectionState` module
- first-class `TensorRegistry` abstraction shared across frontend/backend concerns
- first-class `ViewRegistry` abstraction richer than the current lookup tables
- event-centric navigation model beyond the current event window and overlay behavior

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

Current implementation already approximates this via `sidebar`, `main`, and `details` slots in [frontend/src/components/layout/LayoutShell.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/layout/LayoutShell.tsx). The details slot currently behaves more like a general side panel than a mature inspector.

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

## Guardrails

- Do not let views coordinate by directly mutating each other.
- Do not push hot pointer-move rendering through React state if an imperative chart API can handle it.
- Do not collapse navigation state, processing state, and view-local state into one untyped store.
- Do not make TensorScope depend on one concrete renderer abstraction too early.
- Do not describe planned architecture as already implemented.
- Prefer stable tensor dims and coords over view-specific ad hoc assumptions.
- Prefer linking to [docs/hand-off-2026-03-11.md](/storage2/arash/projects/tensorscope/docs/hand-off-2026-03-11.md) and [docs/frontend-phase3.md](/storage2/arash/projects/tensorscope/docs/frontend-phase3.md) for implementation history instead of copying that history into every new doc.

## Current milestone

As of March 11, 2026, the repo is between an early frontend prototype and the intended M1 linked multiscale explorer.

Already present:

- backend tensor/session API
- frontend workspace shell
- linked timeseries and spatial selection
- navigator overview
- initial view registry mapping
- `uPlot` use for timeseries and navigator

Not yet complete:

- dedicated shared frontend `SelectionState` store with a clean navigation contract
- mature tensor and view registries
- formal workspace-shell separation between navigation, inspector, and per-view tools
- event track and richer linked event semantics
- architecture docs that future agents can use as a stable contract

## Open design questions

- What should the canonical frontend `SelectionState` include beyond the current backend fields: visible window, selected event, frequency band, or all of them?
- Should the visible time window live inside shared navigation state or beside it?
- How much of the future registry model should be authored by the server versus the frontend?
- What is the cleanest way to represent event-centric navigation without coupling the event table, overlays, and timeseries view?

## Current known gaps

- The frontend store is still an app-shell store, not yet the canonical navigation architecture.
- The backend and frontend each encode parts of the view capability model.
- The current timeseries implementation works, but lifecycle and tool concerns are still tightly coupled inside one component.
- Existing notes such as [docs/frontend-phase3.md](/storage2/arash/projects/tensorscope/docs/frontend-phase3.md) contain stale statements about placeholder rendering, so newer docs should prefer the hand-off note and direct code inspection.

When this document changes materially, also update [../prompts/context_snapshot.md](../prompts/context_snapshot.md) and the scoped prompts under [../prompts/tensorscope/](../prompts/tensorscope/).
