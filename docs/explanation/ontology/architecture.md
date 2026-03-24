# TensorScope Architecture Diagram

A Mermaid entity diagram showing how TensorScope's core entities relate to
each other. All relationships are grounded in repository evidence; see
[relationships.md](relationships.md) for the textual relationship model and
[layers.md](layers.md) for the layered view.

---

## Conceptual Entity Diagram

Arrows are labelled with the type of relationship.
Dashed arrows (`-.->`) cross the HTTP boundary between backend and frontend.

**Colour key**
- Blue nodes — backend entities (`src/tensorscope/`)
- Green nodes — frontend entities (`frontend/src/`)
- Yellow nodes — boundary entities that exist in both or cross the HTTP wire

```mermaid
graph TD

    %% ── Data lineage ─────────────────────────────────────────────────
    SourceTensor["Tensor\n(source)"]
    DerivedTensor["Tensor\n(derived / DerivedTensor)"]
    Schema["Tensor Schema\n(validate_and_normalize_grid)"]
    Modality["Data Modality\n(GridLFPModality, FlatLFPModality…)"]
    Transform["Transform\n(TransformDefinition + TransformExecutor)"]
    TransformCache["Transform Cache"]
    WorkspaceDAG["Workspace DAG\n(WorkspaceDAG)"]
    PipelineExport["Pipeline Export\n(PipelineSpec + SnakemakeCooker)"]

    Schema -->|validates| SourceTensor
    Modality -->|wraps| SourceTensor
    Transform -->|reads| SourceTensor
    Transform -->|produces| DerivedTensor
    DerivedTensor -->|registered as| SourceTensor
    TransformCache -->|memoises| Transform
    Transform -->|recorded in| WorkspaceDAG
    WorkspaceDAG -->|extracted as| PipelineExport

    %% ── Event and brainstate ─────────────────────────────────────────
    EventDetector["Event Detector\n(ThresholdDetector)"]
    EventStream["Event Stream\n(EventStream + EventRegistry)"]
    Brainstate["Brainstate\n(1-D state codes)"]

    EventDetector -->|reads| SourceTensor
    EventDetector -->|produces| EventStream

    %% ── Server-side processing and slicing ───────────────────────────
    ProcessingPipeline["Processing Pipeline\n(apply_processing + _processed_cache)"]
    SliceRequest["Tensor Slice Request\n(TensorSliceRequestDTO)"]
    ArrowPayload["Arrow IPC Payload\n(base64-encoded)"]

    ProcessingPipeline -->|preprocesses| SourceTensor
    ProcessingPipeline -->|result cached in| ServerState["Server State\n(ServerState + SessionManager)"]
    SliceRequest -->|selects window from| SourceTensor
    SliceRequest -->|serialised as| ArrowPayload

    %% ── Selection drives slicing ─────────────────────────────────────
    Selection["Selection\n(timeCursor, timeWindow, AP, ML, freq, event)"]
    Selection -->|embedded in| SliceRequest

    %% ── View layer ───────────────────────────────────────────────────
    View["View\n(timeseries, spatial_map, spectrogram,\npsd_*, navigator, propagation_frame…)"]
    ViewPanel["View Panel\n(ViewPanel chrome)"]
    ViewGrid["View Grid\n(ViewGrid + slot layout)"]
    Layout["Layout\n(LayoutManager / useLayoutStore)"]
    WorkspaceMain["WorkspaceMain\n(orchestrator)"]

    ArrowPayload -.->|decoded by| View
    SourceTensor -->|dims determine| View
    View -->|wrapped by| ViewPanel
    ViewPanel -->|arranged in| ViewGrid
    ViewGrid -->|organised by| Layout
    WorkspaceMain -->|orchestrates| View
    WorkspaceMain -->|reads| Selection
    WorkspaceMain -->|fires| SliceRequest

    EventStream -->|overlaid on| View
    Brainstate -->|overlaid on| View

    %% ── State sync boundary ──────────────────────────────────────────
    ServerState -.->|StateDTO bootstrap| WorkspaceMain
    Selection -.->|PUT /api/v1/selection| ServerState

    %% ── DAG visualisation ────────────────────────────────────────────
    WorkspaceDAG -.->|DAGGraphView renders| DAGView["DAG View\n(DAGGraphView)"]

    %% ── Workspace Object bridge ──────────────────────────────────────
    WorkspaceObject["Workspace Object\n(frontend chip strip)"]
    SourceTensor -.->|TensorSummaryDTO| WorkspaceObject
    WorkspaceObject -->|selects tensor for| WorkspaceMain

    %% ── Styling ──────────────────────────────────────────────────────
    classDef backend  fill:#dde8f0,stroke:#4a7fa5,color:#000
    classDef frontend fill:#e8f4e8,stroke:#4a9a5a,color:#000
    classDef boundary fill:#fff8e1,stroke:#c9a227,color:#000

    class SourceTensor,DerivedTensor,Schema,Modality,Transform,TransformCache,WorkspaceDAG,PipelineExport,EventDetector,EventStream,Brainstate,ProcessingPipeline,ServerState backend
    class View,ViewPanel,ViewGrid,Layout,WorkspaceMain,WorkspaceObject,DAGView frontend
    class Selection,SliceRequest,ArrowPayload boundary
```

---

## Reading the Diagram

**Solid arrows** are intra-layer or same-side relationships:
- Data lineage: `Schema → Tensor → Transform → DerivedTensor`
- View pipeline: `View → ViewPanel → ViewGrid → Layout`
- Control: `Selection → SliceRequest → View data`

**Dashed arrows** cross the HTTP boundary or represent asynchronous
bootstrapping:
- `ServerState -.-> WorkspaceMain` — `GET /api/v1/state` returns `StateDTO`
  which bootstraps the frontend stores on load
- `Selection -.-> ServerState` — `PUT /api/v1/selection` persists the
  cursor to the server; React Query invalidation then refetches all slice queries
- `SourceTensor -.-> WorkspaceObject` — `TensorSummaryDTO` fields are mapped
  to frontend chip-strip objects in `WorkspaceMain`

**Node groupings** by layer (see [layers.md](layers.md)):
- Blue (backend): Analysis Layer entities — Tensor, Transform, ProcessingPipeline, DAG, Events, Brainstate
- Green (frontend): Visualization + UI Shell entities — View, ViewPanel, Layout, WorkspaceMain
- Yellow (boundary): State + Transport entities that exist on both sides or traverse the wire
