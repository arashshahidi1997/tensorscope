# TensorScope Core Entities

Definitions derived from direct inspection of `src/tensorscope/` (Python
backend) and `frontend/src/` (TypeScript frontend). Supporting detail is
drawn from the analysis artifacts in
[docs/dev/ontology-analysis/](../../dev/ontology-analysis/).
Every entity is grounded in call sites, import graphs, and API wire formats.

See [relationships.md](relationships.md) for the relationship model,
[architecture.md](architecture.md) for the visual diagram, and
[terminology.md](terminology.md) for naming inconsistencies.

---

## 1. Tensor

**Definition**
A named, multidimensional scientific array (an `xarray.DataArray`) that is the
fundamental data unit of TensorScope. A tensor has labeled dimensions such as
`time`, `AP`, `ML`, `channel`, and optionally `freq`. Source tensors are
loaded at startup; derived tensors are produced by transforms.

**Evidence**
- [src/tensorscope/core/state.py](../../../src/tensorscope/core/state.py) — `TensorNode`, `TensorRegistry`, `TensorScopeState`
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `ServerState`, `create_server_state`, `tensor_summary`, `tensor_meta`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `TensorSummaryDTO`, `TensorMetaDTO`, `CoordSummaryDTO`, `ElectrodeLayoutDTO`
- [src/tensorscope/server/routers/tensors.py](../../../src/tensorscope/server/routers/tensors.py) — `GET /api/v1/tensors`, `GET /api/v1/tensors/{name}`
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — `selectedTensor`, `workspaceObjects`, `panelTensorOverrides`
- [frontend/src/components/views/WorkspaceMain.tsx](../../../frontend/src/components/views/WorkspaceMain.tsx) — orchestrates tensor selection and view wiring

**Responsibilities**
- Holds raw or derived data with named axes and coordinate metadata
- Provides dimension names that determine which views are available
- Carries spatial coordinates (`AP`, `ML`) when the array is grid-shaped
- Acts as the data source for every slice request and view render

**Relationships**
- A *Tensor* is stored in a `TensorRegistry` (inside `TensorScopeState` and `ServerState`)
- A *Tensor* is the input and output of a *Transform* execution
- A *Derived Tensor* is a *Tensor* with attached *Transform Provenance*
- A *View* is chosen based on a *Tensor*'s dimension set (`_VIEW_REGISTRY` / `getAvailableViews`)
- A *Selection* coordinates which slice of a *Tensor* is currently visible
- The *Processing Pipeline* optionally transforms a *Tensor* before slicing

---

## 2. Tensor Schema

**Definition**
A set of conventions for labeling and validating a tensor's dimensions.
Two canonical forms exist: **grid tensors** `(time, AP, ML)` and
**flat tensors** `(time, channel)`. The schema layer normalises input arrays
to one of these forms and raises `SchemaError` when neither fits.

**Evidence**
- [src/tensorscope/core/schema.py](../../../src/tensorscope/core/schema.py) — `validate_and_normalize_grid`, `flatten_grid_to_channels`, `SchemaError`
- [src/tensorscope/core/data/modalities.py](../../../src/tensorscope/core/data/modalities.py) — `GridLFPModality`, `FlatLFPModality`, `SpectrogramModality`, `SpikeTrainsModality`
- [frontend/src/registry/viewRegistry.ts](../../../frontend/src/registry/viewRegistry.ts) — `getAvailableViews` branches on dimension names

**Responsibilities**
- Validates and normalises raw `xarray.DataArray` input at load time
- Provides helpers to convert between grid and flat layouts
- Implicitly governs which views and transforms apply to a tensor

**Relationships**
- Consumed by *Data Modality* classes to interpret dimension structure
- Determines *View* availability on both backend (`_VIEW_REGISTRY`) and frontend (`VIEW_DESCRIPTORS`)
- Used by *Transform* input validation (`InputSpec`)

---

## 3. Data Modality

**Definition**
An abstract interface (`DataModality`) for a time-bounded data type that
knows its sampling rate and can return windowed data. Concrete subclasses
cover LFP (grid and flat layouts), precomputed spectrograms, and spike trains.

> **Backend-only.** The frontend has no direct counterpart; it infers modality
> from dimension names exposed in tensor metadata.

**Evidence**
- [src/tensorscope/core/data/modality.py](../../../src/tensorscope/core/data/modality.py) — `DataModality` abstract base
- [src/tensorscope/core/data/modalities.py](../../../src/tensorscope/core/data/modalities.py) — `GridLFPModality`, `FlatLFPModality`, `SpectrogramModality`, `SpikeUnit`, `SpikeTrainsModality`
- [src/tensorscope/core/data/alignment.py](../../../src/tensorscope/core/data/alignment.py) — `align_to_common_timebase`, `find_nearest_time_index`

**Responsibilities**
- Abstracts over physical data shapes so server code can query windows uniformly
- Exposes `time_bounds()` and `get_window(t_start, t_end)` regardless of tensor layout
- `GridLFPModality.to_flat()` converts to the flat form required by some transforms

**Relationships**
- Wraps a *Tensor* to provide a typed, time-bounded access pattern
- Used internally by the backend; not surfaced directly in the API

---

## 4. Selection

**Definition**
A shared navigation cursor describing what the user is currently looking at:
a time point and window, spatial coordinates (AP, ML), a frequency, and an
optional event. The selection is replicated on both backend and frontend;
mutations go through a single server round-trip that then invalidates all
active queries.

> **Asymmetry:** The backend `SelectionState` is a flat dataclass; the
> frontend `useSelectionStore` additionally tracks viewport duration and
> multi-electrode brush/hover state not persisted on the server.
> See [terminology.md T1](terminology.md#t1-time-backend-vs-timecursor-frontend--same-concept-two-names)
> for the `time` vs `timeCursor` naming inconsistency.

**Evidence**
- [src/tensorscope/core/state.py](../../../src/tensorscope/core/state.py) — `SelectionState`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `SelectionDTO`
- [src/tensorscope/server/routers/selection.py](../../../src/tensorscope/server/routers/selection.py) — `GET /api/v1/selection`, `PUT /api/v1/selection`
- [frontend/src/store/selectionStore.ts](../../../frontend/src/store/selectionStore.ts) — `useSelectionStore`, `timeCursor`, `timeWindow`, `spatial`, `freq`, `event`, `viewportDuration`
- [frontend/src/components/views/useOverviewDetail.ts](../../../frontend/src/components/views/useOverviewDetail.ts) — overview-detail time contract
- [frontend/src/components/views/useEventNavigation.ts](../../../frontend/src/components/views/useEventNavigation.ts) — event navigation contract

**Responsibilities**
- Provides the coordinates used by every view to request its specific slice
- Acts as the single source of truth for inter-view synchronisation
- Persisted per-session on the server; reconstructed from `StateDTO` on load

**Relationships**
- Embedded in every `TensorSliceRequestDTO` to parameterise each *View* fetch
- Updated by user interaction in any *View* (time pan, spatial click, freq drag)
- Drives *Event* navigation via `useEventNavigation`
- Controls *Brainstate* overlay alignment in time-based views

---

## 5. View

**Definition**
A named rendering mode that takes a tensor slice and displays it.
The backend *view registry* maps tensor dimension sets to supported view ids.
The frontend *view registry* maps those same ids to React components.
The two registries must agree on ids; any mismatch silently hides a view.

> **Protocol note:** `psd_live` is a server-only view id that computes live
> multitaper PSD. The frontend intercepts it and expands it into three
> sub-view ids. See [terminology.md T4](terminology.md#t4-psd_live-is-a-server-internal-view-id-not-a-renderable-frontend-view).

**Evidence**
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `_VIEW_REGISTRY`, `available_views`, `apply_slice_request`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `TensorSliceRequestDTO`, `TensorSliceDTO`
- [frontend/src/registry/viewRegistry.ts](../../../frontend/src/registry/viewRegistry.ts) — `VIEW_DESCRIPTORS`, `getAvailableViews`, `viewRegistry`, `OrthoPair`
- [frontend/src/components/views/viewTypes.ts](../../../frontend/src/components/views/viewTypes.ts) — `SliceViewProps`
- [frontend/src/components/views/WorkspaceMain.tsx](../../../frontend/src/components/views/WorkspaceMain.tsx) — `expandPSDLive`

Concrete view components:
- [frontend/src/components/views/TimeseriesSliceView.tsx](../../../frontend/src/components/views/TimeseriesSliceView.tsx)
- [frontend/src/components/views/SpatialMapSliceView.tsx](../../../frontend/src/components/views/SpatialMapSliceView.tsx)
- [frontend/src/components/views/NavigatorView.tsx](../../../frontend/src/components/views/NavigatorView.tsx)
- [frontend/src/components/views/SpectrogramView.tsx](../../../frontend/src/components/views/SpectrogramView.tsx)
- [frontend/src/components/views/PSDHeatmapView.tsx](../../../frontend/src/components/views/PSDHeatmapView.tsx)
- [frontend/src/components/views/PSDCurveView.tsx](../../../frontend/src/components/views/PSDCurveView.tsx)
- [frontend/src/components/views/PSDSpatialView.tsx](../../../frontend/src/components/views/PSDSpatialView.tsx)
- [frontend/src/components/views/PropagationView.tsx](../../../frontend/src/components/views/PropagationView.tsx)
- [frontend/src/components/views/HypnogramView.tsx](../../../frontend/src/components/views/HypnogramView.tsx)

**Responsibilities**
- Backend: slice the tensor to the shape the view needs and serialise to Arrow IPC
- Frontend: decode Arrow IPC and render interactively; emit selection callbacks on interaction

**Relationships**
- A *View* consumes a *Tensor* slice parameterised by the current *Selection*
- *View* availability is determined by *Tensor Schema* (dimension names)
- *Views* occupy fixed *Layout* slots; they show/hide in place
- *Processing Pipeline* is applied to the tensor before slicing for every view request

---

## 6. Layout

**Definition**
The visual arrangement of panels and views in the workspace.
The backend stores named `LayoutPreset` descriptors and exposes a preset
switcher API. The frontend owns the live layout state in `useLayoutStore`,
including panel sizes, the active sidebar tab, the maximised view, and the
slot-based `ViewSlotLayout`.

> **Asymmetry:** Backend layout presets describe logical panel groupings with
> `grid_assignments` and `sidebar_panels` fields. The frontend slot layout
> (`ViewSlotLayout`) is a richer structure with explicit rows, width
> fractions, and per-slot view assignments; it is not round-tripped to the
> server. The `sidebar_panels` field in the backend uses different id strings
> from the frontend's `SidebarTabId`. See
> [terminology.md T5](terminology.md#t5-backend-sidebar-panel-ids-vs-frontend-sidebar-tab-ids--completely-disjoint-sets).

**Evidence**
- [src/tensorscope/core/layout.py](../../../src/tensorscope/core/layout.py) — `LayoutPreset`, `LayoutManager`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `LayoutDTO`, `LayoutUpdateDTO`
- [src/tensorscope/server/routers/layout.py](../../../src/tensorscope/server/routers/layout.py) — `GET /api/v1/layout`, `PUT /api/v1/layout`
- [frontend/src/store/layoutStore.ts](../../../frontend/src/store/layoutStore.ts) — `useLayoutStore`, `ViewSlot`, `ViewRow`, `ViewSlotLayout`, `LayoutState`
- [frontend/src/components/views/viewGridLayout.ts](../../../frontend/src/components/views/viewGridLayout.ts) — `DEFAULT_SLOT_LAYOUT`
- [frontend/src/components/views/ViewGrid.tsx](../../../frontend/src/components/views/ViewGrid.tsx)
- [frontend/src/components/views/ViewPanel.tsx](../../../frontend/src/components/views/ViewPanel.tsx)

**Responsibilities**
- Defines which views are visible and where they appear
- Supports preset switching (e.g. `spatial_focus`, `psd_explorer`)
- Persists sidebar/panel geometry across page reloads via Zustand `persist` middleware
- `ViewPanel` provides per-panel chrome: tensor chooser, maximise, and close

**Relationships**
- Each *Layout* slot hosts one *View*
- The *Session* persists the active preset name; the frontend holds slot-level detail
- Changing layout preset may change which *Tensors* are foregrounded

---

## 7. Processing Pipeline

**Definition**
A fixed-order sequence of optional preprocessing steps applied to a tensor
before slicing for any view. Steps include common-median reference (CMR),
bandpass filter, notch filter, spatial median, and z-score normalisation.
Results are cached per session to avoid re-computing on every request.

**Evidence**
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `apply_processing`, `ServerState._get_processed_tensor`, `_processed_cache`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `ProcessingParamsDTO`, `DownsampleMethod`
- [src/tensorscope/server/routers/processing.py](../../../src/tensorscope/server/routers/processing.py) — `GET /api/v1/processing`, `PUT /api/v1/processing`
- [frontend/src/components/controls/ProcessingPanel.tsx](../../../frontend/src/components/controls/ProcessingPanel.tsx) — UI controls
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — PSD-related settings (`psdFmax`, `psdNW`)

**Responsibilities**
- Optionally preprocesses tensors server-side before every slice is computed
- Caches the full processed tensor so repeated slice requests are cheap
- Exposes a toggle (`enabled`) so the raw tensor can be used instead
- Downsampling (`none` / `minmax` / `lttb`) is applied at slice time, not cached

**Relationships**
- Applied to a *Tensor* inside `apply_slice_request` before any *View* slice is generated
- Controlled by `ProcessingParamsDTO`; updated via `PUT /api/v1/processing`
- Independent of the *Transform* pipeline (which produces new named tensors)

---

## 8. Transform

**Definition**
A declarative, named computation that consumes one or more tensors and
produces a new derived tensor. A transform is described by `TransformDefinition`
(parameter schema, IO specs, compute function). The `TransformRegistry` holds
all available transforms; `TransformExecutor` validates parameters, runs the
function, caches the result, and registers the output as a new `TensorNode`.

**Evidence**
- [src/tensorscope/core/transforms/registry.py](../../../src/tensorscope/core/transforms/registry.py) — `ParamSpec`, `InputSpec`, `OutputSpec`, `TransformDefinition`, `TransformRegistry`
- [src/tensorscope/core/transforms/executor.py](../../../src/tensorscope/core/transforms/executor.py) — `TransformExecutor`
- [src/tensorscope/core/transforms/cache.py](../../../src/tensorscope/core/transforms/cache.py) — `TransformCache`
- [src/tensorscope/core/transforms/builtins.py](../../../src/tensorscope/core/transforms/builtins.py) — `BANDPASS`, `SPECTROGRAM`, `PSD`, `BANDPOWER`, `COHERENCE`, `EVENT_ALIGN`, `DIM_REDUCTION`, `PREWHITEN`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `TransformDefinitionDTO`, `TransformRequestDTO`
- [src/tensorscope/server/routers/transforms.py](../../../src/tensorscope/server/routers/transforms.py) — `GET /api/v1/transforms`, `POST /api/v1/transforms/execute`

**Responsibilities**
- Defines the computation schema (parameters, input constraints, output dimensions)
- Validates that a transform is applicable to a candidate tensor before offering it in the UI
- Executes the computation and registers the result in the tensor registry and DAG
- Caches results keyed by provenance hash to avoid redundant computation

**Relationships**
- Consumes one or more *Tensors* as inputs; produces a *Derived Tensor*
- Registered in the *Workspace DAG* as a `DAGTransformNode`
- Can be promoted to a *Pipeline Export* step
- Distinct from the *Processing Pipeline*, which is always-on preprocessing, not a named derivation

---

## 9. Derived Tensor and Transform Provenance

**Definition**
A `DerivedTensor` is the result of executing a *Transform*. It carries a
`TransformProvenance` record (transform name, parameters, parent tensor ids)
that serves as a cache key and forms the lineage stored in the *Workspace DAG*.

**Evidence**
- [src/tensorscope/core/transforms/model.py](../../../src/tensorscope/core/transforms/model.py) — `TransformProvenance`, `DerivedTensor`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `DerivedTensorDTO`, `TransformProvenanceDTO`
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — `WorkspaceObject` with `type: "source" | "derived"`

**Responsibilities**
- Records which transform with which parameters produced a tensor
- Enables deterministic cache lookup (`TransformProvenance.cache_key`)
- Distinguishes derived tensors from source tensors in the workspace UI

**Relationships**
- Produced by *Transform* execution; registered as a *Tensor* in `TensorRegistry`
- Provenance forms the edges in the *Workspace DAG*
- Can be marked `pipeline_selected` and exported as a *Pipeline Export* step

---

## 10. Workspace DAG

**Definition**
A directed acyclic graph that records the full derivation history of the
session. Nodes are either tensor nodes (`DAGTensorNode`) or transform nodes
(`DAGTransformNode`); directed edges (`TransformEdge`) link tensor inputs to
transform executions and transform executions to output tensors.

**Evidence**
- [src/tensorscope/core/transforms/dag.py](../../../src/tensorscope/core/transforms/dag.py) — `WorkspaceDAG`, `DAGTensorNode`, `DAGTransformNode`, `TransformEdge`, `ProvenanceStep`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `WorkspaceDAGDTO`, `DAGNodeVisibilityDTO`
- [src/tensorscope/server/routers/dag.py](../../../src/tensorscope/server/routers/dag.py) — `GET /api/v1/dag`, `GET /api/v1/dag/provenance/{tensor_node_id}`
- [frontend/src/store/dagStore.ts](../../../frontend/src/store/dagStore.ts) — `useDAGStore`, `focusedNodeId`, `focusedNodeType`
- [frontend/src/components/layout/DAGGraphView.tsx](../../../frontend/src/components/layout/DAGGraphView.tsx) — SVG DAG visualisation

**Responsibilities**
- Maintains the complete derivation lineage for the session
- Supports upstream/downstream traversal and provenance chain queries
- Each tensor node carries visibility and `pipeline_selected` flags used during *Pipeline Export*

**Relationships**
- Populated by `TransformExecutor` each time a *Transform* is executed
- `pipeline_selected` flags drive *Pipeline Export* scope selection
- Frontend focus state (`useDAGStore`) drives the inspector panel displayed alongside the graph

---

## 11. Pipeline Export

**Definition**
A serialisable `PipelineSpec` document extracted from the *Workspace DAG*
by walking upstream from marked tensors. The spec identifies source tensors,
transform steps, and output tensors in topological order. A `WorkflowCooker`
(currently `SnakemakeCooker`) converts the spec into runnable workflow artifacts.

**Evidence**
- [src/tensorscope/core/pipeline/spec.py](../../../src/tensorscope/core/pipeline/spec.py) — `PipelineSpec`, `PipelineSourceTensor`, `PipelineTransformNode`, `PipelineDerivedTensor`, `ExecutionMetadata`
- [src/tensorscope/core/pipeline/selection.py](../../../src/tensorscope/core/pipeline/selection.py) — `extract_pipeline`, `PipelineSelectionError`
- [src/tensorscope/core/pipeline/cooker.py](../../../src/tensorscope/core/pipeline/cooker.py) — `WorkflowCooker`, `SnakemakeCooker`, `WorkflowArtifact`
- [src/tensorscope/server/routers/pipeline.py](../../../src/tensorscope/server/routers/pipeline.py) — `POST /api/v1/pipeline/export`, `POST /api/v1/pipeline/promote/{tensor_node_id}`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `PipelineExportRequestDTO`, `PipelineExportResponseDTO`, `WorkflowArtifactDTO`

**Responsibilities**
- Extracts the minimal subgraph needed to reproduce selected output tensors
- Serialises the spec to JSON/YAML for archival or hand-off
- Generates workflow scripts (Snakemake) from the spec

**Relationships**
- Derived entirely from the *Workspace DAG* by upstream traversal
- Each exported step corresponds to a *Transform* execution record
- Requires tensors to be marked `pipeline_selected` in the *Workspace DAG*

---

## 12. Event Stream

**Definition**
A named, timestamped collection of events (`EventStream`) backed by a
pandas DataFrame. Events have at minimum an onset time; optionally an offset
and label. Multiple event streams can coexist; the `EventRegistry` indexes
them by name.

**Evidence**
- [src/tensorscope/core/events/model.py](../../../src/tensorscope/core/events/model.py) — `EventStream`, `EventStyle`
- [src/tensorscope/core/events/registry.py](../../../src/tensorscope/core/events/registry.py) — `EventRegistry`
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `ServerState.events`, `event_stream_meta`
- [src/tensorscope/server/routers/events.py](../../../src/tensorscope/server/routers/events.py) — `GET /api/v1/events`, `GET /api/v1/events/{name}/window`
- [frontend/src/store/selectionStore.ts](../../../frontend/src/store/selectionStore.ts) — `event` field (selected event id and stream name)
- [frontend/src/components/views/EventTableView.tsx](../../../frontend/src/components/views/EventTableView.tsx)
- [frontend/src/components/views/useEventNavigation.ts](../../../frontend/src/components/views/useEventNavigation.ts)

**Responsibilities**
- Stores and serves timestamped events windowed to the current time range
- Provides next/previous navigation across the stream
- Displayed as overlay markers in time-based views and as a browsable table

**Relationships**
- The current *Selection* includes the selected event id; updating it scrolls time-based views
- *Event Detectors* produce new `EventStream` instances registered in `EventRegistry`
- Event overlays are rendered inside *View* components that consume time data

---

## 13. Event Detector

**Definition**
A pluggable computation (`EventDetector`) that consumes a tensor and produces
an `EventStream`. Detectors are registered by name; `ThresholdDetector` is
the built-in implementation. The detector registry (`register_detector`,
`get_detector`, `list_detectors`) is global and extensible.

> **Frontend gap:** The frontend has no dedicated detector UI. Detector
> results flow into the existing event-stream path once registered on the
> backend.

**Evidence**
- [src/tensorscope/core/events/detectors.py](../../../src/tensorscope/core/events/detectors.py) — `EventDetector`, `ThresholdDetector`, `DetectorParamSpec`, `register_detector`, `get_detector`, `list_detectors`
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `DetectorDefinitionDTO`, `DetectRequestDTO`, `DetectResultDTO`
- [src/tensorscope/server/routers/events.py](../../../src/tensorscope/server/routers/events.py) — `GET /api/v1/events/detectors`, `POST /api/v1/events/detect`

**Responsibilities**
- Defines a parameter schema analogous to `TransformDefinition` but for event detection
- Executes detection against a tensor and registers the result as an `EventStream`
- `ThresholdDetector` marks time points where signal amplitude crosses a threshold

**Relationships**
- Consumes a *Tensor*; produces an *Event Stream* registered in `EventRegistry`
- Structurally parallel to *Transform*: parameter schema, execution, registry

---

## 14. Brainstate

**Definition**
An optional, 1-D integer-coded time series stored as an `xarray.DataArray`
in `ServerState.brainstates`. It represents the animal's sleep or arousal
state at each sample. The backend converts it into named intervals with
colour metadata. The frontend renders it as a `HypnogramView` and as an
overlay on time-based views.

> **Distinction from Event Stream:** Brainstates encode a continuous,
> exhaustive state partition (every sample belongs to exactly one state),
> whereas event streams record sparse, discrete events. They have separate
> routes and display logic.
> See [terminology.md T8](terminology.md#t8-brainstate-singular-functions-vs-brainstates-plural-field) for the singular/plural naming inconsistency.

**Evidence**
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `brainstate_intervals`, `brainstate_meta`, `ServerState.brainstates`
- [src/tensorscope/server/routers/brainstates.py](../../../src/tensorscope/server/routers/brainstates.py) — `GET /api/v1/brainstates`, `GET /api/v1/brainstates/intervals`
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — `brainstateOverlay`, `showHypnogram`
- [frontend/src/components/views/HypnogramView.tsx](../../../frontend/src/components/views/HypnogramView.tsx)
- [frontend/src/components/views/brainstateOverlay.ts](../../../frontend/src/components/views/brainstateOverlay.ts)
- [frontend/src/components/views/brainstateColors.ts](../../../frontend/src/components/views/brainstateColors.ts)

**Responsibilities**
- Partitions the recording session into labelled, coloured state intervals
- Displayed as a step chart in `HypnogramView` and as a background overlay in `NavigatorView` and `TimeseriesSliceView`

**Relationships**
- Aligned to the *Tensor* time axis; toggled by flags in `useAppStore`
- Shares time axis with *Selection* for alignment but is independent of event selection

---

## 15. Session and Server State

**Definition**
`SessionManager` creates and expires per-browser-session `SessionRecord`
objects, each holding a `ServerState`. `ServerState` is the mutable,
per-session object that aggregates the tensor registry, selection, layout,
events, processing params, transform services, DAG, and processed-tensor
cache.

**Evidence**
- [src/tensorscope/server/session.py](../../../src/tensorscope/server/session.py) — `SessionManager`, `SessionRecord`
- [src/tensorscope/server/state.py](../../../src/tensorscope/server/state.py) — `ServerState`, `create_server_state`
- [src/tensorscope/server/app.py](../../../src/tensorscope/server/app.py) — `create_app` factory, error handler registration
- [src/tensorscope/server/models.py](../../../src/tensorscope/server/models.py) — `StateDTO`, `ApiErrorDTO`
- [src/tensorscope/server/routers/state.py](../../../src/tensorscope/server/routers/state.py) — `GET /api/v1/state`
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — `useAppStore`
- [frontend/src/store/selectionStore.ts](../../../frontend/src/store/selectionStore.ts) — `useSelectionStore`
- [frontend/src/store/layoutStore.ts](../../../frontend/src/store/layoutStore.ts) — `useLayoutStore` (persisted)
- [frontend/src/store/dagStore.ts](../../../frontend/src/store/dagStore.ts) — `useDAGStore`
- [frontend/src/store/activityStore.ts](../../../frontend/src/store/activityStore.ts) — `useActivityStore`

**Responsibilities**
- `SessionManager` isolates state between browser tabs/users using cookie-based session ids
- `ServerState` is the single authoritative mutable object on the server for a session
- `GET /api/v1/state` returns `StateDTO`: active tensor, selection, layout, tensor summaries, event summaries
- Frontend Zustand stores mirror server state locally and add UI-only state (theme, panel sizes, DAG focus)

**Relationships**
- Contains or owns every other server-side entity: *Tensor* registry, *Selection*, *Layout*, *Event* registry, *Processing Pipeline*, *Transform* services, *Workspace DAG*, *Brainstate*
- Frontend stores are the client-side projection of `ServerState`; synchronised via `StateDTO` on load and via targeted mutations thereafter

---

## 16. Workspace Object (frontend-only)

**Definition**
A lightweight frontend record (`WorkspaceObject` in `useAppStore`) that
represents either a source or derived tensor visible in the workspace UI.
It is synthesised client-side from `TensorSummaryDTO` records returned in
`StateDTO`; there is no corresponding backend class.

> See [terminology.md T6](terminology.md#t6-workspaceobject-frontend-vs-dagtensornode-backend--parallel-concepts-incompatible-fields)
> for the relationship between `WorkspaceObject` and the backend `DAGTensorNode`.

**Evidence**
- [frontend/src/store/appStore.ts](../../../frontend/src/store/appStore.ts) — `WorkspaceObject`, `workspaceObjects`, `setWorkspaceObjects`, `setObjectVisible`
- [frontend/src/components/views/WorkspaceMain.tsx](../../../frontend/src/components/views/WorkspaceMain.tsx) — builds `workspaceObjects` from `stateQuery.data.tensors`

**Responsibilities**
- Tracks per-tensor visibility and display mode (`single`, `row`, `column`) in the workspace UI
- Bridges the server's tensor summaries to the frontend workspace panel

**Relationships**
- Derived from *Tensor* metadata (`TensorSummaryDTO`)
- Drives *View* and panel visibility decisions in `WorkspaceMain`

---

## 17. Activity Entry (frontend-only)

**Definition**
A client-side record (`ActivityEntry` in `useActivityStore`) that tracks
in-progress or completed work items such as transform executions, with
status, timing, cache-hit flags, and errors. It is purely a UI concern with
no backend counterpart.

**Evidence**
- [frontend/src/store/activityStore.ts](../../../frontend/src/store/activityStore.ts) — `ActivityEntry`, `ActivityStatus`, `addActivity`, `updateActivity`, `clearEntries`

**Responsibilities**
- Provides a real-time activity log for user-visible operations
- Records whether a result was a cache hit

**Relationships**
- Updated by frontend code that calls transform execution or similar async operations
- No server-side entity; the backend does not expose an equivalent activity log
