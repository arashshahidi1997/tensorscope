# TensorScope Entity Inventory

This document lists candidate conceptual entities discovered by inspecting the codebase. It records names and descriptions that appear to be used as first-class concepts in code. It does not attempt to define the architecture.

## Core data and state entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `TensorNode` | Core tensor/state model | `src/tensorscope/core/state.py`, `TensorNode` | Immutable named tensor object holding an `xarray.DataArray` plus lineage metadata such as `source`, `transform`, and `params`. |
| `TensorRegistry` | Core tensor/state model | `src/tensorscope/core/state.py`, `TensorRegistry` | Registry of named `TensorNode` objects used as the system’s tensor catalog. |
| `SelectionState` | Core tensor/state model; API DTO conversion; frontend selection store mapping | `src/tensorscope/core/state.py`, `SelectionState`; `src/tensorscope/server/models.py`, `SelectionDTO`; `frontend/src/store/selectionStore.ts` | Global selection coordinates for time, frequency, AP, ML, and optional channel. |
| `TensorScopeState` | Core tensor/state model | `src/tensorscope/core/state.py`, `TensorScopeState` | Unified backend state holding the tensor registry, global selection, and active tensor. |
| `SchemaError` | Core schema validation | `src/tensorscope/core/schema.py`, `SchemaError` | Error raised when tensor data does not match the expected labeled-dimension schema. |
| Grid tensor schema | Core schema validation | `src/tensorscope/core/schema.py`, `validate_and_normalize_grid` | Canonical spatial tensor form with dimensions `(time, AP, ML)`. |
| Flat tensor schema | Core schema validation | `src/tensorscope/core/schema.py`, `_extract_ap_ml_from_channel`, `flatten_grid_to_channels` | Channel-based tensor form `(time, channel)` with AP/ML per-channel coordinates or MultiIndex metadata. |
| `DataModality` | Core modality abstraction | `src/tensorscope/core/data/modality.py`, `DataModality` | Abstract interface for time-bounded data modalities that can report sampling rate and return windows. |
| `GridLFPModality` | Core modality implementations | `src/tensorscope/core/data/modalities.py`, `GridLFPModality` | LFP modality backed by canonical `(time, AP, ML)` tensor data. |
| `FlatLFPModality` | Core modality implementations | `src/tensorscope/core/data/modalities.py`, `FlatLFPModality` | LFP modality backed by `(time, channel)` tensor data. |
| `SpectrogramModality` | Core modality implementations | `src/tensorscope/core/data/modalities.py`, `SpectrogramModality` | Time-frequency modality for tensors with `time` and `freq` plus either spatial or channel dimensions. |
| `SpikeUnit` | Core modality implementations | `src/tensorscope/core/data/modalities.py`, `SpikeUnit` | Single unit spike train represented by unit id and spike times in seconds. |
| `SpikeTrainsModality` | Core modality implementations | `src/tensorscope/core/data/modalities.py`, `SpikeTrainsModality` | Irregular spike timestamps grouped by unit. |
| Common timebase alignment | Core data helpers | `src/tensorscope/core/data/alignment.py`, `align_to_common_timebase`, `find_nearest_time_index` | Helper concept for aligning multiple time arrays or locating the nearest sampled time. |

## Layout and panel entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `LayoutPreset` | Core layout model | `src/tensorscope/core/layout.py`, `LayoutPreset` | Pure-data layout descriptor mapping panel ids to logical grid coordinates and sidebar panel lists. |
| `LayoutManager` | Core layout registry | `src/tensorscope/core/layout.py`, `LayoutManager` | Registry and state holder for named layout presets such as `default`, `spatial_focus`, `timeseries_focus`, and `psd_explorer`. |
| `LayoutDTO` / `LayoutUpdateDTO` | Server API model | `src/tensorscope/server/models.py`, `LayoutDTO`, `LayoutUpdateDTO` | API payloads representing the current layout and layout preset changes. |
| `SidebarTabId` | Frontend layout store | `frontend/src/store/layoutStore.ts` | Named sidebar tabs: `explore`, `graph`, `tensors`, `events`, `pipeline`. |
| `ViewSlot` | Frontend layout store | `frontend/src/store/layoutStore.ts`, `ViewSlot` | Slot record assigning a view id to a region and width fraction within a row. |
| `ViewRow` | Frontend layout store | `frontend/src/store/layoutStore.ts`, `ViewRow` | Named row of view slots with label and minimum height. |
| `ViewSlotLayout` | Frontend layout store; view grid helpers | `frontend/src/store/layoutStore.ts`, `ViewSlotLayout`; `frontend/src/components/views/viewGridLayout.ts` | Slot-based layout structure composed of rows and slots. |
| `GridCell` / `ViewGridLayout` | Frontend layout store | `frontend/src/store/layoutStore.ts` | Older grid-layout representation kept for preset compatibility. |
| `LayoutState` | Frontend layout store | `frontend/src/store/layoutStore.ts` | UI layout state for sidebar, inspector, bottom panel, grid layout, and maximized view. |
| `ViewGrid` | Frontend views | `frontend/src/components/views/ViewGrid.tsx` | Main slot-based renderer for active view panels. |
| `ViewPanel` | Frontend views | `frontend/src/components/views/ViewPanel.tsx` | Panel chrome wrapper providing header, per-panel tensor selector, maximize, and close actions. |
| `panelTensorOverrides` | Frontend app store | `frontend/src/store/appStore.ts` | Per-panel tensor override map allowing individual panels to show a tensor different from the global selection. |

## Transform and processing entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `ParamSpec` | Core transform registry | `src/tensorscope/core/transforms/registry.py`, `ParamSpec` | Schema for a single transform parameter, including type, defaults, bounds, and choices. |
| `InputSpec` | Core transform registry | `src/tensorscope/core/transforms/registry.py`, `InputSpec` | Declares required input dimensions and input count constraints for a transform. |
| `OutputSpec` | Core transform registry | `src/tensorscope/core/transforms/registry.py`, `OutputSpec` | Declares output dimension names, dtype, and coordinate rules for a transform. |
| `TransformDefinition` | Core transform registry | `src/tensorscope/core/transforms/registry.py`, `TransformDefinition` | Declarative transform definition containing name, parameter schema, IO specs, compute function, and description. |
| `TransformRegistry` | Core transform registry | `src/tensorscope/core/transforms/registry.py`, `TransformRegistry` | Registry of available transforms and compatibility queries against tensors. |
| `TransformProvenance` | Core transform model | `src/tensorscope/core/transforms/model.py`, `TransformProvenance` | Immutable record of transform name, parameters, and parent tensor ids used to produce a derived tensor. |
| `DerivedTensor` | Core transform model; server DTO | `src/tensorscope/core/transforms/model.py`, `DerivedTensor`; `src/tensorscope/server/models.py`, `DerivedTensorDTO` | First-class tensor result of transform execution, with provenance, shape metadata, status, cached key, and optional data payload. |
| `TransformCache` | Core transform cache | `src/tensorscope/core/transforms/cache.py`, `TransformCache` | In-memory cache keyed by transform provenance hash. |
| `TransformExecutor` | Core transform execution | `src/tensorscope/core/transforms/executor.py`, `TransformExecutor` | Validator and executor for registered transforms that also populates cache, tensor registry, and DAG state. |
| Built-in transform `bandpass` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `BANDPASS` | Bandpass filter transform along the time axis. |
| Built-in transform `spectrogram` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `SPECTROGRAM` | Short-time Fourier transform producing power spectrogram output. |
| Built-in transform `psd` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `PSD` | Welch PSD transform producing frequency-domain output. |
| Built-in transform `bandpower` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `BANDPOWER` | Frequency-band aggregation over tensors that already have a `freq` dimension. |
| Built-in transform `coherence` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `COHERENCE` | Pairwise coherence transform over channel-like data. |
| Built-in transform `event_align` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `EVENT_ALIGN` | Event-aligned window extraction transform producing an `event` by `time_offset` tensor. |
| Built-in transform `dim_reduction` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `DIM_REDUCTION` | PCA-based dimensionality reduction over channel-like tensors. |
| Built-in transform `prewhiten` | Built-in transform registry | `src/tensorscope/core/transforms/builtins.py`, `PREWHITEN` | Temporal differencing step used to remove autocorrelation. |
| `ProcessingParamsDTO` | Server API model; processing pipeline | `src/tensorscope/server/models.py`, `ProcessingParamsDTO`; `src/tensorscope/server/state.py`, `apply_processing` | Request/state object describing preprocessing steps such as CMR, bandpass, notch, spatial median, and z-score. |
| Slice-time processing pipeline | Server state | `src/tensorscope/server/state.py`, `apply_processing` | Fixed-order preprocessing path applied to tensors before slicing when enabled. |
| Downsampling methods | Server API model; server state | `src/tensorscope/server/models.py`, `DownsampleMethod`; `src/tensorscope/server/state.py`, `downsample_time_axis` | Named time-axis reduction strategies: `none`, `minmax`, and `lttb`. |
| Activity entry | Frontend activity store | `frontend/src/store/activityStore.ts`, `ActivityEntry` | Client-side record of work items with status, timings, params, cache-hit flag, and error. |

## DAG and provenance entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `DAGTensorNode` | Core DAG model; server DTO | `src/tensorscope/core/transforms/dag.py`, `DAGTensorNode`; `src/tensorscope/server/models.py`, `DAGTensorNodeDTO` | Graph node representing a source or derived tensor, with visibility, exploratory, and pipeline-selection flags. |
| `DAGTransformNode` | Core DAG model; server DTO | `src/tensorscope/core/transforms/dag.py`, `DAGTransformNode`; `src/tensorscope/server/models.py`, `DAGTransformNodeDTO` | Graph node representing one transform execution and its parameter snapshot. |
| `TransformEdge` | Core DAG model; server DTO | `src/tensorscope/core/transforms/dag.py`, `TransformEdge`; `src/tensorscope/server/models.py`, `TransformEdgeDTO` | Directed edge linking tensor-to-transform inputs or transform-to-tensor outputs. |
| `ProvenanceStep` | Core DAG model; server DTO | `src/tensorscope/core/transforms/dag.py`, `ProvenanceStep`; `src/tensorscope/server/models.py`, `ProvenanceStepDTO` | One lineage step linking input tensor, transform, params, and output tensor. |
| `WorkspaceDAG` | Core DAG model; server DTO; frontend DAG focus store | `src/tensorscope/core/transforms/dag.py`, `WorkspaceDAG`; `src/tensorscope/server/models.py`, `WorkspaceDAGDTO`; `frontend/src/store/dagStore.ts` | Workspace graph connecting source and derived tensors through transform nodes and edges. |
| `DAGNodeVisibilityDTO` | Server API model | `src/tensorscope/server/models.py`, `DAGNodeVisibilityDTO` | Request payload for toggling tensor-node visibility or exploratory status. |
| `focusedNodeId` / `focusedNodeType` | Frontend DAG store | `frontend/src/store/dagStore.ts` | Client-side focused DAG node used for inspector state. |

## Pipeline export entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `PipelineSourceTensor` | Core pipeline spec | `src/tensorscope/core/pipeline/spec.py`, `PipelineSourceTensor` | Source tensor declaration in an exported pipeline, optionally with a data reference. |
| `PipelineTransformNode` | Core pipeline spec | `src/tensorscope/core/pipeline/spec.py`, `PipelineTransformNode` | Promoted transform execution in an exported pipeline spec. |
| `PipelineDerivedTensor` | Core pipeline spec | `src/tensorscope/core/pipeline/spec.py`, `PipelineDerivedTensor` | Derived tensor declaration in a pipeline spec. |
| `ExecutionMetadata` | Core pipeline spec | `src/tensorscope/core/pipeline/spec.py`, `ExecutionMetadata` | Metadata about when and in which session a pipeline spec was created. |
| `PipelineSpec` | Core pipeline spec; server DTO | `src/tensorscope/core/pipeline/spec.py`, `PipelineSpec`; `src/tensorscope/server/models.py`, `PipelineSpecDTO` | Serializable pipeline document extracted from the workspace DAG. |
| `PipelineSelectionError` | Pipeline extraction | `src/tensorscope/core/pipeline/selection.py`, `PipelineSelectionError` | Error type for invalid or non-exportable DAG selections. |
| `extract_pipeline` | Pipeline extraction | `src/tensorscope/core/pipeline/selection.py`, `extract_pipeline` | Function that walks upstream from selected output tensors to build a minimal pipeline spec. |
| `WorkflowArtifact` | Pipeline cooker | `src/tensorscope/core/pipeline/cooker.py`, `WorkflowArtifact` | Generated workflow artifact identified by filename and content. |
| `WorkflowCooker` | Pipeline cooker | `src/tensorscope/core/pipeline/cooker.py`, `WorkflowCooker` | Abstract workflow generator for turning a pipeline spec into runnable artifacts. |
| `SnakemakeCooker` | Pipeline cooker | `src/tensorscope/core/pipeline/cooker.py`, `SnakemakeCooker` | Concrete workflow cooker that emits Snakemake-oriented artifacts. |
| Pipeline export/import payloads | Server API model | `src/tensorscope/server/models.py`, `PipelineExportRequestDTO`, `PipelineExportResponseDTO`, `WorkflowArtifactDTO` | API payloads for requesting a pipeline export and returning the spec plus generated workflow artifacts. |

## Event and detector entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `EventStyle` | Core event model | `src/tensorscope/core/events/model.py`, `EventStyle` | Display metadata for an event stream, including color, marker, alpha, and line width. |
| `EventStream` | Core event model; server DTO mapping | `src/tensorscope/core/events/model.py`, `EventStream`; `src/tensorscope/server/state.py`, `event_stream_meta` | Timestamped event collection backed by a DataFrame and accessed by window, id, next, and previous queries. |
| `EventRegistry` | Core event model; server state | `src/tensorscope/core/events/registry.py`, `EventRegistry`; `src/tensorscope/server/state.py`, `ServerState.events` | Registry of named event streams. |
| `DetectorParamSpec` | Core detector framework | `src/tensorscope/core/events/detectors.py`, `DetectorParamSpec` | Schema for one detector parameter. |
| `EventDetector` | Core detector framework | `src/tensorscope/core/events/detectors.py`, `EventDetector` | Abstract base class for event detectors that consume a tensor and produce an event stream. |
| `ThresholdDetector` | Core detector framework | `src/tensorscope/core/events/detectors.py`, `ThresholdDetector` | Built-in event detector that marks threshold crossings in time-series data. |
| Detector registry | Core detector framework | `src/tensorscope/core/events/detectors.py`, `register_detector`, `get_detector`, `list_detectors` | Global detector registry for built-in and future detectors. |
| Event DTOs | Server API model | `src/tensorscope/server/models.py`, `EventStreamMetaDTO`, `EventRecordDTO`, `DetectorDefinitionDTO`, `DetectRequestDTO`, `DetectResultDTO` | API shapes for event streams, event records, detector definitions, and detector execution results. |
| Event selection | Frontend selection store; event navigation hook | `frontend/src/store/selectionStore.ts`; `frontend/src/components/views/useEventNavigation.ts` | Shared frontend state for the selected event id and stream name. |

## Server session and API entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `SessionRecord` | Server session management | `src/tensorscope/server/session.py`, `SessionRecord` | In-memory record binding a session id to `ServerState` and expiration time. |
| `SessionManager` | Server session management | `src/tensorscope/server/session.py`, `SessionManager` | TTL-backed server session store that clones template state for new sessions. |
| `ServerState` | Server state | `src/tensorscope/server/state.py`, `ServerState` | Mutable per-session server object holding app state, layout, events, processing state, transform services, DAG, and processed-tensor cache. |
| `create_server_state` | Server state factory | `src/tensorscope/server/state.py`, `create_server_state` | Factory that constructs a server-ready session from one tensor or a tensor mapping. |
| `TensorSummaryDTO` / `TensorMetaDTO` | Server API model | `src/tensorscope/server/models.py` | Summary and detailed metadata payloads for tensors, including view availability and coordinate summaries. |
| `CoordSummaryDTO` | Server API model | `src/tensorscope/server/models.py`, `CoordSummaryDTO` | Lightweight metadata summary for a coordinate axis. |
| `ElectrodeLayoutDTO` | Server API model; server state | `src/tensorscope/server/models.py`, `ElectrodeLayoutDTO`; `src/tensorscope/server/state.py`, `electrode_layout` | Spatial layout description inferred from AP/ML coordinates. |
| `TensorSliceRequestDTO` / `TensorSliceDTO` | Server API model; server slicing | `src/tensorscope/server/models.py`; `src/tensorscope/server/state.py`, `apply_slice_request`, `tensor_slice` | Request/response pair for view-specific tensor slicing, selection, downsampling, and Arrow serialization. |
| View availability registry | Server state | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`, `available_views` | Mapping from tensor dimension sets to server-advertised view ids. |
| Brainstate intervals/meta | Server state; brainstate routes | `src/tensorscope/server/state.py`, `brainstate_intervals`, `brainstate_meta`; `src/tensorscope/server/routers/brainstates.py` | Brainstate-specific interval and metadata representation derived from a 1-D state code time series. |
| `StateDTO` | Server API model | `src/tensorscope/server/models.py`, `StateDTO` | Top-level session state payload including active tensor, selection, layout, tensor summaries, and event summaries. |
| `ApiErrorDTO` | Server API model | `src/tensorscope/server/models.py`, `ApiErrorDTO` | Structured API error response payload. |

## Frontend selection, workspace, and view entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `SelectionStore` | Frontend store | `frontend/src/store/selectionStore.ts` | Zustand store holding current time cursor, time window, spatial selection, frequency selection, event selection, and viewport duration. |
| `timeWindow` / `viewportDuration` | Frontend selection store; overview-detail hook | `frontend/src/store/selectionStore.ts`; `frontend/src/components/views/useOverviewDetail.ts` | Shared visible time range and zoom-scale concepts used across time-based views. |
| Spatial multi-selection | Frontend selection store | `frontend/src/store/selectionStore.ts`, `hoveredId`, `selectedIds`, `setSpatialBrush` | Store concepts for hovered electrode, selected electrodes, and brush-based selection. |
| `AppStore` | Frontend app store | `frontend/src/store/appStore.ts` | Global UI store for selected tensor, active views, theme, PSD settings, workspace objects, and panel tensor overrides. |
| `WorkspaceObject` | Frontend app store | `frontend/src/store/appStore.ts`, `WorkspaceObject` | Frontend representation of a source or derived tensor shown in the workspace object list. |
| `ThemeId` | Frontend app store | `frontend/src/store/appStore.ts` | Named frontend theme options. |
| `objectLayoutMode` | Frontend app store | `frontend/src/store/appStore.ts` | Workspace object display mode: `single`, `row`, or `column`. |
| `SliceViewProps` | Frontend view contract | `frontend/src/components/views/viewTypes.ts` | Common prop contract for slice-rendering views, including selection and callback hooks for time, cell, frequency, and window changes. |
| `WorkspaceMain` | Frontend views | `frontend/src/components/views/WorkspaceMain.tsx` | Main workspace orchestrator that wires shared state, queries, and linked scientific views. |
| `TensorChooser` | Frontend views | `frontend/src/components/views/TensorChooser.tsx` | Selector component for choosing among available tensors. |
| `TensorOverview` | Frontend views | `frontend/src/components/views/TensorOverview.tsx` | Overview component for a tensor and its togglable active views. |
| `useOverviewDetail` | Frontend views | `frontend/src/components/views/useOverviewDetail.ts` | Hook exposing the shared overview-detail time navigation contract. |
| `useEventNavigation` | Frontend views | `frontend/src/components/views/useEventNavigation.ts` | Hook exposing the selected event identity and store-local event navigation actions. |

## View registry and concrete view entities

| Entity name | Where it appears in code | Relevant files/classes | Short description inferred from code |
| --- | --- | --- | --- |
| `VIEW_DESCRIPTORS` | Frontend view registry | `frontend/src/registry/viewRegistry.ts` | Canonical client-side list of available view descriptors with ids, labels, required dimensions, and priorities. |
| `ViewDescriptor`-based available views | Frontend view registry | `frontend/src/registry/viewRegistry.ts`, `getAvailableViews` | Filtering mechanism that decides which views can render a tensor schema. |
| `OrthoPair` | Frontend view registry | `frontend/src/registry/viewRegistry.ts`, `OrthoPair`, `getOrthoPair` | Linked pair of view ids used for orthogonal slicing of 4-D tensors. |
| `viewRegistry` | Frontend view registry | `frontend/src/registry/viewRegistry.ts` | Mapping from view id strings to React renderer components. |
| `timeseries` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/TimeseriesSliceView.tsx` | Time-based slice renderer for traces and linked time navigation. |
| `spatial_map` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/SpatialMapSliceView.tsx` | Spatial frame view driven by AP/ML coordinates and selected time. |
| `navigator` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/NavigatorView.tsx` | Overview time navigator used to control visible window and cursor. |
| `spectrogram` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/SpectrogramView.tsx` | Time-frequency view for tensors with `time` and `freq`. |
| `propagation_frame` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PropagationView.tsx`, `PropagationController.tsx` | Spatial propagation-oriented view using a selected frame time from a spatial tensor. |
| `psd_live` server view | Server slicing and view registry | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`, `apply_slice_request` | Special server-side slice mode that computes a live multitaper PSD from a time window. |
| `psd_average` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PSDSliceView.tsx` | PSD view collapsing time to show average frequency content. |
| `psd_spatial` view | Server view registry; frontend registry/component | `src/tensorscope/server/state.py`, `_VIEW_REGISTRY`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PSDSpatialView.tsx` | PSD-derived spatial view keyed by selected frequency. |
| `psd_heatmap` view | Frontend registry/component | `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PSDHeatmapView.tsx` | Frontend PSD sub-view rendered from the expanded `psd_live` result. |
| `psd_curve` view | Frontend registry/component | `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PSDCurveView.tsx` | Frontend PSD line-plot sub-view rendered from the expanded `psd_live` result. |
| `hypnogram` view | Frontend registry/component | `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/HypnogramView.tsx` | Brainstate interval view aligned to time. |
| `table` view | Server/frontend fallback view | `src/tensorscope/server/state.py`, `available_views`; `frontend/src/registry/viewRegistry.ts`; `frontend/src/components/views/PlaceholderSliceView.tsx` | Fallback generic view id used when no more specific renderer applies. |
| `SpatialEventView` | Frontend views | `frontend/src/components/views/SpatialEventView.tsx` | Spatial event-oriented visualization component. |
| `EventTableView` | Frontend views | `frontend/src/components/views/EventTableView.tsx` | Tabular event display component. |
| `EventSummary` / `EventOverlaySummary` | Frontend views | `frontend/src/components/views/EventSummary.tsx`, `EventOverlaySummary.tsx` | Small summary components for event collections and overlays. |
| `OrthoSlicerView` | Frontend views | `frontend/src/components/views/OrthoSlicerView.tsx` | Composite view for orthogonal slicing of tensors that have time, frequency, and spatial dimensions. |
| `PropagationController` | Frontend views | `frontend/src/components/views/PropagationController.tsx` | Controller component for propagation playback/strip/tiled modes. |
| `ChartToolbar` / `TimeScaleBar` | Frontend views | `frontend/src/components/views/ChartToolbar.tsx` | Time scale and interaction controls for time-based charts. |
| `SpatialRendererBackend` | Frontend views | `frontend/src/components/views/SpatialRenderer.ts`, `SpatialRendererBackend` | Rendering backend contract for spatial cell drawing. |
