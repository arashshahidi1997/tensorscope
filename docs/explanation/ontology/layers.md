# TensorScope Layered Architecture

This document describes the six conceptual layers of TensorScope.
Each layer depends only on layers below it. The model is derived from the
import structure and call graphs of the actual repository.

See [architecture.md](architecture.md) for the Mermaid entity diagram.
See [entities.md](entities.md) for individual entity definitions.

---

## Layer Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI SHELL LAYER                                                      │
│                                                                      │
│   Layout (LayoutManager / useLayoutStore)                            │
│   ViewGrid  ·  ViewPanel  ·  SidebarTabBar  ·  ResizeHandle         │
│   WorkspaceObject chip strip                                         │
│                                                                      │
│   Arranges and sizes every panel. Persists geometry across reloads.  │
│   Does not know about tensor contents or scientific meaning.         │
├─────────────────────────────────────────────────────────────────────┤
│  VISUALIZATION LAYER                                                 │
│                                                                      │
│   View components (TimeseriesSliceView, SpatialMapSliceView,         │
│     SpectrogramView, PSDHeatmapView, PSDCurveView, PSDSpatialView,   │
│     NavigatorView, PropagationView, HypnogramView, EventTableView)   │
│   WorkspaceMain  ·  viewRegistry  ·  VIEW_DESCRIPTORS               │
│                                                                      │
│   Decodes Arrow IPC and renders scientific data into the DOM.        │
│   Each view emits selection callbacks; none owns state directly.     │
├─────────────────────────────────────────────────────────────────────┤
│  DATA TRANSPORT LAYER                               (HTTP boundary)  │
│                                                                      │
│   useSliceQuery  ·  TanStack Query cache                             │
│   TensorSliceRequestDTO  ·  Arrow IPC (base64)  ·  TensorSliceDTO   │
│   api/arrow.ts (decodeArrowSlice, extractPSDHeatmap, …)             │
│                                                                      │
│   Manages request deduplication, stale-while-revalidate, and        │
│   keep-previous-data across all active views. One query per view.    │
├─────────────────────────────────────────────────────────────────────┤
│  STATE LAYER                                                         │
│                                                                      │
│   Selection  (useSelectionStore  ↔  SelectionState / SelectionDTO)  │
│   App shell  (useAppStore — selectedTensor, activeViews, theme)      │
│   DAG focus  (useDAGStore — focusedNodeId)                          │
│   Activity   (useActivityStore — in-flight operation log)            │
│   Session    (SessionManager / ServerState — per-tab server state)   │
│                                                                      │
│   The single source of truth for what the user is looking at.       │
│   All views read from here; mutations propagate up to the server     │
│   and back down via query invalidation.                              │
├─────────────────────────────────────────────────────────────────────┤
│  ANALYSIS LAYER                                   (backend only)     │
│                                                                      │
│   Tensor / TensorRegistry / TensorSchema / Data Modality            │
│   Transform (TransformDefinition · TransformRegistry ·               │
│              TransformExecutor · TransformCache · DerivedTensor)     │
│   Processing Pipeline (apply_processing · _processed_cache)         │
│   Workspace DAG (WorkspaceDAG · DAGTensorNode · DAGTransformNode)    │
│   Event Detector (EventDetector · ThresholdDetector)                │
│   Event Stream (EventStream · EventRegistry)                        │
│   Brainstate (brainstate_intervals · brainstate_meta)               │
│                                                                      │
│   Pure computation: no HTTP, no rendering. Transforms consume        │
│   tensors and produce derived tensors. Detectors consume tensors     │
│   and produce event streams. Results are always reproducible         │
│   from provenance alone (TransformProvenance / TransformCache).      │
├─────────────────────────────────────────────────────────────────────┤
│  EXPORT LAYER                                     (backend only)     │
│                                                                      │
│   Pipeline Export (PipelineSpec · extract_pipeline)                  │
│   Workflow Cooker (WorkflowCooker · SnakemakeCooker · WorkflowArtifact) │
│   Workspace DAG  →  PipelineSpec  →  Snakefile / YAML               │
│                                                                      │
│   Reads the DAG, selects the minimal upstream subgraph, serialises  │
│   it to a reproducible pipeline document, and emits runnable         │
│   workflow scripts. Has no effect on server state.                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer Descriptions

### UI Shell Layer

Owns the visual skeleton: which panels exist, how wide they are, which
sidebar tab is active, and whether a panel is maximised. Implemented in
[frontend/src/store/layoutStore.ts](../../../frontend/src/store/layoutStore.ts),
[frontend/src/components/views/ViewGrid.tsx](../../../frontend/src/components/views/ViewGrid.tsx),
and
[frontend/src/components/views/ViewPanel.tsx](../../../frontend/src/components/views/ViewPanel.tsx).
Layout geometry is persisted across page reloads via Zustand `persist`
middleware. This layer knows only view *ids* (strings), not view content.

### Visualization Layer

Owns the scientific rendering. Each view component receives a decoded slice
(from the transport layer) and selection callbacks (from the state layer).
No view component stores state; all interaction callbacks propagate up to
the state layer. The `WorkspaceMain` orchestrator maps view ids to React
elements and connects queries to component props. Implemented across
`frontend/src/components/views/` and
[frontend/src/registry/viewRegistry.ts](../../../frontend/src/registry/viewRegistry.ts).

### Data Transport Layer

Bridges the HTTP boundary. `useSliceQuery` (TanStack Query) caches each
view's slice request by query key `["slice", tensorName, request]`. A
change to any part of the request (e.g. a selection update) produces a new
key and triggers a fresh fetch, while the previous data is retained as
placeholder. Arrow IPC decoding occurs here before passing structured data
to view components. Implemented in
[frontend/src/api/queries.ts](../../../frontend/src/api/queries.ts) and
[frontend/src/api/arrow.ts](../../../frontend/src/api/arrow.ts).

### State Layer

The single source of truth for what the user is looking at. Frontend Zustand
stores (`useSelectionStore`, `useAppStore`, `useLayoutStore`, `useDAGStore`,
`useActivityStore`) hold local state. On the server, `ServerState` (managed
by `SessionManager`) is the authoritative per-session object. Selection
mutations go to the server via `PUT /api/v1/selection`; processing mutations
go to `PUT /api/v1/processing` and invalidate all slice queries. The
`StateDTO` returned by `GET /api/v1/state` bootstraps the frontend stores on
load.

### Analysis Layer

Entirely backend-side (`src/tensorscope/core/`). No HTTP, no rendering, no
FastAPI imports. Implements the scientific computations: tensor validation
and normalisation, transform execution and caching, event detection, and
brainstate interval extraction. This layer is importable standalone as
`tensorscope.core` independently of the server.

### Export Layer

Also backend-side. Reads the `WorkspaceDAG`, extracts the minimal subgraph
needed to reproduce selected output tensors, and emits serialisable
`PipelineSpec` documents and runnable workflow scripts (Snakemake). Has no
side effects on `ServerState`. Implemented in
`src/tensorscope/core/pipeline/`.

---

## Dependency Rules

| Layer | May import from |
|---|---|
| UI Shell | Visualization, State |
| Visualization | Data Transport, State |
| Data Transport | State (for query keys) |
| State | — (stores are leaves; no upward deps) |
| Analysis | — (pure Python; no server or UI imports) |
| Export | Analysis (reads DAG and tensor provenance) |

The Analysis and Export layers have no dependency on the server routers or
the frontend. They are importable as a standalone library (`tensorscope.core`)
independent of FastAPI.
