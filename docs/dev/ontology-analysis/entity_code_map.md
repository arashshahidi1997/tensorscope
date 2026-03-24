# TensorScope Entity Code Map

This document maps the code-discovered entities from [entity_inventory.md](/storage2/arash/projects/tensorscope/docs/explanation/entity_inventory.md) to their current implementations. It only maps code that exists in the repository.

## Entity: Tensor

### Backend implementation
- Core classes:
  - `TensorNode` stores named tensor data plus `source`, `transform`, and `params`.
  - `TensorRegistry` stores named `TensorNode` instances.
  - `TensorScopeState` keeps the tensor registry and active tensor.
- Server state:
  - `ServerState` exposes tensor iteration, metadata lookup, processed-tensor caching, and slice generation.
- DTO models:
  - `TensorSummaryDTO`
  - `TensorMetaDTO`
  - `CoordSummaryDTO`
  - `ElectrodeLayoutDTO`
  - `TensorSliceRequestDTO`
  - `TensorSliceDTO`
- Routers:
  - `GET /api/v1/tensors`
  - `GET /api/v1/tensors/{name}`
  - `POST /api/v1/tensors/{name}/slice`
  - `GET /api/v1/state`

### Frontend implementation
- Zustand stores:
  - `useAppStore` holds `selectedTensor`, `workspaceObjects`, and per-panel tensor overrides.
- View components:
  - `TensorChooser`
  - `TensorOverview`
  - `WorkspaceMain`
- Layout components:
  - `ViewPanel` uses panel-level tensor selection.
  - `ViewGrid` resolves the tensor shown in each slot.
- View registry:
  - `getAvailableViews(...)` derives available view ids from tensor schema.

### Important files
- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/tensors.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/tensors.py)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)
- [frontend/src/components/views/ViewGrid.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewGrid.tsx)

### Key functions
- `TensorRegistry.add`, `TensorRegistry.get`, `TensorRegistry.list`
- `TensorScopeState.set_active_tensor`
- `create_server_state`
- `tensor_summary`, `tensor_meta`, `coord_summary`
- `ServerState.tensor_meta`, `ServerState.tensor_slice`
- `list_tensors`, `get_tensor`, `get_tensor_slice`

## Entity: Selection

### Backend implementation
- Core classes:
  - `SelectionState` is the backend selection model.
- DTO models:
  - `SelectionDTO`
- Routers:
  - `GET /api/v1/selection`
  - `PUT /api/v1/selection`
  - Selection is also embedded in `StateDTO` and `TensorSliceRequestDTO`.

### Frontend implementation
- Zustand stores:
  - `useSelectionStore` holds `timeCursor`, `timeWindow`, `spatial`, `freq`, `event`, and `viewportDuration`.
- View components and hooks:
  - `useOverviewDetail`
  - `useEventNavigation`
  - `WorkspaceMain`
  - time-aware views such as `TimeseriesSliceView`, `NavigatorView`, `SpectrogramView`, and `HypnogramView` consume the shared selection state through props and callbacks.

### Important files
- [src/tensorscope/core/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/selection.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/selection.py)
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts)
- [frontend/src/components/views/useOverviewDetail.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useOverviewDetail.ts)
- [frontend/src/components/views/useEventNavigation.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useEventNavigation.ts)

### Key functions
- `SelectionState.update`
- `SelectionDTO.from_selection`
- `ServerState.update_selection`
- `get_selection`, `update_selection`
- `toSelectionDTO`
- `initFromDTO`, `patchFromDTO`, `setTimeCursor`, `setTimeWindow`, `setSpatial`, `setFreq`, `setEvent`

## Entity: Layout

### Backend implementation
- Core classes:
  - `LayoutPreset`
  - `LayoutManager`
- DTO models:
  - `LayoutDTO`
  - `LayoutUpdateDTO`
- Routers:
  - `GET /api/v1/layout`
  - `PUT /api/v1/layout`

### Frontend implementation
- Zustand stores:
  - `useLayoutStore` holds sidebar/inspector/bottom-panel state, maximized view, and grid layout.
- Layout components:
  - `ViewGrid`
  - `ViewPanel`
  - `viewGridLayout.ts` defines `DEFAULT_SLOT_LAYOUT` and slot/row helpers.
- App store cross-links:
  - `useAppStore.layoutDraft` exists for client-side layout state derived from API layout payloads.

### Important files
- [src/tensorscope/core/layout.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/layout.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/layout.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/layout.py)
- [frontend/src/store/layoutStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/layoutStore.ts)
- [frontend/src/components/views/ViewGrid.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewGrid.tsx)
- [frontend/src/components/views/ViewPanel.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewPanel.tsx)
- [frontend/src/components/views/viewGridLayout.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/viewGridLayout.ts)

### Key functions
- `LayoutManager.get_preset`, `LayoutManager.set_preset`, `LayoutManager.to_dict`
- `ServerState.layout_dto`, `ServerState.set_layout_preset`
- `get_layout`, `update_layout`
- `setSidebarWidth`, `toggleSidebar`, `setViewGridLayout`, `toggleMaximizeView`, `applyPreset`
- `isRowActive`, `findRowForView`, `getOverflowViews`

## Entity: Tensor Schema and Modalities

### Backend implementation
- Core classes and functions:
  - `SchemaError`
  - `validate_and_normalize_grid`
  - `flatten_grid_to_channels`
  - `DataModality`
  - `GridLFPModality`
  - `FlatLFPModality`
  - `SpectrogramModality`
  - `SpikeUnit`
  - `SpikeTrainsModality`
  - `align_to_common_timebase`
  - `find_nearest_time_index`
- No dedicated DTOs or routers were found for modality classes; they are backend-side helpers and abstractions.

### Frontend implementation
- No dedicated Zustand store or registry for modality classes was found.
- Frontend schema usage is indirect:
  - `getAvailableViews(...)` checks tensor dimension names.
  - view components assume dimensions such as `time`, `freq`, `AP`, `ML`, and `channel`.

### Important files
- [src/tensorscope/core/schema.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/schema.py)
- [src/tensorscope/core/data/modality.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/data/modality.py)
- [src/tensorscope/core/data/modalities.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/data/modalities.py)
- [src/tensorscope/core/data/alignment.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/data/alignment.py)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)

### Key functions
- `validate_and_normalize_grid`
- `flatten_grid_to_channels`
- `DataModality.time_bounds`, `DataModality.get_window`, `DataModality.to_dict`
- `GridLFPModality.to_flat`
- `align_to_common_timebase`
- `find_nearest_time_index`

## Entity: Transform

### Backend implementation
- Core classes:
  - `ParamSpec`
  - `InputSpec`
  - `OutputSpec`
  - `TransformDefinition`
  - `TransformRegistry`
  - `TransformExecutor`
  - `TransformCache`
- Built-in transform definitions:
  - `BANDPASS`
  - `SPECTROGRAM`
  - `PSD`
  - `BANDPOWER`
  - `COHERENCE`
  - `EVENT_ALIGN`
  - `DIM_REDUCTION`
  - `PREWHITEN`
- DTO models:
  - `TransformParamSpecDTO`
  - `TransformDefinitionDTO`
  - `TransformRequestDTO`
- Routers:
  - `GET /api/v1/transforms`
  - `GET /api/v1/transforms/{name}`
  - `GET /api/v1/transforms/compatible/{tensor_name}`
  - `POST /api/v1/transforms/execute`

### Frontend implementation
- Zustand stores:
  - `useActivityStore` tracks client-side activity entries for transform-like operations.
  - `useAppStore.workspaceObjects` stores source/derived tensor summaries surfaced to the UI.
- View components:
  - `WorkspaceMain` consumes available-view metadata and derived tensor state through API queries.
- View registry:
  - transform outputs are surfaced through `viewRegistry` and `getAvailableViews(...)` based on result dims.

### Important files
- [src/tensorscope/core/transforms/registry.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/registry.py)
- [src/tensorscope/core/transforms/executor.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/executor.py)
- [src/tensorscope/core/transforms/cache.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/cache.py)
- [src/tensorscope/core/transforms/builtins.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/builtins.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/transforms.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/transforms.py)
- [frontend/src/store/activityStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/activityStore.ts)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)

### Key functions
- `TransformRegistry.register`, `TransformRegistry.get`, `TransformRegistry.list_compatible`
- `TransformDefinition.validate_params`
- `TransformExecutor.execute`
- `register_builtins`
- `list_transforms`, `get_transform`, `list_compatible_transforms`, `execute_transform`
- `addActivity`, `updateActivity`

## Entity: Derived Tensor and Transform Provenance

### Backend implementation
- Core classes:
  - `TransformProvenance`
  - `DerivedTensor`
- DTO models:
  - `TransformProvenanceDTO`
  - `DerivedTensorDTO`
- Router usage:
  - returned from `POST /api/v1/transforms/execute`
- Cross-links:
  - `TransformExecutor.execute(...)` creates `DerivedTensor`.
  - successful execution also registers the result as a `TensorNode`.

### Frontend implementation
- Zustand stores:
  - `useAppStore.workspaceObjects` distinguishes `type: "source" | "derived"`.
- View components:
  - `WorkspaceMain` synthesizes workspace objects from tensor summaries and derived status returned through the API.
- No dedicated frontend provenance store was found outside the DAG-related state.

### Important files
- [src/tensorscope/core/transforms/model.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/model.py)
- [src/tensorscope/core/transforms/executor.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/executor.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/transforms.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/transforms.py)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)

### Key functions
- `TransformProvenance.to_dict`, `TransformProvenance.cache_key`
- `DerivedTensor.to_dict`, `DerivedTensor.from_dict`, `DerivedTensor.is_computed`
- `TransformExecutor.execute`

## Entity: Processing Pipeline

### Backend implementation
- DTO models:
  - `ProcessingParamsDTO`
  - `DownsampleMethod`
- Server state:
  - `ServerState.get_processing`
  - `ServerState.set_processing`
  - `ServerState._get_processed_tensor`
  - `apply_processing`
  - `downsample_time_axis`
  - `zscore_offset`
- Routers:
  - `GET /api/v1/processing`
  - `PUT /api/v1/processing`
- Processing is also applied from `apply_slice_request(...)`.

### Frontend implementation
- Zustand stores:
  - `useAppStore` stores PSD-specific parameters (`psdFmax`, `psdNW`, `psdWindowS`, `freqLogScale`).
- View components:
  - `WorkspaceMain` calls processing queries and renders the inline `ProcessingPanel`.
  - `ChartToolbar` and PSD-related views consume the related client-side control state.

### Important files
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/routers/processing.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/processing.py)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)

### Key functions
- `ProcessingParamsDTO.has_any_active`
- `ServerState.get_processing`, `ServerState.set_processing`
- `ServerState._get_processed_tensor`
- `apply_processing`
- `downsample_time_axis`
- `zscore_offset`
- `get_processing`, `set_processing`

## Entity: Workspace DAG

### Backend implementation
- Core classes:
  - `DAGTensorNode`
  - `DAGTransformNode`
  - `TransformEdge`
  - `ProvenanceStep`
  - `WorkspaceDAG`
- DTO models:
  - `DAGTensorNodeDTO`
  - `DAGTransformNodeDTO`
  - `TransformEdgeDTO`
  - `ProvenanceStepDTO`
  - `WorkspaceDAGDTO`
  - `DAGNodeVisibilityDTO`
- Routers:
  - `GET /api/v1/dag`
  - `GET /api/v1/dag/tensors/{node_id}`
  - `GET /api/v1/dag/transforms/{node_id}`
  - `PUT /api/v1/dag/tensors/{node_id}/visibility`
  - `GET /api/v1/dag/upstream/{node_id}`
  - `GET /api/v1/dag/downstream/{node_id}`
  - `GET /api/v1/dag/provenance/{tensor_node_id}`

### Frontend implementation
- Zustand stores:
  - `useDAGStore` holds `focusedNodeId` and `focusedNodeType`.
- App store cross-links:
  - `useAppStore.workspaceObjects` surfaces tensor-like workspace items.
- No dedicated DAG view component was found in the requested directories; current frontend implementation in these paths is store-level focus state plus general workspace components.

### Important files
- [src/tensorscope/core/transforms/dag.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/dag.py)
- [src/tensorscope/core/transforms/executor.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/transforms/executor.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/dag.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/dag.py)
- [frontend/src/store/dagStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/dagStore.ts)

### Key functions
- `WorkspaceDAG.add_tensor_node`, `WorkspaceDAG.add_transform_node`, `WorkspaceDAG.add_edge`
- `WorkspaceDAG.record_execution`
- `WorkspaceDAG.get_upstream`, `WorkspaceDAG.get_downstream`, `WorkspaceDAG.get_provenance_chain`
- `WorkspaceDAG.set_tensor_visible`, `WorkspaceDAG.set_tensor_exploratory`, `WorkspaceDAG.set_tensor_pipeline_selected`
- `get_dag`, `update_tensor_visibility`, `get_upstream`, `get_downstream`, `get_provenance_chain`
- `setFocusedNode`, `clearFocus`

## Entity: Pipeline Export

### Backend implementation
- Core classes:
  - `PipelineSourceTensor`
  - `PipelineTransformNode`
  - `PipelineDerivedTensor`
  - `ExecutionMetadata`
  - `PipelineSpec`
  - `WorkflowArtifact`
  - `WorkflowCooker`
  - `SnakemakeCooker`
- Extraction and export helpers:
  - `PipelineSelectionError`
  - `extract_pipeline`
  - `export_json`, `export_yaml`, `import_json`, `import_yaml`, `export_pipeline`
  - `get_cooker`
- DTO models:
  - `PipelineSourceTensorDTO`
  - `PipelineTransformNodeDTO`
  - `PipelineDerivedTensorDTO`
  - `ExecutionMetadataDTO`
  - `PipelineSpecDTO`
  - `PipelineExportRequestDTO`
  - `WorkflowArtifactDTO`
  - `PipelineExportResponseDTO`
- Routers:
  - `POST /api/v1/pipeline/export`
  - `POST /api/v1/pipeline/promote/{tensor_node_id}`
  - `POST /api/v1/pipeline/demote/{tensor_node_id}`

### Frontend implementation
- Zustand stores:
  - `useLayoutStore.activeSidebarTab` includes `pipeline`.
  - `useAppStore.workspaceObjects` and DAG state are the existing client-side structures that expose candidate tensors for pipeline-related UI flows.
- No dedicated pipeline store or pipeline-specific view component was found in the requested frontend directories.

### Important files
- [src/tensorscope/core/pipeline/spec.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/pipeline/spec.py)
- [src/tensorscope/core/pipeline/selection.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/pipeline/selection.py)
- [src/tensorscope/core/pipeline/export.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/pipeline/export.py)
- [src/tensorscope/core/pipeline/cooker.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/pipeline/cooker.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/pipeline.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/pipeline.py)
- [frontend/src/store/layoutStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/layoutStore.ts)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)

### Key functions
- `extract_pipeline`
- `_topo_sort_transforms`
- `PipelineSpec.to_dict`, `PipelineSpec.from_dict`
- `export_pipeline`
- `get_cooker`
- `export_pipeline` router function
- `promote_tensor`, `demote_tensor`

## Entity: Event Stream

### Backend implementation
- Core classes:
  - `EventStyle`
  - `EventStream`
  - `EventRegistry`
- DTO models:
  - `EventStreamMetaDTO`
  - `EventRecordDTO`
- Routers:
  - `GET /api/v1/events`
  - `GET /api/v1/events/{name}`
  - `GET /api/v1/events/{name}/window`
- App wiring:
  - `ServerState.events` stores the registry.
  - `event_stream_meta(...)` adapts backend event streams to DTOs.

### Frontend implementation
- Zustand stores:
  - `useSelectionStore.event` stores selected event identity.
- View components:
  - `EventTableView`
  - `EventSummary`
  - `EventOverlaySummary`
  - `SpatialEventView`
- Hooks:
  - `useEventNavigation`

### Important files
- [src/tensorscope/core/events/model.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/events/model.py)
- [src/tensorscope/core/events/registry.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/events/registry.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/events.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/events.py)
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts)
- [frontend/src/components/views/EventTableView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/EventTableView.tsx)
- [frontend/src/components/views/SpatialEventView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/SpatialEventView.tsx)
- [frontend/src/components/views/useEventNavigation.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useEventNavigation.ts)

### Key functions
- `EventStream.get_events_in_window`, `EventStream.get_event_by_id`, `EventStream.get_next_event`, `EventStream.get_prev_event`
- `EventRegistry.register`, `EventRegistry.get`, `EventRegistry.list`
- `event_stream_meta`
- `list_event_streams`, `get_event_stream`, `get_event_window`
- `selectEvent`, `clearEvent`

## Entity: Event Detector

### Backend implementation
- Core classes:
  - `DetectorParamSpec`
  - `EventDetector`
  - `ThresholdDetector`
- Registry functions:
  - `register_detector`
  - `get_detector`
  - `list_detectors`
- DTO models:
  - `DetectorParamSpecDTO`
  - `DetectorDefinitionDTO`
  - `DetectRequestDTO`
  - `DetectResultDTO`
- Router:
  - `GET /api/v1/events/detectors`
  - `POST /api/v1/events/detect`

### Frontend implementation
- No dedicated detector store or detector component was found in the requested frontend directories.
- Detector results flow into the existing event-stream path once registered on the backend.

### Important files
- [src/tensorscope/core/events/detectors.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/events/detectors.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/events.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/events.py)

### Key functions
- `ThresholdDetector.detect`
- `register_detector`, `get_detector`, `list_detectors`
- `list_event_detectors`
- `run_detector`

## Entity: Brainstate

### Backend implementation
- Server state helpers:
  - `brainstate_intervals`
  - `brainstate_meta`
- Router:
  - `GET /api/v1/brainstates`
  - `GET /api/v1/brainstates/intervals`
- Storage:
  - `ServerState.brainstates` holds the optional brainstate `xarray.DataArray`.

### Frontend implementation
- Zustand stores:
  - `useAppStore.brainstateOverlay`
  - `useAppStore.showHypnogram`
- View components:
  - `HypnogramView`
  - brainstate-related helpers in `brainstateOverlay.ts` and `brainstateColors.ts`
  - `NavigatorView` and `WorkspaceMain` consume the interval metadata.

### Important files
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/routers/brainstates.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/brainstates.py)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/HypnogramView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/HypnogramView.tsx)
- [frontend/src/components/views/brainstateOverlay.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/brainstateOverlay.ts)
- [frontend/src/components/views/brainstateColors.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/brainstateColors.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)

### Key functions
- `brainstate_intervals`
- `brainstate_meta`
- `get_brainstate_meta`
- `get_brainstate_intervals`
- `toggleBrainstateOverlay`
- `toggleHypnogram`
- `makeBrainstateDrawHook`

## Entity: Session and App State

### Backend implementation
- Core server classes:
  - `SessionRecord`
  - `SessionManager`
  - `ServerState`
- DTO models:
  - `StateDTO`
  - `ApiErrorDTO`
- Routers:
  - `GET /api/v1/state`
- App factory:
  - `create_app(...)` creates a `SessionManager`, mounts routers, and installs error handlers.

### Frontend implementation
- Zustand stores:
  - `useAppStore`
  - `useSelectionStore`
  - `useLayoutStore`
  - `useDAGStore`
  - `useActivityStore`
- View components:
  - `WorkspaceMain` is the main consumer of server state queries in the requested frontend paths.

### Important files
- [src/tensorscope/server/session.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/session.py)
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/app.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/app.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/state.py)
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/store/selectionStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/selectionStore.ts)
- [frontend/src/store/layoutStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/layoutStore.ts)
- [frontend/src/store/dagStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/dagStore.ts)
- [frontend/src/store/activityStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/activityStore.ts)

### Key functions
- `SessionManager.get_or_create`, `SessionManager.cleanup`
- `ServerState.state_dto`
- `create_app`
- `register_error_handlers`
- `get_state`

## Entity: View

### Backend implementation
- Server view registry:
  - `_VIEW_REGISTRY` maps tensor dimension sets to view ids.
  - `available_views(...)` computes view ids for a tensor.
- Slice generation:
  - `apply_slice_request(...)` applies per-view logic.
- DTO models:
  - `TensorSliceRequestDTO`
  - `TensorSliceDTO`
- Routers:
  - tensor slice endpoints serve all view-specific data.

### Frontend implementation
- View registry:
  - `VIEW_DESCRIPTORS`
  - `getAvailableViews(...)`
  - `getOrthoPair(...)`
  - `viewRegistry`
- View components found in `frontend/src/components/views`:
  - `TimeseriesSliceView`
  - `SpatialMapSliceView`
  - `NavigatorView`
  - `SpectrogramView`
  - `PSDSliceView`
  - `PSDHeatmapView`
  - `PSDCurveView`
  - `PSDSpatialView`
  - `HypnogramView`
  - `PropagationView`
  - `PropagationController`
  - `OrthoSlicerView`
  - `PlaceholderSliceView`

### Important files
- [src/tensorscope/server/state.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/state.py)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)
- [src/tensorscope/server/routers/tensors.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/tensors.py)
- [frontend/src/registry/viewRegistry.ts](/storage2/arash/projects/tensorscope/frontend/src/registry/viewRegistry.ts)
- [frontend/src/components/views/viewTypes.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/viewTypes.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)

### Key functions
- `available_views`
- `apply_slice_request`
- `ServerState.tensor_slice`
- `getAvailableViews`
- `getOrthoPair`
- `expandPSDLive`

## Entity: Panel and Slot-Based View Layout

### Backend implementation
- Backend layout presets reference logical panel ids such as `spatial_map`, `navigator`, `timeseries`, `psd_explorer`, `selector`, and `processing`.
- DTO models:
  - `LayoutDTO`
- Router:
  - `GET /api/v1/layout`
  - `PUT /api/v1/layout`

### Frontend implementation
- Zustand stores:
  - `useLayoutStore`
- Layout components:
  - `ViewGrid`
  - `ViewPanel`
  - `viewGridLayout.ts`
- Structural types:
  - `ViewSlot`
  - `ViewRow`
  - `ViewSlotLayout`
  - `ViewGridLayout`

### Important files
- [src/tensorscope/core/layout.py](/storage2/arash/projects/tensorscope/src/tensorscope/core/layout.py)
- [src/tensorscope/server/routers/layout.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/routers/layout.py)
- [frontend/src/store/layoutStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/layoutStore.ts)
- [frontend/src/components/views/ViewGrid.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewGrid.tsx)
- [frontend/src/components/views/ViewPanel.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/ViewPanel.tsx)
- [frontend/src/components/views/viewGridLayout.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/viewGridLayout.ts)

### Key functions
- `LayoutManager.to_dict`
- `set_layout_preset`
- `toggleMaximizeView`
- `handleClose` in `ViewGrid`
- `getSlottedViewIds`
- `getOverflowViews`

## Entity: Workspace Object

### Backend implementation
- No dedicated backend class named `WorkspaceObject` was found.
- The closest backend sources are:
  - `TensorSummaryDTO` from `/state`
  - `TensorNode` / `DerivedTensor`
  - `DAGTensorNode`

### Frontend implementation
- Zustand stores:
  - `useAppStore.workspaceObjects`
- View components:
  - `WorkspaceMain` synthesizes workspace objects from `stateQuery.data.tensors`.

### Important files
- [frontend/src/store/appStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/appStore.ts)
- [frontend/src/components/views/WorkspaceMain.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/WorkspaceMain.tsx)
- [src/tensorscope/server/models.py](/storage2/arash/projects/tensorscope/src/tensorscope/server/models.py)

### Key functions
- `setWorkspaceObjects`
- `setObjectVisible`
- `setObjectLayoutMode`

## Entity: Activity Entry

### Backend implementation
- No dedicated backend activity-entry class, DTO, or router was found in the requested backend paths.

### Frontend implementation
- Zustand stores:
  - `useActivityStore`
- Structural types:
  - `ActivityStatus`
  - `ActivityEntry`

### Important files
- [frontend/src/store/activityStore.ts](/storage2/arash/projects/tensorscope/frontend/src/store/activityStore.ts)

### Key functions
- `addActivity`
- `updateActivity`
- `clearEntries`
