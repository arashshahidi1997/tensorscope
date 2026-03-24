# TensorScope Entity Relationships

This document describes how TensorScope's entities relate to each other.
All relationships are derived from call sites, import chains, and API wire
formats in the repository. See [entities.md](entities.md) for entity
definitions and [architecture.md](architecture.md) for the visual diagram.

---

## Containment Tree

The server-side containment hierarchy, rooted at `Session`:

```
Session
└── ServerState
    ├── TensorRegistry
    │   ├── TensorNode (source tensors)
    │   └── TensorNode (derived tensors, via Transform)
    ├── SelectionState ──────────────────── mirrors ──► useSelectionStore
    ├── LayoutManager ───────────────────── mirrors ──► useLayoutStore
    ├── EventRegistry
    │   └── EventStream (produced by EventDetector)
    ├── ProcessingPipeline (_processed_cache)
    ├── TransformRegistry / TransformExecutor / TransformCache
    │   └── produces DerivedTensor → TensorNode
    ├── WorkspaceDAG
    │   ├── DAGTensorNode
    │   ├── DAGTransformNode
    │   └── TransformEdge
    ├── Brainstates (optional DataArray)
    └── _processed_cache (keyed processed tensor results)

View (per active slot)
  ├── id determined by Tensor schema (dimension names)
  ├── data from apply_slice_request(selection, view_id, tensor)
  └── rendered by viewRegistry[id] React component

PipelineSpec (export artifact)
  └── extracted from WorkspaceDAG by walking upstream from pipeline_selected nodes
```

---

## Relationship Graph

### Containment

```
Session         --owns-----------►  ServerState
ServerState     --contains-------►  TensorRegistry
ServerState     --contains-------►  SelectionState
ServerState     --contains-------►  LayoutManager
ServerState     --contains-------►  EventRegistry
ServerState     --contains-------►  ProcessingPipeline (_processed_cache)
ServerState     --contains-------►  TransformRegistry
ServerState     --contains-------►  TransformExecutor
ServerState     --contains-------►  TransformCache
ServerState     --contains-------►  WorkspaceDAG
ServerState     --contains-------►  Brainstates (optional xr.DataArray)
TensorRegistry  --stores---------►  Tensor (as TensorNode)
Layout          --positions------►  View  (slot → view-id assignment)
ViewGrid        --contains-------►  ViewPanel (one per active slot)
ViewPanel       --wraps----------►  View  (provides chrome: header, close, maximize)
```

Evidence: `ServerState` fields in
[src/tensorscope/server/state.py:49-62](../../../src/tensorscope/server/state.py#L49-L62);
`ViewGrid` → `ViewPanel` in
[frontend/src/components/views/ViewGrid.tsx](../../../frontend/src/components/views/ViewGrid.tsx).

---

### Production / Creation

```
Transform       --produces-------►  DerivedTensor  (via TransformExecutor.execute)
DerivedTensor   --registered_as--►  Tensor         (step 11 of execute: TensorRegistry.add)
TransformExecutor --records_in---►  WorkspaceDAG   (step 12 of execute: dag.record_execution)
EventDetector   --produces-------►  EventStream    (ThresholdDetector.detect → EventRegistry)
EventStream     --registered_in--►  EventRegistry
WorkspaceDAG    --extracted_as---►  PipelineSpec   (extract_pipeline walks upstream DAG)
PipelineSpec    --cooked_by------►  WorkflowArtifact  (SnakemakeCooker.cook)
```

Evidence: `TransformExecutor.execute` steps 9–12 in
[src/tensorscope/core/transforms/executor.py:179-214](../../../src/tensorscope/core/transforms/executor.py#L179-L214);
`extract_pipeline` in
[src/tensorscope/core/pipeline/selection.py](../../../src/tensorscope/core/pipeline/selection.py).

---

### Control / Determination

```
Tensor (dims)       --determines----►  available Views
                                       (_VIEW_REGISTRY lookup → available_views())
Selection           --parameterizes--►  TensorSliceRequest  (embedded in every request)
TensorSliceRequest  --drives---------►  View data           (one request per active view)
ProcessingPipeline  --preprocesses---►  Tensor              (before slice; result cached)
Brainstate          --overlaid_on----►  TimeseriesView, NavigatorView, HypnogramView
WorkspaceDAG        --scopes---------►  PipelineExport      (pipeline_selected flags)
```

Evidence: `_VIEW_REGISTRY` in
[src/tensorscope/server/state.py:40-45](../../../src/tensorscope/server/state.py#L40-L45);
`tensor_slice` in
[src/tensorscope/server/state.py:210-239](../../../src/tensorscope/server/state.py#L210-L239).

---

### Rendering

```
View              --renders--------►  Arrow IPC payload from Tensor slice
WorkspaceMain     --orchestrates---►  all active Views  (builds viewElements map)
WorkspaceMain     --reads----------►  useSelectionStore, useAppStore
WorkspaceMain     --fires----------►  useSliceQuery (one per active view type)
useSliceQuery     --calls----------►  POST /api/v1/tensors/{name}/slice
```

Evidence: `viewElements` map and per-view `useSliceQuery` calls in
[frontend/src/components/views/WorkspaceMain.tsx:170-386](../../../frontend/src/components/views/WorkspaceMain.tsx#L170-L386).

---

### State Synchronisation

```
GET /api/v1/state    --bootstraps----►  frontend stores (via StateDTO on load)
useSelectionStore    --mirrors-------►  SelectionState (synced after each PUT /selection)
useLayoutStore       --persists------►  Layout geometry (Zustand persist middleware, survives reload)
useAppStore          --synthesizes---►  WorkspaceObject list  (from StateDTO.tensors)
ProcessingPanel      --mutates-------►  ProcessingPipeline (PUT /api/v1/processing)
                                        then invalidates all ["slice"] queries
```

Evidence: `stateQuery` bootstrap effect in
[frontend/src/components/views/WorkspaceMain.tsx:114-132](../../../frontend/src/components/views/WorkspaceMain.tsx#L114-L132);
`useSetProcessing` mutation in
[frontend/src/api/queries.ts:113-122](../../../frontend/src/api/queries.ts#L113-L122).

---

## Traced Interaction Examples

### 1. User clicks a time point in the Timeseries view

```
TimeseriesSliceView
  onSelectTime(t)
    │
    ▼
WorkspaceMain.onCommitSelection({ ...selectionDraft, time: t })
    │  (prop provided by parent shell)
    ▼
PUT /api/v1/selection  →  ServerState.update_selection()
                          └─ SelectionState.timeCursor = t
    │
    ▼  (parent also calls useSelectionStore.setTimeCursor(t))
useSelectionStore.timeCursor updated
    │
    ▼
toSelectionDTO(selectionState) produces new selectionDraft
    │  (query key ["slice", name, request] changes)
    ▼
useSliceQuery refires for every active view
    │
    ▼
POST /api/v1/tensors/{name}/slice  (TensorSliceRequestDTO with new time)
  → ServerState.tensor_slice()
    → _get_processed_tensor() (returns cached processed array)
    → apply_slice_request()   (windows by time_range, downsamples)
    → encode_arrow_payload()  → base64 Arrow IPC
    │
    ▼
decodeArrowSlice() on frontend  →  view component re-renders
```

Key files:
[frontend/src/components/views/TimeseriesSliceView.tsx](../../../frontend/src/components/views/TimeseriesSliceView.tsx),
[frontend/src/api/queries.ts:49-59](../../../frontend/src/api/queries.ts#L49-L59),
[src/tensorscope/server/state.py:210-239](../../../src/tensorscope/server/state.py#L210-L239).

---

### 2. User executes a Bandpass transform

```
User picks "bandpass" transform on "signal" tensor in the Graph tab
    │
    ▼
POST /api/v1/transforms/execute
  body: { transform_name: "bandpass", input_names: ["signal"], params: { low: 1, high: 300 } }
    │
    ▼
ServerState.execute_transform("bandpass", ["signal"], params)
  └─ TransformExecutor.execute():
       1. TransformRegistry.get("bandpass")  →  BANDPASS TransformDefinition
       2. TensorRegistry.get("signal")       →  source TensorNode
       3. validate input dims (requires "time")
       4. validate + fill params
       5. TransformProvenance(name, params, parent_ids=["signal"])
       6. TransformCache.get(cache_key)  →  miss
       7. BANDPASS.compute([signal.data], params)  →  xr.DataArray
       8. DerivedTensor(id="bandpass_<hash>", status="computed", ...)
       9. TransformCache.put(derived)
      10. TensorRegistry.add(TensorNode(name="bandpass_<hash>", data=result))
      11. WorkspaceDAG.record_execution(...)
    │
    ▼
Response: DerivedTensorDTO
    │
    ▼
WorkspaceMain: next GET /api/v1/state returns new tensor in StateDTO.tensors
  → setWorkspaceObjects() adds new chip to workspace strip
  → user clicks chip → setSelectedTensor("bandpass_<hash>")
  → useSliceQuery fires for new tensor → views render derived data
```

Key files:
[src/tensorscope/core/transforms/executor.py:50-220](../../../src/tensorscope/core/transforms/executor.py#L50-L220),
[src/tensorscope/server/routers/transforms.py](../../../src/tensorscope/server/routers/transforms.py).

---

### 3. User enables Common Median Reference in the Processing panel

```
ProcessingPanel: user toggles CMR checkbox
    │
    ▼
useSetProcessing.mutate({ ...params, cmr: true })
    │
    ▼
PUT /api/v1/processing  →  ServerState.set_processing(params)
                           └─ _processed_cache.clear()   ← cache invalidated
    │
    ▼  (mutation onSuccess)
queryClient.invalidateQueries(["processing"])
queryClient.invalidateQueries(["slice"])       ← all view data stale
    │
    ▼
useSliceQuery refires for every active view
    │
    ▼
ServerState.tensor_slice() calls _get_processed_tensor("signal")
  → _processed_cache miss → apply_processing(node.data, params)
    (applies CMR across AP/ML, then bandpass, notch, zscore as configured)
  → result stored in _processed_cache["signal"]
  → apply_slice_request(cached_processed, request)
  → Arrow IPC  →  views re-render with processed data
```

Key files:
[src/tensorscope/server/state.py:127-208](../../../src/tensorscope/server/state.py#L127-L208),
[frontend/src/api/queries.ts:113-122](../../../frontend/src/api/queries.ts#L113-L122).

---

### 4. Frontend expands `psd_live` into three sub-views

The server exposes a single `psd_live` view id for `(time, AP, ML)` tensors
but the frontend needs three separate panel slots. See also
[terminology.md T4](terminology.md#t4-psd_live-is-a-server-internal-view-id-not-a-renderable-frontend-view).

```
GET /api/v1/tensors/signal  →  TensorMetaDTO.available_views = ["timeseries", ..., "psd_live"]
    │
    ▼
WorkspaceMain: expandPSDLive(rawAvailableViews)
  replaces "psd_live" with ["psd_heatmap", "psd_curve", "psd_spatial"]
    │
    ▼
Single useSliceQuery fires:  view_type = "psd_live", psd_params = { NW, fmax }
    │
    ▼
POST /api/v1/tensors/signal/slice
  → apply_slice_request() detects view_type == "psd_live"
  → cogpy.psd_multitaper(flat_signal, fs, NW, fmax)  →  (freq, AP, ML) array
  → Arrow IPC with shape (n_freq, n_ap, n_ml)
    │
    ▼
decodeArrowSlice(payload)          → decoded Arrow table
extractPSDHeatmap(decoded)         → data for PSDHeatmapView   (channels × freq)
extractPSDAverage(decoded)         → data for PSDCurveView     (mean ± std curve)
decoded passed directly             → PSDSpatialView           (slice at selectedFreq)
```

Key files:
[frontend/src/components/views/WorkspaceMain.tsx:48-58](../../../frontend/src/components/views/WorkspaceMain.tsx#L48-L58),
[src/tensorscope/server/state.py:369-410](../../../src/tensorscope/server/state.py#L369-L410),
[frontend/src/api/arrow.ts](../../../frontend/src/api/arrow.ts).

---

### 5. User exports a pipeline from the DAG

```
User marks output tensor "bandpass_<hash>" as pipeline_selected in DAG tab
    │
    ▼
PUT /api/v1/dag/tensors/bandpass_<hash>/visibility
  { pipeline_selected: true }
  → WorkspaceDAG.set_tensor_pipeline_selected("bandpass_<hash>", True)
    │
    ▼
POST /api/v1/pipeline/export
  body: { output_tensor_ids: ["bandpass_<hash>"], workflow: "snakemake" }
    │
    ▼
extract_pipeline(dag, ["bandpass_<hash>"])
  → topo-sort upstream DAG nodes from target
  → PipelineSpec(
       sources=[PipelineSourceTensor(name="signal")],
       transforms=[PipelineTransformNode(name="bandpass", params={...})],
       outputs=[PipelineDerivedTensor(name="bandpass_<hash>")]
    )
    │
    ▼
SnakemakeCooker.cook(spec)  →  [WorkflowArtifact(filename="Snakefile", content=...)]
    │
    ▼
Response: PipelineExportResponseDTO { spec, artifacts }
```

Key files:
[src/tensorscope/core/pipeline/selection.py](../../../src/tensorscope/core/pipeline/selection.py),
[src/tensorscope/core/pipeline/cooker.py](../../../src/tensorscope/core/pipeline/cooker.py),
[src/tensorscope/server/routers/pipeline.py](../../../src/tensorscope/server/routers/pipeline.py).
